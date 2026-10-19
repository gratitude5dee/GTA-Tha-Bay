import { describe, expect, it } from 'vitest';
import { NodeControl, fnv32, signalAspect } from '../../../packages/shared/src/index.ts';
import { groupByHeading } from '../src/stages/s6-signals.ts';
import { crossing, net, point, resetIds, way } from './net-fixtures.ts';

/** Two side streets (North, South names differ so only distance and a shared main street decide) meeting Main at x = 0 and x = gap. */
function twoTees(gap: number): ReturnType<typeof way>[] {
  const main = { highway: 'residential', name: 'Main Street' };
  const side = (x: number, name: string): ReturnType<typeof way> => way([x, -100, x, 0], { highway: 'residential', name });
  return [
    way([-120, 0, 0, 0], main, 'w1'), way([0, 0, gap, 0], main, 'w2'), way([gap, 0, gap + 120, 0], main, 'w3'),
    side(0, 'North One'), side(gap, 'North Two'),
  ];
}

describe('S6 junction merging', () => {
  it('merges nodes 20 m apart on one intersection and keeps nodes 30 m apart', () => {
    resetIds();
    const near = net(twoTees(20));
    expect(near.junctions.junctions).toHaveLength(2 + 3);   // one merged junction, three dead ends
    const merged = near.junctions.junctions.find((j) => j.nodes.length === 2)!;
    expect(merged.nodes).toHaveLength(2);
    resetIds();
    const far = net(twoTees(30));
    expect(far.junctions.junctions.filter((j) => j.nodes.length === 2)).toHaveLength(0);
    expect(far.junctions.junctions.filter((j) => j.control !== NodeControl.DeadEnd)).toHaveLength(2);
  });

  it('never merges nodes on different layers', () => {
    resetIds();
    const main = { highway: 'residential', name: 'Main Street' };
    const r = net([
      way([-120, 0, 0, 0], main), way([0, 0, 20, 0], main), way([20, 0, 140, 0], main),
      way([0, -100, 0, 0], { highway: 'residential', name: 'N' }), way([20, -100, 20, 0], { highway: 'residential', name: 'M', layer: '-1', tunnel: 'yes' }),
    ]);
    expect(r.junctions.junctions.filter((j) => j.nodes.length === 2)).toHaveLength(0);
  });

  it('keeps at most 8 approaches per junction', () => {
    resetIds();
    const spokes: ReturnType<typeof way>[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      spokes.push(way([0, 0, Math.cos(a) * 100, Math.sin(a) * 100], { highway: 'residential', name: `Spoke ${k}` }));
    }
    const r = net(spokes);
    expect(r.junctions.report.maxApproaches).toBe(6);
    expect(r.junctions.report.maxApproaches).toBeLessThanOrEqual(8);
  });
});

