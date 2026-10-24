/**
 * M03b2 AC-5: on a transit fixture (a bus pattern with two stops, a Metro spline, a cable-car chain, a ferry line, an air corridor)
 * the counts of each kind on each tier equal the row of `config/world/transit.json`; a bus dwells 8 s at each stop, a cable car moves
 * at 4.2 m/s and a ferry at 7 m/s (within 0.1 m/s). Movers read only the route data they are given.
 */
import { describe, expect, it } from 'vitest';
import type { ChunkKey, QualityTierId } from '@dv/shared';
import { airPose, airProgress, corridors } from '../src/sim/transit/aircraft.ts';
import { BUS_LATERAL_M, busDwellTicks, busSpeed } from '../src/sim/transit/bus.ts';
import { TRANSIT_CONFIG, countOf } from '../src/sim/transit/components.ts';
import { EMPTY_ROUTES, Path, parseRoutes, type TransitRoutesData } from '../src/sim/transit/path.ts';
import { TransitSim } from '../src/sim/transit/sim.ts';
import { crossRoads } from './fixtures/roads.ts';
import { makePedRig } from './fixtures/peds.ts';

const TIERS: readonly QualityTierId[] = ['desktop-ultra', 'desktop', 'xr-visionpro', 'mobile', 'mobile-low', 'xr-quest'];

async function fixture(tier: QualityTierId) {
  const cross = crossRoads();
  const rig = await makePedRig({ chunks: [cross.chunk], initialFill: false });
  const data: TransitRoutesData = {
    schema: 'transit-routes/1',
    bakeId: 'fixture',
    metro: [{ id: 'metro.t1', nameKey: 'transit.metro.t1', points: [-90, 10, 90, 10] }],
    bus: [{
      id: 'bus.t1', nameKey: 'transit.bus.t1', edges: [cross.inEdge[3] as number, cross.outEdge[1] as number],
      stops: [{ id: 'stop.a', nameKey: 'transit.stop.a', edge: cross.inEdge[3] as number, s: 50 }, { id: 'stop.b', nameKey: 'transit.stop.b', edge: cross.outEdge[1] as number, s: 60 }],
    }],
    ferry: [{ id: 'ferry.t1', nameKey: 'transit.ferry.t1', source: 'authored', points: [0, 200, 300, 200] }],
    cablecar: [{ id: 'cable.t1', nameKey: 'transit.cable.t1', points: [0, -80, 60, -80, 120, -60] }],
    air: [{ id: 'air.t1', nameKey: 'transit.air.t1', altitudeM: [600, 900], points: [0, 0, 1500, 0, 3000, 0] }],
  };
  const sim = new TransitSim({ world: { net: rig.services.network, graph: rig.services.graph, groundY: () => 3 }, tier });
  sim.setRoutes(data);
  return { cross, rig, data, sim };
}

/** Runs AI steps at the given focus. */
function steps(sim: TransitSim, from: number, n: number, each?: (tick: number) => void): number {
  let tick = from;
  for (let i = 0; i < n; i++) {
    sim.step(tick, { x: 0, z: 0 });
    each?.(tick);
    tick += 2;
  }
  return tick;
}

