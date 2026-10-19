import { describe, expect, it } from 'vitest';
import { RoadClass, EdgeFlag } from '../../../packages/shared/src/index.ts';
import { adoptOrientation, normalizeStreetName, parseMaxspeed, runRoads, type OnewayPair } from '../src/stages/s5-roads.ts';
import { BOX, crossing, net, point, resetIds, roadCfg, row, way } from './net-fixtures.ts';

describe('S5 classes, lanes, widths and parking follow roadclass.json', () => {
  const cases: { name: string; tags: Record<string, string>; cls: RoadClass; lanes: number; speed: number; parking: 0 | 1 | 2 }[] = [
    { name: 'motorway', tags: { highway: 'motorway' }, cls: RoadClass.Freeway, lanes: 2, speed: 24.5, parking: 0 },
    { name: 'motorway with lanes=6', tags: { highway: 'motorway', lanes: '6', oneway: 'yes' }, cls: RoadClass.Freeway, lanes: 6, speed: 24.5, parking: 0 },
    { name: 'ramp', tags: { highway: 'motorway_link' }, cls: RoadClass.Ramp, lanes: 1, speed: 15.5, parking: 0 },
    { name: 'primary', tags: { highway: 'primary' }, cls: RoadClass.Arterial, lanes: 2, speed: 13.5, parking: 2 },
    { name: 'primary lanes=4, 30 mph', tags: { highway: 'primary', lanes: '4', maxspeed: '30 mph' }, cls: RoadClass.Arterial, lanes: 2, speed: 13.5, parking: 2 },
    { name: 'tertiary', tags: { highway: 'tertiary' }, cls: RoadClass.Collector, lanes: 1, speed: 11.25, parking: 2 },
    { name: 'residential, parking only on one side', tags: { highway: 'residential', 'parking:lane:left': 'no' }, cls: RoadClass.Local, lanes: 1, speed: 11.25, parking: 1 },
    { name: 'residential without parking', tags: { highway: 'residential', 'parking:lane:both': 'no' }, cls: RoadClass.Local, lanes: 1, speed: 11.25, parking: 0 },
    { name: 'living street, 15 mph', tags: { highway: 'living_street', maxspeed: '15 mph' }, cls: RoadClass.Local, lanes: 1, speed: 6.75, parking: 2 },
    { name: 'service', tags: { highway: 'service' }, cls: RoadClass.Service, lanes: 1, speed: 4.5, parking: 0 },
  ];
  it.each(cases)('$name', (c) => {
    resetIds();
    const { roads } = net([way([0, 0, 100, 0], c.tags)]);
    const e = roads.edges[0]!;
    const def = roadCfg.classes[c.cls]!;
    expect(e.cls).toBe(c.cls);
    expect(e.lanes).toBe(c.lanes);
    expect(e.laneWidthM).toBe(def.laneWidthM);
    expect(e.speedMps).toBe(c.speed);
    expect(e.parkingSides).toBe(c.parking);
    const seg = roads.segs[0]!;
    const oneWay = c.tags['oneway'] === 'yes' || c.cls <= RoadClass.Ramp ? 1 : 2;   // motorways and their links are one-way in OSM
    expect(seg.widthM).toBeCloseTo(Math.round((c.lanes * def.laneWidthM * oneWay + 2.3 * c.parking) * 10) / 10, 6);
    expect(roads.edges.length).toBe(oneWay === 1 ? 1 : 2);
    expect(Boolean(e.flags & EdgeFlag.NoParking)).toBe(c.parking === 0);
  });

  it('keeps the spec speeds on the 0.25 m/s grid the pack stores', () => {
    for (const c of roadCfg.classes) expect(Math.abs(c.speedMps * 4 - Math.round(c.speedMps * 4))).toBeLessThan(1e-9);
  });

  it('parses maxspeed, street names and drops what is not a road', () => {
    expect(parseMaxspeed('25 mph')).toBeCloseTo(11.176, 3);
    expect(parseMaxspeed('50')).toBeCloseTo(13.889, 3);
    expect(parseMaxspeed('none')).toBeNull();
    expect(normalizeStreetName('Van Ness Avenue')).toBe('VAN NESS');
    expect(normalizeStreetName('03RD ST')).toBe('3RD');
    expect(normalizeStreetName('Lombard Street')).toBe(normalizeStreetName('LOMBARD'));
    resetIds();
    const { roads } = net([
      way([0, 0, 100, 0], { highway: 'footway' }), way([0, 10, 100, 10], { highway: 'service', service: 'parking_aisle' }),
      way([0, 20, 100, 20], { highway: 'residential', access: 'private' }), way([0, 30, 100, 30], { highway: 'residential' }),
    ]);
    expect(roads.segs).toHaveLength(1);
    expect(roads.report.droppedAccess).toBe(2);
  });
});