describe('S6 controls, movements and restrictions', () => {
  it('lets only dead ends U-turn', () => {
    resetIds();
    const r = net(crossing(100));
    for (const j of r.junctions.junctions) {
      if (j.control === NodeControl.DeadEnd) expect(j.movements.map((m) => m.turn)).toEqual(['uturn']);
      else expect(j.movements.some((m) => m.turn === 'uturn')).toBe(false);
    }
    const centre = r.junctions.junctions.find((j) => j.movements.length === 12)!;
    expect(centre.movements.filter((m) => m.turn === 'straight')).toHaveLength(4);
    expect(centre.movements.filter((m) => m.turn === 'left')).toHaveLength(4);
    expect(centre.movements.filter((m) => m.turn === 'right')).toHaveLength(4);
  });

  it('removes exactly the movement a no_left_turn relation names', () => {
    resetIds();
    const base = net(crossing(100));
    const centre0 = base.junctions.junctions.find((j) => j.movements.length === 12)!;
    resetIds();
    // arriving from the west on Main (w1, heading east), left is north: Cross' northern arm (w3)
    const withR = net([...crossing(100), point(0, 0, { type: 'restriction', restriction: 'no_left_turn', from: 'w1', to: 'w3' })]);
    const centre1 = withR.junctions.junctions.find((j) => j.movements.length === 11)!;
    expect(centre1).toBeDefined();
    const key = (r: typeof withR, j: typeof centre1): Set<string> => new Set(j.movements.map((m) => `${r.roads.segs[r.roads.edges[m.inEdge]!.seg]!.osmWay}>${r.roads.segs[r.roads.edges[m.outEdge]!.seg]!.osmWay}:${m.turn}`));
    const all = key(base, centre0), kept = key(withR, centre1);
    const gone = [...all].filter((k) => !kept.has(k));
    expect(gone).toEqual(['1>3:left']);
    expect(withR.junctions.report.restrictionsApplied).toBe(1);
  });

  it('removes the other movements for only_straight_on', () => {
    resetIds();
    const r = net([...crossing(100), point(0, 0, { type: 'restriction', restriction: 'only_straight_on', from: 'w1', to: 'w2' })]);
    const centre = r.junctions.junctions.find((j) => j.movements.length === 10)!;
    const fromW1 = centre.movements.filter((m) => r.roads.segs[r.roads.edges[m.inEdge]!.seg]!.osmWay === 1);
    expect(fromW1.map((m) => m.turn)).toEqual(['straight']);
  });

  it('assigns controls: all-way stop on local x local, minor stop with a stop sign, signal with a signal node', () => {
    resetIds();
    expect(net(crossing(100)).junctions.junctions.find((j) => j.movements.length === 12)!.control).toBe(NodeControl.AllWayStop);
    resetIds();
    const minor = net([...crossing(100, { highway: 'primary' }), point(0, 0, { highway: 'stop' })]);
    const mj = minor.junctions.junctions.find((j) => j.movements.length === 12)!;
    expect(mj.control).toBe(NodeControl.MinorStop);
    expect(mj.stopApproaches).toHaveLength(2);
    resetIds();
    const sig = net([...crossing(100), point(0, 0, { highway: 'traffic_signals' })]);
    expect(sig.junctions.junctions.find((j) => j.movements.length === 12)!.control).toBe(NodeControl.Signal);
    resetIds();
    const yieldNet = net([...crossing(100), point(0, 0, { highway: 'give_way' })]);
    expect(yieldNet.junctions.junctions.find((j) => j.movements.length === 12)!.control).toBe(NodeControl.Yield);
  });

  it('gives each movement conflicts within 2 m, at most 12, never from the same incoming edge', () => {
    resetIds();
    const r = net([...crossing(100), point(0, 0, { highway: 'traffic_signals' })]);
    const j = r.junctions.junctions.find((x) => x.movements.length === 12)!;
    for (const m of j.movements) {
      expect(m.conflicts.length).toBeLessThanOrEqual(12);
      for (const c of m.conflicts) {
        expect(j.movements[c]!.inEdge).not.toBe(m.inEdge);
        expect(j.movements[c]!.conflicts).toContain(m.id);   // symmetric below the cap
      }
    }
    // a left turn crosses the opposing straight movement and every movement of the cross street that it meets
    const left = j.movements.find((m) => m.turn === 'left')!;
    expect(left.conflicts.length).toBeGreaterThan(2);
    // opposing straight movements run on lane-0 points either side of the centre line: no conflict
    const straights = j.movements.filter((m) => m.turn === 'straight');
    const opposite = straights.find((m) => m.inEdge !== straights[0]!.inEdge && r.roads.edges[m.inEdge]!.twin === straights[0]!.outEdge)!;
    expect(straights[0]!.conflicts).not.toContain(opposite.id);
  });
});

