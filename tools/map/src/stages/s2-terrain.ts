/**
 * S2 terrain (02-world-bake.md section 4): Terrarium mosaic sampled on one global 4 m post grid, so the 65 x 65 grids of
 * neighbouring chunks agree on their shared edge by construction. Water posts clamp to [-60, -2.5] m, pier posts rise to
 * 3.0 m. `sampleHeight` from @dv/shared is the same function the browser runs.
 */
import { CHUNK_EDGE_M, GRID_MIN_M, TERRAIN_POSTS, chunkKeyAt, sampleHeight, type ChunkKey, type HeightGrid } from '../../../../packages/shared/src/index.ts';
import { chunkKeyOfIndex, type AreaGrid } from '../config.ts';
import type { Raster } from '../geom/raster.ts';
import type { TerrariumMosaic } from '../sources/terrarium.ts';

export const WATER_SHORE_M = -2.5;
export const WATER_FLOOR_M = -60;
export const PIER_TOP_M = 3.0;

export interface TerrainStats {
  chunks: number;
  minM: number;
  maxM: number;
  missingPixels: number;
  cityHallM: number | null;
  edgeMismatches: number;
  pierPosts: number;
}
export interface TerrainProduct {
  /** key `9/x/y` to 65 x 65 Int16 decimetres, row-major with z outer. Only chunks with land or pier posts. */
  grids: Map<ChunkKey, Int16Array>;
  stats: TerrainStats;
}

/**
 * `extra` names chunks that get a grid although they hold no land or pier post: the chunks a bridge deck crosses over open
 * water (M02a2), so their slabs have a p0 chunk to live in. Their posts are the clamped bathymetry like every other water post.
 */
export function runTerrain(grid: AreaGrid, mosaic: TerrariumMosaic, land: Raster, pier: Raster, extra?: ReadonlySet<ChunkKey>): TerrainProduct {
  const grids = new Map<ChunkKey, Int16Array>();
  const n = TERRAIN_POSTS;
  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  const buf = new Float32Array(n * n);
  let min = Infinity, max = -Infinity, pierPosts = 0;
  const before = mosaic.missing;
  for (let cy = grid.cy0; cy <= grid.cy1; cy++) {
    for (let cx = grid.cx0; cx <= grid.cx1; cx++) {
      const i0 = (cx - grid.cx0) * (n - 1);
      const j0 = (cy - grid.cy0) * (n - 1);
      let any = false;
      for (let j = 0; j < n && !any; j++) {
        const row = (j0 + j) * land.w + i0;
        for (let i = 0; i < n; i++) if (land.data[row + i] || pier.data[row + i]) { any = true; break; }
      }
      if (!any && !extra?.has(chunkKeyOfIndex(cx, cy))) continue;
      for (let i = 0; i < n; i++) xs[i] = GRID_MIN_M + cx * CHUNK_EDGE_M[9] + i * 4;
      for (let j = 0; j < n; j++) zs[j] = GRID_MIN_M + cy * CHUNK_EDGE_M[9] + j * 4;
      mosaic.sampleGrid(xs, zs, buf);
      const dm = new Int16Array(n * n);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const k = (j0 + j) * land.w + i0 + i;
          let h = buf[j * n + i] as number;
          if (pier.data[k]) { h = PIER_TOP_M; pierPosts++; }
          else if (!land.data[k]) h = Math.max(Math.min(h, WATER_SHORE_M), WATER_FLOOR_M);
          const q = Math.max(-32767, Math.min(32767, Math.round(h * 10)));
          dm[j * n + i] = q;
          if (q < min) min = q;
          if (q > max) max = q;
        }
      }
      grids.set(chunkKeyOfIndex(cx, cy), dm);
    }
  }
  const field = new TerrainField(grids);
  let mismatches = 0;
  for (const [key, dm] of grids) {
    const [, sx, sy] = key.split('/').map(Number) as [number, number, number];
    const east = grids.get(chunkKeyOfIndex(sx + 1, sy));
    if (east) for (let j = 0; j < n; j++) if (dm[j * n + n - 1] !== east[j * n]) mismatches++;
    const south = grids.get(chunkKeyOfIndex(sx, sy + 1));
    if (south) for (let i = 0; i < n; i++) if (dm[(n - 1) * n + i] !== south[i]) mismatches++;
  }
  return {
    grids,
    stats: {
      chunks: grids.size,
      minM: grids.size ? min / 10 : 0,
      maxM: grids.size ? max / 10 : 0,
      missingPixels: mosaic.missing - before,
      cityHallM: field.heightAt(0, 0),
      edgeMismatches: mismatches,
      pierPosts,
    },
  };
}

export function heightGridOf(key: ChunkKey, dm: Int16Array): HeightGrid {
  const [, x, y] = key.split('/').map(Number) as [number, number, number];
  return { originX: GRID_MIN_M + x * CHUNK_EDGE_M[9], originZ: GRID_MIN_M + y * CHUNK_EDGE_M[9], cellM: 4, dm };
}

/** Height lookup over the baked chunk grids. */
export class TerrainField {
  private readonly cache = new Map<ChunkKey, HeightGrid>();
  constructor(readonly grids: ReadonlyMap<ChunkKey, Int16Array>) {}

  gridOf(key: ChunkKey): HeightGrid | null {
    const c = this.cache.get(key);
    if (c) return c;
    const dm = this.grids.get(key);
    if (!dm) return null;
    const g = heightGridOf(key, dm);
    this.cache.set(key, g);
    return g;
  }

  /** Bilinear height in metres, or null when the chunk was not baked (water only). */
  heightAt(x: number, z: number): number | null {
    const g = this.gridOf(chunkKeyAt(9, x, z));
    return g ? sampleHeight(g, x, z) : null;
  }
}
