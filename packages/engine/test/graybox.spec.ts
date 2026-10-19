import { sampleHeight } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { CONTROL_STATE } from '../src/sim/control/states.ts';
import { CIVIC_GRAYBOX } from '../src/sim/scenarios/civic-graybox.ts';
import { createGrayboxSim, fixtureChunks, boxesOf } from './graybox-helpers.ts';
import { frame, player } from './walk-sim.ts';

describe('the gray-box sim (AC-4)', () => {
  it('adds the chunk statics on 4 consecutive ticks, one per tick, nearest chunk first', async () => {
    const sim = await createGrayboxSim();
    const added: { tick: number; n: number; key: string }[] = [];
    for (let i = 0; i < 8; i++) {
      sim.step(1);
      for (const e of sim.services.events.drain()) if (e.t === 'world.chunk') added.push({ tick: e.tick, n: e.n ?? 0, key: e.s ?? '' });
    }
    expect(added.map((a) => a.tick)).toEqual([0, 1, 2, 3]);
    expect(added.map((a) => a.n)).toEqual([1, 2, 3, 4]);
    // The spawn (89, 60) is inside 9/256/256, which comes first; every key is distinct.
    expect(added[0]?.key).toBe('9/256/256');
    expect(new Set(added.map((a) => a.key)).size).toBe(4);
    sim.dispose();
  });

  it('keeps the player in the teleport wait until ground exists, then grounds it on the terrain within 60 ticks', async () => {
    const sim = await createGrayboxSim();
    const first = player(sim);
    expect(first.state).toBe(CONTROL_STATE.teleportPending);
    let groundedAt = -1;
    for (let i = 0; i < 60 && groundedAt < 0; i++) {
      sim.step(1);
      const p = player(sim);
      if (p.grounded && p.state === CONTROL_STATE.idle) groundedAt = sim.tick;
    }
    expect(groundedAt).toBeGreaterThan(0);
    expect(groundedAt).toBeLessThanOrEqual(60);
    const p = player(sim);
    const ground = sampleHeight(fixtureChunks().sim[0]!.height, CIVIC_GRAYBOX.spawn[0], CIVIC_GRAYBOX.spawn[2]);
    expect(p.x).toBeCloseTo(CIVIC_GRAYBOX.spawn[0], 6);
    expect(p.z).toBeCloseTo(CIVIC_GRAYBOX.spawn[2], 6);
    expect(Math.abs(p.y - ground)).toBeLessThan(0.15);
    sim.dispose();
  });

  it('walks across the chunk boundary at z = 128 without dropping below the terrain', async () => {
    const sim = await createGrayboxSim();
    sim.step(40); // settle
    // Face south (+Z): forward is (-sin yaw, -cos yaw), so yaw pi.
    const yaw = 32768;
    const chunks = fixtureChunks().sim;
    const terrainAt = (x: number, z: number): number => {
      const c = chunks.find((k) => k.height.originX <= x && x < k.height.originX + 256 && k.height.originZ <= z && z < k.height.originZ + 256);
      return c ? sampleHeight(c.height, x, z) : NaN;
    };
    let crossed = false;
    let worstDrop = 0;
    for (let i = 0; i < 1600 && !crossed; i++) {
      sim.step(1, (tick) => frame({ tick, moveY: -127, camYaw: yaw, buttons: 0 }));
      const p = player(sim);
      const t = terrainAt(p.x, p.z);
      if (!Number.isNaN(t)) worstDrop = Math.max(worstDrop, t - p.y);
      if (p.z > 140) crossed = true;
    }
    expect(crossed).toBe(true);
    expect(worstDrop).toBeLessThan(0.1);
    sim.dispose();
  });

  it('is deterministic: two runs give the same state hash', async () => {
    const run = async (): Promise<string> => {
      const sim = await createGrayboxSim();
      sim.step(120, (tick) => frame({ tick, moveY: -100, camYaw: 32768 }));
      const h = sim.hash();
      sim.dispose();
      return h;
    };
    expect(await run()).toBe(await run());
  });

  it('the fixture has the 12 boxes the milestone names', () => {
    const { sim } = fixtureChunks();
    expect(sim).toHaveLength(4);
    expect(sim.flatMap((c) => boxesOf(c.prisms))).toHaveLength(12);
  });
});
