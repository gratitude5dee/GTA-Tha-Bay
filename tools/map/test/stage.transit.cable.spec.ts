import { describe, expect, it } from 'vitest';
import { loadContentWorld, type ContentWorld } from '../src/content.ts';
import { buildEdgeGraph } from '../src/graph/route.ts';
import { runTransit } from '../src/stages/s10-transit.ts';
import { BOX, net, resetIds, way } from './net-fixtures.ts';

const content = loadContentWorld();

function cable(osm: ReturnType<typeof way>[], lines: ContentWorld['cablecars']['lines']) {
  const { roads, junctions } = net(osm);
  const graph = buildEdgeGraph(roads.edges, junctions.junctions, (n) => junctions.nodes[n]!.junction, (e) => roads.segs[e.seg]!.lengthM, (n) => junctions.nodes[n]!.out);
  const withLines = { ...content, cablecars: { ...content.cablecars, lines } } as ContentWorld;
  return runTransit({
    bakeId: 'a'.repeat(64), osm, routes: [], stops: [], segs: roads.segs, edges: roads.edges, nodes: junctions.nodes, graph, content: withLines, box: BOX, requireCablecars: true,
  });
}

const ringAt = (cx: number, cz: number, r: number): number[] => {
  const pts: number[] = [];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * 2 * Math.PI; pts.push(cx + r * Math.cos(a), cz + r * Math.sin(a)); }
  pts.push(pts[0]!, pts[1]!);
  return pts;
};

/** Alpha Street west to east; Beta crosses it at x = 150; Gamma runs north-south at x = 410, past the end of Alpha (x = 300). */
const streets = (): ReturnType<typeof way>[] => [
  way([0, 0, 150, 0], { highway: 'primary', name: 'Alpha Street' }, 'w1'),
  way([150, 0, 300, 0], { highway: 'primary', name: 'Alpha Street' }, 'w2'),
  way([150, -100, 150, 0], { highway: 'secondary', name: 'Beta Street' }, 'w3'),
  way([150, 0, 150, 100], { highway: 'secondary', name: 'Beta Street' }, 'w4'),
  way([410, -100, 410, 0], { highway: 'secondary', name: 'Gamma Street' }, 'w5'),
  way([410, 0, 410, 100], { highway: 'secondary', name: 'Gamma Street' }, 'w6'),
];
const rail = (endX: number): ReturnType<typeof way> => way([150, 0, 300, 0, endX, 0], { railway: 'tram', cable_tram: 'cable' }, 'w800');
const LINE = [{ id: 'cc.test-end', legs: [{ street: 'Alpha Street', from: 'Beta Street', to: 'Gamma Street' }] }];

describe('S10 cable-car legs walk the cable rails and end at the turntable (DL-710)', () => {
  it('resolves a chain end with no shared street node to the turntable and reaches it over the rails', () => {
    resetIds();
    const osm = [...streets(), rail(402), way(ringAt(405, 0, 3), { railway: 'turntable' }, 'w900')];
    const { routes, report } = cable(osm, LINE);
    expect(report.cablecarMissing).toEqual([]);
    expect(report.cablecarOff).toEqual([]);
    const pts = routes.cablecar[0]!.points;
    expect(Math.hypot(pts[0]! - 150, pts[1]!)).toBeLessThan(1);                 // the Beta crossing
    expect(Math.hypot(pts[pts.length - 2]! - 405, pts[pts.length - 1]!)).toBeLessThan(2);   // the turntable centre, 105 m past the end of Alpha
    expect(report.cablecarCheck[0]).toMatchObject({ id: 'cc.test-end', turntables: ['w900'] });
    expect(report.cablecarCheck[0]!.worstM).toBeLessThanOrEqual(6);
  });

  it('reports the chain as missing when there is neither a street node nor a turntable', () => {
    resetIds();
    const { routes, report } = cable([...streets(), rail(402)], LINE);
    expect(routes.cablecar).toEqual([]);
    expect(report.cablecarMissing).toEqual(['cc.test-end']);
  });

  it('fails the 6 m check when the track stops far short of the turntable and the spline crosses open ground', () => {
    resetIds();
    // the rail ends 19 m from the turntable centre: the link in between is more than 6 m from rail and ring
    const osm = [...streets(), rail(386), way(ringAt(405, 0, 3), { railway: 'turntable' }, 'w900')];
    const { report } = cable(osm, LINE);
    expect(report.cablecarOff).toEqual(['cc.test-end']);
    expect(report.cablecarCheck[0]!.worstM).toBeGreaterThan(6);
  });

  it('ignores sidings and tunnel sections of the cable rails', () => {
    resetIds();
    const osm = [
      ...streets(), way([150, 0, 300, 0, 402, 0], { railway: 'tram', cable_tram: 'cable', service: 'siding' }, 'w801'),
      way(ringAt(405, 0, 3), { railway: 'turntable' }, 'w900'),
    ];
    const { report } = cable(osm, LINE);
    expect(report.cablecarMissing).toEqual(['cc.test-end']);
  });
});
