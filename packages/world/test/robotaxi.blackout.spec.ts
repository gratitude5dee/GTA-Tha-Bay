/**
 * M03b1 AC-3: robotaxis in a blackout. A robotaxi that reaches a dark junction stops (an all-way stop) and, with probability 0.35,
 * stalls for a seeded 4 to 9 s with its hazard lights on; the ambient cars treat the same junction as an all-way stop and nobody
 * deadlocks; a robotaxi never goes faster than 0.95 x the limit of its edge. Twenty seeds.
 */
import { describe, expect, it } from 'vitest';
import { NodeControl, type ChunkKey } from '@dv/shared';
import type { Agent } from '../src/sim/traffic/agent.ts';
import { ARCH, AgentState, LightBit } from '../src/sim/traffic/components.ts';
import { robotaxiSpeedCap } from '../src/sim/traffic/robotaxi.ts';
import { crossRoads } from './fixtures/roads.ts';
import { makeRig, routeThrough } from './fixtures/traffic.ts';

const CELL = '9/256/256' as ChunkKey;
const LIMIT = 11.25;

interface Run {
  stalls: number[];
  crossed: number;
  overlap: number;
  maxSpeedOverCap: number;
  hazard: boolean;
  robotaxi: Agent;
}

async function blackoutRun(seed: number): Promise<Run> {
  const cross = crossRoads({ speedMps: LIMIT });
  const stalls: number[] = [];
  const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false, seed, hooks: { stalled: (_a, hold) => stalls.push(hold) } });
  rig.services.traffic.setBlackout(true, 'test');
  const put = (arm: number, out: number, arch: number, slot: number): Agent => {
    const a = rig.sim.place({ key: `amb:9/256/256:${slot}`, cell: CELL, slot, epoch: 1, arch, edge: cross.inEdge[arm] as number, s: 30, lane: 0, speed: 8 });
    if (!a) throw new Error('not placed');
    routeThrough(a, cross, arm, out);
    return a;
  };
  // the robotaxi comes from the north; sedans arrive together on the other three streets
  const robo = put(0, 2, ARCH.robotaxi, 10);
  const cars = [put(1, 3, ARCH.sedan, 11), put(2, 0, ARCH.sedan, 12), put(3, 1, ARCH.sedan, 13)];
  const j = cross.junctions[0];
  if (!j) throw new Error('no junction');
  const all = [robo, ...cars];
  const done = new Set<string>();
  let overlap = 0;
  let maxOver = 0;
  let hazard = false;
  rig.run(3600, () => {
    const inside = all.filter((c) => c.state === AgentState.Cross);
    for (const c of inside) done.add(c.key);
    for (let x = 0; x < inside.length; x++) {
      for (let y = x + 1; y < inside.length; y++) {
        const m = j.movements[(inside[x] as Agent).mov];
        if (m?.conflicts.includes((inside[y] as Agent).mov)) overlap++;
      }
    }
    // the robotaxi limit: the edge it is on (or the lower of the two while it crosses)
    const lim = robotaxiSpeedCap(LIMIT);
    maxOver = Math.max(maxOver, robo.speed - lim);
    if (robo.state === AgentState.Stalled && (robo.lights & LightBit.Hazard) !== 0) hazard = true;
  });
  return { stalls, crossed: done.size, overlap, maxSpeedOverCap: maxOver, hazard, robotaxi: robo };
}

describe('AC-3: a blackout', () => {
  it('twenty seeds: every stall lasts 4 to 9 s with hazards on, the junction is an all-way stop without deadlock, the cap holds', async () => {
    const holds: number[] = [];
    let stalled = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = await blackoutRun(seed * 7919);
      expect(r.crossed, `seed ${seed}: every car crosses`).toBe(4);
      expect(r.overlap, `seed ${seed}: no two conflicting movements at once`).toBe(0);
      expect(r.maxSpeedOverCap, `seed ${seed}: robotaxi cap`).toBeLessThanOrEqual(1e-9);
      if (r.stalls.length > 0) {
        stalled++;
        expect(r.hazard, `seed ${seed}: hazard lights`).toBe(true);
        for (const h of r.stalls) holds.push(h);
      }
    }
    // the probability is 0.35 per dark junction, so some of the twenty stall and some do not
    expect(stalled).toBeGreaterThanOrEqual(2);
    expect(stalled).toBeLessThanOrEqual(15);
    for (const h of holds) {
      expect(h).toBeGreaterThanOrEqual(4 * 60);
      expect(h).toBeLessThan(9 * 60);
    }
  }, 60_000);

  it('the stall lasts as long as it was drawn, measured in the state of the agent', async () => {
    const cross = crossRoads({ speedMps: LIMIT });
    // find a seed that stalls
    for (let seed = 1; seed <= 40; seed++) {
      const stalls: number[] = [];
      const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false, seed: seed * 104729, hooks: { stalled: (_a, h) => stalls.push(h) } });
      rig.services.traffic.setBlackout(true, 'test');
      const robo = rig.sim.place({ key: 'amb:9/256/256:20', cell: CELL, slot: 20, epoch: 1, arch: ARCH.robotaxi, edge: cross.inEdge[0] as number, s: 30, lane: 0, speed: 8 });
      if (!robo) throw new Error('not placed');
      routeThrough(robo, cross, 0, 2);
      let ticks = 0;
      rig.run(2400, () => {
        if (robo.state === AgentState.Stalled) ticks++;
      });
      if (stalls.length === 0) continue;
      expect(ticks).toBeGreaterThanOrEqual(240);
      expect(ticks).toBeLessThanOrEqual(542);
      expect(Math.abs(ticks - (stalls[0] as number))).toBeLessThanOrEqual(3);
      return;
    }
    throw new Error('no seed stalled in 40 tries');
  });

  it('with the signals working a robotaxi never stalls', async () => {
    const cross = crossRoads({ speedMps: LIMIT });
    let stalls = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false, seed: seed * 31, hooks: { stalled: () => stalls++ } });
      const robo = rig.sim.place({ key: 'amb:9/256/256:21', cell: CELL, slot: 21, epoch: 1, arch: ARCH.robotaxi, edge: cross.inEdge[0] as number, s: 30, lane: 0, speed: 8 });
      if (!robo) throw new Error('not placed');
      routeThrough(robo, cross, 0, 2);
      rig.run(1200);
    }
    expect(stalls).toBe(0);
  });

  it('a stop-sign junction is no dark signal: no stall', async () => {
    const cross = crossRoads({ speedMps: LIMIT, control: NodeControl.AllWayStop });
    let stalls = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false, seed: seed * 17, hooks: { stalled: () => stalls++ } });
      const robo = rig.sim.place({ key: 'amb:9/256/256:22', cell: CELL, slot: 22, epoch: 1, arch: ARCH.robotaxi, edge: cross.inEdge[0] as number, s: 30, lane: 0, speed: 8 });
      if (!robo) throw new Error('not placed');
      routeThrough(robo, cross, 0, 2);
      rig.run(1200);
    }
    expect(stalls).toBe(0);
  });
});
