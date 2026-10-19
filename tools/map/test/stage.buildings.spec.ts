import { describe, expect, it } from 'vitest';
import { BuildingKind, chunkBounds, fnv32 } from '../../../packages/shared/src/index.ts';
import { ccwArea, reverseRing } from '../src/geom/rings.ts';
import { Raster } from '../src/geom/raster.ts';
import { TerrainField } from '../src/stages/s2-terrain.ts';
import {
  CHUNK_BUILDING_LIMIT, bakeBuildings, buildingHeightM, classifyKind, cleanRings, isCivicTags, osmHeightM, paletteOf, parseCm, roofOf,
  type FootprintRow, type KindInput,
} from '../src/stages/s4-buildings.ts';
import type { OsmFeature } from '../src/sources/geo.ts';
import { bakeExcerpt } from './helpers.ts';

describe('S4 heights', () => {
  it.each([
    ['1138', 11.38], [1138, 11.38], ['  500 ', 5], ['', null], [undefined, null], ['abc', null], ['0', null], ['-30', null],
  ] as const)('parses the text column %j to %s m', (v, m) => {
    expect(parseCm(v)).toBe(m);
  });

  it.each([
    [{ hgt_mediancm: '1138', hgt_maxcm: '1269' }, 11.38],
    [{ hgt_mediancm: '2000', hgt_maxcm: '3000' }, 20], // no blend at or below 35 m
    [{ hgt_mediancm: '5000', hgt_maxcm: '7000' }, 0.65 * 50 + 0.35 * 70], // blend above 35 m
    [{ hgt_mediancm: '5000', hgt_maxcm: '4000' }, 50], // a max below the median is ignored
    [{ hgt_mediancm: '100' }, 3.5], // clamp up
    [{ hgt_mediancm: '99999' }, 340], // clamp down
    [{ hgt_maxcm: '900' }, 9], // median missing: the max
    [{ p2010_zmaxn88ft: '154.7793', gnd_mediancm: '3557' }, 154.7793 * 0.3048 - 35.57], // 2010 elevation minus ground
    [{}, 3.5],
  ] as [FootprintRow, number][])('computes the height of %j as %s m', (row, m) => {
    expect(buildingHeightM(row)).toBeCloseTo(m, 6);
  });

  it('reads OSM heights from height, then building:levels, then the type', () => {
    expect(osmHeightM({ building: 'yes', height: '190' })).toBe(190);
    expect(osmHeightM({ building: 'yes', height: '100 ft' })).toBeCloseTo(30.48, 2);
    expect(osmHeightM({ building: 'yes', 'building:levels': '10' })).toBeCloseTo(34.2, 6);
    expect(osmHeightM({ building: 'house' })).toBe(7);
    expect(osmHeightM({ building: 'something-else' })).toBe(9);
  });
});

describe('S4 kind, roof and palette', () => {
  const base: KindInput = { heightM: 20, areaM2: 400, landuse: 'none', civic: false, industrialTag: false };
  it.each([
    [{ heightM: 35 }, BuildingKind.Tower],
    [{ heightM: 120, civic: true }, BuildingKind.Tower], // the tower rule comes first
    [{ heightM: 20, civic: true }, BuildingKind.Civic],
    [{ heightM: 9, areaM2: 200, landuse: 'residential' as const }, BuildingKind.ResLow],
    [{ heightM: 9, areaM2: 200, landuse: 'commercial' as const }, BuildingKind.ResLow],
    [{ heightM: 11.9, areaM2: 349 }, BuildingKind.ResLow],
    [{ heightM: 9, areaM2: 350 }, BuildingKind.Commercial],
    [{ heightM: 12, areaM2: 400, landuse: 'residential' as const }, BuildingKind.ResMid],
    [{ heightM: 34.9, areaM2: 400 }, BuildingKind.ResMid],
    [{ heightM: 20, areaM2: 400, landuse: 'commercial' as const }, BuildingKind.Commercial],
    [{ heightM: 20, areaM2: 400, landuse: 'industrial' as const }, BuildingKind.Commercial],
    [{ heightM: 10, areaM2: 2000, landuse: 'industrial' as const }, BuildingKind.Industrial],
    [{ heightM: 14, areaM2: 2000, landuse: 'industrial' as const }, BuildingKind.Commercial],
    [{ heightM: 10, areaM2: 500, industrialTag: true }, BuildingKind.Industrial],
  ] as [Partial<KindInput>, BuildingKind][])('classifies %j as kind %s', (patch, kind) => {
    expect(classifyKind({ ...base, ...patch })).toBe(kind);
  });

  it('gives ResLow gable 55 %, hip 15 %, flat 30 % by hash, and every other kind a flat roof', () => {
    const counts = [0, 0, 0];
    for (let h = 0; h < 100; h++) counts[roofOf(BuildingKind.ResLow, h)]!++;
    expect(counts).toEqual([30, 55, 15]); // flat, gable, hip
    for (const k of [BuildingKind.ResMid, BuildingKind.Commercial, BuildingKind.Tower, BuildingKind.Industrial, BuildingKind.Civic]) expect(roofOf(k, 7)).toBe(0);
  });

  it('keeps palette in range and stable per building id', () => {
    for (const id of ['a', 'b', '201006.0044265']) {
      const p = paletteOf(fnv32(id), 16);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(16);
      expect(paletteOf(fnv32(id), 16)).toBe(p);
    }
  });

  it('recognises civic OSM tags', () => {
    expect(isCivicTags({ amenity: 'townhall' })).toBe(true);
    expect(isCivicTags({ building: 'cathedral' })).toBe(true);
    expect(isCivicTags({ amenity: 'school' })).toBe(true);
    expect(isCivicTags({ building: 'yes' })).toBe(false);
  });
});

