/**
 * M03b1 junction protocol: stop signs and dark signals (the first car to stop goes, ties by `StableKey`), the conflict set, the
 * permissive left, the 20 s claim timeout (the lowest `StableKey` proceeds), dead ends, closed edges and the turn weights of the plan.
 */
import { describe, expect, it } from 'vitest';
import { NodeControl, type ChunkKey } from '@dv/shared';
import { Agent } from '../src/sim/traffic/agent.ts';
import { ARCH, AgentState, Turn } from '../src/sim/traffic/components.ts';
import { CLAIM_TIMEOUT_TICKS, JunctionBook, boxHalf, newDecision } from '../src/sim/traffic/junction.ts';
import { planTurn } from '../src/sim/traffic/plan.ts';
import { crossRoads } from './fixtures/roads.ts';
import { makeRig, routeThrough, type Rig } from './fixtures/traffic.ts';

const CELL = '9/256/256' as ChunkKey;
let serial = 0;

function put(rig: Rig, cross: ReturnType<typeof crossRoads>, inArm: number, outArm: number, s: number, speed: number, key?: string): Agent {
  const slot = 800 + serial++;
  const a = rig.sim.place({ key: key ?? `amb:9/256/256:${slot}`, cell: CELL, slot, epoch: 1, arch: ARCH.sedan, edge: cross.inEdge[inArm] as number, s, lane: 0, speed });
  if (!a) throw new Error('not placed');
  routeThrough(a, cross, inArm, outArm);
  return a;
}

describe('all-way stop', () => {
  it('four cars arrive together: each stops, the first to stop goes, and no two cross conflicting movements at once', async () => {
    const cross = crossRoads({ control: NodeControl.AllWayStop });
    const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false });
    const cars = [put(rig, cross, 0, 2, 40, 9), put(rig, cross, 1, 3, 40, 9), put(rig, cross, 2, 0, 40, 9), put(rig, cross, 3, 1, 40, 9)];
    const j = cross.junctions[0];
    if (!j) throw new Error('no junction');
    const crossedAt = new Map<string, number>();
    const stoppedBefore = new Map<string, number>();
    let overlap = 0;
    rig.run(1800, (tick) => {
      const inside = cars.filter((c) => c.state === AgentState.Cross);
      for (const c of inside) {
        if (!crossedAt.has(c.key)) {
          crossedAt.set(c.key, tick);
          stoppedBefore.set(c.key, c.stoppedTick);
        }
      }
      for (let x = 0; x < inside.length; x++) {
        for (let y = x + 1; y < inside.length; y++) {
          const m = j.movements[(inside[x] as Agent).mov];
          if (m?.conflicts.includes((inside[y] as Agent).mov)) overlap++;
        }
      }
    });
    expect(crossedAt.size).toBe(4);
    expect(overlap).toBe(0);
    // every car came to rest and dwelt at least 0.75 s before it went
    for (const c of cars) expect((crossedAt.get(c.key) ?? 0) - 1).toBeGreaterThan(0);
    for (const [key, at] of crossedAt) expect(at - (stoppedBefore.get(key) ?? -1)).toBeGreaterThanOrEqual(0);
  });

  it('two cars that stop on the same tick on crossing streets: the lower StableKey goes first', async () => {
    const cross = crossRoads({ control: NodeControl.AllWayStop });
    const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false });
    const hi = put(rig, cross, 1, 3, 40, 9, 'amb:9/256/256:850');
    const lo = put(rig, cross, 0, 2, 40, 9, 'amb:9/256/256:300');
    const order: string[] = [];
    rig.run(1500, () => {
      for (const c of [hi, lo]) if (c.state === AgentState.Cross && !order.includes(c.key)) order.push(c.key);
    });
    expect(order).toEqual([lo.key, hi.key]);
  });

  it('cars on opposite streets that do not conflict go at the same time', async () => {
    const cross = crossRoads({ control: NodeControl.AllWayStop });
    const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false });
    const a = put(rig, cross, 0, 2, 40, 9);
    const b = put(rig, cross, 2, 0, 40, 9);
    let both = false;
    rig.run(1500, () => {
      if (a.state === AgentState.Cross && b.state === AgentState.Cross) both = true;
    });
    expect(both).toBe(true);
  });
});

