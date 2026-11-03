/**
 * M02h5 AC-2: the S13 vegetation scatter (`stages/s13-scatter.ts`) on hand-built polygons, the S3 street-tree density rules, and the
 * scatter of the finished `synth` bake (skipped without one, as `requireBake` says).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CoverClass, GroundClass, TreeForm, decodeL0, decodeP0, isScatterByte, latLngFromEnu, treeFormOfByte,
} from '../../../packages/shared/src/index.ts';
import { loadTreeForms, loadVegetation, mapSchema, type AreaGrid } from '../src/config.ts';
import { BRIDSON_DENSITY, PointHash } from '../src/geom/poisson.ts';
import { Raster } from '../src/geom/raster.ts';
import { ScatterExclusion, runScatter, type ScatterInputs } from '../src/stages/s13-scatter.ts';
import { runWater, type TreeRow } from '../src/stages/s3-water.ts';
import type { OsmFeature } from '../src/sources/geo.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

const CFG = loadVegetation();
const box = (x0: number, z0: number, x1: number, z1: number): number[] => [x0, z0, x1, z0, x1, z1, x0, z1];
const STEP = 4, W = 512, H = 384;

/** A 2,048 x 1,536 m area: a clean 1 km2 wood, a wood with every exclusion, scrub, a park with a pitch, a hedge, yards on a sidewalk. */
function inputs(): ScatterInputs {
  const grid = { minX: 0, minZ: 0, maxX: W * STEP, maxZ: H * STEP } as AreaGrid;
  const ground = new Raster(0, 0, STEP, W, H, 0.5, GroundClass.Grass);
  const cover = new Raster(0, 0, STEP, W, H, 0.5, CoverClass.None);
  // sand in a corner of wood B
  ground.fillRings([box(1400, 0, 1500, 100)], GroundClass.Sand);
  // the park (cover Park on base Park ground) and the yards that front a sidewalk row
  ground.fillRings([box(0, 1100, 800, 1500)], GroundClass.Park);
  cover.fillRings([box(0, 1100, 800, 1500)], CoverClass.Park);
  cover.fillRings([box(1000, 1100, 1400, 1300)], CoverClass.Yard);
  ground.fillRings([box(1000, 1300, 1400, 1304)], GroundClass.Sidewalk);
  return {
    grid, cfg: CFG, ground, cover,
    polys: [
      { id: 'w1', kind: 'wood', rings: [box(0, 0, 1000, 1000)] },
      { id: 'w2', kind: 'wood', rings: [box(1100, 0, 1500, 400)] },
      { id: 's1', kind: 'scrub', rings: [box(1600, 0, 1800, 200)] },
    ],
    hedges: [{ id: 'h1', pts: [1600, 600, 1700, 600] }],
    excluded: [{ id: 'pitch', rings: [box(100, 1200, 300, 1400)] }],
    footprints: [{ prism: box(1200, 100, 1260, 160), proxy: false }, { prism: box(1420, 200, 1460, 240), proxy: true }],
    roads: [{ pts: [1100, 300, 1500, 300], widthM: 10 }],
    peds: [{ x0: 1300, z0: 0, x1: 1300, z1: 400, widthM: 3 }],
    chunkExists: () => true,
  };
}

interface Rec { x: number; z: number; byte: number; form: number }
const recs = (r: number[]): Rec[] => {
  const out: Rec[] = [];
  for (let i = 0; i + 3 < r.length; i += 4) out.push({ x: r[i]!, z: r[i + 1]!, byte: r[i + 3]!, form: treeFormOfByte(r[i + 3]!) });
  return out;
};
const isTree = (f: number): boolean => f !== TreeForm.Shrub && f !== TreeForm.Hedge;
const inBox = (r: Rec, x0: number, z0: number, x1: number, z1: number): boolean => r.x >= x0 && r.x < x1 && r.z >= z0 && r.z < z1;

describe('vegetation.json (M02h5)', () => {
  it('validates against tools/map/schemas/vegetation.schema.json, and a broken one does not', () => {
    expect(mapSchema('vegetation')(CFG)).toEqual([]);
    expect(mapSchema('vegetation')({ ...CFG, wood: { ...CFG.wood, rMin: -1 } }).length).toBeGreaterThan(0);
    expect(CFG.wood.rMin).toBe(6);
    expect(CFG.hedge.blockM).toBe(0.9);
  });
});

