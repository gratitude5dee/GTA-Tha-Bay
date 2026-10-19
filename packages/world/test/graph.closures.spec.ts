import { describe, expect, it } from 'vitest';
import { Fnv64, type ChunkKey } from '@dv/shared';
import { ByteReader, ByteWriter } from '@dv/engine/sim';
import { RoadNetwork } from '../src/sim/graph/adjacency.ts';
import { RoadGraph } from '../src/sim/graph/query.ts';
import { Blackout } from '../src/sim/env/blackout.ts';
import { TrafficControlImpl, type ClosureChange } from '../src/sim/traffic/control.ts';
import { chunkOf, roads, topologyOf } from './fixtures/roads.ts';

const NODES: [number, number][] = [[-100, 0], [-50, 0], [0, -50], [0, 50], [50, 0], [100, 0]];
const fixture = () => roads(NODES, [
  { a: 0, b: 1, twoWay: false }, { a: 1, b: 2, twoWay: false }, { a: 1, b: 3, twoWay: false }, { a: 2, b: 4, twoWay: false }, { a: 3, b: 4, twoWay: false }, { a: 4, b: 5, twoWay: false },
]);

function setup() {
  const f = fixture();
  const net = new RoadNetwork(topologyOf(f));
  net.addChunk(chunkOf('9/256/256' as ChunkKey, f));
  const blackout = new Blackout();
  const tc = new TrafficControlImpl(blackout);
  const g = new RoadGraph(net, { tick: () => 0, blackout: () => tc.blackout, closed: (e) => tc.isClosed(e) });
  const events: ClosureChange[] = [];
  tc.onClosureChange((e) => events.push(e));
  return { f, g, tc, events, blackout };
}

const route = (g: RoadGraph) => g.route({ from: { edge: 0, s: 1, lane: 0 }, to: { edge: 5, s: 1, lane: 0 }, maxExpand: 1000 })!.edges;

describe('TrafficControl closures', () => {
  it('closes edges for planning, notifies the listeners and reopens them on release', () => {
    const { g, tc, events } = setup();
    expect(route(g)).toEqual([0, 1, 3, 5]);
    tc.closeEdges([3, 1], 'race');
    expect(events).toEqual([{ edges: [1, 3], closed: true, by: 'race' }]);
    expect(tc.isClosed(1)).toBe(true);
    expect(route(g)).toEqual([0, 2, 4, 5]);   // the other way round
    tc.closeEdges([2], 'barrier');
    expect(g.route({ from: { edge: 0, s: 1, lane: 0 }, to: { edge: 5, s: 1, lane: 0 }, maxExpand: 1000 })).toBeNull();   // both ways shut
    tc.release('barrier');
    tc.release('race');
    expect(events.filter((e) => e.by === 'race')).toEqual([{ edges: [1, 3], closed: true, by: 'race' }, { edges: [1, 3], closed: false, by: 'race' }]);
    expect(tc.isClosed(1)).toBe(false);
    expect(route(g)).toEqual([0, 1, 3, 5]);
  });

  it('keeps an edge closed while any owner holds it, and lists only what each owner changed', () => {
    const { tc, events } = setup();
    tc.closeEdges([1, 2], 'a');
    tc.closeEdges([2, 3], 'b');
    expect(events.map((e) => e.edges)).toEqual([[1, 2], [2, 3]]);
    tc.release('a');
    expect(events[2]).toEqual({ edges: [1, 2], closed: false, by: 'a' });
    expect(tc.isClosed(2)).toBe(true);
    expect(tc.isClosed(1)).toBe(false);
    expect(tc.closedEdges()).toEqual([2, 3]);
    tc.reopenEdges([3], 'b');
    expect(tc.closedBy('b')).toEqual([2]);
    tc.release('nobody');
    expect(events).toHaveLength(4);
  });

  it('closes an edge once per owner and ignores empty owners and bad ids', () => {
    const { tc, events } = setup();
    tc.closeEdges([1, 1, 1], 'x');
    tc.closeEdges([1], 'x');
    tc.closeEdges([2], '');
    tc.closeEdges([-1, 2.5], 'x');
    expect(events).toEqual([{ edges: [1], closed: true, by: 'x' }]);
  });
});

describe('TrafficControl density and blackout', () => {
  it('clamps density to 0 to 1.5 and lets the newest override win until it is released', () => {
    const { tc } = setup();
    expect(tc.densityOf('traffic')).toBe(1);
    tc.setDensity('traffic', 3, 'sandbox');
    expect(tc.densityOf('traffic')).toBe(1.5);
    tc.setDensity('traffic', 0.35, 'mission');
    expect(tc.densityOf('traffic')).toBe(0.35);
    tc.setDensity('traffic', -2, 'event');
    expect(tc.densityOf('traffic')).toBe(0);
    tc.release('event');
    expect(tc.densityOf('traffic')).toBe(0.35);
    tc.release('mission');
    expect(tc.densityOf('traffic')).toBe(1.5);
    tc.setDensity('ped', Number.NaN, 'x');
    expect(tc.densityOf('ped')).toBe(1);
    tc.release('sandbox');
    expect(tc.densityOf('traffic')).toBe(1);
  });

  it('adopts the blackout resource: owners hold it, release drops only their hold', () => {
    const { tc, blackout } = setup();
    tc.setBlackout(true, 'mission');
    tc.setBlackout(true, 'debug');
    expect(tc.blackout).toBe(true);
    expect(blackout.owners()).toEqual(['debug', 'mission']);
    tc.release('mission');
    expect(tc.blackout).toBe(true);
    tc.setBlackout(false, 'debug');
    expect(tc.blackout).toBe(false);
  });
});

describe('TrafficControl resource', () => {
  const hashOf = (tc: TrafficControlImpl): string => {
    const h = new Fnv64();
    tc.resource().hash(h);
    return h.hex();
  };

  it('hashes and checkpoints densities and closures, independent of the order they were set in', () => {
    const a = setup().tc;
    const b = setup().tc;
    a.closeEdges([3, 1], 'x');
    a.closeEdges([2], 'a');
    a.setDensity('ped', 0.5, 'm');
    b.setDensity('ped', 0.5, 'm');
    b.closeEdges([2], 'a');
    b.closeEdges([1, 3], 'x');
    expect(hashOf(a)).toBe(hashOf(b));
    a.setDensity('ped', 0.6, 'm');
    expect(hashOf(a)).not.toBe(hashOf(b));

    const w = new ByteWriter();
    b.resource().save(w);
    const c = setup().tc;
    c.resource().load(new ByteReader(w.toBytes()));
    expect(hashOf(c)).toBe(hashOf(b));
    expect(c.closedEdges()).toEqual([1, 2, 3]);
    expect(c.densityOf('ped')).toBe(0.5);
    c.release('x');
    expect(c.closedEdges()).toEqual([2]);
  });
});
