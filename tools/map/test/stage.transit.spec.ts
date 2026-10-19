import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { latLngFromEnu } from '../../../packages/shared/src/index.ts';
import { loadContentWorld, type ContentWorld } from '../src/content.ts';
import { mapSchema } from '../src/config.ts';
import { buildEdgeGraph } from '../src/graph/route.ts';
import { runTransit, type RouteRow, type StopRow } from '../src/stages/s10-transit.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';
import { BOX, net, resetIds, way } from './net-fixtures.ts';

const content = loadContentWorld();
const shape = (pts: number[]): RouteRow['shape'] => ({
  type: 'MultiLineString',
  coordinates: [pts.reduce<number[][]>((a, _v, i) => { if (i % 2 === 0) { const p = latLngFromEnu(pts[i] as number, pts[i + 1] as number); a.push([p.lng, p.lat]); } return a; }, [])],
}) as RouteRow['shape'];
const stopAt = (id: string, x: number, z: number): StopRow => { const p = latLngFromEnu(x, z); return { stopid: id, stopname: `Stop ${id}`, latitude: p.lat, longitude: p.lng }; };

function transit(osm: ReturnType<typeof way>[], o: { routes?: RouteRow[]; stops?: StopRow[]; content?: ContentWorld; requireCablecars?: boolean } = {}) {
  const { roads, junctions } = net(osm);
  const graph = buildEdgeGraph(roads.edges, junctions.junctions, (n) => junctions.nodes[n]!.junction, (e) => roads.segs[e.seg]!.lengthM, (n) => junctions.nodes[n]!.out);
  const r = runTransit({
    bakeId: 'a'.repeat(64), osm, routes: o.routes ?? [], stops: o.stops ?? [], segs: roads.segs, edges: roads.edges, nodes: junctions.nodes, graph,
    content: o.content ?? content, box: BOX, requireCablecars: o.requireCablecars ?? false,
  });
  return { ...r, roads };
}

