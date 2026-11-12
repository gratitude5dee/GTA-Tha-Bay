/**
 * M02h6 AC-3: every signal head of the `synth` bake's busiest tiles, over ticks 0 to 7,199, shows the code of the aspect the sim graph gives
 * its movement (`RoadGraph.signal(node, movement)`, which the traffic obeys), and `dark` under a blackout. The 10 Hz clock evaluates only
 * the heads within 200 m and writes a code only when it changes.
 */
import { type ChunkKey, type Aspect } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { createWorldApi } from '../src/sim/api/world-api.ts';
import { Blackout } from '../src/sim/env/blackout.ts';
import { FURNITURE_STRIDE, FurnitureKind, type FurnitureHead } from '../src/client/chunks/mesh-types.ts';
import { meshChunk } from '../src/client/chunks/mesher.ts';
import { SignalClock, aspectCodeOf, type HeadSlot } from '../src/client/furniture/signals.ts';
import { ASPECT_CODE } from '../src/client/traffic/lights.ts';
import { bakeTiles } from './curbs.support.ts';
import { indexOf, loadAll, storeOf } from './fixtures/world.ts';

const TILES = bakeTiles('synth', 'furniture.signals', 2);

describe('signal heads on synth (AC-3)', () => {
  it('every head equals the sim graph over ticks 0 to 7,199, and is dark under a blackout', async () => {
    if (TILES.length === 0) return;
    let checked = 0;
    for (const t of TILES) {
      const heads: { head: FurnitureHead; node: number }[] = [];
      for (const sim of t.sims) {
        const m = meshChunk(sim, t.renders.find((r) => r.key === sim.key) ?? null, { tier: 'desktop', distM: 0, tile: t.sims });
        for (let i = 0; i < m.furniture.length; i += FURNITURE_STRIDE) {
          if (m.furniture[i] !== FurnitureKind.signal) continue;
          const head = m.heads[m.furniture[i + 5] as number] as FurnitureHead;
          const j = sim.junctions.find((x) => x.id === head.junction);
          expect(j, `${sim.key}: head of junction ${head.junction}`).toBeDefined();
          heads.push({ head, node: j?.nodes[0] as number });
        }
      }
      expect(heads.length).toBeGreaterThan(0);
      const store = storeOf(t.sims);
      await loadAll(store, t.sims.map((s) => s.key as ChunkKey));
      const clock = { t: 0 };
      const blackout = new Blackout();
      const api = createWorldApi(store, indexOf(), { tick: () => clock.t }, { blackout });
      const seen = new Set<Aspect>();
      for (let tick = 0; tick < 7200; tick++) {
        clock.t = tick;
        for (const h of heads) {
          const want = api.graph.signal(h.node, h.head.movement);
          seen.add(want);
          const got = aspectCodeOf(h.head, tick, false);
          if (got !== ASPECT_CODE[want]) expect({ tick, junction: h.head.junction, movement: h.head.movement, got, want }).toBeNull();
          checked++;
        }
      }
      expect([...seen].sort()).toEqual(['amber', 'green', 'red']);
      api.traffic.setBlackout(true, 'test');
      for (const tick of [0, 1234, 7199]) {
        clock.t = tick;
        for (const h of heads) {
          expect(api.graph.signal(h.node, h.head.movement)).toBe('dark');
          expect(aspectCodeOf(h.head, tick, true)).toBe(ASPECT_CODE.dark);
        }
      }
    }
    expect(checked).toBeGreaterThan(7200);
  });

  it('the 10 Hz clock evaluates only the heads within 200 m and reports their aspects', () => {
    const program = { id: 1, cycleTicks: 120, offsetTicks: 0, pedWalkTicks: 0, phases: [{ startTick: 0, greenTicks: 50, amberTicks: 10, clearTicks: 0, movements: [7] }] };
    const near: HeadSlot = { head: { junction: 1, movement: 7, program }, x: 10, z: 0, slot: 0 };
    const far: HeadSlot = { head: { junction: 2, movement: 7, program }, x: 500, z: 0, slot: 1 };
    const codes = new Float32Array(2).fill(-1);
    const clock = new SignalClock(200, 10);
    expect(clock.update([near, far], codes, 0, false, 0, 0, 0)).toBe(true);
    expect(codes[0]).toBe(ASPECT_CODE.green);
    expect(codes[1]).toBe(-1);
    expect(clock.info().n).toBe(1);
    // within 100 ms nothing is evaluated again
    expect(clock.update([near, far], codes, 55, false, 0, 0, 50)).toBe(false);
    expect(clock.update([near, far], codes, 55, false, 0, 0, 120)).toBe(true);
    expect(codes[0]).toBe(ASPECT_CODE.amber);
    expect(clock.update([near, far], codes, 90, false, 0, 0, 240)).toBe(true);
    expect(codes[0]).toBe(ASPECT_CODE.red);
    expect(clock.info().aspects.red).toBe(1);
    clock.update([near, far], codes, 90, true, 0, 0, 400);
    expect(codes[0]).toBe(ASPECT_CODE.dark);
  });
});
