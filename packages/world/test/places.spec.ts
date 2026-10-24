import { describe, expect, it } from 'vitest';
import { RoadNetwork } from '../src/sim/graph/adjacency.ts';
import { RoadGraph } from '../src/sim/graph/query.ts';
import { PED_ROUTE_MAX_POINTS, PlaceIndexImpl, labelFromKey, thin } from '../src/sim/api/places.ts';
import { loadBake } from './fixtures/bake.ts';
import { roads, topologyOf } from './fixtures/roads.ts';
import { indexOf, landmarkAt, poiAt } from './fixtures/world.ts';

const graphOf = (f: ReturnType<typeof roads>): RoadGraph => new RoadGraph(new RoadNetwork(topologyOf(f)), { tick: () => 0, blackout: () => false, closed: () => false });

describe('PlaceIndex on fixtures', () => {
  const lms = [landmarkAt('lm.coit-tower', 1186, -2562, '9/261/246'), landmarkAt('lm.city-hall', 4, 1, '9/256/256'), landmarkAt('lm.coit-view', 1200, -2500, '9/261/246')];
  const pois = [
    poiAt('poi.north-beach.coit-cafe', 1190, -2570, 'cafe'),
    poiAt('poi.north-beach.coit-tower-shop', 1180, -2560, 'shop', { landmark: 'lm.coit-tower' }),
    poiAt('poi.mission.dolores-bar', 100, 100, 'bar'),
    poiAt('poi.mission.dolores-cafe', 100, 130, 'cafe'),
    poiAt('poi.mission.far-cafe', 100, 600, 'cafe'),
    poiAt('poi.mission.same-spot', 100, 100, 'cafe'),
  ];
  const index = indexOf({ landmarks: lms, pois });
  const places = new PlaceIndexImpl(index);

  it('looks up landmarks and POIs by id', () => {
    expect(places.landmarks().map((l) => l.id)).toEqual(lms.map((l) => l.id));
    expect(places.landmark('lm.city-hall')!.x).toBe(4);
    expect(places.landmark('lm.nope')).toBeNull();
    expect(places.poi('poi.mission.dolores-bar')!.kind).toBe('bar');
    expect(places.poi('poi.nope.x')).toBeNull();
    expect(places.poiPos('poi.mission.dolores-cafe')).toEqual([100, 0, 130]);
    expect(places.poiPos('poi.nope.x')).toBeNull();
  });

  it('lists POIs inside the radius only, nearest first, ties by id, filtered by kind', () => {
    const near = places.poisNear(100, 100, 50).map((p) => p.id);
    expect(near).toEqual(['poi.mission.dolores-bar', 'poi.mission.same-spot', 'poi.mission.dolores-cafe']);
    expect(places.poisNear(100, 100, 29).map((p) => p.id)).toEqual(['poi.mission.dolores-bar', 'poi.mission.same-spot']);
    expect(places.poisNear(100, 100, 50, 'cafe').map((p) => p.id)).toEqual(['poi.mission.same-spot', 'poi.mission.dolores-cafe']);
    expect(places.poisNear(5000, 5000, 100)).toEqual([]);
    for (const p of places.poisNear(100, 100, 200)) expect(Math.hypot(p.x - 100, p.z - 100)).toBeLessThanOrEqual(200);
  });

  it('finds places by prefix and token, landmarks first, and bounds the answer by the limit', async () => {
    const r = await places.findPlace('coit', 5);
    expect(r[0]).toEqual({ label: 'Coit Tower', x: 1186, z: -2562, kind: 'landmark' });
    expect(r.map((e) => e.label)).toEqual(['Coit Tower', 'Coit View', 'Coit Cafe']);
    expect((await places.findPlace('coit', 2)).length).toBe(2);
    expect((await places.findPlace('tower coit', 5)).map((e) => e.label)).toEqual(['Coit Tower']);
    expect((await places.findPlace('dolores', 5)).map((e) => e.kind)).toEqual(['bar', 'cafe']);
    expect(await places.findPlace('', 5)).toEqual([]);
    expect(await places.findPlace('zzz', 5)).toEqual([]);
    expect(await places.findPlace('coit', 0)).toEqual([]);
    expect((await places.findPlace('CITY hall', 5))[0]!.label).toBe('City Hall');
  });

  it('uses the injected label when there is one', async () => {
    const p = new PlaceIndexImpl(index, null, (key) => (key === 'place.coit-tower' ? 'Telegraph Hill Tower' : undefined));
    expect((await p.findPlace('telegraph', 3))[0]!.label).toBe('Telegraph Hill Tower');
    expect(labelFromKey('poi.north-beach.coit-cafe')).toBe('Coit Cafe');
    expect(labelFromKey('place.city-hall')).toBe('City Hall');
  });

  it('thins a polyline to at most the limit, keeping both ends', () => {
    const pts = Array.from({ length: 500 }, (_v, i) => i);
    const t = thin(pts, 64);
    expect(t).toHaveLength(64);
    expect(t[0]).toBe(0);
    expect(t[63]).toBe(499);
    expect(t).toEqual([...t].sort((a, b) => a - b));
    expect(thin([1, 2, 3], 64)).toEqual([1, 2, 3]);
  });

  it('plans a commute along the roads, thinned to 64 points, and falls back to the straight line', () => {
    // a street of 300 short edges
    const nodes: [number, number][] = Array.from({ length: 301 }, (_v, i) => [i * 10, 0]);
    const f = roads(nodes, Array.from({ length: 300 }, (_v, i) => ({ a: i, b: i + 1 })));
    const withRoads = new PlaceIndexImpl(indexOf({ pois: [poiAt('poi.a.start', 5, 3), poiAt('poi.a.end', 2995, 3)] }), graphOf(f));
    const route = withRoads.pedRoute('poi.a.start', 'poi.a.end');
    expect(route.length).toBeLessThanOrEqual(PED_ROUTE_MAX_POINTS);
    expect(route.length).toBeGreaterThan(10);
    expect(route[0]).toEqual([5, 0, 3]);
    expect(route[route.length - 1]).toEqual([2995, 0, 3]);
    for (let i = 1; i < route.length; i++) expect(route[i]![0]).toBeGreaterThanOrEqual(route[i - 1]![0] - 1e-9);
    // no graph, or an island: the two ends
    expect(places.pedRoute('poi.mission.dolores-bar', 'poi.mission.far-cafe')).toEqual([[100, 0, 100], [100, 0, 600]]);
    expect(places.pedRoute('poi.mission.dolores-bar', 'poi.nope.x')).toEqual([]);
  });
});

