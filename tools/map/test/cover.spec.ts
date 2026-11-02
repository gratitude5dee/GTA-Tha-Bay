/**
 * M02h3 AC-2 (and AC-4 with the bake): the S13 cover stage on hand-built rasters. The seven rules and their order, the protected
 * classes, a one-cell driveway, the `mixed` share on 1 km2, and `buildPacks` with the cover on and off differing only in GROUND on
 * base-`Paved` cells (and the l0 section 21).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CoverClass, GroundClass, TERRAIN_POSTS, decodeCoverTile, latLngFromEnu,
  type ChunkKey,
} from '../../../packages/shared/src/index.ts';
import { areaGridOf, loadCover, type AreaGrid, type CoverConfig } from '../src/config.ts';
import { Raster } from '../src/geom/raster.ts';
import type { OsmFeature } from '../src/sources/geo.ts';
import { applyCoverToGround, cellHash01, cellSlope, labelBlocks, runCover, supercoverCells, type CoverInputs } from '../src/stages/s13-cover.ts';
import { buildPacks, type PackInputs } from '../src/stages/s13-pack.ts';
import type { WaterProduct } from '../src/stages/s3-water.ts';
import type { BakedBuilding, BuildingsProduct } from '../src/stages/s4-buildings.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

const CFG = loadCover();
/** Chunk 9/256/256: x and z from -128 to 128. */
const ONE: AreaGrid = areaGridOf({ minX: -128, minZ: -128, maxX: 128, maxZ: 128 });
const cellRaster = (grid: AreaGrid, init = 0): Raster => new Raster(grid.minX, grid.minZ, 4, grid.nx * 64, grid.ny * 64, 0.5, init);
/** The ENU ring around cells [i0, i1) x [j0, j1) of a cell raster. */
const cellRing = (r: Raster, i0: number, j0: number, i1: number, j1: number): number[] => {
  const x0 = r.originX + i0 * 4, z0 = r.originZ + j0 * 4, x1 = r.originX + i1 * 4, z1 = r.originZ + j1 * 4;
  return [x0, z0, x1, z0, x1, z1, x0, z1];
};
const lonLat = (x: number, z: number): [number, number] => {
  const p = latLngFromEnu(x, z);
  return [p.lng, p.lat];
};
const polyFeature = (id: string, ring: number[], tags: Record<string, string>): OsmFeature => {
  const coords: [number, number][] = [];
  for (let k = 0; k < ring.length; k += 2) coords.push(lonLat(ring[k] as number, ring[k + 1] as number));
  coords.push(coords[0] as [number, number]);
  return { id, tags, geometry: { type: 'Polygon', coordinates: [coords] } };
};
const lineFeature = (id: string, pts: number[], tags: Record<string, string>): OsmFeature => {
  const coords: [number, number][] = [];
  for (let k = 0; k < pts.length; k += 2) coords.push(lonLat(pts[k] as number, pts[k + 1] as number));
  return { id, tags, geometry: { type: 'LineString', coordinates: coords } };
};
const flatGrids = (grid: AreaGrid, dmAt: (x: number, z: number) => number = () => 100): Map<ChunkKey, Int16Array> => {
  const m = new Map<ChunkKey, Int16Array>();
  for (let cy = grid.cy0; cy <= grid.cy1; cy++) {
    for (let cx = grid.cx0; cx <= grid.cx1; cx++) {
      const dm = new Int16Array(TERRAIN_POSTS * TERRAIN_POSTS);
      const ox = grid.minX + (cx - grid.cx0) * 256, oz = grid.minZ + (cy - grid.cy0) * 256;
      for (let j = 0; j < TERRAIN_POSTS; j++) for (let i = 0; i < TERRAIN_POSTS; i++) dm[j * TERRAIN_POSTS + i] = dmAt(ox + i * 4, oz + j * 4);
      m.set(`9/${cx}/${cy}` as ChunkKey, dm);
    }
  }
  return m;
};

interface Case {
  ground: Raster;
  inp: CoverInputs;
  at: (i: number, j: number) => number;
}
/**
 * The test chunk: a road row at j = 32 and a road column at i = 32 cut four blocks. NW (i, j < 32) is under `residential` landuse; NE
 * has ResLow footprints only; SW has Commercial footprints only; SE is a park block with some protected cells.
 */
