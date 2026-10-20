/**
 * M03b1 promotion, the slot side (BD-FIX-VW-01): an agent leaves the traffic once per promotion, and the parked slot it came from
 * stays empty while its promotion is in force and while a vehicle stands on it. Before the fix the parked pass refilled the slot on
 * the next AI step, on top of the car that had just hit it, and every refill was promoted again by the same contact (the book refused
 * the key, but the agent was removed and counted anyway): in the synth city 55 promotions in 17 s, and a parked van that reappeared
 * inside a sedan and held it for the rest of the run (tests/e2e/vehicle.spec.ts, the tunnel drive).
 *
 * Pure `TrafficSim` (no ECS, no Rapier); the movers and obstacles are what `system.ts` passes in.
 */
import { describe, expect, it } from 'vitest';
import type { ChunkKey } from '@dv/shared';
import type { Agent } from '../src/sim/traffic/agent.ts';
import { ARCH } from '../src/sim/traffic/components.ts';
import type { Mover } from '../src/sim/traffic/promote.ts';
import { PROMOTED_TICKS } from '../src/sim/traffic/promote.ts';
import type { Obstacle } from '../src/sim/traffic/reactions.ts';
import { crossRoads } from './fixtures/roads.ts';
import { makeRig, type Rig } from './fixtures/traffic.ts';

const CELL = '9/256/256' as ChunkKey;

/** A car of the player's size standing on (x, z), heading east, moving at `speed` m/s along +X. */
function car(id: string, x: number, z: number, speed: number): { mover: Mover; obstacle: Obstacle } {
  return {
    mover: { id, x, z, vx: speed, vz: 0, hx: 1, hz: 0, halfW: 0.95, halfL: 2.4, massKg: 1500 },
    obstacle: { id, kind: 'vehicle', x, z, vx: speed, vz: 0, halfW: 0.95, halfL: 2.4 },
  };
}

function standOn(rig: Rig, cars: readonly { mover: Mover; obstacle: Obstacle }[]): void {
  rig.input = { movers: cars.map((c) => c.mover), obstacles: cars.map((c) => c.obstacle) };
}

async function parkedRig(): Promise<{ rig: Rig; parked: Agent }> {
  const cross = crossRoads({ armM: 100 });
  // three parked slots along the east arm, all within 80 m of the focus at the centre
  const seg = (cross.chunk.edges.find((e) => e.id === cross.inEdge[1]) as { seg: number }).seg;
  cross.chunk.spawn.parked = [
    { slot: 200, seg: seg as never, s: 30, side: 1, yawJitterDm: 0 },
    { slot: 201, seg: seg as never, s: 45, side: 1, yawJitterDm: 0 },
    { slot: 202, seg: seg as never, s: 60, side: -1, yawJitterDm: 0 },
  ];
  const rig = await makeRig({ chunks: [cross.chunk], tier: 'desktop-ultra', initialFill: false, parked: true });
  rig.run(4);
  const parked = rig.sim.agents.get(`amb:${CELL}:200`);
  if (!parked || !parked.isParked) throw new Error('the parked slot 200 was not filled');
  expect(parked.near).toBe(true);
  return { rig, parked };
}

describe('promotion: once per contact, and the slot stays empty', () => {
  it('a parked car hit by a vehicle is promoted once, and its slot is not refilled under that vehicle', async () => {
    const { rig, parked } = await parkedRig();
    const key = parked.key;
    const at = { x: parked.x, z: parked.z };
    // the hit: a car at 6 m/s right on the parked car
    standOn(rig, [car('veh:player', at.x, at.z, 6)]);
    rig.run(2);
    expect(rig.sim.stats.promotions).toBe(1);
    expect(rig.sim.promotions.has(key)).toBe(true);
    expect(rig.sim.agents.has(key)).toBe(false);

    // the car stays on the slot and keeps moving (the promoted car rolling on, the player's car pushing): two seconds of AI steps
    let refilled = 0;
    rig.run(120, () => {
      if (rig.sim.agents.has(key)) refilled++;
    });
    expect(rig.sim.stats.promotions, 'promotions of one contact').toBe(1);
    expect(refilled, 'AI steps on which the slot held a parked car again').toBe(0);
    // the other slots are untouched
    expect(rig.sim.agents.has(`amb:${CELL}:201`)).toBe(true);
    expect(rig.sim.agents.has(`amb:${CELL}:202`)).toBe(true);
  });

  it('the slot stays empty while the promotion is in force, then while a wreck stands on it, and is refilled once it is clear', async () => {
    const { rig, parked } = await parkedRig();
    const key = parked.key;
    const at = { x: parked.x, z: parked.z };
    standOn(rig, [car('veh:player', at.x, at.z, 6)]);
    rig.run(2);
    expect(rig.sim.stats.promotions).toBe(1);
    // the hitting car drives off; the promoted car is somewhere else: nothing stands on the slot, but the promotion is in force
    standOn(rig, [car('veh:player', at.x + 40, at.z, 6)]);
    let early = 0;
    rig.run(PROMOTED_TICKS - 20, () => {
      if (rig.sim.agents.has(key)) early++;
    });
    expect(early, 'AI steps on which the slot was refilled during the promotion').toBe(0);
    // the promotion runs out with a wreck (stationary) on the slot: still empty
    standOn(rig, [car(`veh:amb.${CELL}.200.1`, at.x + 0.5, at.z, 0)]);
    rig.run(60);
    expect(rig.sim.promotions.has(key)).toBe(false);
    expect(rig.sim.agents.has(key)).toBe(false);
    // the wreck is gone: the slot is a parked car again, at its own place
    standOn(rig, []);
    rig.run(4);
    const back = rig.sim.agents.get(key);
    expect(back?.isParked).toBe(true);
    expect(Math.abs((back?.x ?? 0) - at.x) + Math.abs((back?.z ?? 0) - at.z)).toBeLessThan(1e-9);
    expect(rig.sim.stats.promotions).toBe(1);
  });

  it('an agent whose key is still in the promotion book is not promoted again (it stays in the traffic)', async () => {
    const cross = crossRoads({ armM: 100 });
    const rig = await makeRig({ chunks: [cross.chunk], tier: 'mobile-low', initialFill: false, parked: false });
    const key = `amb:${CELL}:60`;
    const first = rig.sim.place({ key, cell: CELL, slot: 60, epoch: 1, arch: ARCH.sedan, edge: cross.inEdge[1] as number, s: 80, lane: 0, speed: 0 });
    if (!first) throw new Error('not placed');
    rig.run(2);
    standOn(rig, [car('veh:player', first.x, first.z, 6)]);
    rig.run(2);
    expect(rig.sim.stats.promotions).toBe(1);
    expect(rig.sim.promotions.has(key)).toBe(true);
    // the slot spawns again under the same key (a new epoch) and is hit within the 8 s of the first promotion
    standOn(rig, []);
    const again = rig.sim.place({ key, cell: CELL, slot: 60, epoch: 2, arch: ARCH.sedan, edge: cross.inEdge[1] as number, s: 40, lane: 0, speed: 0 });
    if (!again) throw new Error('not placed');
    rig.run(2);
    standOn(rig, [car('veh:other', again.x, again.z, 6)]);
    rig.run(2);
    expect(rig.sim.stats.promotions, 'a second promotion of a key the book holds').toBe(1);
    expect(rig.sim.promotions.count).toBe(1);
    expect(rig.sim.agents.get(key)).toBe(again);
  });
});
