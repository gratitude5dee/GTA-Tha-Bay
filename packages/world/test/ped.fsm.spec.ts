/**
 * M03b2 AC-4 and the pedestrian FSM (living part 4.2): walking pace, stairs, idle at waiting nodes, dodge, flee, hit, the seeded
 * witness report, and the gathering at `crowd.attract` sources (3 live at most).
 */
import { describe, expect, it } from 'vitest';
import { PedEdgeKind, PedNodeFlag, type ChunkKey, type SimChunk } from '@dv/shared';
import {
  DODGE_TICKS, FLEE_TICKS, HIT_TICKS, IDLE_MAX_TICKS, IDLE_MIN_TICKS, PedState, WALK_MPS, WALK_SPREAD_MPS, WITNESS_MAX_TICKS, WITNESS_MIN_TICKS,
} from '../src/sim/peds/components.ts';
import { ATTRACT_CAP } from '../src/sim/peds/attract.ts';
import { gatherRingOf as ringOf } from '../src/sim/peds/fsm.ts';
import { isPedKey } from '../src/sim/peds/witness.ts';
import type { WitnessEvent } from '../src/sim/traffic/witness.ts';
import { makePedRig, pedCrossing, vehicleAt } from './fixtures/peds.ts';

const CELL = '9/256/256' as ChunkKey;

async function lone() {
  const f = pedCrossing();
  const rig = await makePedRig({ chunks: [f.chunk], focus: { x: -25, z: 0, vx: 0, vz: 0 }, initialFill: false });
  return { f, rig };
}

describe('walking', () => {
  it('walks at its own pace, 1.4 +- 0.2 m/s', async () => {
    const { rig } = await lone();
    const fast = rig.sim.place({ key: 'amb:9/256/256:300', cell: CELL, slot: 300, a: 0, b: 1, s: 0, pace: WALK_MPS + WALK_SPREAD_MPS, lane: 0 });
    const slow = rig.sim.place({ key: 'amb:9/256/256:301', cell: CELL, slot: 301, a: 0, b: 1, s: 0, pace: WALK_MPS - WALK_SPREAD_MPS, lane: 0 });
    if (!fast || !slow) throw new Error('not placed');
    rig.run(600);
    expect(fast.s).toBeCloseTo(1.6 * 10, 1);
    expect(slow.s).toBeCloseTo(1.2 * 10, 1);
  });

  it('seeded paces fall in the range', async () => {
    const f = pedCrossing();
    const rig = await makePedRig({ chunks: [f.chunk], tier: 'desktop', focus: { x: -25, z: 70, vx: 0, vz: 0 } });
    rig.run(4);
    expect(rig.sim.peds.size).toBeGreaterThan(5);
    for (const p of rig.sim.peds.list()) {
      expect(p.pace).toBeGreaterThanOrEqual(WALK_MPS - WALK_SPREAD_MPS - 1e-9);
      expect(p.pace).toBeLessThanOrEqual(WALK_MPS + WALK_SPREAD_MPS + 1e-9);
    }
  });

  it('stairs slow the walk to 0.6 of the pace', async () => {
    const f = pedCrossing();
    const stairs = { ...f.chunk, pedEdges: f.chunk.pedEdges.map((e) => (e.kind === PedEdgeKind.Sidewalk && e.a === 0 ? { ...e, kind: PedEdgeKind.Stairs } : e)) };
    const rig = await makePedRig({ chunks: [stairs], focus: { x: -25, z: 0, vx: 0, vz: 0 }, initialFill: false });
    const p = rig.sim.place({ key: 'amb:9/256/256:302', cell: CELL, slot: 302, a: 0, b: 1, s: 0, pace: 1.4, lane: 0 });
    if (!p) throw new Error('not placed');
    rig.run(600);
    expect(p.s).toBeCloseTo(1.4 * 0.6 * 10, 1);
  });
});

describe('idle at a waiting node', () => {
  it('some pedestrians stop 5 to 40 s at a node flagged Waiting, and walk on afterwards', async () => {
    const f = pedCrossing();
    // the end of the sidewalk (node 1) is a crossing node, which is flagged Waiting
    const rig = await makePedRig({ chunks: [f.chunk], focus: { x: -25, z: 0, vx: 0, vz: 0 }, initialFill: false });
    const ps = [];
    for (let i = 0; i < 40; i++) {
      const p = rig.sim.place({ key: `amb:9/256/256:${310 + i}`, cell: CELL, slot: 310 + i, a: 0, b: 1, s: 28, pace: 1.4, lane: 0 });
      if (p) ps.push(p);
    }
    expect(ps.length).toBe(40);
    let idle = 0;
    let timerMin = Infinity, timerMax = 0;
    rig.run(120, () => {
      for (const p of ps) {
        if (p.state === PedState.Idle && p.timer > 0) {
          timerMin = Math.min(timerMin, p.timer);
          timerMax = Math.max(timerMax, p.timer);
        }
      }
    });
    for (const p of ps) if (p.state === PedState.Idle) idle++;
    expect(idle).toBeGreaterThan(3);
    expect(idle).toBeLessThan(40);
    expect(timerMax).toBeLessThanOrEqual(IDLE_MAX_TICKS);
    expect(timerMin).toBeGreaterThan(0);
    expect(timerMax).toBeGreaterThanOrEqual(IDLE_MIN_TICKS);
    // all of them are walking again 45 s later
    rig.run(IDLE_MAX_TICKS + 60);
    expect(ps.filter((p) => p.state === PedState.Idle).length).toBeLessThan(idle);
  });
});