function testChunk(over: Partial<CoverInputs> = {}, cfg: CoverConfig = CFG): Case {
  const ground = cellRaster(ONE, GroundClass.Paved);
  for (let k = 0; k < 64; k++) {
    ground.data[32 * 64 + k] = GroundClass.Asphalt;
    ground.data[k * 64 + 32] = GroundClass.Asphalt;
  }
  // SE block: park, with sand, rock and a pier
  for (let j = 33; j < 64; j++) for (let i = 33; i < 64; i++) ground.data[j * 64 + i] = GroundClass.Park;
  ground.data[40 * 64 + 40] = GroundClass.Sand;
  ground.data[40 * 64 + 41] = GroundClass.Rock;
  ground.data[40 * 64 + 42] = GroundClass.Rail;
  // NW block: two Grass cells and a Dirt cell
  ground.data[5 * 64 + 5] = GroundClass.Grass;
  ground.data[5 * 64 + 6] = GroundClass.Grass;
  ground.data[5 * 64 + 7] = GroundClass.Dirt;
  const footprints: BakedBuilding[] = [];
  const foot = (i0: number, j0: number, i1: number, j1: number, kind: number): void => {
    footprints.push({ prism: cellRing(ground, i0, j0, i1, j1), kind } as unknown as BakedBuilding);
  };
  foot(2, 20, 6, 24, 0); // a house in NW
  foot(36, 4, 40, 8, 0); // ResLow in NE
  foot(44, 4, 48, 8, 1); // ResMid in NE
  foot(4, 40, 10, 46, 2); // Commercial in SW
  const inp: CoverInputs = {
    grid: ONE, ground, landuse: [{ cls: 'residential', rings: [cellRing(ground, 0, 0, 32, 32)] }],
    footprints: footprints.map((b) => ({ prism: b.prism, kind: b.kind })), grids: flatGrids(ONE), osm: [], cfg: { ...cfg, mixed: { ...cfg.mixed, share: 0 } },
    ...over,
  };
  return { ground, inp, at: (i, j) => j * 64 + i };
}