describe('S4 ring cleaning', () => {
  const square = [0, 0, 0, 10, 10, 10, 10, 0]; // NW, SW, SE, NE: CCW north-up
  const circle = (n: number, r: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(50 + r * Math.cos((-i * 2 * Math.PI) / n), 50 + r * Math.sin((-i * 2 * Math.PI) / n));
    return out;
  };

  it('forces CCW and drops a repeated closing point', () => {
    const r = cleanRings(reverseRing([...square, 0, 0]), false)!;
    expect(ccwArea(r.render)).toBeGreaterThan(0);
    expect(r.render).toHaveLength(8);
    expect(ccwArea(r.prism)).toBeGreaterThan(0);
  });

  it('removes collinear points', () => {
    const r = cleanRings([0, 0, 0, 5, 0, 10, 5, 10, 10, 10, 10, 5, 10, 0, 5, 0], false)!;
    expect(r.render).toHaveLength(8);
  });

  it('caps a 60-gon at 28 vertices and a low-rise at 8', () => {
    expect(cleanRings(circle(60, 10), false)!.render.length / 2).toBeLessThanOrEqual(28);
    expect(cleanRings(circle(60, 10), true)!.render.length / 2).toBeLessThanOrEqual(8);
    expect(cleanRings(circle(60, 10), false)!.prism.length / 2).toBeLessThanOrEqual(28);
  });

  it('drops footprints under 4 m², degenerate rings and slivers', () => {
    expect(cleanRings([0, 0, 0, 1.9, 1.9, 1.9, 1.9, 0], false)).toBeNull();
    expect(cleanRings([0, 0, 5, 0], false)).toBeNull();
    expect(cleanRings([0, 0, 10, 0, 20, 0], false)).toBeNull();
    expect(cleanRings([0, 0, 0, 2, 2, 2, 2, 0], false)).not.toBeNull(); // exactly 4 m²
  });

  it('collapses edges under 0.8 m (1.5 m low-rise)', () => {
    const notch = [0, 0, 0, 10, 4.9, 10, 5, 10.5, 10, 10, 10, 0];
    expect(cleanRings(notch, false)!.render.length / 2).toBeLessThan(6);
    const lowNotch = [0, 0, 0, 10, 4, 10, 4.3, 10.4, 4.9, 10, 10, 10, 10, 0];
    const low = cleanRings(lowNotch, true)!;
    expect(low.render.length / 2).toBeLessThanOrEqual(5);
  });

  it('quantises to the 0.1 m grid', () => {
    const r = cleanRings([0.04, 0.04, 0.04, 10.06, 10.06, 10.06, 10.06, 0.04], false)!;
    for (const v of [...r.render, ...r.prism]) expect(Math.abs(v * 10 - Math.round(v * 10))).toBeLessThan(1e-9);
  });
});

