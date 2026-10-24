import { describe, expect, it } from 'vitest';
import {
  GRID_MIN_M, LEVEL_BIT, MapBuildings, MapData, MapFormatError, MapPolyKind, bldgHeightClass, clipPolylineToRect, decodeGeocode, encodeGeocode, encodeMap, encodeMapBuildings,
  type MapSource,
} from '@dv/shared';

const BAKE = 'ab'.repeat(32);
const X0 = -100, Z0 = -100;

function source(): MapSource {
  return {
    bakeId: BAKE,
    hoods: [{ name: 'Mission', slug: 'mission', tier: 2, labelX: 10.5, labelZ: -20.5, polys: [{ rings: [[0, 0, 200, 0, 200, 200, 0, 200], [50, 50, 100, 50, 100, 100, 50, 100]] }] }],
    polys: [
      { kind: MapPolyKind.Land, levels: 7, rings: [[-500, -500, 500, -500, 500, 500, -500, 500]] },
      { kind: MapPolyKind.Water, levels: 7, rings: [[100, 100, 150, 100, 150, 150, 100, 150]] },
      { kind: MapPolyKind.LanduseBase + 4, levels: LEVEL_BIT[9], rings: [[0, 0, 40, 0, 40, 40]] },
    ],
    labels: [{ kind: 4, text: 'City Hall é世', x: 3.5, z: 1 }],
    hill: { cellM: 32, minX: -64, minZ: -64, cols: 4, rows: 3, cells: Uint8Array.from([128, 128, 128, 128, 128, 200, 90, 128, 128, 128, 128, 128]) },
    streets: [
      // crosses the chunk edge at x = 128 (chunk 9/256/256 spans -128..128)
      { cnn: 1000000, classcode: 5, oneway: 1, bridge: false, tunnel: false, name: 'Main St', pts: [X0, 0, 300, 0], pts7: [X0, 0, 300, 0], pts5: null },
      { cnn: 4294967, classcode: 1, oneway: 2, bridge: true, tunnel: false, name: 'Fwy', pts: [0, Z0, 0, 40, 10, 90], pts7: [0, Z0, 10, 90], pts5: [0, Z0, 10, 90] },
      { cnn: 7, classcode: 4, oneway: 0, bridge: false, tunnel: true, name: 'Main St', pts: [-20, 10, 20, 10], pts7: [-20, 10, 20, 10], pts5: null },
    ],
  };
}

describe('clipPolylineToRect', () => {
  it('cuts a line at the rectangle and keeps its direction', () => {
    const pieces = clipPolylineToRect([-50, 5, 150, 5], 0, 0, 100, 10);
    expect(pieces).toEqual([[0, 5, 100, 5]]);
    const rev = clipPolylineToRect([150, 5, -50, 5], 0, 0, 100, 10);
    expect(rev).toEqual([[100, 5, 0, 5]]);
  });

  it('splits a line that leaves and re-enters, and drops one that misses', () => {
    const pieces = clipPolylineToRect([10, 5, 10, 50, 40, 50, 40, 5], 0, 0, 100, 10);
    expect(pieces).toHaveLength(2);
    expect(clipPolylineToRect([200, 200, 300, 300], 0, 0, 100, 100)).toEqual([]);
  });
});

describe('sf-map.v1 format', () => {
  it('round-trips polygons, neighbourhoods, labels, hillshade and street records', () => {
    const m = MapData.decode(encodeMap(source()));
    expect(m.bakeId).toBe(BAKE);
    expect(m.hoods).toHaveLength(1);
    expect(m.hoods[0]).toMatchObject({ name: 'Mission', slug: 'mission', tier: 2, labelX: 10.5, labelZ: -20.5 });
    expect(m.hoods[0]!.polys[0]).toHaveLength(2);
    expect(Array.from(m.hoods[0]!.polys[0]![0]!)).toEqual([0, 0, 400, 0, 400, 400, 0, 400]);
    expect(m.polys.map((p) => p.kind)).toEqual([MapPolyKind.Land, MapPolyKind.Water, MapPolyKind.LanduseBase + 4]);
    expect(m.polys[2]!.levels).toBe(LEVEL_BIT[9]);
    expect(m.labels).toEqual([{ kind: 4, text: 'City Hall é世', x: 3.5, z: 1 }]);
    expect(m.hill).toMatchObject({ cellM: 32, minX: -64, minZ: -64, cols: 4, rows: 3 });
    expect(m.shadeAt(-64 + 32 * 1 + 1, -64 + 32 * 1 + 1)).toBe(200);
    expect(m.shadeAt(1e6, 1e6)).toBe(128);
    const table = m.cnnTable();
    expect([...table.keys()].sort((a, b) => a - b)).toEqual([7, 1000000, 4294967]);
    expect(table.get(1000000)).toEqual({ classcode: 5, oneway: 1 });
    expect(table.get(4294967)).toEqual({ classcode: 1, oneway: 2 });
  });

  it('cuts street lines at chunk edges with 0.5 m units relative to the chunk NW corner', () => {
    const m = MapData.decode(encodeMap(source()));
    // chunk 9/256/256 spans -128..128 on both axes
    const cx = (0 - GRID_MIN_M) / 256;
    expect(Number.isInteger(cx)).toBe(false);
    const c0 = Math.floor((X0 - GRID_MIN_M) / 256);
    const lines = m.allStreets(9).filter((l) => l.line.cnn === 1000000);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const first = m.streets(9, c0, Math.floor((0 - GRID_MIN_M) / 256)).find((l) => l.cnn === 1000000)!;
    const ox = GRID_MIN_M + c0 * 256;
    expect(ox + first.pts[0]! / 2).toBeCloseTo(X0, 5);
    expect(first.bridge).toBe(false);
    expect(m.allStreets(9).find((l) => l.line.cnn === 4294967)!.line.bridge).toBe(true);
    expect(m.allStreets(9).find((l) => l.line.cnn === 7)!.line.tunnel).toBe(true);
    // z7 holds the classes down to collectors, z5 only the freeway
    expect(new Set(m.allStreets(7).map((l) => l.line.cnn))).toEqual(new Set([1000000, 4294967, 7]));
    expect(new Set(m.allStreets(5).map((l) => l.line.cnn))).toEqual(new Set([4294967]));
    expect(m.allStreets(9).find((l) => l.line.cnn === 1000000)!.line.nameId).toBe(m.allStreets(9).find((l) => l.line.cnn === 7)!.line.nameId);
    expect(m.strings[m.allStreets(9)[0]!.line.nameId]).toBeTypeOf('string');
  });

  it('indexes polygons by level and rectangle', () => {
    const m = MapData.decode(encodeMap(source()));
    expect(m.polysIn(9, -10, -10, 10, 10).map((p) => p.kind)).toEqual([MapPolyKind.Land, MapPolyKind.LanduseBase + 4]);
    expect(m.polysIn(7, -10, -10, 10, 10).map((p) => p.kind)).toEqual([MapPolyKind.Land]);
    expect(m.polysIn(5, 2000, 2000, 2100, 2100)).toEqual([]);
  });

  it('encodes the same bytes every time and rejects damaged input', () => {
    const a = encodeMap(source());
    const b = encodeMap(source());
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(() => MapData.decode(a.slice(0, 20))).toThrow(MapFormatError);
    expect(() => MapData.decode(a.slice(0, a.length - 10))).toThrow(MapFormatError);
    const bad = a.slice();
    bad[0] = 0;
    expect(() => MapData.decode(bad)).toThrow(/bad magic/);
    const ver = a.slice();
    ver[4] = 9;
    expect(() => MapData.decode(ver)).toThrow(/version 9/);
    expect(() => encodeMap({ ...source(), bakeId: 'xyz' })).toThrow(RangeError);
  });
});