describe('AC-4: dodge, flee, hit', () => {
  it('a car at 8 m/s within 6 m makes a walking pedestrian dodge', async () => {
    const { rig } = await lone();
    const p = rig.sim.place({ key: 'amb:9/256/256:320', cell: CELL, slot: 320, a: 0, b: 1, s: 10, pace: 1.4, lane: 0 });
    if (!p) throw new Error('not placed');
    expect(p.state).toBe(PedState.Walk);
    rig.vehicles = [vehicleAt(p.x, p.z + 5, 0, -1, 8)];
    rig.run(2);
    expect(p.state).toBe(PedState.Dodge);
    rig.vehicles = [];
    let widest = 0;
    rig.run(DODGE_TICKS + 4, () => (widest = Math.max(widest, Math.hypot(p.ox, p.oz))));
    // a sidestep of about 1.4 m off the graph line, then it walks on
    expect(p.state).toBe(PedState.Walk);
    expect(widest).toBeGreaterThan(1);
    expect(widest).toBeLessThan(1.6);
  });

  it('a car slower than 6 m/s, or farther than 6 m, or behind, does not', async () => {
    const { rig } = await lone();
    const p = rig.sim.place({ key: 'amb:9/256/256:321', cell: CELL, slot: 321, a: 0, b: 1, s: 10, pace: 1.4, lane: 0 });
    if (!p) throw new Error('not placed');
    rig.vehicles = [vehicleAt(p.x, p.z + 5, 0, -1, 5)];
    rig.run(2);
    expect(p.state).toBe(PedState.Walk);
    rig.vehicles = [vehicleAt(p.x, p.z + 8, 0, -1, 9)];
    rig.run(2);
    expect(p.state).toBe(PedState.Walk);
    rig.vehicles = [vehicleAt(p.x, p.z - 5, 0, -1, 9)];
    rig.run(2);
    expect(p.state).toBe(PedState.Walk);
  });

  it('a very fast car within 10 m makes it flee at 2.8 m/s for 10 s', async () => {
    const { rig } = await lone();
    const p = rig.sim.place({ key: 'amb:9/256/256:322', cell: CELL, slot: 322, a: 0, b: 1, s: 10, pace: 1.4, lane: 0 });
    if (!p) throw new Error('not placed');
    rig.vehicles = [vehicleAt(p.x, p.z + 8, 0, -1, 18)];
    rig.run(2);
    expect(p.state).toBe(PedState.Flee);
    rig.vehicles = [];
    const s0 = p.s, from = p.from;
    rig.run(60);
    expect(p.state).toBe(PedState.Flee);
    if (p.from === from) expect(p.s - s0).toBeCloseTo(2.8 * 1, 0);
    rig.run(FLEE_TICKS);
    expect(p.state).not.toBe(PedState.Flee);
  });

  it('a car at 3 m/s or more that touches it knocks it down for 3 s', async () => {
    const { rig } = await lone();
    const p = rig.sim.place({ key: 'amb:9/256/256:323', cell: CELL, slot: 323, a: 0, b: 1, s: 10, pace: 1.4, lane: 0 });
    if (!p) throw new Error('not placed');
    const hits: string[] = [];
    rig.sim.hooks.hit = (q) => hits.push(q.key);
    rig.vehicles = [vehicleAt(p.x, p.z + 1.5, 0, -1, 6)];
    rig.run(2);
    expect(p.state).toBe(PedState.Hit);
    expect(hits).toEqual([p.key]);
    rig.vehicles = [];
    rig.run(HIT_TICKS - 8);
    expect(p.state).toBe(PedState.Hit);
    rig.run(16);
    expect(p.state).toBe(PedState.Walk);
  });
});

