/**
 * M03b2 AC-12: transit spawned from the baked routes of a fresh `synth` bake (`data/transit-routes.v1`), on every tier. The live bus,
 * Metro, ferry and aircraft counts equal the `config/world/transit.json` row, every bus stops for 8 s at each baked stop of its
 * pattern, every Bay Rail entrance stands at one of the 8 `bay-rail` nodes, and no mover leaves its baked path by more than 0.5 m.
 * Cable cars are covered on `sf` by the demo: the `synth` bake has no chain and gets no cable cars (DL-664). The suite goes through
 * `requireBake('synth')`; `DV_REQUIRE_BAKE=1` forbids the skip.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { QualityTierId } from '@dv/shared';
import { busDwellTicks } from '../src/sim/transit/bus.ts';
import { countOf } from '../src/sim/transit/components.ts';
import { Path, parseRoutes, type TransitRoutesData } from '../src/sim/transit/path.ts';
import { bayRailStations } from '../src/sim/transit/rail.ts';
import { TransitSim } from '../src/sim/transit/sim.ts';
import { loadBake, type BakeData } from './fixtures/bake.ts';
import { makePedRig } from './fixtures/peds.ts';

const TIERS: readonly QualityTierId[] = ['desktop-ultra', 'desktop', 'xr-visionpro', 'mobile', 'mobile-low', 'xr-quest'];

const bake = loadBake('synth', 'transit.synth');
const suite = bake ? describe : describe.skip;

async function setup(b: BakeData, tier: QualityTierId) {
  const routes = parseRoutes(readFileSync(path.join(b.dir, 'transit-routes.json'))) as TransitRoutesData;
  const rig = await makePedRig({ chunks: b.chunks(), topology: b.topology, index: b.index, initialFill: false });
  const sim = new TransitSim({ world: { net: rig.services.network, graph: rig.services.graph, groundY: (x, z) => { try { return rig.services.query.groundY(x, z); } catch { return null; } } }, tier });
  sim.setRoutes(routes);
  return { routes, rig, sim };
}

suite('AC-12: the synth bake', () => {
  it('has the route data the milestone expects: bus patterns with stops, a Metro spline, a ferry line, 3 corridors, no cable-car chain', () => {
    if (!bake) return;
    const routes = parseRoutes(readFileSync(path.join(bake.dir, 'transit-routes.json'))) as TransitRoutesData;
    expect(routes.bus.length).toBeGreaterThanOrEqual(2);
    expect(routes.bus.every((b) => b.stops.length >= 2)).toBe(true);
    expect(routes.metro.length).toBeGreaterThanOrEqual(1);
    expect(routes.ferry.length).toBeGreaterThanOrEqual(1);
    expect(routes.air).toHaveLength(3);
    expect(routes.cablecar).toHaveLength(0);
    expect(routes.bakeId).toBe(bake.bakeId);
  });

  for (const tier of TIERS) {
    it(`${tier}: the live bus, Metro, ferry and aircraft counts equal the config row`, async () => {
      if (!bake) return;
      const { sim } = await setup(bake, tier);
      const c = sim.counts();
      expect(c.bus).toBe(countOf('bus', tier));
      expect(c.metro).toBe(countOf('metro', tier));
      expect(c.ferry).toBe(countOf('ferry', tier));
      expect(c.air).toBe(countOf('air', tier));
      expect(c.cablecar).toBe(0);
    }, 60_000);
  }

  it('every bus stops for 8 s at each baked stop of its pattern', async () => {
    if (!bake) return;
    const { sim, routes } = await setup(bake, 'desktop');
    sim.step(0, { x: 0, z: 0 });
    let stopsChecked = 0;
    for (let r = 0; r < sim.buses.length; r++) {
      const route = sim.buses[r];
      const bus = sim.onRoute('bus', r)[0];
      if (!route || !bus) continue;
      expect(route.stops.length).toBe(routes.bus[r]?.stops.length);
      for (let k = 0; k < route.stops.length; k++) {
        const stop = route.stops[k] as { s: number };
        // a stop within 2 m of the start of the pattern is reached across the end of the lap
        bus.s = stop.s >= 2 ? stop.s - 2 : route.length - (2 - stop.s);
        bus.stop = stop.s >= 2 ? k : route.stops.length;
        bus.dwell = 0;
        let t = 10_000;
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
        expect(still * 2).toBeGreaterThanOrEqual(busDwellTicks() - 2);
        expect(still * 2).toBeLessThanOrEqual(busDwellTicks() + 2);
        stopsChecked++;
      }
    }
    expect(stopsChecked).toBe(routes.bus.reduce((n, b) => n + b.stops.length, 0));
  }, 120_000);

  it('every Bay Rail entrance stands at one of the 8 bay-rail nodes of the world index', () => {
    if (!bake) return;
    const nodes = bake.index.transit.filter((t) => t.kind === 'bay-rail');
    expect(nodes).toHaveLength(8);
    const stations = bayRailStations(bake.index.transit);
    expect(stations).toHaveLength(8);
    for (const s of stations) {
      const n = nodes.find((q) => q.id === s.id);
      expect(n).toBeTruthy();
      if (n) expect([s.x, s.z]).toEqual([n.x, n.z]);
    }
    // the line order covers the stations: embarcadero first, balboa park last
    expect(stations[0]?.id).toBe('rail.embarcadero');
    expect(stations[7]?.id).toBe('rail.balboa-park');
  });

  it('no mover leaves its baked path by more than 0.5 m (buses on resident edges, the rest on their spline)', async () => {
    if (!bake) return;
    const { sim, rig } = await setup(bake, 'desktop');
    // the baked path of a bus: the geometry of its edges in travel order
    const busPaths = sim.buses.map((r) => {
      const pts: number[] = [];
      for (const e of r.edges) {
        const re = rig.services.network.resident(e);
        if (!re) continue;
        const g = re.seg.pts;
        const n = g.length / 3;
        const order = re.edge.dir === -1 ? Array.from({ length: n }, (_, i) => n - 1 - i) : Array.from({ length: n }, (_, i) => i);
        for (const i of order) pts.push(g[i * 3] as number, g[i * 3 + 2] as number);
      }
      return new Path(pts);
    });
    let busSamples = 0, otherSamples = 0, worst = 0;
    let t = 0;
    for (let i = 0; i < 14_000; i++) {
      sim.step(t, { x: 0, z: 0 });
      t += 2;
      if (i % 5 !== 0) continue;
      for (const m of sim.movers) {
        if (m.kind === 'bus') {
          const route = sim.buses[m.route];
          if (!route) continue;
          const at = route.edgeAt(m.s);
          if (!rig.services.network.resident(route.edges[at] as number)) continue;
          const d = (busPaths[m.route] as Path).nearest(m.x, m.z).d;
          worst = Math.max(worst, d);
          busSamples++;
          expect(d).toBeLessThanOrEqual(0.5);
        } else {
          const p = sim.paths[m.kind as 'metro' | 'ferry' | 'cablecar'][m.route] as Path;
          const d = p.nearest(m.x, m.z).d;
          otherSamples++;
          expect(d).toBeLessThanOrEqual(0.5);
        }
      }
    }
    expect(busSamples).toBeGreaterThan(100);
    expect(otherSamples).toBeGreaterThan(100);
    expect(worst).toBeLessThanOrEqual(0.5);
  }, 240_000);
});