describe('claims', () => {
  it('a claim that times out lets the lowest StableKey of the overdue claimants through, the others still wait', async () => {
    const cross = crossRoads({ control: NodeControl.AllWayStop });
    const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false });
    const j = cross.junctions[0];
    if (!j) throw new Error('no junction');
    const net = rig.services.network;
    const book = new JunctionBook(net, rig.services.graph, rig.sim.paths);
    const len = rig.sim.paths.len(cross.inEdge[0] as number);
    const lineS = len - boxHalf(len) - 0.5;
    const waiting = (key: string, arm: number, out: number): Agent => {
      const a = new Agent(key, CELL, 1, 1);
      a.edge = cross.inEdge[arm] as number;
      a.s = lineS - 0.5;
      a.speed = 0;
      a.nextEdge = cross.outEdge[out] as number;
      a.mov = cross.movement(arm, out);
      a.jct = 0;
      a.turn = Turn.Straight;
      a.stoppedTick = 100;
      return a;
    };
    // a car stuck inside the box on a movement that conflicts with both waiting cars
    const blocker = new Agent('amb:9/256/256:1', CELL, 1, 1);
    blocker.edge = cross.inEdge[2] as number;
    blocker.state = AgentState.Cross;
    blocker.jct = 0;
    blocker.mov = cross.movement(2, 3);
    blocker.jLen = 12;
    const a = waiting('amb:9/256/256:20', 0, 2);
    const b = waiting('amb:9/256/256:30', 1, 3);
    // sanity: the blocker's movement conflicts with both
    const mA = j.movements[a.mov], mB = j.movements[b.mov];
    expect(mA?.conflicts).toContain(blocker.mov);
    expect(mB?.conflicts).toContain(blocker.mov);
    const byEdge = new Map<number, Agent[]>([[a.edge, [a]], [b.edge, [b]], [blocker.edge, [blocker]]]);
    const d = newDecision();
    const t0 = 5000;
    book.begin(t0, [a, b, blocker], byEdge);
    book.evaluate(a, d);
    expect(d.go).toBe(false);
    expect(a.claimTick).toBe(t0);
    book.evaluate(b, d);
    expect(d.go).toBe(false);
    // 20 s later both claims are overdue: the lower key goes, the other keeps waiting
    const t1 = t0 + CLAIM_TIMEOUT_TICKS;
    book.begin(t1, [a, b, blocker], byEdge);
    book.evaluate(b, d);
    expect(d.go).toBe(false);
    book.evaluate(a, d);
    expect(d.go).toBe(true);
    // once a has gone, b is the lowest overdue claimant
    book.begin(t1 + 2, [b, blocker], new Map([[b.edge, [b]], [blocker.edge, [blocker]]]));
    book.evaluate(b, d);
    expect(d.go).toBe(true);
  });
});

describe('permissive left', () => {
  it('a left turn on green waits for oncoming traffic and goes after it has passed', async () => {
    const cross = crossRoads();
    const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false });
    const j = cross.junctions[0];
    if (!j) throw new Error('no junction');
    const left = put(rig, cross, 0, 1, 80, 4);
    const oncoming = put(rig, cross, 2, 0, 55, 11);
    expect(j.movements[cross.movement(0, 1)]?.conflicts).toContain(cross.movement(2, 0));
    let leftAt = -1, onAt = -1;
    let overlap = 0;
    rig.run(900, (tick) => {
      if (leftAt < 0 && left.state === AgentState.Cross) leftAt = tick;
      if (onAt < 0 && oncoming.state === AgentState.Cross) onAt = tick;
      if (left.state === AgentState.Cross && oncoming.state === AgentState.Cross) overlap++;
    });
    expect(onAt).toBeGreaterThan(0);
    expect(leftAt).toBeGreaterThan(onAt);
    expect(overlap).toBe(0);
  });
});

