import { describe, expect, it } from 'vitest';
import { NodeControl } from '../../../packages/shared/src/index.ts';
import { net, resetIds, way } from './net-fixtures.ts';

describe('S6 box-clip ends (DL-705)', () => {
  // two one-way carriageways of a divided road, cut at the east edge of the box: a sink and a source with nothing between them
  const edge = 9000;
  const divided = (gap: number): ReturnType<typeof way>[] => [
    way([edge - 400, 0, edge + 300, 0], { highway: 'primary', oneway: 'yes', name: 'Bridge' }, 'w1'),
    way([edge + 300, gap, edge - 400, gap], { highway: 'primary', oneway: 'yes', name: 'Bridge' }, 'w2'),
    // the west end joins the carriageways, so the pair is not a detached fragment
    way([edge - 400, gap, edge - 400, 0], { highway: 'primary', oneway: 'yes', name: 'Turn' }, 'w3'),
  ];

  it('joins the sink to the nearest source on the same box side through one DeadEnd junction with a U-turn', () => {
    resetIds();
    const { roads, junctions } = net(divided(14));
    expect(junctions.report.clipPairs).toBe(1);   // one sink, one source: one pair
    expect(junctions.report.clipSinksUnpaired).toBe(0);
    const j = junctions.junctions.find((q) => q.nodes.length === 2 && q.control === NodeControl.DeadEnd)!;
    expect(j).toBeDefined();
    const sink = roads.nodes.find((n) => n.clip === 2 && n.out.length === 0)!;
    const source = roads.nodes.find((n) => n.clip === 2 && n.in.length === 0)!;
    expect([...j.nodes].sort((a, b) => a - b)).toEqual([sink.id, source.id].sort((a, b) => a - b));
    const turn = j.movements.find((m) => m.inEdge === sink.in[0] && m.outEdge === source.out[0])!;
    expect(turn).toBeDefined();
    expect(turn.turn).toBe('uturn');
  });

  it('does not join ends more than 150 m apart', () => {
    resetIds();
    const far = net(divided(200));
    expect(far.junctions.report.clipPairs).toBe(0);
    expect(far.junctions.report.clipSinksUnpaired).toBe(1);
    expect(far.junctions.junctions.every((q) => q.nodes.length === 1)).toBe(true);
  });
});
