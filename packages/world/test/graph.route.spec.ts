import { describe, expect, it } from 'vitest';
import { NodeControl, RoadClass, type ChunkKey, type EdgeId } from '@dv/shared';
import { RoadNetwork } from '../src/sim/graph/adjacency.ts';
import { RoadGraph } from '../src/sim/graph/query.ts';
import { MinHeap } from '../src/sim/graph/heap.ts';
import { chunkOf, junctionAt, roads, topologyOf, type RoadFixture, type Street } from './fixtures/roads.ts';

const CH = '9/256/256' as ChunkKey;

function graphOf(f: RoadFixture, o: { resident?: boolean; topology?: boolean; closed?: ReadonlySet<EdgeId> } = {}): RoadGraph {
  const net = new RoadNetwork(o.topology === false ? null : topologyOf(f));
  if (o.resident !== false) net.addChunk(chunkOf(CH, f));
  const closed = o.closed ?? new Set<EdgeId>();
  return new RoadGraph(net, { tick: () => 0, blackout: () => false, closed: (e) => closed.has(e) });
}

/** S - A, then A to D by way of B (north) or C (south), then D - T; every street one-way and equally long on both ways. */
const DIAMOND_NODES: [number, number][] = [[-100, 0], [-50, 0], [0, -50], [0, 50], [50, 0], [100, 0]];
const S = 0, A = 1, B = 2, C = 3, D = 4, T = 5;

describe('MinHeap', () => {
  it('pops by key, then by id', () => {
    const h = new MinHeap();
    for (const [k, id] of [[5, 9], [3, 4], [3, 2], [7, 1], [3, 3], [1, 8]] as const) h.push(k, id);
    const out: number[][] = [];
    for (let p = h.pop(); p; p = h.pop()) out.push([p.key, p.id]);
    expect(out).toEqual([[1, 8], [3, 2], [3, 3], [3, 4], [5, 9], [7, 1]]);
  });
});

