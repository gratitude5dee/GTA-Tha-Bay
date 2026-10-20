/**
 * M03b2 AC-2: local avoidance (living part 4.3 and 4.4). Pedestrians within 60 m of the player (at most 48) run a pairwise repulsion
 * step every third AI tick in `StableKey` order, and no pedestrian centre comes within 0.6 m of an XR head: here a head pose moving at
 * 1.6 m height through 48 near pedestrians for 3,600 ticks.
 */
import { describe, expect, it } from 'vitest';
import type { ChunkKey } from '@dv/shared';
import { AVOID_EVERY, AVOID_MAX, AVOID_RADIUS_M, HEAD_CLEAR_M, PERSONAL_M, avoidSet, repulse } from '../src/sim/peds/avoidance.ts';
import { makePedRig } from './fixtures/peds.ts';
import { pedCrossing } from './fixtures/peds.ts';

const CELL = '9/256/256' as ChunkKey;

async function crowd(n: number) {
  const f = pedCrossing();
  const rig = await makePedRig({ chunks: [f.chunk], focus: { x: -25, z: 0, vx: 0, vz: 0 }, initialFill: false });
  for (let i = 0; i < n; i++) {
    const north = i % 2 === 0;
    rig.sim.place({
      key: `amb:9/256/256:${400 + i}`, cell: CELL, slot: 400 + i, a: north ? 0 : 3, b: north ? 1 : 2, s: (i * 0.6) % 28, pace: 1.2 + (i % 5) * 0.1, lane: i % 3 === 0 ? 0.5 : -0.5,
    });
  }
  return { f, rig };
}

describe('AC-2: an XR head among 48 pedestrians', () => {
  it('no pedestrian centre comes within 0.6 m of the head in 3,600 ticks, and the avoidance step runs every third AI tick in key order', async () => {
    const { rig } = await crowd(48);
    expect(rig.sim.peds.size).toBe(48);
    const orders: string[][] = [];
    let min = Infinity;
    let clears = 0;
    rig.run(3600, (tick) => {
      if (tick % 2 !== 0) return;
      // the head walks the north sidewalk back and forth at 1.5 m/s, 1.6 m above the ground
      const u = (tick / 60) * 1.5;
      const x = -40 + Math.abs(((u % 60) + 60) % 60 - 30);
      rig.head = { x, z: -6 + 0.4 * Math.sin(tick / 40) };
      rig.focus = { x, z: -6, vx: 0, vz: 0 };
      for (const p of rig.sim.peds.list()) min = Math.min(min, Math.hypot(p.x - rig.head.x, p.z - rig.head.z));
      if (rig.sim.aiStep % AVOID_EVERY === 0 && tick > 0) orders.push(rig.sim.lastAvoid);
      clears = rig.sim.stats.headClears;
    });
    // the head of step k is set before step k+1, so the audit reads the positions of step k against the head of step k+1: allow the head's step
    expect(min).toBeGreaterThanOrEqual(HEAD_CLEAR_M - 0.12);
    expect(clears).toBeGreaterThan(0);
    expect(rig.sim.stats.avoidPasses).toBe(Math.floor(rig.sim.aiStep / AVOID_EVERY));
    expect(orders.length).toBeGreaterThan(500);
    for (const o of orders) {
      expect(o.length).toBeLessThanOrEqual(AVOID_MAX);
      const sorted = [...o].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      expect(o).toEqual(sorted);
    }
  });

  it('the clearance holds exactly at every step when the head pose is set before the step', async () => {
    const { rig } = await crowd(48);
    let min = Infinity;
    for (let i = 0; i < 1800; i++) {
      const tick = rig.tick;
      const x = -40 + ((tick / 60) * 1.5) % 30;
      rig.head = { x, z: -6 };
      rig.focus = { x, z: -6, vx: 0, vz: 0 };
      rig.run(2);
      for (const p of rig.sim.peds.list()) min = Math.min(min, Math.hypot(p.x - (rig.head?.x ?? 0), p.z - (rig.head?.z ?? 0)));
    }
    // the head moves between the step and the audit by at most 1.5 m/s x 2 ticks
    expect(min).toBeGreaterThanOrEqual(HEAD_CLEAR_M - 0.06);
  });
});

describe('the repulsion step', () => {
  it('visits only pedestrians within 60 m, at most 48, in ascending key order', async () => {
    const { rig } = await crowd(60);
    rig.run(2);
    const out: ReturnType<typeof rig.sim.peds.list>[number][] = [];
    const set = avoidSet(rig.sim.peds.list(), -25, 0, out);
    expect(set.length).toBe(AVOID_MAX);
    expect(set.map((p) => p.key)).toEqual(rig.sim.peds.list().slice(0, AVOID_MAX).map((p) => p.key));
    // far away: nobody
    expect(avoidSet(rig.sim.peds.list(), -25 + AVOID_RADIUS_M + 200, 0, []).length).toBe(0);
  });

  it('pushes two pedestrians that stand closer than 0.9 m apart, and leaves others alone', async () => {
    const { rig } = await crowd(0);
    const a = rig.sim.place({ key: 'amb:9/256/256:500', cell: CELL, slot: 500, a: 0, b: 1, s: 10, pace: 1.4, lane: 0 });
    const b = rig.sim.place({ key: 'amb:9/256/256:501', cell: CELL, slot: 501, a: 0, b: 1, s: 10.3, pace: 1.4, lane: 0 });
    const c = rig.sim.place({ key: 'amb:9/256/256:502', cell: CELL, slot: 502, a: 0, b: 1, s: 25, pace: 1.4, lane: 0 });
    if (!a || !b || !c) throw new Error('not placed');
    const pairs = repulse([a, b, c], null);
    expect(pairs).toBe(1);
    expect(a.ox).toBeLessThan(0);
    expect(b.ox).toBeGreaterThan(0);
    expect(c.ox).toBe(0);
    expect(Math.hypot(a.ox, a.oz)).toBeLessThan(PERSONAL_M);
  });

  it('is repeatable: the same crowd gives the same offsets', async () => {
    const run = async (): Promise<string> => {
      const { rig } = await crowd(30);
      rig.head = { x: -30, z: -6 };
      rig.run(600);
      return rig.sim.peds.list().map((p) => `${p.key}:${p.x.toFixed(6)},${p.z.toFixed(6)}`).join('|');
    };
    expect(await run()).toBe(await run());
  });
});
