import { describe, expect, it } from 'vitest';
import { TERRAIN_POSTS, enuFromLatLng, latLngFromEnu, type ChunkKey } from '../../../packages/shared/src/index.ts';
import { pinnedClamp, runGrading, type BridgesConfig, type GradingProduct } from '../src/stages/s7-grading.ts';
import { TerrainField } from '../src/stages/s2-terrain.ts';
import { CITY_KEYS, bridgesCfg, crossing, gridsFor, keysBox, net, resetIds, roadCfg, way } from './net-fixtures.ts';

type Height = (x: number, z: number) => number;
const hill: Height = (x, z) => 20 + 25 * Math.exp(-((x - 100) ** 2 + z ** 2) / (2 * 120 ** 2));
const steep: Height = (x) => 10 + 0.8 * Math.max(-100, Math.min(100, x)) + 80;

function grade(osm: ReturnType<typeof way>[], h: Height, cfg: BridgesConfig = bridgesCfg, keys: ChunkKey[] = CITY_KEYS): { g: GradingProduct; grids: Map<ChunkKey, Int16Array> } {
  const { roads, junctions } = net(osm);
  const grids = gridsFor(keys, h);
  const g = runGrading({ segs: roads.segs, nodes: junctions.nodes, edges: roads.edges, grids, cfg, hillGradePct: roadCfg.hillGradePct });
  return { g, grids };
}

const gradeOf = (g: GradingProduct): number => Math.max(0, ...g.edges.map((e) => e.maxGradePct));

describe('S7 grading of surface roads', () => {
  it('never lets a road exceed 40 % even over an 80 % hillside, and the Hill flag marks steep edges', () => {
    resetIds();
    const { g } = grade([way([-100, 0, 100, 0], { highway: 'residential' }), way([-100, 0, -100, 100], { highway: 'residential' })], steep);
    expect(gradeOf(g)).toBeLessThanOrEqual(40);
    expect(g.stats.maxGradePct).toBeLessThanOrEqual(40);
    expect(g.edges.some((e) => e.flags & 32)).toBe(true);
  });

  it('puts the road surface on the heightfield along the centre line', () => {
    resetIds();
    const { g } = grade([...crossing(160)], hill);
    const field = new TerrainField(g.grids);
    let worst = 0;
    for (const s of g.segs) {
      for (let i = 0; i < s.pts.length / 2; i++) {
        const h = field.heightAt(s.pts[i * 2] as number, s.pts[i * 2 + 1] as number);
        worst = Math.max(worst, Math.abs((h ?? 0) - (s.ys[i] as number)));
      }
    }
    // bilinear sampling and the junction regions, where two roads of different profile meet, bound the difference
    expect(worst).toBeLessThan(0.6);
  });

  it('keeps the shared edge posts of neighbouring chunks equal after grading', () => {
    resetIds();
    // a street along the chunk border x = 128 and one across it
    const { g } = grade([way([128, -200, 128, 200], { highway: 'primary' }), way([20, 40, 260, 40], { highway: 'residential' })], hill);
    const a = g.grids.get('9/256/256' as ChunkKey)!, b = g.grids.get('9/257/256' as ChunkKey)!;
    let diff = 0;
    for (let j = 0; j < TERRAIN_POSTS; j++) diff += Math.abs(a[j * TERRAIN_POSTS + TERRAIN_POSTS - 1]! - b[j * TERRAIN_POSTS]!);
    expect(diff).toBe(0);
    expect(g.stats.postsGraded).toBeGreaterThan(50);
  });

  it('pins both ends and limits the slope of a profile (pinnedClamp)', () => {
    const n = 41;
    const s = Float64Array.from({ length: n }, (_v, k) => k * 4);
    const y = Float64Array.from({ length: n }, (_v, k) => (k % 2 ? 30 : 0));   // jagged input
    pinnedClamp(y, s, 0, 40, 0.39);
    expect(y[0]).toBe(0);
    expect(y[n - 1]).toBe(40);
    for (let k = 1; k < n; k++) expect(Math.abs(y[k]! - y[k - 1]!)).toBeLessThanOrEqual(0.39 * 4 + 1e-6);
  });
});

