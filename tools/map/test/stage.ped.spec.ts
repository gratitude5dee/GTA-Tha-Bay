import { describe, expect, it } from 'vitest';
import { PedEdgeKind, PedNodeFlag, type ChunkKey } from '../../../packages/shared/src/index.ts';
import { PrismIndex } from '../../../tools/map/src/geom/prisms.ts';
import { LATTICE_M, PED_EDGE_LIMIT, SIDEWALK_OFFSET_M, runPed, type PedProduct } from '../src/stages/s8-ped.ts';
import { TerrainField } from '../src/stages/s2-terrain.ts';
import { runGrading } from '../src/stages/s7-grading.ts';
import type { LandusePoly } from '../src/stages/s3-water.ts';
import { CITY_KEYS, BOX, bridgesCfg, crossing, gridsFor, net, point, resetIds, roadCfg, way } from './net-fixtures.ts';

const flat = (): number => 12;

function ped(osm: ReturnType<typeof way>[], opts: { landuse?: LandusePoly[]; prisms?: PrismIndex } = {}): { p: PedProduct; segs: ReturnType<typeof runGrading>['segs'] } {
  const { roads, junctions } = net(osm);
  const g = runGrading({ segs: roads.segs, nodes: junctions.nodes, edges: roads.edges, grids: gridsFor(CITY_KEYS, flat), cfg: bridgesCfg, hillGradePct: roadCfg.hillGradePct });
  const p = runPed({
    segs: g.segs, edges: g.edges, nodes: g.nodes, junctions: junctions.junctions, osm, field: new TerrainField(g.grids),
    landuse: opts.landuse ?? [], prisms: opts.prisms ?? new PrismIndex(), isWater: () => false, box: BOX,
  });
  return { p, segs: g.segs };
}

const allEdges = (p: PedProduct): { kind: PedEdgeKind; a: { x: number; z: number; flags: number }; b: { x: number; z: number; flags: number }; w: number; junction: number; movement: number }[] => {
  const out: ReturnType<typeof allEdges> = [];
  for (const c of p.chunks.values()) {
    const byId = new Map(c.nodes.map((n) => [n.id, n]));
    for (const e of c.edges) out.push({ kind: e.kind, a: byId.get(e.a)!, b: byId.get(e.b)!, w: e.widthM, junction: e.junction, movement: e.movement });
  }
  return out;
};

describe('S8 sidewalks and crosswalks', () => {
  it('offsets sidewalks half a road width plus 1.6 m from the centre line, on both sides', () => {
    resetIds();
    const { p, segs } = ped([way([-100, 20, 100, 20], { highway: 'residential' }), way([-100, 20, -100, 120], { highway: 'residential' })]);
    const seg = segs[0]!;
    const off = seg.widthM / 2 + SIDEWALK_OFFSET_M;
    const walks = allEdges(p).filter((e) => e.kind === PedEdgeKind.Sidewalk && Math.abs(e.a.z - e.b.z) < 0.5 && Math.abs(e.a.x - e.b.x) > 15);
    expect(walks.length).toBeGreaterThan(1);
    const zs = new Set(walks.map((e) => Math.round(Math.abs(e.a.z - 20) * 10) / 10));
    expect([...zs]).toEqual([Math.round(off * 10) / 10]);
    expect(new Set(walks.map((e) => Math.sign(e.a.z - 20))).size).toBe(2);
  });

  it('puts a crosswalk across each approach of a four-way junction, carrying the junction id and a movement', () => {
    resetIds();
    const { p } = ped([...crossing(100), point(0, 0, { highway: 'traffic_signals' })]);
    const xw = allEdges(p).filter((e) => e.kind === PedEdgeKind.Crosswalk);
    expect(xw).toHaveLength(4);
    expect(p.report.crosswalks).toBe(4);
    for (const e of xw) {
      expect(e.junction).toBeGreaterThanOrEqual(0);
      expect(e.movement).toBeGreaterThanOrEqual(0);
      expect(e.a.flags & PedNodeFlag.Crossing).toBeTruthy();
      expect(e.b.flags & PedNodeFlag.Waiting).toBeTruthy();
    }
  });

  it('adds a mid-block crossing at an OSM highway=crossing point and none for freeways, ramps and service roads', () => {
    resetIds();
    const mid = ped([way([-150, 0, 150, 0], { highway: 'residential' }), point(30, 0, { highway: 'crossing' })]);
    const xw = allEdges(mid.p).filter((e) => e.kind === PedEdgeKind.Crosswalk);
    expect(xw).toHaveLength(1);
    expect(xw[0]!.junction).toBe(-1);
    resetIds();
    const none = ped([way([-150, 0, 150, 0], { highway: 'motorway', oneway: 'yes' }), way([-150, 40, 150, 40], { highway: 'service' })]);
    expect(none.p.report.nodes).toBe(0);
    expect(none.p.report.sidewalkKm).toBe(0);
  });

  it('skips segments tagged sidewalk=no, bridges and tunnels', () => {
    resetIds();
    const r = ped([
      way([-150, 0, 150, 0], { highway: 'residential', sidewalk: 'no' }),
      way([-150, 60, 150, 60], { highway: 'tertiary', bridge: 'yes', layer: '1' }),
    ]);
    expect(r.p.report.sidewalkKm).toBe(0);
  });
});

