/**
 * M03b1 AC-1 and AC-2: the signal rule of ambient traffic. On the `synth` bake 50 agents drive 600 s in `canonical`; on the
 * `civic-excerpt` bake (the real junctions around City Hall) 20 agents do. No agent crosses a stop line while its movement shows red,
 * or amber when it could still stop at 3.5 m/s^2, and no claim is held longer than 20 s. A hand-built crossing shows the rule at one
 * junction: a car waits for its phase and goes on green.
 */
import { describe, expect, it } from 'vitest';
import { signalAspect, type ChunkKey } from '@dv/shared';
import { ARCH } from '../src/sim/traffic/components.ts';
import { boxHalf } from '../src/sim/traffic/junction.ts';
import { loadBake } from './fixtures/bake.ts';
import { crossRoads } from './fixtures/roads.ts';
import { CLAIM_LIMIT_TICKS, auditHooks, makeRig, routeThrough } from './fixtures/traffic.ts';

const SECONDS_600 = 36_000;

describe('a signalised crossing (hand-built)', () => {
  it('a car arriving on a red phase stops at the line and goes only when its phase turns green', async () => {
    const cross = crossRoads();
    const { hooks, audit } = auditHooks();
    const rig = await makeRig({ chunks: [cross.chunk], hooks, parked: false, initialFill: false });
    // arm 1 (east) has red until tick 1440 (the north-south phase is green first)
    const car = rig.sim.place({ key: 'amb:9/256/256:900', cell: '9/256/256' as ChunkKey, slot: 900, epoch: 1, arch: ARCH.sedan, edge: cross.inEdge[1] as number, s: 20, lane: 0, speed: 8 });
    expect(car).not.toBeNull();
    if (!car) return;
    routeThrough(car, cross, 1, 3);
    const len = rig.sim.paths.len(car.edge);
    const lineS = len - boxHalf(len) - 0.5;
    let maxS = 0;
    let crossedAt = -1;
    rig.run(2400, (tick) => {
      if (tick < 1440 && car.state !== 1) maxS = Math.max(maxS, car.s);
      if (crossedAt < 0 && car.state === 1) crossedAt = tick;
    });
    expect(maxS).toBeLessThanOrEqual(lineS + 1e-6);
    expect(audit.crossings).toBeGreaterThanOrEqual(1);
    expect(crossedAt).toBeGreaterThanOrEqual(1440);
    expect(audit.red + audit.amber).toBe(0);
    const prog = cross.junctions[0]?.program;
    expect(prog).toBeTruthy();
    if (prog) expect(signalAspect(prog, crossedAt, cross.movement(1, 3), false)).toBe('green');
  });

  it('a car arriving on green goes through without stopping', async () => {
    const cross = crossRoads();
    const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false });
    const car = rig.sim.place({ key: 'amb:9/256/256:901', cell: '9/256/256' as ChunkKey, slot: 901, epoch: 1, arch: ARCH.sedan, edge: cross.inEdge[0] as number, s: 10, lane: 0, speed: 9 });
    if (!car) throw new Error('not placed');
    routeThrough(car, cross, 0, 2);
    let minSpeed = Infinity;
    rig.run(900, () => {
      if (car.edge === cross.inEdge[0] && car.state !== 1 && car.s > 30) minSpeed = Math.min(minSpeed, car.speed);
    });
    expect(car.edge).toBe(cross.outEdge[2]);
    expect(minSpeed).toBeGreaterThan(5);
  });

  it('on amber a car that can stop stops, and one that cannot goes through', async () => {
    const cross = crossRoads();
    const { hooks, audit } = auditHooks();
    const rig = await makeRig({ chunks: [cross.chunk], hooks, parked: false, initialFill: false });
    // the north-south green ends at tick 1200 and the amber runs to 1380
    rig.run(1190);
    const far = rig.sim.place({ key: 'amb:9/256/256:902', cell: '9/256/256' as ChunkKey, slot: 902, epoch: 1, arch: ARCH.sedan, edge: cross.inEdge[0] as number, s: 20, lane: 0, speed: 11 });
    if (!far) throw new Error('not placed');
    routeThrough(far, cross, 0, 2);
    rig.run(25);
    // 13.5 m from the line at 11 m/s needs 17.3 m to stop at 3.5 m/s^2: it cannot, and must go through on the amber
    const near = rig.sim.place({ key: 'amb:9/256/256:903', cell: '9/256/256' as ChunkKey, slot: 903, epoch: 1, arch: ARCH.sedan, edge: cross.inEdge[2] as number, s: 80, lane: 0, speed: 11 });
    if (!near) throw new Error('not placed');
    routeThrough(near, cross, 2, 0);
    let nearAt = -1;
    let farStopped = true;
    rig.run(1200, (tick) => {
      if (nearAt < 0 && near.state === 1) nearAt = tick;
      if (tick > 1380 && tick < 2800 && far.state === 1) farStopped = false;
    });
    expect(nearAt).toBeGreaterThan(1200);
    expect(nearAt).toBeLessThan(1380);
    expect(farStopped).toBe(true);
    expect(audit.red).toBe(0);
    expect(audit.amber).toBe(0);
    expect(audit.crossings).toBeGreaterThanOrEqual(1);
  });
});

