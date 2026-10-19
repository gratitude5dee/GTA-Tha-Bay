import { describe, expect, it } from 'vitest';
import { RoadClass, latLngFromEnu } from '../../../packages/shared/src/index.ts';
import { runRoads } from '../src/stages/s5-roads.ts';
import { BOX, crossing, net, resetIds, roadCfg, row, way } from './net-fixtures.ts';

/** Ten agreeing one-way pieces so the F/T orientation is adopted, then the pieces under test. */
function agreeing(extra: ReturnType<typeof way>[], extraRows: ReturnType<typeof row>[]): { osm: ReturnType<typeof way>[]; streets: ReturnType<typeof row>[] } {
  const osm: ReturnType<typeof way>[] = [];
  const streets: ReturnType<typeof row>[] = [];
  for (let i = 0; i < 12; i++) {
    const z = 3000 + i * 40;
    osm.push(way([0, z, 100, z], { highway: 'residential', oneway: 'yes', name: `Agree${i}` }));
    streets.push(row([0, z, 100, z], { cnn: 900 + i, streetname: `AGREE${i}`, oneway: 'F' }));
  }
  return { osm: [...osm, ...extra], streets: [...streets, ...extraRows] };
}

describe('S5 one-way rules (DL-705)', () => {
  it('never reverses an OSM one-way, whatever the matched row says', () => {
    resetIds();
    const { osm, streets } = agreeing(
      [way([0, 0, 100, 0], { highway: 'residential', oneway: 'yes', name: 'Along' })],
      [row([100, 0, 0, 0], { cnn: 1, streetname: 'ALONG', oneway: 'F' })],   // digitised east to west and flagged F: travel west, against OSM
    );
    const { roads } = net(osm, streets);
    const seg = roads.segs.find((s) => s.name === 'Along')!;
    expect(seg.oneWay).toBe(1);
    expect(roads.report.oneway.osmKeptAgainstDsf).toBe(1);
    expect(roads.report.oneway.osmKept).toBe(13);
  });

  it('gives no one-way to a piece without a name (the 12 m match may pick any street)', () => {
    resetIds();
    const { osm, streets } = agreeing([way([0, 0, 100, 0], { highway: 'residential' })], [row([0, 2, 100, 2], { cnn: 2, streetname: 'ELSEWHERE', oneway: 'F' })]);
    const { roads } = net(osm, streets);
    const seg = roads.segs.find((s) => s.name === '')!;
    expect(seg.oneWay).toBe(0);
    expect(seg.cnn).toBe(2);   // it may still take the cnn
    expect(roads.report.oneway.unnamedSkipped).toBe(1);
  });

  it('applies a DataSF one-way to a named two-way piece on STREETS and on no other layer', () => {
    resetIds();
    const { osm, streets } = agreeing(
      [way([0, 0, 100, 0], { highway: 'residential', name: 'Plain' }), way([0, 100, 100, 100], { highway: 'trunk', name: 'Fwy' })],
      [row([0, 0, 100, 0], { cnn: 3, streetname: 'PLAIN', oneway: 'F' }), row([0, 100, 100, 100], { cnn: 4, streetname: 'FWY', oneway: 'F', layer: 'FREEWAYS' })],
    );
    const { roads } = net(osm, streets);
    expect(roads.segs.find((s) => s.name === 'Plain')!.oneWay).toBe(1);
    // trunk is two-way in this fixture (only motorways default to one-way) and sits on FREEWAYS: untouched
    expect(roads.segs.find((s) => s.name === 'Fwy')!.oneWay).toBe(0);
    expect(roads.report.oneway.applied).toBe(1);
    expect(roads.report.oneway.otherLayerSkipped).toBe(1);
  });
});

