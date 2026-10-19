/**
 * Terrain helpers on the C08 HeightGrid (65 x 65 posts, row-major with z outer, Int16 in 0.1 m units).
 * Pure; C02 lint applies.
 */
import { TERRAIN_POSTS, type HeightGrid } from './c08.ts';

/** Index of the post at column `col` (x) and row `row` (z) in `HeightGrid.dm`. */
export function postIndex(col: number, row: number): number {
  return row * TERRAIN_POSTS + col;
}

/**
 * Bilinear height in metres at ENU (x, z). Throws RangeError outside the chunk: the grid covers
 * [originX, originX + 64 * cellM] on both axes, edges included.
 */
export function sampleHeight(h: HeightGrid, x: number, z: number): number {
  const span = (TERRAIN_POSTS - 1) * h.cellM;
  const u = x - h.originX;
  const v = z - h.originZ;
  if (!(u >= 0 && u <= span && v >= 0 && v <= span)) {
    throw new RangeError(`sampleHeight: (${x}, ${z}) is outside the chunk at (${h.originX}, ${h.originZ})`);
  }
  const fu = u / h.cellM;
  const fv = v / h.cellM;
  const last = TERRAIN_POSTS - 2;
  const c0 = Math.min(Math.floor(fu), last);
  const r0 = Math.min(Math.floor(fv), last);
  const tx = fu - c0;
  const tz = fv - r0;
  const a = (h.dm[postIndex(c0, r0)] ?? 0) * 0.1;
  const b = (h.dm[postIndex(c0 + 1, r0)] ?? 0) * 0.1;
  const c = (h.dm[postIndex(c0, r0 + 1)] ?? 0) * 0.1;
  const d = (h.dm[postIndex(c0 + 1, r0 + 1)] ?? 0) * 0.1;
  const north = a + (b - a) * tx;
  const south = c + (d - c) * tx;
  return north + (south - north) * tz;
}
