import { describe, expect, it } from 'vitest';
import type { WorldApi } from '@dv/shared';
import { FALL_FLOOR_Y, FALL_RECOVER_TICKS } from '../../src/sim/control/fall.ts';
import { CONTROL_OWNER, CONTROL_STATE } from '../../src/sim/control/states.ts';
import { LocalPlayer, Transform } from '../../src/sim/ecs/components.ts';
import type { PhysicsSim } from '../../src/sim/sim-factory.ts';
import { createWalkSim, hold, JUMP, player } from '../walk-sim.ts';

/** The plain fixture ground is flat at y 0 here. */
const SPAWN: [number, number, number] = [40, 0, -100];

interface FakeQuery {
  ground: number | null;
  walk: { x: number; y: number; z: number } | null;
  asked: number;
}

/** A `WorldApi` with only the two queries the safety net reads (BD-FIX-SPAWN-02). */
function fakeWorld(q: FakeQuery): WorldApi {
  return {
    query: {
      groundY: () => {
        q.asked++;
        return q.ground;
      },
      nearestWalkable: () => q.walk,
    },
  } as unknown as WorldApi;
}

function sink(sim: PhysicsSim, y: number): void {
  const id = sim.ecs.query([LocalPlayer])[0] as number;
  sim.ecs.store(Transform).py[id] = y;
}

async function settled(q: FakeQuery): Promise<PhysicsSim> {
  const sim = await createWalkSim({ spawn: SPAWN, noCourse: true });
  sim.services.world.api = fakeWorld(q);
  hold(sim, 30, {});
  expect(player(sim).grounded).toBe(true);
  return sim;
}

/** Ticks until the player stands on the ground again (on foot, idle, grounded, feet at the ground), or -1. */
function ticksUntilBack(sim: PhysicsSim, limit: number): number {
  for (let i = 1; i <= limit; i++) {
    hold(sim, 1, {});
    const p = player(sim);
    if (p.owner === CONTROL_OWNER.OnFoot && p.state === CONTROL_STATE.idle && p.grounded && Math.abs(p.y) < 0.1) return i;
  }
  return -1;
}

describe('out-of-the-world safety net (BD-FIX-SPAWN-02)', () => {
  it('puts a player that fell under the ground back on the nearest walkable point once it has been in the air for 2 s', async () => {
    const q: FakeQuery = { ground: 0, walk: { x: 44, y: 0, z: -100 }, asked: 0 };
    const sim = await settled(q);
    sim.services.events.drain();
    sink(sim, -25);
    const back = ticksUntilBack(sim, 400);
    expect(back).toBeGreaterThanOrEqual(FALL_RECOVER_TICKS);
    expect(back).toBeLessThanOrEqual(FALL_RECOVER_TICKS + 30);
    const p = player(sim);
    expect([p.x, p.z]).toEqual([44, -100]);
    hold(sim, 1, {});   // the fade-in goes out on the first tick the player is settled again
    const events = sim.services.events.drain();
    expect(events.filter((e) => e.t === 'control.recover').map((e) => e.s)).toEqual(['below-ground']);
    expect(events.filter((e) => e.t === 'world.teleport').map((e) => e.s)).toEqual(['out', 'in']);
    sim.dispose();
  });

  it('with nothing resident at the fall, waits under the floor of the play box and lands on the ground found under it', async () => {
    const q: FakeQuery = { ground: null, walk: null, asked: 0 };
    const sim = await settled(q);
    sim.services.events.drain();
    sink(sim, -10);
    // above the floor and nothing resident: no ground to compare with, so nothing happens yet
    hold(sim, FALL_RECOVER_TICKS + 5, {});
    expect(player(sim).y).toBeLessThan(-10);
    const back = ticksUntilBack(sim, 600);
    expect(back).toBeGreaterThan(0);
    const p = player(sim);
    expect([p.x, p.z]).toEqual([SPAWN[0], SPAWN[2]]);
    expect(sim.services.events.drain().filter((e) => e.t === 'control.recover').map((e) => e.s)).toEqual(['below-bounds']);
    expect(FALL_FLOOR_Y).toBe(-80);
    sim.dispose();
  });

  it('leaves a player on the ground, and a jump, alone', async () => {
    const q: FakeQuery = { ground: 0, walk: { x: 0, y: 0, z: 0 }, asked: 0 };
    const sim = await settled(q);
    sim.services.events.drain();
    hold(sim, 1, { buttons: JUMP });
    hold(sim, 300, {});
    const p = player(sim);
    expect([p.x, p.z]).toEqual([SPAWN[0], SPAWN[2]]);
    expect(sim.services.events.drain().some((e) => e.t === 'control.recover')).toBe(false);
    sim.dispose();
  });

  it('does nothing without a baked world', async () => {
    const sim = await createWalkSim({ spawn: SPAWN, noCourse: true });
    expect(sim.services.world.api).toBeNull();
    hold(sim, 30, {});
    sink(sim, -25);
    hold(sim, FALL_RECOVER_TICKS + 60, {});
    expect(player(sim).y).toBeLessThan(-25);
    sim.dispose();
  });

  it('is deterministic: the same run twice gives the same state hash', async () => {
    const run = async (): Promise<string> => {
      const sim = await settled({ ground: 0, walk: { x: 44, y: 0, z: -100 }, asked: 0 });
      sink(sim, -25);
      hold(sim, FALL_RECOVER_TICKS + 40, {});
      const h = sim.hash();
      sim.dispose();
      return h;
    };
    expect(await run()).toBe(await run());
  });
});