describe('S4 OSM supplement on a small synthetic block', () => {
  const dm = new Int16Array(65 * 65).fill(100); // 10 m everywhere
  const field = new TerrainField(new Map([['9/256/256' as never, dm]]));
  const kindRaster = new Raster(-128, -128, 4, 64, 64, 0.5);
  const sq = (x: number, z: number, w: number): number[][][] => [[[x, z], [x, z + w], [x + w, z + w], [x + w, z], [x, z]]];
  const toLngLat = (pts: number[][][]): number[][][] =>
    pts.map((ring) => ring.map(([x, z]) => [-122.4193 + (x as number) / 88083.39, 37.7793 - (z as number) / 110992.06]));
  const row = (id: string, x: number, z: number, w: number, h = '800'): FootprintRow => ({
    sf16_bldgid: id, shape: { type: 'MultiPolygon', coordinates: [toLngLat(sq(x, z, w))] }, hgt_mediancm: h, hgt_maxcm: h,
  });
  const osm = (id: string, x: number, z: number, w: number, tags: Record<string, string>): OsmFeature => ({
    id, tags, geometry: { type: 'Polygon', coordinates: toLngLat(sq(x, z, w)) },
  });

  it('adds a tower the 2010 model lacks and a gap-fill building, never one that overlaps a footprint', () => {
    const footprints = Array.from({ length: 60 }, (_, i) => row(`f${i}`, -100 + (i % 10) * 12, -100 + Math.floor(i / 10) * 12, 8));
    const p = bakeBuildings({
      footprints, terrain: field, kindRaster, palettes: 16, maxOsmFraction: 0.05,
      osm: [
        osm('w1', 90, 90, 20, { building: 'commercial', height: '150' }), // tower, absent from the footprints
        osm('w2', 60, 60, 20, { building: 'house' }), // gap fill, 400 m²
        osm('w3', -98, -98, 12, { building: 'house' }), // overlaps f0: refused
        osm('w4', 100, -100, 8, { building: 'house' }), // 64 m² < 150: refused
        osm('w5', 112, 60, 4, { building: 'yes', height: '130' }), // a second tower, still inside the cap
      ],
    });
    expect(p.report.baked).toBe(60);
    expect(p.report.osm.ids).toEqual(['w1', 'w2', 'w5']);
    expect(p.report.osm).toMatchObject({ towers: 2, gapFill: 1, added: 3 });
    expect(p.report.osm.ids).not.toContain('w3');
    expect(p.report.osm.ids).not.toContain('w4');
    expect(p.report.osm.cap).toBe(3); // floor(0.05 / 0.95 * 60)
    expect(p.report.osm.added).toBeLessThanOrEqual(p.report.osm.cap);
  });

  it('drops rows without geometry and counts them against the bake', () => {
    const p = bakeBuildings({
      footprints: [row('ok', 0, 0, 10), { sf16_bldgid: 'bad' }, { shape: { type: 'MultiPolygon', coordinates: [] } }],
      terrain: field, kindRaster, palettes: 16, maxOsmFraction: 0.05, osm: [],
    });
    expect(p.report.rows).toBe(3);
    expect(p.report.baked).toBe(1);
    expect(p.report.droppedReasons).toEqual({ 'no-geometry': 2 });
  });
});

describe('S4 on the civic-excerpt', () => {
  it('bakes CCW rings of at most 28 vertices, none under 4 m², heights within 3.5-340 m', async () => {
    const b = await bakeExcerpt();
    let n = 0;
    for (const c of b.render) {
      for (const bd of c.buildings) {
        n++;
        const ring = Array.from(bd.ring, (v) => v / 10);
        expect(ring.length / 2).toBeLessThanOrEqual(28);
        expect(ring.length / 2).toBeGreaterThanOrEqual(3);
        expect(ccwArea(ring)).toBeGreaterThan(0);
        expect(ccwArea(ring)).toBeGreaterThanOrEqual(4 - 1e-6);
        expect(bd.heightDm).toBeGreaterThanOrEqual(35);
        expect(bd.heightDm).toBeLessThanOrEqual(3400);
        expect(bd.proxyOf).toBe(0);
        if (bd.kind === BuildingKind.ResLow) expect(ring.length / 2).toBeLessThanOrEqual(8);
      }
    }
    expect(n).toBeGreaterThanOrEqual(600);
    expect(b.report.counts['buildings']).toBe(n);
  });

  it('puts every prism ring CCW inside its chunk and sorts records by id', async () => {
    const b = await bakeExcerpt();
    for (const c of b.sim) {
      const bb = chunkBounds(c.key);
      for (let i = 0; i < c.prisms.length;) {
        const nv = c.prisms[i] as number;
        const ring: number[] = [];
        for (let v = 0; v < nv; v++) ring.push(c.prisms[i + 3 + v * 2] as number, c.prisms[i + 4 + v * 2] as number);
        expect(ccwArea(ring)).toBeGreaterThan(0);
        const cx = ring.filter((_, k) => k % 2 === 0).reduce((s, v) => s + v, 0) / nv;
        expect(cx).toBeGreaterThan(bb.minX - 60);
        expect(cx).toBeLessThan(bb.maxX + 60);
        i += 3 + nv * 2;
      }
    }
  });

  it('bakes at least 98 % of the DataSF rows and stays under the chunk limit', async () => {
    const b = await bakeExcerpt();
    const gates = b.report.gates;
    expect(gates.find((g) => g.id === 's4.baked')?.level).toBe('pass');
    expect(gates.find((g) => g.id === 's4.chunk-limit')?.level).toBe('pass');
    expect(CHUNK_BUILDING_LIMIT).toBe(1500);
  });

  it('classifies the City Hall footprint as Civic through the OSM civic polygon', async () => {
    const b = await bakeExcerpt();
    const hall = b.render.find((c) => c.key === '9/256/256')!;
    expect(hall.buildings.some((bd) => bd.kind === BuildingKind.Civic)).toBe(true);
  });
});