describe('S6 signal programs', () => {
  it('gives a 4-way signal 2 phases and a cycle of 2,880 ticks', () => {
    resetIds();
    const r = net([...crossing(100), point(0, 0, { highway: 'traffic_signals' })]);
    const j = r.junctions.junctions.find((x) => x.movements.length === 12)!;
    const p = j.program!;
    expect(p.phases).toHaveLength(2);
    expect(p.cycleTicks).toBe(2880);
    expect(p.phases.map((ph) => [ph.greenTicks, ph.amberTicks, ph.clearTicks])).toEqual([[1200, 180, 60], [1200, 180, 60]]);
    expect(p.phases.map((ph) => ph.startTick)).toEqual([0, 1440]);
    expect(p.offsetTicks).toBe(fnv32(String(j.id)) % 2880);
    expect([...p.phases[0]!.movements, ...p.phases[1]!.movements].sort((a, b) => a - b)).toEqual(j.movements.map((m) => m.id));
    expect(p.pedWalkTicks).toBe((20 - 5) * 60);
  });

  it('gives an arterial through phase 28 s and the cross street 16 s', () => {
    resetIds();
    const r = net([...crossing(100, { highway: 'primary' }), point(0, 0, { highway: 'traffic_signals' })]);
    const j = r.junctions.junctions.find((x) => x.movements.length === 12)!;
    const p = j.program!;
    const clsOfPhase = p.phases.map((ph) => r.roads.edges[j.movements.find((m) => ph.movements.includes(m.id))!.inEdge]!.cls);
    expect(clsOfPhase.sort()).toEqual([2, 4]);
    const greenOf = (cls: number): number => p.phases.find((ph) => r.roads.edges[j.movements.find((m) => ph.movements.includes(m.id))!.inEdge]!.cls === cls)!.greenTicks;
    expect(greenOf(2)).toBe(28 * 60);
    expect(greenOf(4)).toBe(16 * 60);
    expect(p.cycleTicks).toBe((28 + 3 + 1 + 16 + 3 + 1) * 60);
  });

  it('uses 2 phases for a 3-way and 3 phases for five or more approaches', () => {
    resetIds();
    const tee = net([way([-100, 0, 0, 0], { highway: 'residential', name: 'A' }), way([0, 0, 100, 0], { highway: 'residential', name: 'A' }), way([0, -100, 0, 0], { highway: 'residential', name: 'B' }), point(0, 0, { highway: 'traffic_signals' })]);
    expect(tee.junctions.junctions.find((x) => x.program)!.program!.phases).toHaveLength(2);
    resetIds();
    const spokes: ReturnType<typeof way>[] = [point(0, 0, { highway: 'traffic_signals' })] as never[];
    for (let k = 0; k < 5; k++) { const a = (k * 2 * Math.PI) / 5; spokes.push(way([0, 0, Math.cos(a) * 100, Math.sin(a) * 100], { highway: 'residential', name: `S${k}` })); }
    const five = net(spokes);
    expect(five.junctions.junctions.find((x) => x.program)!.program!.phases).toHaveLength(3);
  });

  it('groups opposite headings on one axis and drives signalAspect through a cycle', () => {
    expect(groupByHeading([{ edge: 0, hx: 1, hz: 0, cls: 4 }, { edge: 1, hx: -1, hz: 0, cls: 4 }, { edge: 2, hx: 0, hz: 1, cls: 4 }, { edge: 3, hx: 0, hz: -1, cls: 4 }], 2)).toEqual([[0, 1], [2, 3]]);
    resetIds();
    const r = net([...crossing(100), point(0, 0, { highway: 'traffic_signals' })]);
    const j = r.junctions.junctions.find((x) => x.program)!;
    const p = j.program!;
    const m = p.phases[0]!.movements[0]!;
    const aspects = new Set<string>();
    for (let t = 0; t < p.cycleTicks; t += 30) aspects.add(signalAspect(p, t, m, false));
    expect([...aspects].sort()).toEqual(['amber', 'green', 'red']);
    expect(signalAspect(p, 0, m, true)).toBe('dark');
  });
});