describe('S13 cover: the rules', () => {
  it('park, yard by landuse, yard by footprint kinds, none elsewhere; protected classes and footprints never change', () => {
    const t = testChunk();
    const { cover } = runCover(t.inp);
    const c = cover.data;
    expect(c[t.at(10, 10)]).toBe(CoverClass.Yard); // NW, residential landuse
    expect(c[t.at(5, 5)]).toBe(CoverClass.Yard); // a Grass cell in the block
    expect(c[t.at(7, 5)]).toBe(CoverClass.None); // Dirt is neither Paved nor Grass
    expect(c[t.at(3, 21)]).toBe(CoverClass.None); // under the house
    expect(c[t.at(50, 20)]).toBe(CoverClass.Yard); // NE, ResLow + ResMid footprints only
    expect(c[t.at(37, 5)]).toBe(CoverClass.None); // under a footprint
    expect(c[t.at(20, 50)]).toBe(CoverClass.None); // SW, Commercial footprints: not residential
    expect(c[t.at(50, 50)]).toBe(CoverClass.Park);
    for (const [i, j] of [[40, 40], [41, 40], [42, 40], [32, 10], [10, 32]] as const) expect(c[t.at(i, j)], `${i},${j}`).toBe(CoverClass.None);
  });

  it('a block over blockMaxM2 is never residential', () => {
    const t = testChunk({}, { ...CFG, blockMaxM2: 1000 });
    const { cover, report } = runCover(t.inp);
    expect(cover.data[t.at(10, 10)]).toBe(CoverClass.None);
    expect(report.blocks.tooLarge).toBeGreaterThan(0);
  });

  it('labels 4-connected blocks: the road cross cuts four', () => {
    const t = testChunk();
    const { sizes } = labelBlocks(t.ground);
    expect(sizes.length).toBe(4);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(63 * 63 - 1); // the rail cell ends a block too
  });

  it('mixed: a yard cell on a slope >= 0.18, or under the seeded hash share', () => {
    // a 0.2 slope along x in the NW block (2 m rise over 10 m: 20 dm per 4 m post step = 0.2)
    const sloped = flatGrids(ONE, (x, z) => (x < 0 && z < 0 ? Math.round((x + 128) * 5) : 100));
    const t = testChunk({ grids: sloped });
    const { cover } = runCover(t.inp);
    expect(cover.data[t.at(10, 10)]).toBe(CoverClass.Mixed);
    expect(cover.data[t.at(50, 20)]).toBe(CoverClass.Yard);
    const all = testChunk();
    all.inp.cfg = { ...CFG, mixed: { ...CFG.mixed, share: 1 } };
    expect(runCover(all.inp).cover.data[all.at(50, 20)]).toBe(CoverClass.Mixed);
  });

  it('scrub: a None cell at slope >= 0.30, a park cell at >= 0.35; a park cell at 0.32 stays park', () => {
    const slope = (s: number) => flatGrids(ONE, (x) => Math.round((x + 128) * 10 * s));
    const a = testChunk({ grids: slope(0.31) });
    const ca = runCover(a.inp).cover.data;
    expect(ca[a.at(20, 50)]).toBe(CoverClass.Scrub); // SW, None
    expect(ca[a.at(50, 50)]).toBe(CoverClass.Park);
    expect(ca[a.at(10, 10)]).toBe(CoverClass.Mixed); // yard on a slope is mixed, not scrub
    const b = testChunk({ grids: slope(0.36) });
    expect(runCover(b.inp).cover.data[b.at(50, 50)]).toBe(CoverClass.Scrub);
    expect(cellSlope(slope(0.3).get('9/256/256')!, 3, 3)).toBeCloseTo(0.3, 5);
  });

  it('vacant then dirt win over the earlier rules; a driveway is one cell wide and only over yard, mixed, vacant or None', () => {
    const t = testChunk();
    const g = t.ground;
    const z10 = g.zOf(10), z50 = g.zOf(50);
    t.inp.osm = [
      polyFeature('w1', cellRing(g, 8, 8, 16, 16), { landuse: 'brownfield' }),
      polyFeature('w2', cellRing(g, 12, 12, 20, 20), { landuse: 'landfill' }),
      polyFeature('w3', cellRing(g, 40, 45, 44, 49), { landuse: 'construction' }), // inside the park
      polyFeature('w4', cellRing(g, 22, 40, 26, 44), { surface: 'dirt', leisure: 'pitch' }),
      lineFeature('w5', [g.xOf(2), z10, g.xOf(14), z10], { highway: 'service', service: 'driveway' }),
      lineFeature('w6', [g.xOf(36), z50, g.xOf(60), z50], { highway: 'service', service: 'driveway' }), // across the park
      lineFeature('w7', [g.xOf(2), g.zOf(28), g.xOf(14), g.zOf(28)], { highway: 'service', service: 'parking_aisle' }),
    ];
    const { cover, report } = runCover(t.inp);
    const c = cover.data;
    expect(c[t.at(9, 9)]).toBe(CoverClass.Vacant);
    expect(c[t.at(13, 13)]).toBe(CoverClass.Dirt); // the later rule
    expect(c[t.at(41, 46)]).toBe(CoverClass.Vacant); // over park
    expect(c[t.at(23, 41)]).toBe(CoverClass.Dirt); // surface=dirt area in a None block
    // the driveway: row 10 from column 2 to 14, over yard and vacant, one cell wide
    for (let i = 2; i <= 14; i++) expect(c[t.at(i, 10)], `col ${i}`).toBe(CoverClass.Driveway);
    expect(c[t.at(5, 9)]).toBe(CoverClass.Yard);
    expect(c[t.at(5, 11)]).toBe(CoverClass.Yard);
    expect(c[t.at(1, 10)]).toBe(CoverClass.Yard);
    // across the park: never over park
    expect(c[t.at(50, 50)]).toBe(CoverClass.Park);
    expect(c[t.at(5, 28)]).toBe(CoverClass.Yard); // a parking aisle is not a driveway
    expect(report.driveways.ways).toBe(1);
    expect(report.areas).toEqual({ vacant: 2, dirt: 2 });
  });

  it('supercover: a diagonal through cell corners takes both side cells; an axis line takes one row', () => {
    const r = cellRaster(ONE);
    const row = supercoverCells(r, [r.xOf(3), r.zOf(7), r.xOf(9), r.zOf(7)]);
    expect(row.map((k) => [k % 64, Math.floor(k / 64)])).toEqual([[3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7]]);
    // corner to corner: (x 0, z 0) to (x 3 cells, z 3 cells) in cell units
    const diag = supercoverCells(r, [r.originX + 4 * 2, r.originZ + 4 * 2, r.originX + 4 * 5, r.originZ + 4 * 5]).map((k) => `${k % 64},${Math.floor(k / 64)}`);
    expect(diag).toEqual(expect.arrayContaining(['2,2', '3,2', '2,3', '3,3', '4,4']));
  });

  it('GROUND changes on base-Paved cells only: yard, mixed, scrub to Grass; dirt, vacant to Dirt; driveway stays Paved', () => {
    const ground = cellRaster(ONE, GroundClass.Paved);
    ground.data[1] = GroundClass.Grass;
    ground.data[2] = GroundClass.Park;
    const cover = cellRaster(ONE);
    const set = [CoverClass.Yard, CoverClass.Mixed, CoverClass.Scrub, CoverClass.Dirt, CoverClass.Vacant, CoverClass.Driveway, CoverClass.None];
    set.forEach((v, k) => { cover.data[10 + k] = v; });
    cover.data[1] = CoverClass.Dirt;
    cover.data[2] = CoverClass.Scrub;
    const before = Uint8Array.from(ground.data);
    const changed = applyCoverToGround(ground, cover);
    expect([...ground.data.subarray(10, 17)]).toEqual([GroundClass.Grass, GroundClass.Grass, GroundClass.Grass, GroundClass.Dirt, GroundClass.Dirt, GroundClass.Paved, GroundClass.Paved]);
    expect(ground.data[1]).toBe(GroundClass.Grass);
    expect(ground.data[2]).toBe(GroundClass.Park);
    expect(changed).toBe(5);
    let diff = 0;
    for (let k = 0; k < before.length; k++) if (before[k] !== ground.data[k]) diff++;
    expect(diff).toBe(5);
  });
});

