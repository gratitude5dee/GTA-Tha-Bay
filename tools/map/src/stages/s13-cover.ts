/**
 * S13 ground cover (M02h3): sorts every 4 m land cell of the area into a cover class (C08 1.1 `CoverClass`) before GROUND is written.
 * Pure: rasters and records in, a cover raster and a report out. Per cell centre, later rules win:
 *  1. park: a base `Park` cell (the park polygons).
 *  2. yard: a base `Paved` or `Grass` cell inside a residential block. A block is a 4-connected component of cells that are not road,
 *     rail, pier or water, at most `blockMaxM2`; it is residential when `residential` landuse covers `residentialLanduseShare` of its
 *     cells, or ResLow plus ResMid make `residentialBuildingShare` of its footprint cells.
 *  3. mixed: a yard cell with slope >= `mixed.slope`, or whose `mixed.cellM` seeded hash is below `mixed.share` (uniform citywide).
 *  4. scrub: a `None` cell with slope >= `scrub.slope`, or a park cell with slope >= `scrub.parkSlope`.
 *  5. vacant: landuse in `vacantLanduse`.
 *  6. dirt: landuse in `dirtLanduse`, or an area whose `surface` is in `dirtSurface`.
 *  7. driveway: the cells a `highway=service` + `service=driveway` centreline crosses (supercover walk, one cell wide), over yard,
 *     mixed, vacant or `None` only.
 * Slope is the steepest gradient between the graded posts of the cell (its four edges and two diagonals). Water, Pier, Asphalt,
 * Sidewalk, Rail, Sand and Rock cells never get a cover, and neither does a cell under an S4 footprint (BD-M02h3-02).
 *
 * GROUND then changes on base-`Paved` cells only (`applyCoverToGround`): yard, mixed and scrub become `Grass`, dirt and vacant `Dirt`,
 * a driveway stays `Paved`. Every value is an existing `GroundClass`, so the sim's water test is unchanged.
 */
import { CoverClass, GroundClass, TERRAIN_POSTS, type ChunkKey } from '../../../../packages/shared/src/index.ts';
import type { AreaGrid, CoverConfig } from '../config.ts';
import { Raster } from '../geom/raster.ts';
import { linesOf, polygonsOf, type OsmFeature } from '../sources/geo.ts';
import type { LandusePoly } from './s3-water.ts';

/** Ground classes that never take a cover. */
const PROTECTED: ReadonlySet<number> = new Set([
  GroundClass.Water, GroundClass.WaterShallow, GroundClass.Pier, GroundClass.Asphalt, GroundClass.Sidewalk, GroundClass.Rail, GroundClass.Sand, GroundClass.Rock,
]);
/** Ground classes that end a block. */
const BARRIER: ReadonlySet<number> = new Set([GroundClass.Water, GroundClass.WaterShallow, GroundClass.Pier, GroundClass.Asphalt, GroundClass.Sidewalk, GroundClass.Rail]);

export interface CoverInputs {
  grid: AreaGrid;
  /** Base ground classes at the cell centres (`groundRaster`, before the cover). */
  ground: Raster;
  /** S3 landuse polygons (`residential` is read). */
  landuse: readonly LandusePoly[];
  /** Footprints: ENU prism rings with their `BuildingKind`. */
  footprints: Iterable<{ prism: readonly number[]; kind: number }>;
  /** Graded terrain, 65 x 65 decimetre posts per chunk. */
  grids: ReadonlyMap<ChunkKey, Int16Array>;
  osm: readonly OsmFeature[];
  cfg: CoverConfig;
}

export interface CoverReport {
  /** Cells per class over the area, `CoverClass` order (none first). */
  cells: Record<string, number>;
  blocks: { total: number; residentialByLanduse: number; residentialByBuildings: number; tooLarge: number; largestM2: number };
  driveways: { ways: number; cells: number };
  areas: { vacant: number; dirt: number };
}

export interface CoverProduct {
  /** `CoverClass` per cell, the grid of `ground`. */
  cover: Raster;
  report: CoverReport;
}