describe('AC-1: 600 s on the synth bake, 50 agents', () => {
  it('no stop line is crossed on red or on a stoppable amber, and no claim outlives 20 s', async () => {
    const bake = loadBake('synth', 'traffic.signals synth');
    if (!bake) return;
    const near = (k: string): boolean => {
      const [, x, y] = k.split('/').map(Number) as [number, number, number];
      return Math.abs(x - 256) <= 3 && Math.abs(y - 256) <= 3;
    };
    const { hooks, audit, probe } = auditHooks();
    const rig = await makeRig({
      chunks: bake.chunks(near), topology: bake.topology, index: bake.index, tier: 'desktop-ultra', crowd: 50 / 800, parked: false, seed: bake.index.worldSeed, hooks,
    });
    let maxAgents = 0;
    rig.run(SECONDS_600, (tick) => {
      if (tick % 30 === 0) {
        probe(rig);
        maxAgents = Math.max(maxAgents, rig.sim.agents.size);
      }
    });
    console.log(`AC-1 synth: ${audit.crossings} crossings ${JSON.stringify(audit.byRule)}, longest claim ${audit.maxClaimTicks} ticks, emergency stops ${rig.sim.stats.emergencyStops}`);
    expect(maxAgents).toBe(50);
    expect(audit.crossings).toBeGreaterThan(300);
    expect(audit.byRule['signal/green'] ?? 0).toBeGreaterThan(20);
    expect(audit.first).toEqual([]);
    expect(audit.red).toBe(0);
    expect(audit.amber).toBe(0);
    expect(audit.maxClaimTicks).toBeLessThanOrEqual(CLAIM_LIMIT_TICKS);
    expect(rig.sim.stats.emergencyStops).toBe(0);
  }, 120_000);
});

describe('AC-2: 600 s on the civic-excerpt bake, 20 agents', () => {
  it('the same rules hold at the real junctions around City Hall', async () => {
    const bake = loadBake('civic-excerpt', 'traffic.signals civic-excerpt');
    if (!bake) return;
    const { hooks, audit, probe } = auditHooks();
    const rig = await makeRig({
      chunks: bake.chunks(), topology: bake.topology, index: bake.index, tier: 'desktop-ultra', crowd: 20 / 800, parked: false, seed: bake.index.worldSeed,
      focus: { x: -128, z: -128, vx: 0, vz: 0 }, hooks,
    });
    rig.run(SECONDS_600, (tick) => {
      if (tick % 30 === 0) probe(rig);
    });
    console.log(`AC-2 civic-excerpt: ${audit.crossings} crossings ${JSON.stringify(audit.byRule)}, longest claim ${audit.maxClaimTicks} ticks`);
    expect(rig.sim.agents.size).toBe(20);
    expect(audit.crossings).toBeGreaterThan(150);
    expect(audit.first).toEqual([]);
    expect(audit.red + audit.amber).toBe(0);
    expect(audit.maxClaimTicks).toBeLessThanOrEqual(CLAIM_LIMIT_TICKS);
    expect(rig.sim.stats.emergencyStops).toBe(0);
  }, 120_000);
});
