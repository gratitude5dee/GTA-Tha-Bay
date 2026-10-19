import { describe, expect, it } from 'vitest';
import { chunkKeyAt, RoadClass } from '../../../packages/shared/src/index.ts';
import { loadDensity } from '../src/config.ts';
import { LAMP_END_CLEAR_M, LAMP_SETBACK_M, placeLamps } from '../src/stages/s9-tags.ts';
import { runGrading } from '../src/stages/s7-grading.ts';
import { BOX, CITY_KEYS, bridgesCfg, gridsFor, net, resetIds, roadCfg, way } from './net-fixtures.ts';

const flat = (): number => 12;

function graded(osm: ReturnType<typeof way>[]): ReturnType<typeof runGrading> {
  const { roads, junctions } = net(osm);
  return runGrading({ segs: roads.segs, nodes: junctions.nodes, edges: roads.edges, grids: gridsFor(CITY_KEYS, flat), cfg: bridgesCfg, hillGradePct: roadCfg.hillGradePct });
}

const lampsOf = (osm: ReturnType<typeof way>[], pitch = 30): ReturnType<typeof placeLamps> =>
  placeLamps({ segs: graded(osm).segs, box: BOX, isLand: () => true, lampPitchM: pitch });

const flatten = (m: ReturnType<typeof placeLamps>): number[][] => {
  const out: number[][] = [];
  for (const l of m.values()) for (let i = 0; i < l.length; i += 3) out.push([l[i] as number, l[i + 1] as number, l[i + 2] as number]);
  return out;
};

describe('S9 street lamps (M02b2)', () => {
  it('density.json carries lampPitchM 30', () => {
    expect(loadDensity().lampPitchM).toBe(30);
  });

  it('places a lamp every pitch on both sides of an arterial, a road-width plus setback from the centre line', () => {
    resetIds();
    const osm = [way([-150, 0, 150, 0], { highway: 'primary', name: 'Main Street' })];
    const segs = graded(osm).segs;
    expect(segs[0]!.cls).toBe(RoadClass.Arterial);
    const lamps = flatten(lampsOf(osm));
    const off = segs[0]!.widthM / 2 + LAMP_SETBACK_M;
    // 300 m long, 10 m clear at each end: 280 m of run, 10 poles per side.
    expect(lamps.length).toBe(20);
    for (const [, z] of lamps) expect(Math.abs(Math.abs(z!) - off)).toBeLessThan(0.11);
    const north = lamps.filter(([, z]) => z! < 0).map(([x]) => x!).sort((a, b) => a - b);
    const south = lamps.filter(([, z]) => z! > 0).map(([x]) => x!).sort((a, b) => a - b);
    expect(north).toHaveLength(10);
    expect(south).toHaveLength(10);
    for (let i = 1; i < north.length; i++) expect(north[i]! - north[i - 1]!).toBeCloseTo(30, 0);
    expect(north[0]).toBeGreaterThanOrEqual(-150 + LAMP_END_CLEAR_M - 0.2);
  });

  it('collectors carry lamps; local and service streets do not', () => {
    resetIds();
    expect(flatten(lampsOf([way([-150, 0, 150, 0], { highway: 'tertiary', name: 'A' })])).length).toBeGreaterThan(0);
    expect(flatten(lampsOf([way([-150, 0, 150, 0], { highway: 'residential', name: 'B' })])).length).toBe(0);
    expect(flatten(lampsOf([way([-150, 0, 150, 0], { highway: 'service' })])).length).toBe(0);
  });

  it('is reproducible, ordered by x then z in each chunk, and keyed by the chunk of each lamp', () => {
    const build = (): ReturnType<typeof placeLamps> => {
      resetIds();
      return lampsOf([way([-150, 0, 150, 0], { highway: 'primary', name: 'Main Street' }), way([0, -150, 0, 150], { highway: 'secondary', name: 'Cross Street' })]);
    };
    const a = build();
    const b = build();
    expect([...a.entries()]).toEqual([...b.entries()]);
    expect(a.size).toBeGreaterThan(0);
    for (const [key, l] of a) {
      let last: [number, number] = [-Infinity, -Infinity];
      for (let i = 0; i < l.length; i += 3) {
        expect(chunkKeyAt(9, l[i] as number, l[i + 1] as number)).toBe(key);
        const cur: [number, number] = [l[i] as number, l[i + 1] as number];
        expect(cur[0] > last[0] || (cur[0] === last[0] && cur[1] >= last[1])).toBe(true);
        last = cur;
      }
    }
  });

  it('a smaller pitch gives more lamps; lamps outside land are dropped', () => {
    resetIds();
    const osm = [way([-150, 0, 150, 0], { highway: 'primary', name: 'Main Street' })];
    expect(flatten(lampsOf(osm, 15)).length).toBeGreaterThan(flatten(lampsOf(osm, 30)).length);
    const dry = placeLamps({ segs: graded(osm).segs, box: BOX, isLand: (x) => x < 0, lampPitchM: 30 });
    expect(flatten(dry).every(([x]) => x! < 0)).toBe(true);
    expect(flatten(dry).length).toBeGreaterThan(0);
  });
});