describe('S7 bridges, slabs and tunnels', () => {
  const overpass = way([-250, 100, 250, 100], { highway: 'primary', bridge: 'yes', layer: '1', name: 'Overpass' });
  const under = [way([0, -100, 0, 100], { highway: 'residential' }), way([0, 100, 0, 300], { highway: 'residential' })];

  it('adds slabs with steps of at most 0.16 m and rises to terrain + 5.5 m without leaving the 6 % approach grade', () => {
    resetIds();
    const flat: Height = () => 12;
    const { g } = grade([overpass, ...under], flat);
    expect(g.stats.overpasses).toBe(1);
    expect(g.stats.slabs).toBeGreaterThan(100);
    expect(g.stats.maxSlabStepM).toBeLessThanOrEqual(0.16);
    const seg = g.segs.find((s) => s.bridge)!;
    const peak = Math.max(...seg.ys);
    expect(peak).toBeCloseTo(12 + 5.5, 0);
    for (let i = 1; i < seg.ys.length; i++) {
      const dx = Math.hypot(seg.pts[i * 2]! - seg.pts[i * 2 - 2]!, seg.pts[i * 2 + 1]! - seg.pts[i * 2 - 1]!);
      expect(Math.abs(seg.ys[i]! - seg.ys[i - 1]!) / dx).toBeLessThanOrEqual(0.07);
    }
    // slab tops step by at most 0.16 m between neighbours, read back from the prisms
    const prisms = [...g.slabs.values()].flat();
    const tops: number[] = [];
    for (let i = 0; i < prisms.length;) { const n = prisms[i]!; tops.push(prisms[i + 1]! + prisms[i + 2]!); i += 3 + n * 2; }
    expect(tops.length).toBe(g.stats.slabs);
    for (let i = 1; i < tops.length; i++) expect(Math.abs(tops[i]! - tops[i - 1]!)).toBeLessThanOrEqual(0.16 + 1e-6);
  });

  it('leaves the terrain under a deck alone', () => {
    resetIds();
    const flat: Height = () => 12;
    const { g, grids } = grade([overpass, ...under], flat);
    const key = '9/256/256' as ChunkKey;
    const before = grids.get(key)!;
    // the underpass street is graded to its own profile at x = 0; the posts under the deck between z = 100 +- 40 are not raised to the deck
    const j = Math.round((100 - (-128)) / 4), i = Math.round((20 - (-128)) / 4);
    expect(g.grids.get(key)![j * TERRAIN_POSTS + i]).toBe(before[j * TERRAIN_POSTS + i]);
  });

  it('lowers a tunnel corridor and covers it with hoods from road + 5.5 m to the old terrain top', () => {
    resetIds();
    const ridge: Height = (x) => 10 + 40 * Math.exp(-(x * x) / (2 * 60 * 60));
    const { g } = grade([way([-200, 0, 200, 0], { highway: 'tertiary', tunnel: 'yes', layer: '-1' })], ridge);
    expect(g.stats.tunnels).toBe(1);
    expect(g.stats.hoods).toBeGreaterThan(10);
    expect(g.stats.openCuts).toBe(0);
    const seg = g.segs[0]!;
    const roadMid = seg.ys[Math.floor(seg.ys.length / 2)]!;
    const hood = [...g.hoods.values()].flat();
    // first hood record: base = road + 5.5, height = terrain top - base
    expect(hood[0]).toBe(4);
    expect(hood[1]! - 5.5).toBeLessThanOrEqual(Math.max(...seg.ys) + 0.2);
    const field = new TerrainField(g.grids);
    expect(field.heightAt(0, 0)!).toBeCloseTo(roadMid - 0.5, 0);
  });

  it('keeps a short tunnel with thin cover as an open cut (no hoods)', () => {
    resetIds();
    const { g } = grade([way([-40, 0, 40, 0], { highway: 'tertiary', tunnel: 'yes', layer: '-1' })], () => 12);
    expect(g.stats.tunnels).toBe(1);
    expect(g.stats.hoods).toBe(0);
    expect(g.stats.openCuts).toBe(1);
  });

  it('puts a named main span at its deck height with at most 6 % ramps to the shore', () => {
    resetIds();
    const mid = latLngFromEnu(0, 0);
    const cfg: BridgesConfig = { ...bridgesCfg, named: [{ id: 'test-span', lat: mid.lat, lng: mid.lng, radiusM: 2000, deckM: 67 }] };
    // land for |x| > 1,000, water between: a 3 km bridge, long enough to climb from 15 m to 67 m at 6 %
    const shore: Height = (x) => (Math.abs(x) > 1000 ? 15 : -10);
    const { g } = grade([way([-1500, 0, 1500, 0], { highway: 'motorway', bridge: 'yes', layer: '1', oneway: 'yes' })], shore, cfg, keysBox(-1500, 1500, -50, 50));
    expect(g.stats.namedSpans).toBe(1);
    const s = g.segs[0]!;
    expect(Math.max(...s.ys)).toBeCloseTo(67, 0);
    for (let i = 1; i < s.ys.length; i++) expect(Math.abs(s.ys[i]! - s.ys[i - 1]!) / Math.hypot(s.pts[i * 2]! - s.pts[i * 2 - 2]!, s.pts[i * 2 + 1]! - s.pts[i * 2 - 1]!)).toBeLessThanOrEqual(0.07);
    expect(enuFromLatLng(mid.lat, mid.lng).x).toBeCloseTo(0, 3);
  });
});