export const COVER_REPORT_NAMES = ['none', 'yard', 'dirt', 'mixed', 'driveway', 'vacant', 'scrub', 'park'] as const;

/** 32-bit integer mix (a murmur3 finaliser): the seeded hash of one `cellM` square, in [0, 1). */
export function cellHash01(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix | 0, 0x9e3779b1) ^ Math.imul(iz | 0, 0x85ebca77) ^ (seed >>> 0)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The steepest post-to-post gradient of cell (i, j) of a 65 x 65 decimetre grid with 4 m cells. */
export function cellSlope(dm: Int16Array, i: number, j: number, cellM = 4): number {
  const n = TERRAIN_POSTS;
  const a = dm[j * n + i] as number, b = dm[j * n + i + 1] as number, c = dm[(j + 1) * n + i] as number, d = dm[(j + 1) * n + i + 1] as number;
  const edge = Math.max(Math.abs(a - b), Math.abs(c - d), Math.abs(a - c), Math.abs(b - d)) / (cellM * 10);
  const diag = Math.max(Math.abs(a - d), Math.abs(b - c)) / (cellM * 10 * Math.SQRT2);
  return Math.max(edge, diag);
}

/**
 * The cells a polyline's centreline crosses, as raster indices (supercover: where the line passes exactly through a cell corner, both
 * cells beside the corner are taken). `r` is a cell raster (offset 0.5).
 */
export function supercoverCells(r: Raster, line: readonly number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const take = (i: number, j: number): void => {
    if (i < 0 || j < 0 || i >= r.w || j >= r.h) return;
    const k = j * r.w + i;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  };
  for (let p = 0; p + 3 < line.length; p += 2) {
    // in cell units: cell i spans [i, i + 1)
    const x0 = ((line[p] as number) - r.originX) / r.step, z0 = ((line[p + 1] as number) - r.originZ) / r.step;
    const x1 = ((line[p + 2] as number) - r.originX) / r.step, z1 = ((line[p + 3] as number) - r.originZ) / r.step;
    let i = Math.floor(x0), j = Math.floor(z0);
    const iEnd = Math.floor(x1), jEnd = Math.floor(z1);
    take(i, j);
    const dx = x1 - x0, dz = z1 - z0;
    const si = dx > 0 ? 1 : dx < 0 ? -1 : 0, sj = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tdx = si !== 0 ? Math.abs(1 / dx) : Infinity, tdz = sj !== 0 ? Math.abs(1 / dz) : Infinity;
    let tx = si > 0 ? (Math.floor(x0) + 1 - x0) * tdx : si < 0 ? (x0 - Math.floor(x0)) * tdx : Infinity;
    let tz = sj > 0 ? (Math.floor(z0) + 1 - z0) * tdz : sj < 0 ? (z0 - Math.floor(z0)) * tdz : Infinity;
    // a start exactly on a boundary moving backwards: the boundary is crossed at t = 0
    for (let guard = 0; guard < 1_000_000 && (i !== iEnd || j !== jEnd); guard++) {
      if (Math.abs(tx - tz) < 1e-9) {
        if (tx > 1 + 1e-9) break;
        // through a corner: both side cells, then the diagonal one
        take(i + si, j);
        take(i, j + sj);
        i += si;
        j += sj;
        tx += tdx;
        tz += tdz;
      } else if (tx < tz) {
        if (tx > 1 + 1e-9) break;
        i += si;
        tx += tdx;
      } else {
        if (tz > 1 + 1e-9) break;
        j += sj;
        tz += tdz;
      }
      take(i, j);
    }
  }
  return out;
}

