/**
 * A software preview of a model (M10d1 `assets:vehicle -- --turntable`): orthographic views at chosen azimuth and elevation, vertex
 * colours with smooth normals and one directional light, no GPU and no browser. It reads the in-memory model, so the review needs
 * no build. Glass draws dark and lamps bright; the collider is left out.
 */
import { ART_NODE, EMISSIVE_PARTS, PART } from '../../../../packages/shared/src/assets/art-parts.ts';
import { encodePng, type Raster } from '../image.ts';
import { modelBounds, walk, type ModelDoc } from './model.ts';

export interface View {
  azimuthDeg: number;
  elevationDeg: number;
}

/** Front three-quarter, side, rear three-quarter and top, the four views of a review sheet. */
export const SHEET_VIEWS: readonly View[] = [
  { azimuthDeg: 35, elevationDeg: 18 },
  { azimuthDeg: 90, elevationDeg: 6 },
  { azimuthDeg: 215, elevationDeg: 18 },
  { azimuthDeg: 0, elevationDeg: 80 },
];

const SIZE = 384;
const toSrgb = (c: number): number => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));

export function renderModel(doc: ModelDoc, view: View, size = SIZE): Raster {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set([46, 50, 56, 255], i * 4);
  const depth = new Float32Array(size * size).fill(-Infinity);
  const b = modelBounds(doc);
  const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2;
  const extent = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2], 1e-6);
  const scale = (size * 0.8) / extent;
  const az = (view.azimuthDeg * Math.PI) / 180, el = (view.elevationDeg * Math.PI) / 180;
  const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
  // rotate about Y by the azimuth, then tilt about X by the elevation; the camera looks down -Z, +X right
  const rot = (x: number, y: number, z: number): [number, number, number] => {
    const rx = x * ca + z * sa;
    const rz = -x * sa + z * ca;
    return [rx, y * ce - rz * se, y * se + rz * ce];
  };
  const light: [number, number, number] = [-0.4, 0.75, 0.55];
  const ll = Math.hypot(...light);
  walk(doc, (n, w) => {
    if (n.name === ART_NODE.collider) return;
    for (const m of n.meshes ?? []) {
      const P = (i: number): [number, number, number] => {
        const r = rot((m.pos[i * 3] as number) + w[0] - cx, (m.pos[i * 3 + 1] as number) + w[1] - cy, (m.pos[i * 3 + 2] as number) + w[2] - cz);
        return [size / 2 + r[0] * scale, size / 2 - r[1] * scale, r[2]];
      };
      const Nrm = (i: number): [number, number, number] => rot(m.nor[i * 3] as number, m.nor[i * 3 + 1] as number, m.nor[i * 3 + 2] as number);
      for (let t = 0; t < m.idx.length; t += 3) {
        const ia = m.idx[t] as number, ib = m.idx[t + 1] as number, ic = m.idx[t + 2] as number;
        const p0 = P(ia), p1 = P(ib), p2 = P(ic);
        const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
        if (area === 0) continue;
        if (area > 0) continue; // back face (screen y points down, so front faces wind negative)
        const n0 = Nrm(ia), n1 = Nrm(ib), n2 = Nrm(ic);
        const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0]))), maxX = Math.min(size - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
        const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1]))), maxY = Math.min(size - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const px = x + 0.5, py = y + 0.5;
            const w0 = ((p1[0] - px) * (p2[1] - py) - (p2[0] - px) * (p1[1] - py)) / area;
            const w1 = ((p2[0] - px) * (p0[1] - py) - (p0[0] - px) * (p2[1] - py)) / area;
            const w2 = 1 - w0 - w1;
            if (w0 < 0 || w1 < 0 || w2 < 0) continue;
            const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
            const k = y * size + x;
            if (z <= (depth[k] as number)) continue;
            depth[k] = z;
            const nx = w0 * n0[0] + w1 * n1[0] + w2 * n2[0], ny = w0 * n0[1] + w1 * n1[1] + w2 * n2[1], nz = w0 * n0[2] + w1 * n1[2] + w2 * n2[2];
            const nl = Math.hypot(nx, ny, nz) || 1;
            const lit = Math.max(0, (nx * light[0] + ny * light[1] + nz * light[2]) / (nl * ll));
            const part = m.part[ia] as number;
            let r = m.col[ia * 3] as number, g = m.col[ia * 3 + 1] as number, bl = m.col[ia * 3 + 2] as number;
            let shade = 0.28 + 0.8 * lit;
            if (part === PART.glass) { r = 0.04; g = 0.07; bl = 0.1; shade = 0.5 + 0.9 * Math.pow(lit, 3); }
            if (EMISSIVE_PARTS.includes(part)) shade = 1.4;
            data.set([Math.min(255, toSrgb(r * shade)), Math.min(255, toSrgb(g * shade)), Math.min(255, toSrgb(bl * shade)), 255], k * 4);
          }
        }
      }
    }
  });
  return { width: size, height: size, data };
}

/** The review sheet: the four views side by side, PNG bytes. */
export function sheetPng(doc: ModelDoc, views: readonly View[] = SHEET_VIEWS, size = SIZE): Uint8Array {
  const cells = views.map((v) => renderModel(doc, v, size));
  const out = new Uint8Array(size * views.length * size * 4);
  cells.forEach((cell, i) => {
    for (let y = 0; y < size; y++) out.set(cell.data.subarray(y * size * 4, (y + 1) * size * 4), (y * size * views.length + i * size) * 4);
  });
  return encodePng({ width: size * views.length, height: size, data: out });
}