describe('PlaceIndex on the synth bake', () => {
  const bake = loadBake('synth', 'places.spec');

  it('lists lm.coit-tower first for "coit", and POIs near a point sorted and inside the radius', async () => {
    if (!bake) return;
    const places = new PlaceIndexImpl(bake.index);
    const coit = bake.index.landmarks.find((l) => l.id === 'lm.coit-tower')!;
    const r = await places.findPlace('coit', 5);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]).toMatchObject({ kind: 'landmark', x: coit.x, z: coit.z });
    const around = places.poisNear(coit.x, coit.z, 1500);
    expect(around.length).toBeGreaterThan(0);
    let last = 0;
    for (const p of around) {
      const d = Math.hypot(p.x - coit.x, p.z - coit.z);
      expect(d).toBeLessThanOrEqual(1500);
      expect(d).toBeGreaterThanOrEqual(last - 1e-9);
      last = d;
    }
    const cafes = places.poisNear(coit.x, coit.z, 3000, 'cafe');
    expect(cafes.every((p) => p.kind === 'cafe')).toBe(true);
    expect(cafes.length).toBeLessThanOrEqual(places.poisNear(coit.x, coit.z, 3000).length);
  });

  it('gives every pedRoute between two POIs at most 64 points', () => {
    if (!bake) return;
    const g = new RoadGraph(new RoadNetwork(bake.topology), { tick: () => 0, blackout: () => false, closed: () => false });
    const places = new PlaceIndexImpl(bake.index, g);
    const pois = bake.index.pois;
    expect(pois.length).toBeGreaterThanOrEqual(150);
    let checked = 0;
    let multi = 0;
    for (let i = 0; i < 60; i++) {
      const a = pois[(i * 7) % pois.length]!;
      const b = pois[(i * 13 + 5) % pois.length]!;
      const route = places.pedRoute(a.id, b.id);
      expect(route.length).toBeGreaterThanOrEqual(2);
      expect(route.length).toBeLessThanOrEqual(64);
      expect(route[0]).toEqual([a.x, a.y, a.z]);
      expect(route[route.length - 1]).toEqual([b.x, b.y, b.z]);
      if (route.length > 2) multi++;
      checked++;
    }
    expect(checked).toBe(60);
    expect(multi).toBeGreaterThan(30);
  });
});