/** Labels the 4-connected components of non-barrier cells; returns the label per cell (-1 on barriers) and the component sizes. */
export function labelBlocks(ground: Raster): { label: Int32Array; sizes: number[] } {
  const w = ground.w, h = ground.h, g = ground.data;
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || BARRIER.has(g[start] as number)) continue;
    const id = sizes.length;
    let top = 0, n = 0;
    stack[top++] = start;
    label[start] = id;
    while (top > 0) {
      const k = stack[--top] as number;
      n++;
      const i = k % w, j = (k - i) / w;
      const visit = (q: number): void => {
        if (label[q] === -1 && !BARRIER.has(g[q] as number)) {
          label[q] = id;
          stack[top++] = q;
        }
      };
      if (i > 0) visit(k - 1);
      if (i < w - 1) visit(k + 1);
      if (j > 0) visit(k - w);
      if (j < h - 1) visit(k + w);
    }
    sizes.push(n);
  }
  return { label, sizes };
}

const areaRings = (f: OsmFeature): number[][][] => polygonsOf(f.geometry).map((p) => [p.outer, ...p.holes]);

export function runCover(inp: CoverInputs): CoverProduct {
  const { grid, ground, cfg } = inp;
  const w = ground.w, h = ground.h, g = ground.data;
  const cellM2 = ground.step * ground.step;
  const like = (init = 0): Raster => new Raster(ground.originX, ground.originZ, ground.step, w, h, ground.offset, init);

  // residential landuse, footprints by kind (1 + kind), vacant and dirt areas
  const resLu = like();
  for (const u of inp.landuse) if (u.cls === 'residential') resLu.fillRings(u.rings, 1);
  const foot = like();
  for (const b of inp.footprints) foot.fillRings([b.prism], 1 + b.kind);
  const vacant = like(), dirt = like();
  const vacantSet = new Set(cfg.vacantLanduse), dirtSet = new Set(cfg.dirtLanduse), surfSet = new Set(cfg.dirtSurface);
  const sorted = [...inp.osm].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const driveways: number[][] = [];
  let vacantAreas = 0, dirtAreas = 0;
  for (const f of sorted) {
    const t = f.tags;
    const lu = t['landuse'];
    if (lu !== undefined && vacantSet.has(lu)) {
      for (const rings of areaRings(f)) { vacant.fillRings(rings, 1); vacantAreas++; }
    }
    const isDirt = (lu !== undefined && dirtSet.has(lu)) || (t['surface'] !== undefined && surfSet.has(t['surface']));
    if (isDirt) {
      for (const rings of areaRings(f)) { dirt.fillRings(rings, 1); dirtAreas++; }
    }
    if (t['highway'] === cfg.driveway.highway && t['service'] === cfg.driveway.service) driveways.push(...linesOf(f.geometry));
  }

  // blocks and their residential test
  const { label, sizes } = labelBlocks(ground);
  const nb = sizes.length;
  const resCells = new Int32Array(nb), footCells = new Int32Array(nb), resFootCells = new Int32Array(nb);
  for (let k = 0; k < w * h; k++) {
    const id = label[k] as number;
    if (id < 0) continue;
    if ((resLu.data[k] as number) === 1) resCells[id] = (resCells[id] as number) + 1;
    const f = foot.data[k] as number;
    if (f > 0) {
      footCells[id] = (footCells[id] as number) + 1;
      if (f === 1 || f === 2) resFootCells[id] = (resFootCells[id] as number) + 1; // ResLow 0, ResMid 1
    }
  }
  const residential = new Uint8Array(nb);
  const blocks = { total: nb, residentialByLanduse: 0, residentialByBuildings: 0, tooLarge: 0, largestM2: 0 };
  for (let id = 0; id < nb; id++) {
    const m2 = (sizes[id] as number) * cellM2;
    if (m2 > blocks.largestM2) blocks.largestM2 = m2;
    if (m2 > cfg.blockMaxM2) { blocks.tooLarge++; continue; }
    if ((resCells[id] as number) >= cfg.residentialLanduseShare * (sizes[id] as number)) { residential[id] = 1; blocks.residentialByLanduse++; }
    else if ((footCells[id] as number) > 0 && (resFootCells[id] as number) >= cfg.residentialBuildingShare * (footCells[id] as number)) { residential[id] = 1; blocks.residentialByBuildings++; }
  }

  // slope from the graded grid of the cell's chunk
  const nxCh = grid.nx;
  const gridOf: (Int16Array | undefined)[] = new Array<Int16Array | undefined>(grid.nx * grid.ny);
  for (let cy = 0; cy < grid.ny; cy++) for (let cx = 0; cx < grid.nx; cx++) gridOf[cy * nxCh + cx] = inp.grids.get(`9/${grid.cx0 + cx}/${grid.cy0 + cy}` as ChunkKey);
  const slopeAt = (i: number, j: number): number => {
    const dm = gridOf[Math.floor(j / 64) * nxCh + Math.floor(i / 64)];
    return dm ? cellSlope(dm, i % 64, j % 64, ground.step) : 0;
  };

  const cover = like();
  const c = cover.data;
  const mx = cfg.mixed;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const base = g[k] as number;
      if (PROTECTED.has(base) || (foot.data[k] as number) > 0) continue;
      let v: number = CoverClass.None;
      if (base === GroundClass.Park) v = CoverClass.Park;
      const id = label[k] as number;
      if ((base === GroundClass.Paved || base === GroundClass.Grass) && id >= 0 && residential[id] === 1) v = CoverClass.Yard;
      const slope = slopeAt(i, j);
      if (v === CoverClass.Yard) {
        const x = ground.xOf(i), z = ground.zOf(j);
        if (cellHash01(Math.floor(x / mx.cellM), Math.floor(z / mx.cellM), mx.seed) < mx.share || slope >= mx.slope) v = CoverClass.Mixed;
      }
      if ((v === CoverClass.None && slope >= cfg.scrub.slope) || (v === CoverClass.Park && slope >= cfg.scrub.parkSlope)) v = CoverClass.Scrub;
      if ((vacant.data[k] as number) === 1) v = CoverClass.Vacant;
      if ((dirt.data[k] as number) === 1) v = CoverClass.Dirt;
      c[k] = v;
    }
  }
  let drivewayWays = 0, drivewayCells = 0;
  for (const line of driveways) {
    let any = false;
    for (const k of supercoverCells(cover, line)) {
      const base = g[k] as number;
      if (PROTECTED.has(base) || (foot.data[k] as number) > 0) continue;
      const v = c[k] as number;
      if (v === CoverClass.Yard || v === CoverClass.Mixed || v === CoverClass.Vacant || v === CoverClass.None) {
        drivewayCells++;
        c[k] = CoverClass.Driveway;
        any = true;
      }
    }
    if (any) drivewayWays++;
  }

  const counts = new Array<number>(COVER_REPORT_NAMES.length).fill(0);
  for (let k = 0; k < w * h; k++) {
    if (PROTECTED.has(g[k] as number)) continue;
    counts[c[k] as number] = (counts[c[k] as number] as number) + 1;
  }
  const cells: Record<string, number> = {};
  COVER_REPORT_NAMES.forEach((n, i) => { cells[n] = counts[i] as number; });
  return { cover, report: { cells, blocks, driveways: { ways: drivewayWays, cells: drivewayCells }, areas: { vacant: vacantAreas, dirt: dirtAreas } } };
}

/** Rewrites GROUND under the cover: base-`Paved` cells only (yard, mixed, scrub to `Grass`; dirt, vacant to `Dirt`; driveway stays). */
export function applyCoverToGround(ground: Raster, cover: Raster): number {
  let changed = 0;
  const g = ground.data, c = cover.data;
  for (let k = 0; k < g.length; k++) {
    if ((g[k] as number) !== GroundClass.Paved) continue;
    const v = c[k] as number;
    const to = v === CoverClass.Yard || v === CoverClass.Mixed || v === CoverClass.Scrub ? GroundClass.Grass
      : v === CoverClass.Dirt || v === CoverClass.Vacant ? GroundClass.Dirt : GroundClass.Paved;
    if (to !== GroundClass.Paved) { g[k] = to; changed++; }
  }
  return changed;
}