describe('S5 DataSF rows', () => {
  it('lets a matched classcode override the OSM class and keeps its cnn', () => {
    resetIds();
    const { roads } = net([way([0, 0, 100, 0], { highway: 'residential', name: 'Oak Street' })], [row([0, 0, 100, 0], { cnn: 4242, streetname: 'OAK', classcode: '2' })]);
    expect(roads.segs[0]!.cls).toBe(RoadClass.Arterial);
    expect(roads.segs[0]!.cnn).toBe(4242);
    expect(roads.report.classOverrides).toBe(1);
  });

  it('does not match a row of another street name, however close', () => {
    resetIds();
    const { roads } = net([way([0, 0, 100, 0], { highway: 'residential', name: 'Oak Street' })], [row([0, 3, 100, 3], { cnn: 1, streetname: 'PINE', classcode: '2' })]);
    expect(roads.segs[0]!.cnn).toBe(0);
    expect(roads.segs[0]!.cls).toBe(RoadClass.Local);
  });

  it('drops pieces matched by an excluded layer and counts the observed layer values', () => {
    resetIds();
    const osm = [way([0, 0, 100, 0], { highway: 'residential', name: 'A' }), way([0, 50, 100, 50], { highway: 'residential', name: 'B' }), way([0, 100, 100, 100], { highway: 'residential', name: 'C' })];
    const streets = [
      row([0, 0, 100, 0], { cnn: 1, streetname: 'A', layer: 'PRIVATE' }), row([0, 50, 100, 50], { cnn: 2, streetname: 'B', layer: 'PAPER_FWYS' }),
      row([0, 100, 100, 100], { cnn: 3, streetname: 'C' }), row([300, 300, 400, 300], { cnn: 4, layer: 'MYSTERY' }), row([300, 400, 400, 400], { cnn: 5, active: 'false' }),
    ];
    const { roads } = net(osm, streets);
    expect(roads.segs.map((s) => s.name)).toEqual(['C']);
    expect(roads.report.droppedExcluded).toBe(2);
    expect(roads.report.layerHistogram).toEqual({ MYSTERY: 1, PAPER_FWYS: 1, PRIVATE: 1, STREETS: 1 });
    expect(roads.report.excludedActive).toBe(2);
    expect(roads.report.unknownLayers).toEqual(['MYSTERY']);
  });

  it('holds the excluded layers as data in roadclass.json', () => {
    expect(roadCfg.layers.excludedPrefixes).toEqual(['PAPER']);
    expect(roadCfg.layers.excludedExact).toEqual(['PSEUDO', 'PRIVATE', 'STREETS_PEDESTRI', 'UPROW']);
    expect(roadCfg.layers.known).toHaveLength(16);
  });
});

describe('S5 one-way orientation (F/T against OSM)', () => {
  const pairs = (agree: number, total: number): OnewayPair[] =>
    Array.from({ length: total }, (_x, i) => ({ cnn: i + 1, osmWay: 100 + i, osmDir: 1 as const, dsfDirAlong: (i < agree ? 1 : -1) as 1 | -1 }));

  it('adopts the orientation with 92 % agreement', () => {
    const r = adoptOrientation(pairs(92, 100), 0.9, 20);
    expect(r.adopted).toBe('F-along');
    expect(r.ratio1).toBeCloseTo(0.92, 6);
    expect(r.ok).toBe(true);
    expect(r.worst).toHaveLength(8);
  });

  it('adopts the opposite reading when that one agrees', () => {
    const r = adoptOrientation(pairs(8, 100), 0.9, 20);
    expect(r.adopted).toBe('F-against');
    expect(r.ratio2).toBeCloseTo(0.92, 6);
    expect(r.ok).toBe(true);
  });

  it('fails with 85 % in either reading and lists the 20 worst segments', () => {
    const r = adoptOrientation(pairs(85, 100), 0.9, 20);
    expect(r.ok).toBe(false);
    expect(r.worst).toHaveLength(15);
    expect(adoptOrientation(pairs(70, 100), 0.9, 20).worst).toHaveLength(20);
    expect(adoptOrientation([], 0.9, 20).ok).toBe(true);
  });

  it('runs on real pieces: DataSF F/T against oneway=yes, and DataSF wins over a two-way OSM way', () => {
    resetIds();
    const osm: ReturnType<typeof way>[] = [];
    const streets: ReturnType<typeof row>[] = [];
    for (let i = 0; i < 10; i++) {
      const z = i * 60;
      osm.push(way([0, z, 100, z], { highway: 'residential', oneway: 'yes', name: `S${i}` }));
      // rows digitised east to west are flagged T: travel against the digitisation, which is east
      streets.push(i % 2 === 0 ? row([0, z, 100, z], { cnn: i + 1, streetname: `S${i}`, oneway: 'F' }) : row([100, z, 0, z], { cnn: i + 1, streetname: `S${i}`, oneway: 'T' }));
    }
    osm.push(way([0, 700, 100, 700], { highway: 'residential', name: 'Two' }));
    streets.push(row([0, 700, 100, 700], { cnn: 99, streetname: 'TWO', oneway: 'F' }));
    const { roads } = net(osm, streets);
    expect(roads.report.oneway).toMatchObject({ comparable: 10, agree1: 10, adopted: 'F-along', ok: true, dsfOneOsmTwo: 1 });
    const two = roads.segs.find((s) => s.name === 'Two')!;
    expect(two.oneWay).toBe(1);
    expect(roads.edges.filter((e) => e.seg === two.id)).toHaveLength(1);
  });
});

