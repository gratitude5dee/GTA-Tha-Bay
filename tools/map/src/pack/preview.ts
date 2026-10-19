/**
 * preview.png: a top-down picture of a finished bake (one pixel = 8 m): ground classes shaded by the baked heightfield,
 * building footprints in grey by height, and a grid line every z=7 tile. A debugging aid and the first thing you can look at
 * before the streaming milestone draws the world. Deterministic: integer maths on the baked arrays.
 */
import { PNG } from 'pngjs';
import { CHUNK_EDGE_M, GroundClass, TERRAIN_POSTS, parseChunkKey, type ChunkKey, type RenderChunk, type SimChunk } from '../../../../packages/shared/src/index.ts';
import type { AreaGrid } from '../config.ts';

export const PREVIEW_M_PER_PX = 8;

const GROUND_RGB: Record<number, [number, number, number]> = {
  [GroundClass.Grass]: [118, 156, 92],
  [GroundClass.Park]: [86, 148, 82],
  [GroundClass.Sand]: [222, 208, 160],
  [GroundClass.Paved]: [168, 164, 156],
  [GroundClass.Dirt]: [150, 124, 92],
  [GroundClass.Rock]: [128, 122, 116],
  [GroundClass.Asphalt]: [86, 86, 90],
  [GroundClass.Sidewalk]: [190, 188, 182],
  [GroundClass.Pier]: [150, 116, 82],
  [GroundClass.WaterShallow]: [92, 156, 196],
  [GroundClass.Water]: [40, 86, 140],
  [GroundClass.Rail]: [96, 90, 84],
};
const WATER_RGB = GROUND_RGB[GroundClass.Water] as [number, number, number];

export function renderPreview(grid: AreaGrid, sims: ReadonlyMap<ChunkKey, SimChunk>, renders: ReadonlyMap<ChunkKey, RenderChunk>): Buffer {
  const cellsPerChunk = CHUNK_EDGE_M[9] / PREVIEW_M_PER_PX; // 32
  const w = grid.nx * cellsPerChunk;
  const h = grid.ny * cellsPerChunk;
  const img = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = WATER_RGB[0];
    img.data[i * 4 + 1] = WATER_RGB[1];
    img.data[i * 4 + 2] = WATER_RGB[2];
    img.data[i * 4 + 3] = 255;
  }
  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const k = (y * w + x) * 4;
    img.data[k] = r;
    img.data[k + 1] = g;
    img.data[k + 2] = b;
  };
  const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
  for (const [key, c] of sims) {
    const p = parseChunkKey(key)!;
    const ox = (p.x - grid.cx0) * cellsPerChunk;
    const oy = (p.y - grid.cy0) * cellsPerChunk;
    const dm = c.height.dm;
    for (let j = 0; j < cellsPerChunk; j++) {
      for (let i = 0; i < cellsPerChunk; i++) {
        // the ground cell at the middle of the 2 x 2 cells of 4 m this pixel covers
        const gx = Math.min(63, i * 2 + 1), gy = Math.min(63, j * 2 + 1);
        const rgb = GROUND_RGB[c.ground[gy * 64 + gx] as number] ?? [200, 0, 200];
        // slope shading from the heightfield (light from the north-west)
        const a = dm[Math.min(TERRAIN_POSTS - 1, gy + 1) * TERRAIN_POSTS + gx] as number;
        const b = dm[gy * TERRAIN_POSTS + Math.min(TERRAIN_POSTS - 1, gx + 1)] as number;
        const o = dm[gy * TERRAIN_POSTS + gx] as number;
        const shade = 1 + ((o - a) + (o - b)) / 60;
        const hs = Math.max(0.55, Math.min(1.45, shade));
        const elev = Math.max(0, o) / 10;
        const lift = 1 + Math.min(0.25, elev / 800);
        put(ox + i, oy + j, clamp(rgb[0] * hs * lift), clamp(rgb[1] * hs * lift), clamp(rgb[2] * hs * lift));
      }
    }
  }
  for (const [key, c] of renders) {
    const p = parseChunkKey(key)!;
    const ox = (p.x - grid.cx0) * CHUNK_EDGE_M[9];
    const oy = (p.y - grid.cy0) * CHUNK_EDGE_M[9];
    for (const b of c.buildings) {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < b.ring.length; i += 2) {
        const x = (b.ring[i] as number) / 10, z = (b.ring[i + 1] as number) / 10;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      const g = clamp(150 - Math.min(90, (b.heightDm / 10) * 0.9));
      const x0 = Math.floor((ox + minX) / PREVIEW_M_PER_PX), x1 = Math.max(x0, Math.floor((ox + maxX) / PREVIEW_M_PER_PX));
      const y0 = Math.floor((oy + minZ) / PREVIEW_M_PER_PX), y1 = Math.max(y0, Math.floor((oy + maxZ) / PREVIEW_M_PER_PX));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, g, g, clamp(g + 6));
    }
  }
  // z=7 tile grid, one pixel wide
  const tile = cellsPerChunk * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (x + grid.cx0 * cellsPerChunk) % tile === 0, gy = (y + grid.cy0 * cellsPerChunk) % tile === 0;
      if (gx || gy) {
        const k = (y * w + x) * 4;
        img.data[k] = (img.data[k] as number) >> 1;
        img.data[k + 1] = (img.data[k + 1] as number) >> 1;
        img.data[k + 2] = ((img.data[k + 2] as number) >> 1) + 90;
      }
    }
  }
  return PNG.sync.write(img, { deflateLevel: 6 });
}
