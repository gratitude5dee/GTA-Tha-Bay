/**
 * A small software rasteriser for looking at a recipe without a GPU or a glTF viewer (`map:landmarks -- --preview lm.coit-tower`):
 * perspective camera, z-buffer, one directional light, the ground drawn as a flat plane. Writes a PNG. Dev tool only: nothing at
 * runtime or in the asset pipeline reads it.
 */
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { rulesOf, type Fidelity } from './fidelity.ts';
import { Geo, type V3 } from './primitives.ts';
import type { BaseParams, RecipeDef } from './build.ts';

export interface PreviewCamera {
  /** Degrees clockwise from north (-Z) the camera looks from: 0 looks at the model from the north. */
  azimuthDeg: number;
  elevationDeg: number;
  distance: number;
  /** Look-at height. */
  targetY: number;
  fovDeg?: number;
  /** A street-level view: the camera stands at `eye` and looks at `lookAt` (the azimuth, elevation and distance are ignored). */
  eye?: V3;
  lookAt?: V3;
  width?: number;
  height?: number;
}

const LIGHT = ((): V3 => {
  const v: V3 = [0.45, 0.8, 0.4];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

export function renderPreview(def: RecipeDef<never>, params: BaseParams, f: Fidelity, cam: PreviewCamera): PNG {
  const g = new Geo(rulesOf(f));
  g.setYaw(((params.yawDeg ?? 0) * Math.PI) / 180);
  (def as RecipeDef<BaseParams>).build(g, params);
  const W = cam.width ?? 640, H = cam.height ?? 400;
  const png = new PNG({ width: W, height: H });
  const depth = new Float32Array(W * H).fill(Infinity);
  for (let y = 0; y < H; y++) {
    const t = y / H;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      png.data[i] = Math.round(150 + 70 * t);
      png.data[i + 1] = Math.round(190 + 45 * t);
      png.data[i + 2] = Math.round(235 + 15 * t);
      png.data[i + 3] = 255;
    }
  }
  const az = (cam.azimuthDeg * Math.PI) / 180, el = (cam.elevationDeg * Math.PI) / 180;
  // camera position on a sphere around the target, looking at it; az 0 = camera north of the target
  const target: V3 = cam.lookAt ?? [0, cam.targetY, 0];
  const eye: V3 = cam.eye ?? [target[0] + Math.sin(az) * Math.cos(el) * cam.distance, target[1] + Math.sin(el) * cam.distance, target[2] - Math.cos(az) * Math.cos(el) * cam.distance];
  const fwd = norm3([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const right = norm3(cross3(fwd, [0, 1, 0]));
  const up = cross3(right, fwd);
  const f2 = 1 / Math.tan(((cam.fovDeg ?? 40) * Math.PI) / 360);
  const proj = (p: V3): [number, number, number] | null => {
    const d: V3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    const z = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
    if (z < 0.5) return null;
    const x = d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
    const y = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    return [W / 2 + ((x / z) * f2 * H) / 2, H / 2 - ((y / z) * f2 * H) / 2, z];
  };
  const tri = (a: V3, b: V3, c: V3, col: V3, shade: number): void => {
    const pa = proj(a), pb = proj(b), pc = proj(c);
    if (!pa || !pb || !pc) return;
    const minX = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0])));
    const minY = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1])));
    const den = (pb[1] - pc[1]) * (pa[0] - pc[0]) + (pc[0] - pb[0]) * (pa[1] - pc[1]);
    if (Math.abs(den) < 1e-9) return;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const l1 = ((pb[1] - pc[1]) * (px - pc[0]) + (pc[0] - pb[0]) * (py - pc[1])) / den;
        const l2 = ((pc[1] - pa[1]) * (px - pc[0]) + (pa[0] - pc[0]) * (py - pc[1])) / den;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const z = l1 * pa[2] + l2 * pb[2] + l3 * pc[2];
        const k = y * W + x;
        if (z >= (depth[k] as number)) continue;
        depth[k] = z;
        const o = k * 4;
        png.data[o] = to8(col[0] * shade);
        png.data[o + 1] = to8(col[1] * shade);
        png.data[o + 2] = to8(col[2] * shade);
      }
    }
  };
  // the ground
  const R = 4000;
  tri([-R, 0, -R], [R, 0, -R], [R, 0, R], [0.18, 0.22, 0.12], 1);
  tri([-R, 0, -R], [R, 0, R], [-R, 0, R], [0.18, 0.22, 0.12], 1);
  for (const c of g.classes()) {
    for (let i = 0; i < c.idx.length; i += 3) {
      const ids = [c.idx[i] as number, c.idx[i + 1] as number, c.idx[i + 2] as number];
      const P = ids.map((k) => [c.pos[k * 3] as number, c.pos[k * 3 + 1] as number, c.pos[k * 3 + 2] as number] as V3);
      const n = c.nor.slice(ids[0]! * 3, ids[0]! * 3 + 3);
      const lam = Math.max(0, (n[0] as number) * LIGHT[0] + (n[1] as number) * LIGHT[1] + (n[2] as number) * LIGHT[2]);
      const col: V3 = [c.col[ids[0]! * 3] as number, c.col[ids[0]! * 3 + 1] as number, c.col[ids[0]! * 3 + 2] as number];
      tri(P[0] as V3, P[1] as V3, P[2] as V3, col, 0.3 + 0.9 * lam);
    }
  }
  return png;
}

const to8 = (v: number): number => {
  const c = Math.max(0, Math.min(1, v));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
};
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function writePreview(file: string, png: PNG): void {
  writeFileSync(file, PNG.sync.write(png));
}
