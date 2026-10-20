/**
 * M03b1 car following (02-world-living.md 2.1.1) and the shape of the plan: the IDM law with its constants, the curve and grade
 * limits, the personality stream, the archetype shares, the lane change before a turn.
 */
import { describe, expect, it } from 'vitest';
import { dsqrt, type ChunkKey } from '@dv/shared';
import { Agent } from '../src/sim/traffic/agent.ts';
import { ARCH, ARCHETYPES, Turn, pickArchetype } from '../src/sim/traffic/components.ts';
import { IDM_A, IDM_B, IDM_S0, IDM_T, PERSONALITY_MAX, PERSONALITY_MIN, advance, curveLimit, gradeScale, idmAccel, stopDistance } from '../src/sim/traffic/idm.ts';
import { laneForTurn, landingLane, turnOfAngle } from '../src/sim/traffic/plan.ts';
import { crossRoads } from './fixtures/roads.ts';
import { makeRig, routeThrough } from './fixtures/traffic.ts';

const DT = 1 / 30;

describe('IDM', () => {
  it('the constants are the spec values', () => {
    expect([IDM_T, IDM_S0, IDM_A, IDM_B]).toEqual([1.4, 2.0, 2.5, 3.5]);
    expect([PERSONALITY_MIN, PERSONALITY_MAX]).toEqual([0.92, 1.08]);
  });

  it('on a free road a car accelerates at 2.5 m/s^2 and settles on its desired speed without passing it', () => {
    expect(idmAccel(0, 12, Infinity, 0)).toBeCloseTo(IDM_A, 9);
    let v = 0;
    const o = { v: 0, ds: 0 };
    let maxV = 0;
    for (let i = 0; i < 30 * 40; i++) {
      advance(v, idmAccel(v, 12, Infinity, 0), DT, o);
      v = o.v;
      maxV = Math.max(maxV, v);
    }
    expect(v).toBeGreaterThan(11.9);
    expect(maxV).toBeLessThanOrEqual(12 + 1e-6);
  });

  it('behind a leader at the same speed the gap settles near s0 + v T', () => {
    const v = 10;
    let gap = 30;
    let speed = 10;
    const o = { v: 0, ds: 0 };
    for (let i = 0; i < 30 * 120; i++) {
      advance(speed, idmAccel(speed, 40, gap, v), DT, o);
      gap += v * DT - o.ds;
      speed = o.v;
    }
    // with a desired speed far above the leader's the free-road term is 1 and the equilibrium gap is s* = s0 + v T
    expect(gap).toBeCloseTo(IDM_S0 + v * IDM_T, 0);
    expect(speed).toBeCloseTo(v, 1);
  });

  it('a car stops short of a standing leader and never drives into it', () => {
    for (const v0 of [5, 10, 14]) {
      let gap = 60;
      let speed = v0;
      const o = { v: 0, ds: 0 };
      let minGap = Infinity;
      let worst = 0;
      for (let i = 0; i < 30 * 60; i++) {
        const a = idmAccel(speed, 14, gap, 0);
        worst = Math.min(worst, a);
        advance(speed, a, DT, o);
        gap -= o.ds;
        speed = o.v;
        minGap = Math.min(minGap, gap);
      }
      expect(speed).toBeLessThan(0.05);
      expect(minGap).toBeGreaterThan(IDM_S0 - 0.3);
      expect(worst).toBeGreaterThanOrEqual(-9);
    }
  });

  it('the curve limit is sqrt(2 / kappa) and the grade scale falls from 10 % to the floor 0.6', () => {
    expect(curveLimit(0.5)).toBeCloseTo(dsqrt(4), 9);
    expect(curveLimit(0.001)).toBe(Infinity);
    expect(gradeScale(8)).toBe(1);
    expect(gradeScale(10)).toBe(1);
    expect(gradeScale(20)).toBeCloseTo(0.75, 9);
    expect(gradeScale(-20)).toBeCloseTo(0.75, 9);
    expect(gradeScale(31.5)).toBeCloseTo(0.6, 9);
    expect(gradeScale(60)).toBe(0.6);
    expect(stopDistance(14, 3.5)).toBeCloseTo(28, 9);
  });
});