describe('S13 cover: the mixed share', () => {
  it('is within 0.02 of mixedShare over 1 km2 of flat yards (uniform, seeded)', () => {
    const grid = areaGridOf({ minX: -128, minZ: -128, maxX: 896, maxZ: 896 });
    expect(grid.nx * grid.ny).toBe(16);
    const ground = cellRaster(grid, GroundClass.Paved);
    const { cover } = runCover({
      grid, ground, landuse: [{ cls: 'residential', rings: [[grid.minX, grid.minZ, grid.maxX, grid.minZ, grid.maxX, grid.maxZ, grid.minX, grid.maxZ]] }],
      footprints: [], grids: flatGrids(grid), osm: [], cfg: { ...CFG, blockMaxM2: 2_000_000 },
    });
    let mixed = 0, yard = 0;
    for (const v of cover.data) {
      if (v === CoverClass.Mixed) mixed++;
      else if (v === CoverClass.Yard) yard++;
    }
    expect(mixed + yard).toBe(256 * 256);
    expect(Math.abs(mixed / (mixed + yard) - CFG.mixed.share)).toBeLessThanOrEqual(0.02);
    // the hash is uniform: its mean over many squares is near 0.5
    let s = 0;
    for (let k = 0; k < 10_000; k++) s += cellHash01(k % 100, Math.floor(k / 100), CFG.mixed.seed);
    expect(Math.abs(s / 10_000 - 0.5)).toBeLessThan(0.02);
  });
});