describe('AC-5: the counts of each tier', () => {
  for (const tier of TIERS) {
    it(`${tier}: bus, Metro, cable-car, ferry and aircraft counts equal the config row`, async () => {
      const { sim } = await fixture(tier);
      const c = sim.counts();
      expect(c.bus).toBe(countOf('bus', tier));
      expect(c.metro).toBe(countOf('metro', tier));
      expect(c.cablecar).toBe(countOf('cablecar', tier));
      expect(c.ferry).toBe(countOf('ferry', tier));
      expect(c.air).toBe(countOf('air', tier));
      // and they stay after running
      steps(sim, 0, 60);
      expect(sim.counts()).toEqual(c);
    });
  }

  it('the rows are the table of living part 5: desktop 6 / 14 / 6 / 4 / 5, mobile-low 2 / 3 / 2 / 1 / 1', () => {
    expect(['metro', 'bus', 'cablecar', 'ferry', 'air'].map((k) => countOf(k as 'metro', 'desktop'))).toEqual([6, 14, 6, 4, 5]);
    expect(['metro', 'bus', 'cablecar', 'ferry', 'air'].map((k) => countOf(k as 'metro', 'xr-visionpro'))).toEqual([4, 10, 4, 3, 4]);
    expect(['metro', 'bus', 'cablecar', 'ferry', 'air'].map((k) => countOf(k as 'metro', 'mobile'))).toEqual([3, 6, 3, 2, 2]);
    expect(['metro', 'bus', 'cablecar', 'ferry', 'air'].map((k) => countOf(k as 'metro', 'mobile-low'))).toEqual([2, 3, 2, 1, 1]);
    expect(['metro', 'bus', 'cablecar', 'ferry', 'air'].map((k) => countOf(k as 'metro', 'xr-quest'))).toEqual([2, 3, 2, 1, 1]);
  });

  it('a kind with no route behind it has no movers (nothing is invented): no cable-car chain, no cable cars', async () => {
    const { sim, data } = await fixture('desktop');
    sim.setRoutes({ ...data, cablecar: [], ferry: [] });
    const c = sim.counts();
    expect(c.cablecar).toBe(0);
    expect(c.ferry).toBe(0);
    expect(c.bus).toBe(countOf('bus', 'desktop'));
    sim.setRoutes(EMPTY_ROUTES);
    expect(sim.counts()).toEqual({ metro: 0, bus: 0, cablecar: 0, ferry: 0, air: 0 });
  });

  it('the first vehicle of a route starts at the point nearest to the focus', async () => {
    const { sim } = await fixture('mobile-low');
    steps(sim, 0, 1);
    const ferry = sim.onRoute('ferry', 0)[0];
    const path = sim.paths.ferry[0] as Path;
    expect(ferry).toBeTruthy();
    if (ferry) expect(Math.abs(ferry.s - path.nearest(0, 0).s)).toBeLessThan(1);
  });
});

describe('AC-5: speeds and dwell', () => {
  it('a cable car moves at 4.2 m/s and a ferry at 7 m/s (+- 0.1)', async () => {
    const { sim } = await fixture('desktop');
    steps(sim, 0, 1);
    const cable = sim.onRoute('cablecar', 0)[0];
    const boat = sim.onRoute('ferry', 0)[0];
    if (!cable || !boat) throw new Error('no movers');
    // mid-route, going out: 5 s
    cable.s = 20;
    cable.dir = 1;
    cable.dwell = 0;
    boat.s = 40;
    boat.dir = 1;
    boat.dwell = 0;
    const c0 = cable.s, b0 = boat.s;
    steps(sim, 2, 150);
    expect(Math.abs((cable.s - c0) / 5 - 4.2)).toBeLessThanOrEqual(0.1);
    expect(Math.abs((boat.s - b0) / 5 - 7)).toBeLessThanOrEqual(0.1);
    expect(cable.speed).toBeCloseTo(4.2, 6);
    expect(boat.speed).toBeCloseTo(7, 6);
  });

  it('trains and boats wait at the ends of their line and turn round', async () => {
    const { sim } = await fixture('mobile-low');
    steps(sim, 0, 1);
    const boat = sim.onRoute('ferry', 0)[0];
    if (!boat) throw new Error('no ferry');
    const path = sim.paths.ferry[0] as Path;
    boat.s = path.length - 1;
    boat.dir = 1;
    boat.dwell = 0;
    let t = steps(sim, 2, 20);
    expect(boat.dir).toBe(-1);
    expect(boat.dwell).toBeGreaterThan(0);
    expect(boat.s).toBe(path.length);
    t = steps(sim, t, 600);
    expect(boat.s).toBeLessThan(path.length);
    void t;
  });

  it('a bus dwells exactly 8 s at each stop of its pattern, and drives 0.85 of the limit between', async () => {
    const { sim } = await fixture('mobile-low');
    steps(sim, 0, 1);
    const route = sim.buses[0];
    if (!route) throw new Error('no bus route');
    expect(route.stops).toHaveLength(2);
    for (const bus of sim.onRoute('bus', 0)) {
      // park the bus 2 m before each stop in turn
      for (let k = 0; k < route.stops.length; k++) {
        const stop = route.stops[k] as { s: number };
        bus.s = stop.s - 2;
        bus.stop = k;
        bus.dwell = 0;
        let t = 1000;
        let still = 0;
        let started = false;
        for (let i = 0; i < 800; i++) {
          sim.step(t, { x: 0, z: 0 });
          if (bus.speed === 0 && Math.abs(bus.s - stop.s) < 0.01) {
            started = true;
            still++;
          } else if (started) break;
          t += 2;
        }
        // 480 ticks = 240 AI steps (the step that arrives counts as the first)
        expect(still * 2).toBeGreaterThanOrEqual(busDwellTicks() - 2);
        expect(still * 2).toBeLessThanOrEqual(busDwellTicks() + 2);
      }
    }
    expect(busSpeed(10)).toBeCloseTo(8.5, 9);
    expect(busSpeed(30)).toBe(TRANSIT_CONFIG.speeds.busMaxMps);
  });

  it('a bus keeps within 0.45 m of the centreline of its edge', async () => {
    const { sim, cross } = await fixture('mobile-low');
    steps(sim, 0, 1);
    const bus = sim.onRoute('bus', 0)[0];
    if (!bus) throw new Error('no bus');
    bus.s = 10;
    bus.dwell = 0;
    steps(sim, 2, 400, () => {
      if (bus.s > 100) return;
      // the west arm runs along z = 0 from x = -100 to the centre
      expect(Math.abs(bus.z)).toBeLessThanOrEqual(BUS_LATERAL_M + 1e-6);
    });
    expect(cross.inEdge[3]).toBeGreaterThanOrEqual(0);
  });
});