describe('A* route', () => {
  const diamond = (order: 'bFirst' | 'cFirst'): { f: RoadFixture; goal: EdgeId; via: EdgeId[] } => {
    const streets: Street[] = [{ a: S, b: A, twoWay: false }];
    if (order === 'bFirst') streets.push({ a: A, b: B, twoWay: false }, { a: A, b: C, twoWay: false }, { a: B, b: D, twoWay: false }, { a: C, b: D, twoWay: false });
    else streets.push({ a: A, b: C, twoWay: false }, { a: A, b: B, twoWay: false }, { a: C, b: D, twoWay: false }, { a: B, b: D, twoWay: false });
    streets.push({ a: D, b: T, twoWay: false });
    const f = roads(DIAMOND_NODES, streets);
    return { f, goal: 5, via: order === 'bFirst' ? [1, 3] : [1, 3] };
  };

  for (const mode of ['resident only', 'topology only', 'resident and topology'] as const) {
    it(`returns the shortest route and breaks an exact tie by the lower edge id (${mode})`, () => {
      for (const order of ['bFirst', 'cFirst'] as const) {
        const { f, goal, via } = diamond(order);
        const g = graphOf(f, { resident: mode !== 'topology only', topology: mode !== 'resident only' });
        const r = g.route({ from: { edge: 0, s: 10 }, to: { edge: goal, s: 20 }, maxExpand: 1000, useTopology: mode === 'topology only' });
        expect(r).not.toBeNull();
        // the lower ids sit on the first street built after the entry edge, whichever way round it lies
        expect(r!.edges).toEqual([0, ...via, goal]);
        expect(r!.complete).toBe(true);
        const seg = (e: EdgeId): number => f.segments[f.edges[e]!.seg]!.lengthM;
        expect(r!.lengthM).toBeCloseTo(seg(0) - 10 + seg(via[0]!) + seg(via[1]!) + 20, 0);
        expect(r!.etaS).toBeGreaterThan(0);
      }
    });
  }

  it('takes the 128 m detour over the 300 m loop, and the loop when it is the goal', () => {
    // 1 to 2 is 300 m round a loop; 1 - 3 - 2 is a 128 m detour
    const f = roads([[-100, 0], [0, 0], [100, 0], [50, 40]], [
      { a: 0, b: 1 }, { a: 1, b: 2, via: [0, 100, 100, 100] }, { a: 1, b: 3 }, { a: 3, b: 2 },
    ]);
    const g = graphOf(f);
    const r = g.route({ from: { edge: 0, s: 5 }, to: { edge: f.ids[1]![0], s: 1 }, maxExpand: 1000 });
    expect(r!.edges).toEqual([0, f.ids[1]![0]]);
    const r2 = g.route({ from: { edge: 0, s: 5 }, to: { edge: f.ids[3]![0], s: 1 }, maxExpand: 1000 });
    expect(r2!.edges).toEqual([0, f.ids[2]![0], f.ids[3]![0]]);
  });

  it('is the same route on every call and with the topology only', () => {
    const { f, goal } = diamond('bFirst');
    const a = graphOf(f, { resident: false }).route({ from: { x: -95, z: 2 }, to: { x: 98, z: -1 }, maxExpand: 1000, useTopology: true });
    const b = graphOf(f, { resident: true }).route({ from: { x: -95, z: 2 }, to: { x: 98, z: -1 }, maxExpand: 1000, useTopology: true });
    expect(a).toEqual(b);
    expect(a!.edges[0]).toBe(0);
    expect(a!.edges[a!.edges.length - 1]).toBe(goal);
  });

  it('avoids `avoid` edges, closed edges and masked classes, but not its own start and goal', () => {
    const { f, goal } = diamond('bFirst');
    const base = graphOf(f);
    expect(base.route({ from: { edge: 0, s: 1 }, to: { edge: goal, s: 1 }, maxExpand: 1000 })!.edges).toEqual([0, 1, 3, 5]);
    expect(base.route({ from: { edge: 0, s: 1 }, to: { edge: goal, s: 1 }, maxExpand: 1000, avoid: new Set([3]) })!.edges).toEqual([0, 2, 4, 5]);
    const closed = graphOf(f, { closed: new Set([1]) });
    expect(closed.route({ from: { edge: 0, s: 1 }, to: { edge: goal, s: 1 }, maxExpand: 1000 })!.edges).toEqual([0, 2, 4, 5]);
    // closing the goal or the start edge does not make them unreachable
    const ends = graphOf(f, { closed: new Set([0, goal]) });
    expect(ends.route({ from: { edge: 0, s: 1 }, to: { edge: goal, s: 1 }, maxExpand: 1000 })!.edges).toEqual([0, 1, 3, 5]);
    // both ways closed: no route
    const both = graphOf(f, { closed: new Set([1, 2]) });
    expect(both.route({ from: { edge: 0, s: 1 }, to: { edge: goal, s: 1 }, maxExpand: 1000 })).toBeNull();
    // class mask: the north way is Local, the south way Arterial; arterials only
    const mixed = roads(DIAMOND_NODES, [
      { a: S, b: A, twoWay: false, cls: RoadClass.Arterial }, { a: A, b: B, twoWay: false, cls: RoadClass.Local }, { a: A, b: C, twoWay: false, cls: RoadClass.Arterial },
      { a: B, b: D, twoWay: false, cls: RoadClass.Local }, { a: C, b: D, twoWay: false, cls: RoadClass.Arterial }, { a: D, b: T, twoWay: false, cls: RoadClass.Arterial },
    ]);
    const mg = graphOf(mixed);
    expect(mg.route({ from: { edge: 0, s: 1 }, to: { edge: 5, s: 1 }, maxExpand: 1000 })!.edges).toEqual([0, 1, 3, 5]);
    expect(mg.route({ from: { edge: 0, s: 1 }, to: { edge: 5, s: 1 }, maxExpand: 1000, classMask: 1 << RoadClass.Arterial })!.edges).toEqual([0, 2, 4, 5]);
    expect(mg.route({ from: { edge: 0, s: 1 }, to: { edge: 5, s: 1 }, maxExpand: 1000, classMask: 1 << RoadClass.Freeway })).toBeNull();
  });

  it('drives a one-way edge the wrong way only with allowWrongWay', () => {
    // a one-way square loop A -> B -> C -> D -> A, counter-clockwise
    const f = roads([[0, 0], [100, 0], [100, 100], [0, 100]], [
      { a: 0, b: 1, twoWay: false }, { a: 1, b: 2, twoWay: false }, { a: 2, b: 3, twoWay: false }, { a: 3, b: 0, twoWay: false },
    ]);
    const g = graphOf(f);
    const fwd = g.routeDetailed({ from: { edge: 1, s: 10 }, to: { edge: 0, s: 50 }, maxExpand: 1000 })!;
    expect(fwd.edges).toEqual([1, 2, 3, 0]);
    expect(fwd.wrongWay).toEqual([false, false, false, false]);
    expect(fwd.lengthM).toBeCloseTo(90 + 100 + 100 + 50, 0);
    const back = g.routeDetailed({ from: { edge: 1, s: 10 }, to: { edge: 0, s: 50 }, maxExpand: 1000, allowWrongWay: true })!;
    expect(back.edges).toEqual([1, 0]);
    expect(back.wrongWay).toEqual([true, true]);
    expect(back.lengthM).toBeCloseTo(10 + 50, 0);
    expect(back.complete).toBe(true);
  });

  it('uses a dead end to turn round, and never a U-turn elsewhere', () => {
    // 0 - 1 - 2, plus 1 - 3 a short dead end; from the segment 0-1 to the segment 1-0 backwards needs a U-turn at the end of 1-2
    const f = roads([[0, 0], [100, 0], [200, 0], [100, 60]], [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 1, b: 3 }]);
    const g = graphOf(f);
    const r = g.route({ from: { edge: f.ids[0]![0], s: 50 }, to: { edge: f.ids[0]![1], s: 20 }, maxExpand: 1000 });
    expect(r).not.toBeNull();
    // out along 0 -> 1, into the nearer dead end (1 -> 3, 60 m; 1 -> 2 is 100 m) and back, then 1 -> 0 on the twin
    expect(r!.edges).toEqual([f.ids[0]![0], f.ids[2]![0], f.ids[2]![1], f.ids[0]![1]]);
  });

  it('follows the resident junction movements but not with useTopology', () => {
    // a plus junction at node 4: west 0, east 1, north 2, south 3; the resident movements allow west to east and north to south
    // (and the straight ways back), so the south exit cannot be reached from the west
    const f = roads([[-80, 0], [80, 0], [0, -80], [0, 80], [0, 0]], [{ a: 0, b: 4 }, { a: 4, b: 1 }, { a: 2, b: 4 }, { a: 4, b: 3 }]);
    const westIn = f.ids[0]![0], westOut = f.ids[0]![1], eastOut = f.ids[1]![0], eastIn = f.ids[1]![1];
    const northIn = f.ids[2]![0], northOut = f.ids[2]![1], southOut = f.ids[3]![0], southIn = f.ids[3]![1];
    const j = junctionAt(0, f, 4, [[westIn, eastOut], [eastIn, westOut], [northIn, southOut], [southIn, northOut]]);
    const net = new RoadNetwork(topologyOf(f));
    net.addChunk(chunkOf(CH, f, { junctions: [j] }));
    const g = new RoadGraph(net, { tick: () => 0, blackout: () => false, closed: () => false });
    expect(g.route({ from: { edge: westIn, s: 10 }, to: { edge: southOut, s: 10 }, maxExpand: 1000 })).toBeNull();
    expect(g.route({ from: { edge: westIn, s: 10 }, to: { edge: southOut, s: 10 }, maxExpand: 1000, useTopology: true })!.edges).toEqual([westIn, southOut]);
    expect(g.route({ from: { edge: westIn, s: 10 }, to: { edge: eastOut, s: 10 }, maxExpand: 1000 })!.edges).toEqual([westIn, eastOut]);
    expect(g.route({ from: { edge: northIn, s: 10 }, to: { edge: southOut, s: 10 }, maxExpand: 1000 })!.edges).toEqual([northIn, southOut]);
  });

  it('continues on the topology graph past the resident chunks', () => {
    // a straight street over three chunks (x -200 .. 600); only the middle chunk is resident
    const nodes: [number, number][] = [[-100, 0], [100, 0], [300, 0], [500, 0]];
    const f = roads(nodes, [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }]);
    const net = new RoadNetwork(topologyOf(f));
    net.addChunk(chunkOf('9/257/256' as ChunkKey, f));
    const g = new RoadGraph(net, { tick: () => 0, blackout: () => false, closed: () => false });
    expect(net.hasChunk('9/257/256' as ChunkKey)).toBe(true);
    expect(net.resident(f.ids[0]![0])).toBeUndefined();
    const r = g.route({ from: { x: -90, z: 2 }, to: { x: 495, z: 3 }, maxExpand: 100 });
    expect(r!.edges).toEqual([f.ids[0]![0], f.ids[1]![0], f.ids[2]![0]]);
    expect(r!.complete).toBe(true);
    expect(r!.lengthM).toBeCloseTo(585, 0);
    // geometry of a non-resident edge is its chord
    const out = new Float64Array(4);
    g.laneCentre({ edge: f.ids[0]![0], s: 100, lane: 0 }, out);
    expect(out[0]).toBeCloseTo(0, 0);
  });

  it('stops at maxExpand with complete false and a route that leads toward the goal', () => {
    const nodes: [number, number][] = Array.from({ length: 21 }, (_v, i) => [-100 + i * 10, 0]);
    const streets: Street[] = Array.from({ length: 20 }, (_v, i) => ({ a: i, b: i + 1, twoWay: false }));
    const f = roads(nodes, streets);
    const g = graphOf(f);
    const full = g.route({ from: { edge: 0, s: 1 }, to: { edge: 19, s: 5 }, maxExpand: 1000 })!;
    expect(full.complete).toBe(true);
    expect(full.edges.length).toBe(20);
    const cut = g.route({ from: { edge: 0, s: 1 }, to: { edge: 19, s: 5 }, maxExpand: 5 })!;
    expect(cut.complete).toBe(false);
    expect(cut.edges.length).toBeGreaterThan(1);
    expect(cut.edges.length).toBeLessThan(20);
    expect(cut.edges).toEqual(full.edges.slice(0, cut.edges.length));
    // an unreachable goal with enough budget is null, not incomplete
    const island = roads([[0, 0], [10, 0], [500, 0], [510, 0]], [{ a: 0, b: 1, twoWay: false }, { a: 2, b: 3, twoWay: false }]);
    expect(graphOf(island).route({ from: { edge: 0, s: 1 }, to: { edge: 1, s: 1 }, maxExpand: 1000 })).toBeNull();
  });

  it('routes within one edge when the goal lies ahead of the start', () => {
    const f = roads([[0, 0], [100, 0]], [{ a: 0, b: 1, twoWay: false }]);
    const r = graphOf(f).route({ from: { edge: 0, s: 20 }, to: { edge: 0, s: 70 }, maxExpand: 10 })!;
    expect(r.edges).toEqual([0]);
    expect(r.lengthM).toBeCloseTo(50, 5);
    expect(r.etaS).toBeCloseTo(5, 5);
  });
});

