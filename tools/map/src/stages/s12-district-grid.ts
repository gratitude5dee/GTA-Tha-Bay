/**
 * S12 district grid (M02c1; 02-world-contracts.md `WorldQuery.nhoodAt`): 64 m cells over the `play` box, one `u8` Analysis
 * Neighborhood index per cell (255 none), rasterised from the neighbourhood polygons S3 fetched in M02a1. The index is the
 * position of the neighbourhood in `NEIGHBOURHOODS_41`, the same index S5 writes into `RoadEdge.nhood`. Packed as
 * `data/district-grid.v1` by `map:pack`. Pure: the same polygons give the same bytes.
 */
import { NHOOD_NONE, encodeDistrictGrid, type DistrictGrid } from '../../../../packages/shared/src/index.ts';
import { NEIGHBOURHOODS_41, slugOf } from '../districts-seed.ts';
import { Raster } from '../geom/raster.ts';
import type { HoodPoly } from './s3-water.ts';

export const DISTRICT_CELL_M = 64;

export interface DistrictGridReport {
  cols: number;
  rows: number;
  cells: number;
  /** Cells with a neighbourhood. */
  assigned: number;
  /** Neighbourhoods with at least one cell. */
  nhoodsPresent: number;
  /** Polygon names that are not one of the 41 (their cells stay 255). */
  unknownNames: string[];
}

export interface DistrictGridProduct {
  grid: DistrictGrid;
  report: DistrictGridReport;
}

export interface DistrictGridInputs {
  bakeId: string;
  hoods: readonly HoodPoly[];
  /** The `play` box of config/world.bounds.json. */
  play: { minX: number; minZ: number; maxX: number; maxZ: number };
}

export function runDistrictGrid(inp: DistrictGridInputs): DistrictGridProduct {
  const minX = Math.floor(inp.play.minX / DISTRICT_CELL_M) * DISTRICT_CELL_M;
  const minZ = Math.floor(inp.play.minZ / DISTRICT_CELL_M) * DISTRICT_CELL_M;
  const cols = Math.ceil((inp.play.maxX - minX) / DISTRICT_CELL_M);
  const rows = Math.ceil((inp.play.maxZ - minZ) / DISTRICT_CELL_M);
  const r = new Raster(minX, minZ, DISTRICT_CELL_M, cols, rows, 0.5, NHOOD_NONE);
  const unknown = new Set<string>();
  // Neighbourhoods do not overlap; the polygons are filled in index order so a shared edge is decided the same way every run.
  const order = [...inp.hoods].sort((a, b) => NEIGHBOURHOODS_41.indexOf(a.name) - NEIGHBOURHOODS_41.indexOf(b.name));
  for (const h of order) {
    const idx = NEIGHBOURHOODS_41.indexOf(h.name);
    if (idx < 0) {
      unknown.add(h.name);
      continue;
    }
    for (const p of h.polys) r.fillRings([p.outer, ...p.holes], idx);
  }
  const seen = new Set<number>();
  let assigned = 0;
  for (const v of r.data) {
    if (v === NHOOD_NONE) continue;
    assigned++;
    seen.add(v);
  }
  return {
    grid: { bakeId: inp.bakeId, cellM: DISTRICT_CELL_M, minX, minZ, cols, rows, nhoods: NEIGHBOURHOODS_41.map(slugOf), cells: r.data },
    report: { cols, rows, cells: cols * rows, assigned, nhoodsPresent: seen.size, unknownNames: [...unknown].sort() },
  };
}

export const districtGridBytes = (p: DistrictGridProduct): Uint8Array => encodeDistrictGrid(p.grid);