describe('S5 layers, nodes and ids', () => {
  it('connects ways that share a vertex and never ways that cross without one', () => {
    resetIds();
    const bridge = way([0, -100, 0, 100], { highway: 'primary', bridge: 'yes', layer: '1', name: 'Over' });
    const street = [way([-100, 0, 0, 0], { highway: 'residential' }), way([0, 0, 100, 0], { highway: 'residential' })];
    const { roads } = net([bridge, ...street]);
    // the bridge has no vertex at the crossing, so its ends are not the street node
    const streetNode = roads.nodes.find((n) => Math.abs(n.x) < 0.1 && Math.abs(n.z) < 0.1)!;
    expect(streetNode.out).toHaveLength(2);
    const bseg = roads.segs.find((s) => s.bridge)!;
    expect(bseg.layer).toBe(1);
    expect(roads.edges.find((e) => e.seg === bseg.id)!.flags & EdgeFlag.Bridge).toBeTruthy();
    expect(roads.nodes[bseg.a]!.out.concat(roads.nodes[bseg.a]!.in).some((e) => roads.edges[e]!.seg !== bseg.id)).toBe(false);
  });

  it('numbers nodes, edges and segments densely in chunk Morton order with symmetric twins', () => {
    resetIds();
    const { roads } = net(crossing(400));
    expect(roads.nodes.map((n) => n.id)).toEqual(roads.nodes.map((_n, i) => i));
    expect(roads.edges.map((e) => e.id)).toEqual(roads.edges.map((_e, i) => i));
    expect(roads.segs.map((s) => s.id)).toEqual(roads.segs.map((_s, i) => i));
    for (const e of roads.edges) {
      expect(e.twin).toBeGreaterThanOrEqual(0);
      expect(roads.edges[e.twin]!.twin).toBe(e.id);
      expect(roads.edges[e.twin]!.from).toBe(e.to);
    }
    // an edge is owned by the chunk of its from node; ids ascend with the node ids of their from end
    for (let i = 1; i < roads.edges.length; i++) expect(roads.edges[i]!.from).toBeGreaterThanOrEqual(roads.edges[i - 1]!.from);
  });

  it('resamples every segment to at most 20 m between points and reports the edge limit', () => {
    resetIds();
    const { roads } = net([way([0, 0, 500, 0], { highway: 'primary' })]);
    const p = roads.segs[0]!.pts;
    for (let i = 2; i < p.length; i += 2) expect(Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!)).toBeLessThanOrEqual(20.001);
    // the two directions belong to the chunks of their from nodes, which lie 500 m apart
    expect(roads.report.maxEdgesPerChunk).toBe(1);
  });

  it('records signal and stop points and restrictions', () => {
    resetIds();
    const osm = [...crossing(100), point(0, 0, { highway: 'traffic_signals' })];
    const { roads } = net(osm);
    expect(roads.signalPoints).toHaveLength(1);
    expect(roads.nodes.find((n) => n.signal)).toBeDefined();
    expect(runRoads({ osm: [], streets: [], hoods: [], cfg: roadCfg, box: BOX }).segs).toHaveLength(0);
  });
});