describe('S13 cover: buildPacks with the cover on and off', () => {
  function packInputs(cover: PackInputs['cover']): PackInputs {
    const t = testChunk();
    const grid = ONE;
    const water = {
      landRings: [[grid.minX - 8, grid.minZ - 8, grid.maxX + 8, grid.minZ - 8, grid.maxX + 8, grid.maxZ + 8, grid.minX - 8, grid.maxZ + 8]],
      waterPolys: [], piers: [], trees: [-100, -100, 1, 0, 50, 50, 1, 1], hoods: [],
      treeReport: { forms: { plane: 1, ficus: 1, conifer: 0, eucalyptus: 0, palm: 0 }, unmatched: [] },
      landuse: [
        { cls: 'residential', rings: [cellRing(t.ground, 0, 0, 64, 64)] },
        { cls: 'park', rings: [cellRing(t.ground, 33, 33, 64, 64)] },
      ],
      stats: { coastChains: 0, openPieces: 0, ringsKept: 1, ringsDropped: 0, droppedKm2: 0, baseLand: false },
    } as WaterProduct;
    const key = '9/256/256' as ChunkKey;
    const byChunk = new Map<ChunkKey, BakedBuilding[]>([[key, []]]);
    const buildings = { byChunk, report: {} } as unknown as BuildingsProduct;
    return {
      bakeId: 'ab'.repeat(32), grid, water, terrain: { grids: flatGrids(grid), stats: {} } as unknown as PackInputs['terrain'], buildings, stamps: [],
      segs: [], nodes: [], edges: [], junctions: [], slabs: new Map(), hoods: new Map(), ped: { chunks: new Map() } as unknown as PackInputs['ped'],
      tags: new Map(), portals: [], spawn: new Map(),
      places: { landmarks: [], pois: [], districts: [], transit: [], teleportNodes: new Map(), proxies: new Map(), lmrefs: new Map() } as unknown as PackInputs['places'],
      lod: [], far: [], cover,
    };
  }

  it('differs only in GROUND on base-Paved cells and in the l0 section 21', () => {
    const off = buildPacks(packInputs(null));
    const on = buildPacks(packInputs({ cfg: { ...CFG, mixed: { ...CFG.mixed, share: 0.2 } }, osm: [] }));
    const disabled = buildPacks(packInputs({ cfg: { ...CFG, enabled: false }, osm: [] }));
    expect(off.cover).toBeUndefined();
    expect(disabled.cover).toBeUndefined();
    expect(disabled.files.map((f) => Buffer.from(f.bytes).toString('hex'))).toEqual(off.files.map((f) => Buffer.from(f.bytes).toString('hex')));
    const key = '9/256/256' as ChunkKey;
    const a = off.sims.get(key)!, b = on.sims.get(key)!;
    let changed = 0;
    for (let k = 0; k < 4096; k++) {
      if (a.ground[k] === b.ground[k]) continue;
      changed++;
      expect(a.ground[k], `cell ${k}`).toBe(GroundClass.Paved);
    }
    expect(changed).toBeGreaterThan(0);
    expect(on.cover?.groundChanged).toBe(changed);
    expect({ ...b, ground: a.ground }).toEqual(a);
    const ra = off.renders.get(key)!, rb = on.renders.get(key)!;
    expect({ ...rb, ground: ra.ground }).toEqual(ra);
    expect(on.index).toEqual(off.index);
    // the p0 packs differ only in GROUND bytes; the l0 pack gains section 21
    const p0a = off.files.find((f) => f.family === 'p0')!.bytes, p0b = on.files.find((f) => f.family === 'p0')!.bytes;
    expect(p0b.length).toBe(p0a.length);
    let bytesDiff = 0;
    for (let k = 0; k < p0a.length; k++) if (p0a[k] !== p0b[k]) bytesDiff++;
    expect(bytesDiff).toBe(changed);
    const l0 = on.files.find((f) => f.family === 'l0')!.bytes;
    const cv = decodeCoverTile(l0).get(key)!;
    expect(Buffer.from(cv).equals(Buffer.from(on.covers!.get(key)!))).toBe(true);
    expect(cv.some((v) => v === CoverClass.Yard)).toBe(true);
    expect(cv.some((v) => v === CoverClass.Park)).toBe(true);
  });
});

describe('S13 cover on the synth bake (AC-4)', () => {
  it('every class has at least 50 cells, the report gives cells per class, and no l0 pack exceeds 2.5 MiB', () => {
    const bake = requireBake('synth', 'cover.spec');
    if (!bake) return;
    const report = JSON.parse(readFileSync(path.join(bake.dir, 'bake-report.json'), 'utf8')) as {
      cover: { cells: Record<string, number>; driveways: { ways: number }; sectionBytes: number };
      packs: { name: string; bytes: number }[];
      gates: { id: string; level: string }[];
    };
    for (const name of ['yard', 'dirt', 'mixed', 'driveway', 'vacant', 'scrub', 'park']) expect(report.cover.cells[name], name).toBeGreaterThanOrEqual(50);
    expect(report.cover.driveways.ways).toBeGreaterThan(0);
    expect(report.gates.find((g) => g.id === 's13.cover-classes')?.level).toBe('pass');
    const l0 = report.packs.filter((p) => p.name.startsWith('l0-'));
    expect(l0.length).toBeGreaterThan(0);
    for (const p of l0) expect(p.bytes, p.name).toBeLessThanOrEqual(2.5 * 1024 * 1024);
  });
});