describe('nearest edge, lane centre and signals', () => {
  it('picks the lane side, honours the height of a layer, and reports the distance', () => {
    const f = roads([[-100, 0], [100, 0], [-100, 30], [100, 30]], [{ a: 0, b: 1 }, { a: 2, b: 3, ya: 9, yb: 9, layer: 1 }]);
    const g = graphOf(f);
    // travelling east, right is south (+z): a point south of the centreline belongs to the eastbound edge
    const south = g.nearestEdge(0, 2, undefined, 30)!;
    const north = g.nearestEdge(0, -2, undefined, 30)!;
    expect(south.edge).toBe(f.ids[0]![0]);
    expect(north.edge).toBe(f.ids[0]![1]);
    expect(south.distM).toBeCloseTo(2, 5);
    expect(south.s).toBeCloseTo(100, 0);
    expect(north.s).toBeCloseTo(100, 0);
    // the overpass line is 30 m north and 9 m up; a point in the air at its height finds it, one on the ground finds the street
    expect(g.nearestEdge(0, 31, 9, 5)!.edge).toBe(f.ids[1]![0]);
    expect(g.nearestEdge(0, 31, 0, 5)).toBeNull();
    expect(g.nearestEdge(0, 31, undefined, 5)!.edge).toBe(f.ids[1]![0]);
    expect(g.nearestEdge(0, 80, undefined, 5)).toBeNull();
  });

  it('places lane centres to the right of travel by the rule of C08 section 1 rule 10', () => {
    const f = roads([[-100, 0], [100, 0], [-100, 40], [100, 40]], [{ a: 0, b: 1, lanes: 2, laneWidthM: 3.5 }, { a: 2, b: 3, twoWay: false, lanes: 3, laneWidthM: 3 }]);
    const g = graphOf(f);
    const out = new Float64Array(4);
    // two-way, eastbound lane 0: median 0, offset 0.5 * 3.5 = 1.75 to the right (south, +z)
    g.laneCentre({ edge: f.ids[0]![0], s: 100, lane: 0 }, out);
    expect([out[0], out[2]]).toEqual([0, 1.75]);
    expect(out[3]).toBeCloseTo(Math.PI * 1.5, 3);   // heading east: yaw 3 pi / 2
    g.laneCentre({ edge: f.ids[0]![0], s: 100, lane: 1 }, out);
    expect(out[2]).toBeCloseTo(1.75 + 3.5, 5);
    // westbound lane 0 sits north of the centreline
    g.laneCentre({ edge: f.ids[0]![1], s: 100, lane: 0 }, out);
    expect(out[2]).toBeCloseTo(-1.75, 5);
    expect(out[3]).toBeCloseTo(Math.PI / 2, 3);
    // one-way, three lanes: (lane + 0.5 - 3 / 2) x 3 m, so lane 1 is the middle one and lane 2 is 3 m to the right
    g.laneCentre({ edge: f.ids[1]![0], s: 100, lane: 1 }, out);
    expect(out[2]).toBeCloseTo(40, 5);
    g.laneCentre({ edge: f.ids[1]![0], s: 100, lane: 0 }, out);
    expect(out[2]).toBeCloseTo(37, 5);
    g.laneCentre({ edge: f.ids[1]![0], s: 100, lane: 2 }, out);
    expect(out[2]).toBeCloseTo(43, 5);
  });

  it('answers signal() from the pure aspect function: dark in a blackout, green where nothing is signalled', () => {
    const f = roads([[-80, 0], [80, 0], [0, 0]], [{ a: 0, b: 2 }, { a: 2, b: 1 }], { 2: NodeControl.Signal });
    const prog = { id: 1, cycleTicks: 600, offsetTicks: 0, pedWalkTicks: 0, phases: [{ startTick: 0, greenTicks: 300, amberTicks: 60, clearTicks: 0, movements: [0] }] };
    const j = junctionAt(7, f, 2, [[f.ids[0]![0], f.ids[1]![0]]], { control: NodeControl.Signal, program: prog });
    const net = new RoadNetwork(topologyOf(f));
    net.addChunk(chunkOf(CH, f, { junctions: [j] }));
    let tick = 0;
    let dark = false;
    const g = new RoadGraph(net, { tick: () => tick, blackout: () => dark, closed: () => false });
    expect(g.signal(2, 0)).toBe('green');
    tick = 310;
    expect(g.signal(2, 0)).toBe('amber');
    tick = 400;
    expect(g.signal(2, 0)).toBe('red');
    dark = true;
    expect(g.signal(2, 0)).toBe('dark');
    expect(g.signal(0, 0)).toBe('green');
    expect(g.neighbours(2)).toEqual([f.ids[1]![0], f.ids[0]![1]].sort((a, b) => a - b));
  });
});