describe('S5 islands (DL-706)', () => {
  const main = (): ReturnType<typeof way>[] => crossing(300);

  it('drops a detached fragment of unmatched service ways (detachedService) and lists it', () => {
    resetIds();
    const { roads } = net([...main(), way([2000, 2000, 2100, 2000], { highway: 'service' }, 'w77'), way([2100, 2000, 2100, 2100], { highway: 'service' }, 'w78')]);
    expect(roads.segs.every((s) => s.osmWay !== 77 && s.osmWay !== 78)).toBe(true);
    const isl = roads.report.islands;
    expect(isl.droppedComponents).toBe(1);
    expect(isl.droppedEdges).toBe(4);
    expect(isl.keptComponents).toBe(0);
    expect(isl.list[0]).toMatchObject({ status: 'dropped', rule: 'detachedService', osmWays: [77, 78], edges: 4 });
    expect(roads.nodes.every((n) => Math.abs(n.x) < 400 && Math.abs(n.z) < 400)).toBe(true);
  });

  it('keeps every other island in the graph, marks it and lists it, with the cnn it carries', () => {
    resetIds();
    const osm = [...main(), way([2000, 2000, 2100, 2000], { highway: 'residential', name: 'Lonely' }, 'w88')];
    const { roads } = net(osm, [row([2000, 2000, 2100, 2000], { cnn: 5150, streetname: 'LONELY' })]);
    const seg = roads.segs.find((s) => s.osmWay === 88)!;
    expect(seg.island).toBe(true);
    expect(roads.segs.filter((s) => s.island === true)).toHaveLength(1);
    expect(roads.report.islands).toMatchObject({ keptComponents: 1, keptEdges: 2, droppedComponents: 0 });
    expect(roads.report.islands.list[0]).toMatchObject({ status: 'kept', rule: 'none', osmWays: [88], cnns: [5150] });
  });

  it('drops a fragment cut at the area box that lies outside every neighbourhood (detachedAtClip), and keeps a service island with a cnn', () => {
    resetIds();
    const osm = [
      ...main(),
      way([BOX.maxX - 200, 5000, BOX.maxX + 300, 5000], { highway: 'residential' }, 'w91'),
      way([3000, 3000, 3100, 3000], { highway: 'service' }, 'w92'),
    ];
    const { roads } = net(osm, [row([3000, 3000, 3100, 3000], { cnn: 77, streetname: '' })]);
    const list = roads.report.islands.list;
    expect(list.find((i) => i.osmWays.includes(91))).toMatchObject({ status: 'dropped', rule: 'detachedAtClip', touchesClip: true });
    // a service island with a DataSF cnn is not a declared drop: it stays and is counted
    expect(list.find((i) => i.osmWays.includes(92))).toMatchObject({ status: 'kept', rule: 'none' });
    expect(roads.segs.some((s) => s.osmWay === 91)).toBe(false);
  });

  it('declares exactly the two drop rules in roadclass.json', () => {
    expect(roadCfg.islands).toEqual({ detachedService: true, detachedAtClip: true });
  });

  it('turns the rules off from the config', () => {
    resetIds();
    const cfg = { ...roadCfg, islands: { detachedService: false, detachedAtClip: false } };
    const r = runRoads({ osm: [...main(), way([2000, 2000, 2100, 2000], { highway: 'service' }, 'w77')], streets: [], hoods: [], cfg, box: BOX });
    expect(r.report.islands.droppedComponents).toBe(0);
    expect(r.report.islands.keptComponents).toBe(1);
  });
});

describe('S5 road-fixes: keepWays and connectors (DL-706)', () => {
  it('keeps a public way whose DataSF row sits on an excluded layer, and a private way, when listed', () => {
    resetIds();
    const osm = [...crossing(300), way([0, 300, 0, 600], { highway: 'residential', name: 'Joiner' }, 'w50'), way([0, 600, 0, 900], { highway: 'residential', access: 'private' }, 'w51')];
    const streets = [row([0, 300, 0, 600], { cnn: 15101000, streetname: 'JOINER', layer: 'PRIVATE' })];
    const without = net(osm, streets);
    expect(without.roads.segs.some((s) => s.osmWay === 50 || s.osmWay === 51)).toBe(false);
    const fixes = { keepWays: [{ osmWay: 50, reason: 'public street dropped through a PRIVATE row' }, { osmWay: 51, reason: 'service gate, open to traffic' }], connectors: [] };
    const kept = net(osm, streets, fixes);
    const seg = kept.roads.segs.find((s) => s.osmWay === 50)!;
    expect(seg.cnn).toBe(0);   // the excluded row is not adopted
    expect(kept.roads.segs.some((s) => s.osmWay === 51)).toBe(true);
    expect(kept.roads.report.islands.keepWaysApplied).toEqual([50, 51]);
    expect(kept.roads.report.islands.keptComponents).toBe(0);   // both join the grid through shared vertices
  });

  it('joins a detached street with an authored connector between OSM vertices', () => {
    resetIds();
    const at = (x: number, z: number): { lat: number; lng: number } => latLngFromEnu(x, z);
    const osm = [...crossing(300), way([1000, 1000, 1100, 1000], { highway: 'residential', name: 'Far' }, 'w60')];
    const lone = net(osm).roads;
    expect(lone.report.islands.keptComponents).toBe(1);
    // the connector runs from the west end of Main Street at (-300, 0) to the west end of the far street, through (1000, 1000)
    const fixes = { keepWays: [], connectors: [{ id: 'test.link', reason: 'public street cut off by a construction way', highway: 'residential', points: [at(-300, 0), at(1000, 1000)] }] };
    const joined = net(osm, [], fixes).roads;
    expect(joined.report.islands.keptComponents).toBe(0);
    expect(joined.report.islands.connectorsApplied).toEqual(['test.link']);
    expect(joined.segs.some((s) => s.osmWay === 0)).toBe(true);
  });
});

describe('S5 box-clip ends carry their side', () => {
  it('marks nodes made by a cut with the box side (1 west, 2 east, 3 north, 4 south)', () => {
    resetIds();
    const cfg = { ...roadCfg, islands: { detachedService: false, detachedAtClip: false } };
    const roads = runRoads({
      osm: [way([BOX.maxX - 100, 0, BOX.maxX + 100, 0], { highway: 'residential' }, 'w1'), way([0, BOX.minZ + 100, 0, BOX.minZ - 100], { highway: 'residential' }, 'w2')],
      streets: [], hoods: [], cfg, box: BOX,
    });
    const sides = roads.nodes.filter((n) => n.clip !== undefined).map((n) => n.clip).sort();
    expect(sides).toEqual([2, 3]);
    expect(roads.segs.every((s) => s.cls === RoadClass.Local)).toBe(true);
  });
});