describe('runScatter (M02h5 AC-2)', () => {
  const inp = inputs();
  const out = runScatter(inp);
  const all = recs(out.records);
  const ex = new ScatterExclusion(inp);

  it('marks every record with bit 7 and only uses the seven forms', () => {
    expect(all.length).toBeGreaterThan(1000);
    for (const r of all) {
      expect(isScatterByte(r.byte), `byte ${r.byte}`).toBe(true);
      expect(r.byte & 0x7f).toBeLessThanOrEqual(6);
    }
    expect(out.report.records).toBe(all.length);
  });

  it('keeps the trees rMin apart and the shrubs their smallest rMin apart', () => {
    const trees = new PointHash(CFG.wood.rMin), shrubs = new PointHash(3);
    for (const r of all) {
      if (isTree(r.form)) trees.add(r.x, r.z);
      else if (r.form === TreeForm.Shrub) shrubs.add(r.x, r.z);
    }
    expect(trees.minPairDistance(CFG.wood.rMin)).toBeGreaterThanOrEqual(CFG.wood.rMin - 1e-9);
    expect(shrubs.minPairDistance(Math.min(CFG.scrub.rMin, CFG.yard.shrubRMin))).toBeGreaterThanOrEqual(Math.min(CFG.scrub.rMin, CFG.yard.shrubRMin) - 1e-9);
    // the wood's understory alone keeps its own spacing
    const under = new PointHash(CFG.wood.understory.rMin);
    for (const r of all) if (r.form === TreeForm.Shrub && inBox(r, 0, 0, 1000, 1000)) under.add(r.x, r.z);
    expect(under.minPairDistance(CFG.wood.understory.rMin)).toBeGreaterThanOrEqual(CFG.wood.understory.rMin - 1e-9);
  });

  it('fills 1 km2 of wood within 10 % of the target density, with the wood mix of forms', () => {
    const trees = all.filter((r) => isTree(r.form) && inBox(r, 0, 0, 1000, 1000));
    const target = (BRIDSON_DENSITY / (CFG.wood.rMin * CFG.wood.rMin)) * 1e6;
    expect(Math.abs(trees.length - target) / target, `${trees.length} trees, target ${target.toFixed(0)}`).toBeLessThan(0.1);
    const share = (f: number): number => trees.filter((r) => r.form === f).length / trees.length;
    expect(Math.abs(share(TreeForm.Eucalyptus) - (CFG.wood.mix.eucalyptus ?? 0))).toBeLessThan(0.05);
    expect(Math.abs(share(TreeForm.Conifer) - (CFG.wood.mix.conifer ?? 0))).toBeLessThan(0.05);
    const shrubs = all.filter((r) => r.form === TreeForm.Shrub && inBox(r, 0, 0, 1000, 1000)).length;
    const want = (BRIDSON_DENSITY / CFG.wood.understory.rMin ** 2) * 1e6 * CFG.wood.understory.share;
    expect(Math.abs(shrubs - want) / want, `${shrubs} understory shrubs, about ${want.toFixed(0)}`).toBeLessThan(0.25);
  });

  it('puts nothing in an exclusion or on the pitch, and wood B is thinned by its exclusions only', () => {
    for (const r of all) expect(ex.reason(r.x, r.z), `${r.x},${r.z}`).toBeNull();
    expect(all.some((r) => inBox(r, 100, 1200, 300, 1400))).toBe(false);
    expect(all.some((r) => inBox(r, 1400, 0, 1500, 100))).toBe(false);
    expect(all.some((r) => Math.abs(r.z - 300) < 5 + CFG.exclusion.roadM && inBox(r, 1100, 0, 1500, 400))).toBe(false);
    expect(all.some((r) => Math.abs(r.x - 1300) < 1.5 + CFG.exclusion.pedM && inBox(r, 1100, 0, 1500, 400))).toBe(false);
    expect(all.filter((r) => inBox(r, 1100, 0, 1500, 400) && isTree(r.form)).length).toBeGreaterThan(1000);
    expect(out.report.blockedM2['road'] ?? 0).toBeGreaterThan(0);
  });

  it('plants groves on the park and leaves the lawns between them open', () => {
    expect(out.report.park.groves).toBeGreaterThan(10);
    expect(out.report.park.trees).toBeGreaterThanOrEqual(out.report.park.groves * (CFG.park.groveMin - 1));
    const park = all.filter((r) => inBox(r, 0, 1100, 800, 1500));
    let open = 0, n = 0;
    for (let x = 5; x < 800; x += 10) {
      for (let z = 1105; z < 1500; z += 10) {
        if (x >= 100 && x < 300 && z >= 1200 && z < 1400) continue;
        n++;
        if (!park.some((r) => Math.hypot(r.x - x, r.z - z) < 8)) open++;
      }
    }
    expect(open / n, 'open lawn share').toBeGreaterThan(0.4);
  });

  it('lays hedge blocks 0.9 m apart on the barrier line and on yard frontages', () => {
    const line = all.filter((r) => r.form === TreeForm.Hedge && Math.abs(r.z - 600) < 0.01).sort((a, b) => a.x - b.x);
    expect(line.length).toBe(Math.floor(100 / CFG.hedge.blockM));
    for (let i = 1; i < line.length; i++) expect(Math.abs(line[i]!.x - line[i - 1]!.x - CFG.hedge.blockM)).toBeLessThan(0.11);
    const yard = all.filter((r) => r.form === TreeForm.Hedge && inBox(r, 1000, 1100, 1400, 1301)).sort((a, b) => a.x - b.x);
    expect(yard.length).toBeGreaterThan(0);
    for (let i = 1; i < yard.length; i++) {
      const d = yard[i]!.x - yard[i - 1]!.x;
      expect(d).toBeGreaterThan(CFG.hedge.blockM - 0.11);
      if (d < 2) expect(Math.abs(d - CFG.hedge.blockM)).toBeLessThan(0.11);
    }
    expect(out.report.yard.hedgeLots).toBeGreaterThan(0);
  });

  it('gives identical records for a shuffled polygon and line order', () => {
    const shuffled = { ...inputs(), polys: [...inp.polys].reverse(), hedges: [...inp.hedges].reverse() };
    expect(runScatter(shuffled).records).toEqual(out.records);
  });
});

