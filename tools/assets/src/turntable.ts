/**
 * A software turntable (M10a1): three orthographic flat-shaded views of a GLB (front, side, back) at 512 x 512, rendered on the CPU so
 * that gate A7 (SSIM of mid and lo against hi) and the A2 check of a mesh candidate run without a GPU or a browser. The shading comes from
 * the face normals; textures are ignored, so the frames compare silhouette and form, which is what the LOD simplification changes.
 */
import type { Document } from '@gltf-transform/core';
import type { Raster } from './image.ts';

export const TURNTABLE_ANGLES_DEG: readonly number[] = [0, 90, 180];
export const TURNTABLE_SIZE = 512;

export interface Framing {
  cx: number;
  cy: number;
  cz: number;
  /** Pixels per metre. */
  scale: number;
}

type Tri = [number, number, number, number, number, number, number, number, number];

function worldTriangles(doc: Document): Tri[] {
  const out: Tri[] = [];
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (mesh === null) continue;
    const m = n.getWorldMatrix();
    const tx = (x: number, y: number, z: number): [number, number, number] => [
      (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
      (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
      (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number),
    ];
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const pos = prim.getAttribute('POSITION');
      if (pos === null) continue;
      const idx = prim.getIndices();
      const count = idx !== null ? idx.getCount() : pos.getCount();
      const v = [0, 0, 0];
      const vertex = (i: number): [number, number, number] => {
        pos.getElement(idx !== null ? (idx.getScalar(i) as number) : i, v);
        return tx(v[0] as number, v[1] as number, v[2] as number);
      };
      for (let i = 0; i + 2 < count; i += 3) {
        const a = vertex(i);
        const b = vertex(i + 1);
        const c = vertex(i + 2);
        out.push([a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]]);
      }
    }
  }
  return out;
}

/** Framing that fits a model into the frame with a 6 % margin. */
export function frameOf(doc: Document): Framing {
  const tris = worldTriangles(doc);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of tris) {
    for (let k = 0; k < 9; k += 3) {
      minX = Math.min(minX, t[k] as number); maxX = Math.max(maxX, t[k] as number);
      minY = Math.min(minY, t[k + 1] as number); maxY = Math.max(maxY, t[k + 1] as number);
      minZ = Math.min(minZ, t[k + 2] as number); maxZ = Math.max(maxZ, t[k + 2] as number);
    }
  }
  if (tris.length === 0) return { cx: 0, cy: 0, cz: 0, scale: 1 };
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2, scale: (TURNTABLE_SIZE * 0.94) / extent };
}

const BACKGROUND = 40;

export function renderView(tris: readonly Tri[], frame: Framing, angleDeg: number): Raster {
  const S = TURNTABLE_SIZE;
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) data.set([BACKGROUND, BACKGROUND, BACKGROUND, 255], i * 4);
  const depth = new Float32Array(S * S).fill(-Infinity);
  const a = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  // Rotate about Y; the camera looks down -Z of the rotated frame, +X to the right, +Y up.
  const proj = (x: number, y: number, z: number): [number, number, number] => {
    const dx = x - frame.cx;
    const dy = y - frame.cy;
    const dz = z - frame.cz;
    const rx = dx * ca + dz * sa;
    const rz = -dx * sa + dz * ca;
    return [S / 2 + rx * frame.scale, S / 2 - dy * frame.scale, rz];
  };
  for (const t of tris) {
    const p0 = proj(t[0] as number, t[1] as number, t[2] as number);
    const p1 = proj(t[3] as number, t[4] as number, t[5] as number);
    const p2 = proj(t[6] as number, t[7] as number, t[8] as number);
    // Face normal in the rotated frame for flat shading; light from the upper left in front.
    const ux = p1[0] - p0[0], uy = -(p1[1] - p0[1]), uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = -(p2[1] - p0[1]), vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len === 0) continue;
    nx /= len; ny /= len; nz /= len;
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const lit = Math.max(0, nx * -0.35 + ny * 0.45 + nz * 0.82);
    const shade = Math.round(70 + 170 * lit);
    const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
    const maxX = Math.min(S - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
    const maxY = Math.min(S - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
    const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    if (area === 0) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((p1[0] - px) * (p2[1] - py) - (p2[0] - px) * (p1[1] - py)) / area;
        const w1 = ((p2[0] - px) * (p0[1] - py) - (p0[0] - px) * (p2[1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
        const k = y * S + x;
        if (z <= (depth[k] as number)) continue;
        depth[k] = z;
        data.set([shade, shade, shade, 255], k * 4);
      }
    }
  }
  return { width: S, height: S, data };
}

/** Front, side and back views of a model with the given framing (default: its own). */
export function turntable(doc: Document, frame: Framing = frameOf(doc)): Raster[] {
  const tris = worldTriangles(doc);
  return TURNTABLE_ANGLES_DEG.map((deg) => renderView(tris, frame, deg));
}