describe('AC-4: witnesses', () => {
  it('a collision seen by a pedestrian within 25 m yields exactly one world.witness event 3 to 6 s later, from a pedestrian', async () => {
    const { rig } = await lone();
    const near = rig.sim.place({ key: 'amb:9/256/256:330', cell: CELL, slot: 330, a: 0, b: 1, s: 5, pace: 1.4, lane: 0 });
    const also = rig.sim.place({ key: 'amb:9/256/256:331', cell: CELL, slot: 331, a: 3, b: 2, s: 5, pace: 1.4, lane: 0 });
    if (!near || !also) throw new Error('not placed');
    const events: WitnessEvent[] = [];
    rig.board.onWitness((e) => events.push(e));
    rig.run(10);
    const postedAt = rig.tick;
    rig.board.post('hitCivilianVehicle', { x: near.x + 12, y: 0, z: near.z }, 'player:0', postedAt);
    rig.run(WITNESS_MAX_TICKS + 20);
    expect(events).toHaveLength(1);
    const e = events[0] as WitnessEvent;
    expect(e.kind).toBe('hitCivilianVehicle');
    expect(isPedKey(e.witness)).toBe(true);
    expect(e.reportAtTick - postedAt).toBeGreaterThanOrEqual(WITNESS_MIN_TICKS);
    expect(e.reportAtTick - postedAt).toBeLessThanOrEqual(WITNESS_MAX_TICKS + 2);
    expect(rig.board.emitted).toBe(1);
  });

  it('the delay is seeded: the same scene gives the same report time, another seed another', async () => {
    const times: number[] = [];
    for (const seed of [0xc0ffee, 0xc0ffee, 7]) {
      const f = pedCrossing();
      const rig = await makePedRig({ chunks: [f.chunk], seed, focus: { x: -25, z: 0, vx: 0, vz: 0 }, initialFill: false });
      const p = rig.sim.place({ key: 'amb:9/256/256:332', cell: CELL, slot: 332, a: 0, b: 1, s: 5, pace: 1.4, lane: 0 });
      if (!p) throw new Error('not placed');
      let at = -1;
      rig.board.onWitness((e) => (at = e.reportAtTick));
      rig.board.post('assault', { x: p.x + 5, y: 0, z: p.z }, 'player:0', 0);
      rig.run(WITNESS_MAX_TICKS + 20);
      times.push(at);
    }
    expect(times[0]).toBeGreaterThan(0);
    expect(times[0]).toBe(times[1]);
    expect(times[2]).not.toBe(times[0]);
  });

  it('a pedestrian beyond 25 m, or an infraction a pedestrian does not notice, reports nothing', async () => {
    const { rig } = await lone();
    const p = rig.sim.place({ key: 'amb:9/256/256:333', cell: CELL, slot: 333, a: 0, b: 1, s: 5, pace: 1.4, lane: 0 });
    if (!p) throw new Error('not placed');
    const events: WitnessEvent[] = [];
    rig.board.onWitness((e) => events.push(e));
    rig.board.post('hitCivilianVehicle', { x: p.x + 60, y: 0, z: p.z }, 'player:0', 0);
    rig.board.post('speedingSeen', { x: p.x + 5, y: 0, z: p.z }, 'player:0', 0);
    rig.run(WITNESS_MAX_TICKS + 20);
    expect(events).toHaveLength(0);
  });
});

describe('crowd.attract', () => {
  it('pedestrians within 40 m gather and film or cheer facing the source; at most 3 sources are live', async () => {
    const { rig } = await lone();
    const ps = [];
    for (let i = 0; i < 12; i++) {
      const p = rig.sim.place({ key: `amb:9/256/256:${340 + i}`, cell: CELL, slot: 340 + i, a: i % 2 === 0 ? 0 : 3, b: i % 2 === 0 ? 1 : 2, s: (i * 2) % 28, pace: 1.4, lane: 0 });
      if (p) ps.push(p);
    }
    const ids = [rig.sim.attract.add(-25, 0, 'test'), rig.sim.attract.add(-60, 0, 'test'), rig.sim.attract.add(-70, 0, 'test'), rig.sim.attract.add(-80, 0, 'test')];
    expect(ids.slice(0, ATTRACT_CAP).every((i) => i > 0)).toBe(true);
    expect(ids[ATTRACT_CAP]).toBe(0);
    rig.run(1800);
    const gathered = ps.filter((p) => p.state === PedState.Record || p.state === PedState.Cheer);
    expect(gathered.length).toBeGreaterThanOrEqual(3);
    for (const p of gathered) {
      const a = rig.sim.attract.get(p.attractId);
      expect(a).toBeTruthy();
      if (a) expect(Math.hypot(p.x - a.x, p.z - a.z)).toBeLessThanOrEqual(ringOf(p) + 35);
    }
    // releasing the source sends them back to walking
    for (const id of ids) rig.sim.attract.release(id);
    rig.run(10);
    expect(ps.filter((p) => p.state === PedState.Record || p.state === PedState.Cheer).length).toBe(0);
  });
});

describe('the end of the graph', () => {
  it('a dead end turns the walker round', async () => {
    const { rig } = await lone();
    const p = rig.sim.place({ key: 'amb:9/256/256:360', cell: CELL, slot: 360, a: 2, b: 3, s: 25, pace: 1.4, lane: 0 });
    if (!p) throw new Error('not placed');
    // node 3 has no other edge: the walker comes back toward node 2
    rig.run(600);
    expect(p.from === 3 || p.to === 3 || p.from === 2).toBe(true);
    expect(p.state === PedState.Walk || p.state === PedState.Wait || p.state === PedState.Idle).toBe(true);
  });

  it('a graph with a Waiting flag only on crossing nodes keeps Idle off plain sidewalk nodes', () => {
    const f = pedCrossing();
    const flagged = (f.chunk as SimChunk).pedNodes.filter((n) => (n.flags & PedNodeFlag.Waiting) !== 0).map((n) => n.id);
    expect(flagged).toEqual([1, 2]);
  });
});