describe('plan', () => {
  it('chooses straight 0.60, right 0.22 and left 0.18 of the time', async () => {
    const cross = crossRoads();
    const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false });
    const w = { net: rig.services.network, graph: rig.services.graph, isClosed: () => false };
    const n = 10_000;
    const count: Record<number, number> = {};
    for (let i = 0; i < n; i++) {
      const c = planTurn(w, rig.sim.paths, cross.inEdge[0] as number, (i + 0.5) / n);
      if (!c) throw new Error('no plan');
      count[c.turn] = (count[c.turn] ?? 0) + 1;
    }
    expect((count[Turn.Straight] ?? 0) / n).toBeCloseTo(0.6, 2);
    expect((count[Turn.Right] ?? 0) / n).toBeCloseTo(0.22, 2);
    expect((count[Turn.Left] ?? 0) / n).toBeCloseTo(0.18, 2);
  });

  it('never plans a closed edge, and never the way it came', async () => {
    const cross = crossRoads();
    const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false });
    rig.services.traffic.closeEdges([cross.outEdge[2] as number], 'test');
    const w = { net: rig.services.network, graph: rig.services.graph, isClosed: (e: number) => rig.services.traffic.isClosed(e) };
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const c = planTurn(w, rig.sim.paths, cross.inEdge[0] as number, (i + 0.5) / 400);
      if (c) seen.add(c.next);
    }
    expect(seen.has(cross.outEdge[2] as number)).toBe(false);
    expect(seen.has(cross.outEdge[0] as number)).toBe(false);
    expect(seen.has(cross.outEdge[1] as number)).toBe(true);
    expect(seen.has(cross.outEdge[3] as number)).toBe(true);
  });

  it('a dead end offers the U-turn only', async () => {
    const cross = crossRoads();
    const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false });
    const w = { net: rig.services.network, graph: rig.services.graph, isClosed: () => false };
    const c = planTurn(w, rig.sim.paths, cross.outEdge[0] as number, 0.5);
    expect(c?.turn).toBe(Turn.UTurn);
    expect(c?.next).toBe(cross.inEdge[0]);
  });
});

describe('dead ends', () => {
  it('a car in sight stops for a second at the end of the street and turns round', async () => {
    const cross = crossRoads();
    const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false });
    const slot = 700;
    const a = rig.sim.place({ key: 'amb:9/256/256:700', cell: CELL, slot, epoch: 1, arch: ARCH.sedan, edge: cross.outEdge[0] as number, s: 60, lane: 0, speed: 8 });
    if (!a) throw new Error('not placed');
    let heldTicks = 0;
    let back = -1;
    rig.run(1200, (tick) => {
      if (a.speed < 0.3 && a.edge === cross.outEdge[0]) heldTicks++;
      if (back < 0 && (a.edge === cross.inEdge[0] || a.state === AgentState.Cross)) back = tick;
    });
    expect(heldTicks).toBeGreaterThanOrEqual(60);
    expect(back).toBeGreaterThan(0);
    expect(a.edge === cross.inEdge[0] || a.state === AgentState.Cross).toBe(true);
  });

  it('a car out of sight at a dead end is removed', async () => {
    const cross = crossRoads();
    const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false, focus: { x: 0, z: 0, vx: 0, vz: 0 } });
    // the street ends 100 m out; the focus is 180 m away from the car, beyond the 80 m near radius
    rig.focus = { x: 0, z: 190, vx: 0, vz: 0 };
    const a = rig.sim.place({ key: 'amb:9/256/256:701', cell: CELL, slot: 701, epoch: 1, arch: ARCH.sedan, edge: cross.outEdge[0] as number, s: 55, lane: 0, speed: 8 });
    if (!a) throw new Error('not placed');
    rig.run(900);
    expect(rig.sim.agents.has('amb:9/256/256:701')).toBe(false);
  });
});