describe('street-tree density (S3, M02h5 AC-2)', () => {
  const table = loadTreeForms();
  const ll = (x: number, z: number): [number, number] => {
    const p = latLngFromEnu(x, z);
    return [p.lng, p.lat];
  };
  const rows: TreeRow[] = [
    { ...((): TreeRow => { const p = latLngFromEnu(10, 10); return { latitude: p.lat, longitude: p.lng, species: 'Platanus x hispanica :: London Plane' }; })() },
    { ...((): TreeRow => { const p = latLngFromEnu(60, 10); return { latitude: p.lat, longitude: p.lng, species: 'Stump :: Stump' }; })() },
    { ...((): TreeRow => { const p = latLngFromEnu(70, 10); return { latitude: p.lat, longitude: p.lng, species: 'Planting site :: Planting Site' }; })() },
  ];
  const osm: OsmFeature[] = [
    { id: 'n1', tags: { natural: 'tree' }, geometry: { type: 'Point', coordinates: ll(11.5, 10) } as never },
    { id: 'n2', tags: { natural: 'tree' }, geometry: { type: 'Point', coordinates: ll(40, 40) } as never },
    { id: 'w1', tags: { natural: 'tree_row' }, geometry: { type: 'LineString', coordinates: [ll(0, 100), ll(80, 100)] } as never },
  ];
  const veg = { streetTrees: CFG.streetTrees, park: { excludeLeisure: CFG.park.excludeLeisure } };
  const grid = { minX: -500, minZ: -500, maxX: 500, maxZ: 500, box: { minX: -500, minZ: -500, maxX: 500, maxZ: 500 } } as never;
  const run = (): ReturnType<typeof runWater> => runWater({ grid, osm, parks: [], hoods: [], trees: rows, treeForms: table, vegetation: veg, minRingKm2: 0, baseLandHint: () => true });

  it('drops the OSM duplicate and the skipSpecies rows, keeps the lone OSM tree, a tree every 8 m on the row; never the scatter bit', () => {
    const w = run();
    const t = recs(w.trees);
    expect(w.treeReport.street).toMatchObject({ datasf: 1, osm: 1, duplicates: 1, skipped: 2, treeRows: 1 });
    expect(t.some((r) => Math.abs(r.x - 11.5) < 0.6 && Math.abs(r.z - 10) < 0.6)).toBe(false);
    const row = t.filter((r) => Math.abs(r.z - 100) < 0.5).sort((a, b) => a.x - b.x);
    expect(row.length).toBe(Math.floor(80 / CFG.streetTrees.treeRowM) + 1);
    for (let i = 1; i < row.length; i++) expect(Math.abs(row[i]!.x - row[i - 1]!.x - CFG.streetTrees.treeRowM)).toBeLessThan(0.2);
    for (const r of t) expect(isScatterByte(r.byte)).toBe(false);
    expect(run().trees).toEqual(w.trees);
  });

  it('hands wood, scrub, hedge lines and pitches to the scatter, never into landuse', () => {
    const feats: OsmFeature[] = [
      { id: 'w10', tags: { landuse: 'forest' }, geometry: { type: 'Polygon', coordinates: [[ll(0, 0), ll(50, 0), ll(50, 50), ll(0, 50), ll(0, 0)]] } as never },
      { id: 'w11', tags: { natural: 'scrub' }, geometry: { type: 'Polygon', coordinates: [[ll(60, 0), ll(90, 0), ll(90, 30), ll(60, 30), ll(60, 0)]] } as never },
      { id: 'w12', tags: { barrier: 'hedge' }, geometry: { type: 'LineString', coordinates: [ll(0, 70), ll(40, 70)] } as never },
      { id: 'w13', tags: { leisure: 'pitch' }, geometry: { type: 'Polygon', coordinates: [[ll(0, 80), ll(30, 80), ll(30, 99), ll(0, 99), ll(0, 80)]] } as never },
    ];
    const w = runWater({ grid, osm: feats, parks: [], hoods: [], trees: [], treeForms: table, vegetation: veg, minRingKm2: 0, baseLandHint: () => true });
    expect(w.vegetationPolys?.map((p) => `${p.id}:${p.kind}`)).toEqual(['w10#0:wood', 'w11#0:scrub']);
    expect(w.hedgeLines?.map((h) => h.id)).toEqual(['w12#0']);
    expect(w.excludedPolys?.map((h) => h.id)).toEqual(['w13#0']);
    expect(w.landuse.some((u) => u.cls === ('forest' as never))).toBe(false);
  });
});