describe('the agent stream', () => {
  it('the personality of spawned agents lies in 0.92 to 1.08 and differs between agents, and is a function of the slot', async () => {
    const cross = crossRoads();
    const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false });
    const p: number[] = [];
    for (let i = 0; i < 200; i++) {
      const a = rig.sim.place({ key: `amb:9/256/256:${i}`, cell: '9/256/256' as ChunkKey, slot: i, epoch: 1, arch: ARCH.sedan, edge: cross.inEdge[0] as number, s: 5, lane: 0 });
      if (a) p.push(a.personality);
      if (a) rig.sim.agents.remove(a);
    }
    expect(p.length).toBe(200);
    expect(Math.min(...p)).toBeGreaterThanOrEqual(PERSONALITY_MIN);
    expect(Math.max(...p)).toBeLessThan(PERSONALITY_MAX);
    expect(Math.min(...p)).toBeLessThan(0.95);
    expect(Math.max(...p)).toBeGreaterThan(1.05);
    const again = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false });
    const a = again.sim.place({ key: 'amb:9/256/256:5', cell: '9/256/256' as ChunkKey, slot: 5, epoch: 1, arch: ARCH.sedan, edge: cross.inEdge[0] as number, s: 5, lane: 0 });
    expect(a?.personality).toBe(p[5]);
    const other = new Agent('amb:9/256/256:5', '9/256/256' as ChunkKey, 5, 42);
    expect(other.rng.getState()).not.toEqual(a?.rng.getState());
  });
});

describe('archetype shares (2.5)', () => {
  const share = (profile: string): number[] => {
    const n = 200_000;
    const c = new Array<number>(ARCHETYPES.length).fill(0);
    for (let i = 0; i < n; i++) c[pickArchetype((i + 0.5) / n, profile)] = (c[pickArchetype((i + 0.5) / n, profile)] ?? 0) + 1;
    return c.map((x) => x / n);
  };

  it('in a downtown profile: compact 32, sedan 26, rideshare 12, robotaxi 8, van 8, truck 6, pickup 6 of the 98 % that are not patrol cars', () => {
    const s = share('cbd');
    const k = 0.98 / 98;
    expect(s[ARCH.compact]).toBeCloseTo(32 * k, 3);
    expect(s[ARCH.sedan]).toBeCloseTo(26 * k, 3);
    expect(s[ARCH.rideshare]).toBeCloseTo(12 * k, 3);
    expect(s[ARCH.robotaxi]).toBeCloseTo(8 * k, 3);
    expect(s[ARCH.van]).toBeCloseTo(8 * k, 3);
    expect(s[ARCH.truck]).toBeCloseTo(6 * k, 3);
    expect(s[ARCH.pickup]).toBeCloseTo(6 * k, 3);
    expect(s[ARCH.cruiser]).toBeCloseTo(0.02, 3);
  });

  it('elsewhere the robotaxi share is 3 % and the difference goes to sedan; industrial triples vans and trucks', () => {
    const s = share('residential');
    const k = 0.98 / 98;
    expect(s[ARCH.robotaxi]).toBeCloseTo(3 * k, 3);
    expect(s[ARCH.sedan]).toBeCloseTo(31 * k, 3);
    const t = share('industrial');
    const total = 32 + 31 + 12 + 3 + 24 + 18 + 6;
    expect(t[ARCH.van]).toBeCloseTo((24 / total) * 0.98, 3);
    expect(t[ARCH.truck]).toBeCloseTo((18 / total) * 0.98, 3);
  });
});

describe('turns and lanes', () => {
  it('the turn classes of a heading change: straight within 30 degrees, a U-turn beyond 150', () => {
    expect(turnOfAngle(0.2)).toBe(Turn.Straight);
    expect(turnOfAngle(-0.5)).toBe(Turn.Straight);
    expect(turnOfAngle(1.57)).toBe(Turn.Right);
    expect(turnOfAngle(-1.57)).toBe(Turn.Left);
    expect(turnOfAngle(3)).toBe(Turn.UTurn);
  });

  it('right turns leave from lane 0, left turns from the leftmost lane', () => {
    expect(laneForTurn(Turn.Right, 2, 1)).toBe(0);
    expect(laneForTurn(Turn.Left, 2, 0)).toBe(1);
    expect(laneForTurn(Turn.Straight, 2, 1)).toBe(1);
    expect(landingLane(Turn.Right, 2, 1)).toBe(0);
    expect(landingLane(Turn.Left, 2, 0)).toBe(1);
  });

  it('an agent changes lane within the last 40 m before its turn', async () => {
    const cross = crossRoads({ lanes: 2, armM: 100 });
    const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false });
    const a = rig.sim.place({ key: 'amb:9/256/256:300', cell: '9/256/256' as ChunkKey, slot: 300, epoch: 1, arch: ARCH.sedan, edge: cross.inEdge[0] as number, s: 5, lane: 1, speed: 6 });
    if (!a) throw new Error('not placed');
    routeThrough(a, cross, 0, 3);
    expect(a.turn).toBe(Turn.Right);
    let changedAt = -1;
    rig.run(600, () => {
      if (changedAt < 0 && a.lane === 0) changedAt = a.s;
    });
    expect(changedAt).toBeGreaterThanOrEqual(100 - 6 - 40 - 1);
    expect(a.lane === 0 || a.edge !== cross.inEdge[0]).toBe(true);
  });
});