describe('sf-map-bldg.v1 format', () => {
  it('round-trips footprints by chunk with a height class', () => {
    const bytes = encodeMapBuildings({
      bakeId: BAKE,
      buildings: [
        { heightClass: bldgHeightClass(5), ring: [0, 0, 20, 0, 20, 20, 0, 20] },
        { heightClass: bldgHeightClass(120), ring: [200, 0, 230, 0, 230, 30, 200, 30] },
      ],
    });
    const b = MapBuildings.decode(bytes);
    expect(b.chunks()).toHaveLength(2);
    const c = Math.floor((0 - GRID_MIN_M) / 256);
    const f = b.footprints(c, c);
    expect(f).toHaveLength(1);
    expect(f[0]!.heightClass).toBe(0);
    expect(f[0]!.pts.length).toBe(8);
    expect(bldgHeightClass(11.9)).toBe(0);
    expect(bldgHeightClass(12)).toBe(1);
    expect(bldgHeightClass(30)).toBe(2);
    expect(bldgHeightClass(80)).toBe(3);
    expect(b.footprints(0, 0)).toEqual([]);
    expect(() => MapBuildings.decode(bytes.slice(0, 30))).toThrow(MapFormatError);
  });
});

describe('sf-geocode.v1 format', () => {
  const src = () => ({
    bakeId: BAKE,
    streets: [{ name: 'FULTON', type: 'ST' }, { name: 'VAN NESS', type: 'AVE' }],
    addresses: [
      { streetId: 1, number: 10, suffix: 0, x: 100.5, z: -50.25, cnn: 9000001 },
      { streetId: 0, number: 329, suffix: 0, x: 3.5, z: 2.5, cnn: 5882000 },
      { streetId: 0, number: 329, suffix: 1, x: 4, z: 3, cnn: 5882000 },
      { streetId: 0, number: 11, suffix: 0, x: -3000.5, z: 1200, cnn: 5881000 },
    ],
    names: [{ kind: 1, label: 'Coit Tower', x: 1186, z: -2562 }, { kind: 3, label: 'Mission', x: 0, z: 0 }],
  });

  it('sorts addresses by street and number, keeps the cnn and the 0.5 m position, and builds the street index', () => {
    const d = decodeGeocode(encodeGeocode(src()));
    expect(d.streets).toEqual(src().streets);
    expect(d.addresses.map((a) => [a.streetId, a.number, a.suffix])).toEqual([[0, 11, 0], [0, 329, 0], [0, 329, 1], [1, 10, 0]]);
    expect(Array.from(d.streetStart)).toEqual([0, 3, 4]);
    const a = d.addresses[3]!;
    expect(a.x).toBeCloseTo(100.5, 6);
    expect(a.z).toBeCloseTo(-50.25, 0);
    expect(a.cnn).toBe(9000001);
    expect(d.addresses[0]!.x).toBeCloseTo(-3000.5, 6);
    expect(d.names.map((n) => n.label)).toEqual(['Coit Tower', 'Mission']);
    expect(Buffer.from(encodeGeocode(src())).equals(Buffer.from(encodeGeocode(src())))).toBe(true);
  });

  it('rejects a damaged buffer', () => {
    const b = encodeGeocode(src());
    expect(() => decodeGeocode(b.slice(0, 50))).toThrow(MapFormatError);
    expect(() => decodeGeocode(new Uint8Array(10))).toThrow(MapFormatError);
  });
});