describe('S8 paths, plazas and the chunk cut', () => {
  it('turns OSM footways and steps into Path and Stairs edges joined to a nearby sidewalk', () => {
    resetIds();
    const { p } = ped([
      way([-150, 0, 150, 0], { highway: 'residential' }),
      way([-60, 12, -60, 80], { highway: 'footway' }),
      way([60, 12, 60, 80], { highway: 'steps' }),
    ]);
    const edges = allEdges(p);
    expect(edges.some((e) => e.kind === PedEdgeKind.Path)).toBe(true);
    expect(edges.some((e) => e.kind === PedEdgeKind.Stairs)).toBe(true);
    expect(p.report.paths).toBeGreaterThan(8);
    expect(p.report.minTileFraction).toBeGreaterThan(0.85);
  });

  it('lays a 12 m lattice in a plaza and leaves out posts under a prism', () => {
    resetIds();
    const sq = (c: number, h: number): number[] => [c - h, c - h, c + h, c - h, c + h, c + h, c - h, c + h];
    const plaza: LandusePoly = { cls: 'plaza', rings: [sq(60, 40)] };
    const open = ped([way([-100, -60, 60, -60], { highway: 'residential' })], { landuse: [plaza] });
    expect(open.p.report.latticeNodes).toBeGreaterThan(30);
    const plazaEdges = allEdges(open.p).filter((e) => e.kind === PedEdgeKind.Plaza);
    expect(plazaEdges.length).toBeGreaterThan(30);
    for (const e of plazaEdges) expect(Math.hypot(e.a.x - e.b.x, e.a.z - e.b.z)).toBeLessThanOrEqual(LATTICE_M + 0.2);
    const prisms = new PrismIndex();
    prisms.add(sq(60, 12));
    resetIds();
    const blocked = ped([way([-100, -60, 60, -60], { highway: 'residential' })], { landuse: [plaza], prisms });
    expect(blocked.p.report.latticeNodes).toBeLessThan(open.p.report.latticeNodes);
  });

  it('cuts every edge at the chunk grid lines so each chunk is self-contained with duplicate nodes', () => {
    resetIds();
    // a 400 m street crosses at least one chunk border
    const { p } = ped([way([-100, 0, 300, 0], { highway: 'primary' })]);
    expect(p.chunks.size).toBeGreaterThan(1);
    const seenAt = new Map<string, Set<string>>();
    for (const [key, c] of p.chunks) {
      const ids = new Set(c.nodes.map((n) => n.id));
      for (const e of c.edges) {
        expect(ids.has(e.a)).toBe(true);
        expect(ids.has(e.b)).toBe(true);
      }
      for (const n of c.nodes) {
        const k = `${n.x},${n.z}`;
        (seenAt.get(k) ?? seenAt.set(k, new Set()).get(k)!).add(key);
      }
    }
    // cut points are the same position in both neighbouring chunks
    const dup = [...seenAt.values()].filter((s) => s.size === 2);
    expect(dup.length).toBeGreaterThan(0);
    expect([...seenAt.values()].every((s) => s.size <= 2)).toBe(true);
  });

  it('keeps every chunk at or below the 1,500 ped-edge limit and reports the busiest chunk', () => {
    resetIds();
    const { p } = ped([...crossing(120), point(0, 0, { highway: 'traffic_signals' })]);
    expect(p.report.maxEdgesPerChunk).toBeLessThanOrEqual(PED_EDGE_LIMIT);
    expect(p.report.overLimit).toEqual([]);
    expect(p.sidewalkM.size).toBeGreaterThan(0);
    const keys: ChunkKey[] = [...p.chunks.keys()];
    expect(keys.length).toBeGreaterThan(0);
  });
});