describe('airliners', () => {
  it('are a pure function of the tick, one corridor each, and climb between the two altitudes', async () => {
    const { data } = await fixture('desktop');
    const cs = corridors(data);
    expect(cs).toHaveLength(1);
    const c = cs[0];
    if (!c) throw new Error('no corridor');
    const out = new Float64Array(4), tmp = new Float64Array(4);
    const t0 = airProgress(c, 0, 5, 0);
    const t1 = airProgress(c, 0, 5, 600);
    // 10 s at 75 m/s over a 3 km corridor
    expect(t1 - t0).toBeCloseTo(750 / 3000, 6);
    airPose(c, t0, out, tmp);
    const y0 = out[1] as number;
    airPose(c, t1, out, tmp);
    expect(out[1] as number).toBeGreaterThan(y0);
    expect(y0).toBeGreaterThanOrEqual(600);
    expect(out[1] as number).toBeLessThanOrEqual(900);
    // five airliners are spread along the corridor
    const ts = [0, 1, 2, 3, 4].map((n) => airProgress(c, n, 5, 0));
    expect(new Set(ts.map((x) => x.toFixed(4))).size).toBe(5);
    // same tick, same place
    expect(airProgress(c, 2, 5, 1234)).toBe(airProgress(c, 2, 5, 1234));
  });
});

describe('route data', () => {
  it('parseRoutes reads the JSON bytes of data/transit-routes.v1 and refuses anything else', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ schema: 'transit-routes/1', bakeId: 'abc', metro: [{ id: 'metro.x', nameKey: 'k', points: [0, 0, 10, 0] }], bus: [], ferry: [], cablecar: [], air: [] }));
    expect(parseRoutes(bytes)?.metro).toHaveLength(1);
    expect(parseRoutes(new TextEncoder().encode('{"schema":"other"}'))).toBeNull();
    expect(parseRoutes(new TextEncoder().encode('not json'))).toBeNull();
    // non-ASCII text decodes too
    expect(parseRoutes(new TextEncoder().encode(JSON.stringify({ schema: 'transit-routes/1', bakeId: 'café \u{1f68c}' })))?.bakeId).toBe('café \u{1f68c}');
  });

  it('a path answers a point, a heading and the nearest arc length', () => {
    const p = new Path([0, 0, 10, 0, 10, 10]);
    expect(p.length).toBe(20);
    const out = new Float64Array(4);
    p.at(15, out);
    expect([out[0], out[1], out[2], out[3]]).toEqual([10, 5, 0, 1]);
    expect(p.nearest(5, 3)).toEqual({ s: 5, d: 3 });
    expect(p.nearest(12, 8).s).toBeCloseTo(18, 9);
  });
});

export type { ChunkKey };