describe('S10 transit routes', () => {
  it('keeps surface light-rail and tram ways as metro splines and drops tunnel sections', () => {
    resetIds();
    const { routes, report } = transit([
      way([-300, 400, 300, 400], { railway: 'light_rail' }, 'w10'),
      way([-300, 500, 300, 500], { railway: 'tram' }, 'w11'),
      way([-300, 600, 300, 600], { railway: 'light_rail', tunnel: 'yes' }, 'w12'),
      way([-300, 700, 300, 700], { railway: 'rail' }, 'w13'),
    ]);
    expect(routes.metro.map((m) => m.id)).toEqual(['metro.w10', 'metro.w11']);
    expect(report.metro).toBe(2);
    // resampled at 40 m or finer, in ENU metres at 0.1 m
    const pts = routes.metro[0]!.points;
    expect(pts.length / 2).toBeGreaterThan(10);
    for (let i = 2; i < pts.length; i += 2) expect(Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!)).toBeLessThanOrEqual(40.5);
    for (const v of pts) expect(Math.round(v * 10)).toBeCloseTo(v * 10, 6);
  });

  it('snaps a bus pattern to a drivable edge sequence in travel direction and binds stops within 25 m', () => {
    resetIds();
    const streets = [
      way([-150, 0, 0, 0], { highway: 'primary', name: 'Main Street' }, 'w1'),
      way([0, 0, 150, 0], { highway: 'primary', name: 'Main Street' }, 'w2'),
      way([150, 0, 300, 0], { highway: 'primary', name: 'Main Street' }, 'w3'),
    ];
    const { routes, report, roads } = transit(streets, {
      routes: [{ lineabbr: '14', route_name: 'Fourteen', direction: 'Outbound', shape: shape([-140, 6, 290, 6]) }],
      stops: [stopAt('1001', -100, 8), stopAt('1002', 200, 6), stopAt('1003', 100, 90)],   // the third is 90 m off the street
    });
    expect(routes.bus).toHaveLength(1);
    const bus = routes.bus[0]!;
    expect(bus.id).toBe('bus.14.outbound');
    expect(bus.edges.length).toBeGreaterThanOrEqual(3);
    for (const e of bus.edges) expect(roads.edges[e]).toBeDefined();
    // east-bound: each edge starts where the previous one ends
    for (let i = 1; i < bus.edges.length; i++) expect(roads.edges[bus.edges[i]!]!.from).toBe(roads.edges[bus.edges[i - 1]!]!.to);
    expect(bus.stops.map((s) => s.id)).toEqual(['stop.1001', 'stop.1002']);
    for (const s of bus.stops) expect(bus.edges).toContain(s.edge);
    expect(report.busStops).toBe(2);
    expect(report.busGaps).toBe(0);
    // names are registry keys, never source strings
    expect(bus.nameKey).toBe('transit.bus.14');
    expect(JSON.stringify(routes)).not.toMatch(/Fourteen|Stop 1001/);
  });

  it('uses OSM route=ferry ways when present and the authored lines otherwise', () => {
    resetIds();
    const osmFerry = transit([way([-2000, -3000, 2000, -3500], { route: 'ferry' }, 'w20')]);
    expect(osmFerry.report.ferrySource).toBe('osm');
    expect(osmFerry.routes.ferry.map((f) => f.source)).toEqual(['osm']);
    resetIds();
    const authored = transit([way([-100, 0, 100, 0], { highway: 'residential' })]);
    expect(authored.report.ferrySource).toBe('authored');
    expect(authored.routes.ferry.length).toBe(content.transitLines.ferry.length);
    expect(authored.routes.ferry.every((f) => f.source === 'authored')).toBe(true);
  });

  it('always writes the 3 authored air corridors with their altitude bands', () => {
    resetIds();
    const { routes } = transit([way([-100, 0, 100, 0], { highway: 'residential' })]);
    expect(routes.air).toHaveLength(3);
    for (const a of routes.air) {
      expect(a.altitudeM[0]).toBeGreaterThanOrEqual(600);
      expect(a.altitudeM[1]).toBeLessThanOrEqual(1500);
      expect(a.points.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('chains a cable-car line along named streets and reports a missing chain', () => {
    resetIds();
    const streets = [
      way([-200, 0, 0, 0], { highway: 'primary', name: 'Alpha Street' }, 'w1'),
      way([0, 0, 200, 0], { highway: 'primary', name: 'Alpha Street' }, 'w2'),
      way([0, -150, 0, 0], { highway: 'secondary', name: 'Beta Street' }, 'w3'),
      way([0, 0, 0, 150], { highway: 'secondary', name: 'Beta Street' }, 'w4'),
      way([-200, 100, 200, 100], { highway: 'secondary', name: 'Gamma Street' }, 'w5'),
      way([200, 0, 200, 100], { highway: 'secondary', name: 'Delta Street' }, 'w6'),
    ];
    const withLines: ContentWorld = {
      ...content,
      cablecars: {
        ...content.cablecars,
        lines: [
          { id: 'cc.test-ok', legs: [{ street: 'Alpha Street', from: 'Beta Street', to: 'Delta Street' }] },
          { id: 'cc.test-missing', legs: [{ street: 'Alpha Street', from: 'Beta Street', to: 'Nowhere Street' }] },
        ],
      },
    } as ContentWorld;
    const { routes, report } = transit(streets, { content: withLines, requireCablecars: true });
    expect(routes.cablecar.map((c) => c.id)).toEqual(['cc.test-ok']);
    expect(report.cablecarMissing).toEqual(['cc.test-missing']);
    const pts = routes.cablecar[0]!.points;
    expect(Math.hypot(pts[0]! - 0, pts[1]! - 0)).toBeLessThan(1);
    expect(Math.hypot(pts[pts.length - 2]! - 200, pts[pts.length - 1]! - 0)).toBeLessThan(1);
  });

  it('is deterministic', () => {
    const run = (): string => { resetIds(); return JSON.stringify(transit([way([-300, 400, 300, 400], { railway: 'light_rail' }, 'w10')]).routes); };
    expect(run()).toBe(run());
  });
});

describe('transit routes asset on the synth bake (AC-11; needs pnpm map:build -- --area synth)', () => {
  const bake = requireBake('synth', 'stage.transit');
  const run = bake ? it : it.skip;

  run('validates against transit-routes.schema.json with the required counts and is in the ODbL database scope', () => {
    const routes = JSON.parse(readFileSync(path.join(bake!.dir, 'transit-routes.json'), 'utf8')) as {
      metro: unknown[]; bus: { edges: number[]; stops: unknown[] }[]; ferry: unknown[]; cablecar: unknown[]; air: unknown[];
    };
    expect(mapSchema('transit-routes')(routes)).toEqual([]);
    expect(routes.metro.length).toBeGreaterThanOrEqual(1);
    expect(routes.bus.filter((b) => b.stops.length >= 2).length).toBeGreaterThanOrEqual(2);
    expect(routes.ferry.length).toBeGreaterThanOrEqual(1);
    expect(routes.air).toHaveLength(3);
    const idx = JSON.parse(readFileSync(path.join(bake!.dir, 'world-index.json'), 'utf8')) as { transit: { kind: string; fastTravel: boolean }[] };
    const bay = idx.transit.filter((t) => t.kind === 'bay-rail');
    expect(bay).toHaveLength(8);
    expect(bay.every((t) => t.fastTravel)).toBe(true);
    const sources = JSON.parse(readFileSync(path.join(process.cwd(), 'config', 'world', 'sources.json'), 'utf8')) as { database: { assets: string[] } };
    expect(sources.database.assets).toContain('data/transit-routes.v1');
  });
});