describe('the synth bake (M02h5 AC-2)', () => {
  it('has scatter and streetTrees in its report, bit 7 on scatter records only, l0 packs at most 2.5 MiB', () => {
    const bake = requireBake('synth', 'scatter synth');
    if (!bake) return;
    const report = JSON.parse(readFileSync(path.join(bake.dir, 'bake-report.json'), 'utf8')) as {
      scatter?: { records: number; wood: { m2: number; trees: number } }; streetTrees?: { trees: number; hoods: unknown[]; sources: { duplicates: number; skipped: number; treeRow: number } };
      counts: { trees: number; scatter?: number };
    };
    expect(report.scatter?.records).toBeGreaterThan(0);
    expect(report.scatter?.wood.m2).toBeGreaterThan(0);
    expect(report.streetTrees?.hoods.length).toBeGreaterThan(0);
    expect(report.streetTrees?.sources.duplicates).toBeGreaterThan(0);
    expect(report.streetTrees?.sources.skipped).toBeGreaterThan(0);
    expect(report.streetTrees?.sources.treeRow).toBeGreaterThan(0);
    const dir = path.join(bake.dir, 'packs');
    let street = 0, scatter = 0;
    for (const name of readdirSync(dir).filter((n) => /^l0-\d+-\d+\.pack$/.test(n)).sort()) {
      expect(statSync(path.join(dir, name)).size, name).toBeLessThanOrEqual(2.5 * 1024 * 1024);
      const sims = decodeP0(new Uint8Array(readFileSync(path.join(dir, name.replace('l0-', 'p0-')))));
      for (const c of decodeL0(new Uint8Array(readFileSync(path.join(dir, name))), sims)) {
        for (let i = 3; i < c.trees.length; i += 4) {
          if (isScatterByte(c.trees[i]!)) scatter++;
          else street++;
        }
      }
    }
    expect(scatter).toBeGreaterThan(0);
    // the packed street trees are the S3 trees on land (a few fall on water or off the chunks), never more
    expect(street).toBeLessThanOrEqual(report.counts.trees);
    expect(scatter).toBeLessThanOrEqual(report.scatter?.records ?? 0);
  });
});
