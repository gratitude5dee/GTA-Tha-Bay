/**
 * S12 map (M02c2; 02-world-maps.md section 1; stage id `map`): turns a bake into `map_data/sf-map.v1` and `map_data/sf-map-bldg.v1`.
 *
 *  - Streets come from the DataSF `3psu-pn9h` rows themselves (every active row that is not on a `PAPER*` layer and has a `cnn` and a
 *    `classcode` of 1 to 6), so every street segment carries its `cnn` and the street-segment count equals the source count by
 *    construction; the gates read the written bytes back to prove it. Bridges and tunnels are flagged from the S5 segments of the same
 *    `cnn`. z9 records hold the full line, z7 records the classes down to collectors (DP 2 m), z5 records freeways and major
 *    arterials (DP 8 m); a line is cut at chunk edges (0.5 m units relative to the chunk's NW corner).
 *  - Polygons (land rings, lakes, piers, landuse and parks) at DP 5 m, the 41 neighbourhood polygons with a label point and a tier,
 *    landmark pins, and a 32 m hillshade over the area box (u8, 128 is flat).
 *  - `sf-map-bldg.v1`: footprints at DP 1.5 m, area 40 m2 and over, with a height class.
 * Pure: the same inputs give the same bytes.
 */
import {
  CHUNK_EDGE_M, GRID_MIN_M, LEVEL_BIT, MAP_LANDUSE_KINDS, MapPolyKind, bldgHeightClass, encodeMap, encodeMapBuildings,
  type BldgSourceItem, type LandmarkRecord, type MapSource, type MapSourceHood, type MapSourceLabel, type MapSourcePoly, type MapSourceStreet,
} from '../../../../packages/shared/src/index.ts';
import { simplifyPolyline, simplifyRing } from '../geom/dp.ts';
import { ccwArea, distToRing, openRing, pointInRing, ringBbox, ringCentroid, type Bbox } from '../geom/rings.ts';
import { linesOf, type Geometry } from '../sources/geo.ts';
import type { BakedBuilding } from './s4-buildings.ts';
import type { SegB } from './s5-roads.ts';
import type { HoodPoly, WaterProduct } from './s3-water.ts';
import { slugOf } from '../districts-seed.ts';

export const POLY_DP_M = 5;
export const BLDG_DP_M = 1.5;
export const BLDG_MIN_AREA_M2 = 40;
export const HILL_CELL_M = 32;
const Z7_DP_M = 2;
const Z5_DP_M = 8;

export interface MapStreetRow {
  cnn?: string | number;
  streetname?: string;
  st_type?: string;
  classcode?: string | number;
  oneway?: string;
  layer?: string;
  active?: string | boolean;
  line?: Geometry;
}

/** The rows the map keeps: active, not on a `PAPER*` layer, with a `cnn` and a `classcode` 1 to 6. The gates count with the same rule. */
export function mapStreetKept(r: MapStreetRow): { cnn: number; classcode: number } | null {
  const active = r.active === true || r.active === 'true';
  if (!active || !r.line) return null;
  if ((r.layer ?? '').startsWith('PAPER')) return null;
  const cnn = Number(r.cnn);
  const cc = Number(r.classcode);
  if (!(cnn > 0) || !Number.isInteger(cnn) || !Number.isInteger(cc) || cc < 1 || cc > 6) return null;
  return { cnn, classcode: cc };
}

export const onewayCode = (v: string | undefined): 0 | 1 | 2 => (v === 'F' ? 1 : v === 'T' ? 2 : 0);

/** "FULTON ST" is a name already; the synth rows carry the type apart ("51ST" + "AVE"). */
export function streetLabel(r: MapStreetRow): string {
  const name = (r.streetname ?? '').trim();
  const type = (r.st_type ?? '').trim();
  const text = type && !name.toUpperCase().endsWith(` ${type.toUpperCase()}`) ? `${name} ${type}` : name;
  return text.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_m, a: string, b: string) => `${a}${b.toUpperCase()}`);
}

export function labelFromKey(key: string): string {
  const last = key.slice(key.lastIndexOf('.') + 1);
  return last
    .split('-')
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export interface MapInputs {
  bakeId: string;
  streets: readonly MapStreetRow[];
  /** S5 segments (bridge and tunnel flags by `cnn`). */
  segs: readonly SegB[];
  water: WaterProduct;
  /** Graded terrain height in metres, or null where no chunk was baked (water). */
  heightAt(x: number, z: number): number | null;
  box: Bbox;
  landmarks: readonly LandmarkRecord[];
  buildings: ReadonlyMap<string, readonly BakedBuilding[]>;
}

export interface MapReport {
  streets: { rows: number; kept: number; cnns: number; byClasscode: Record<string, number> };
  polys: { total: number; land: number; water: number; piers: number; landuse: number };
  hoods: number;
  labels: number;
  hill: { cols: number; rows: number; bytes: number };
  records: Record<'z9' | 'z7' | 'z5', number>;
  buildings: { kept: number; dropped: number };
  mapBytes: number;
  bldgBytes: number;
}

export interface MapProduct {
  map: Uint8Array;
  bldg: Uint8Array;
  report: MapReport;
  /** The label point of every neighbourhood (the geocoder's name index uses it). */
  hoodPoints: { name: string; x: number; z: number }[];
}

const inBoxish = (b: Bbox, line: ArrayLike<number>): boolean => {
  const r = ringBbox(line);
  return r.maxX >= b.minX && r.minX <= b.maxX && r.maxZ >= b.minZ && r.minZ <= b.maxZ;
};

function polyAreaM2(r: ArrayLike<number>): number {
  return Math.abs(ccwArea(r));
}

/** A point inside the polygon that is far from its edges: the centroid when inside, else the best of a 12 x 12 scan. */
export function labelPoint(outer: ArrayLike<number>, holes: readonly ArrayLike<number>[]): { x: number; z: number } {
  const inside = (x: number, z: number): boolean => pointInRing(x, z, outer) && !holes.some((h) => pointInRing(x, z, h));
  const c = ringCentroid(outer);
  if (inside(c.x, c.z)) return c;
  const b = ringBbox(outer);
  let best = { x: (outer[0] as number) ?? 0, z: (outer[1] as number) ?? 0 };
  let bestD = -1;
  for (let j = 0; j < 12; j++) {
    for (let i = 0; i < 12; i++) {
      const x = b.minX + ((i + 0.5) / 12) * (b.maxX - b.minX), z = b.minZ + ((j + 0.5) / 12) * (b.maxZ - b.minZ);
      if (!inside(x, z)) continue;
      const d = distToRing(x, z, outer);
      if (d > bestD) {
        bestD = d;
        best = { x, z };
      }
    }
  }
  return best;
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function runMap(inp: MapInputs): MapProduct {
  // ---- streets
  const flagsByCnn = new Map<number, { bridge: boolean; tunnel: boolean }>();
  for (const s of inp.segs) {
    if (!s.cnn) continue;
    const f = flagsByCnn.get(s.cnn) ?? { bridge: false, tunnel: false };
    if (s.bridge) f.bridge = true;
    if (s.tunnel) f.tunnel = true;
    flagsByCnn.set(s.cnn, f);
  }
  const streets: MapSourceStreet[] = [];
  const byClasscode: Record<string, number> = {};
  const cnns = new Set<number>();
  let kept = 0;
  const sorted = [...inp.streets].sort((a, b) => Number(a.cnn) - Number(b.cnn));
  for (const r of sorted) {
    const k = mapStreetKept(r);
    if (!k) continue;
    const lines = linesOf(r.line);
    let used = false;
    for (const pts of lines) {
      if (pts.length < 4 || !inBoxish(inp.box, pts)) continue;
      used = true;
      const f = flagsByCnn.get(k.cnn);
      streets.push({
        cnn: k.cnn,
        classcode: k.classcode,
        oneway: onewayCode(r.oneway),
        bridge: f?.bridge ?? false,
        tunnel: f?.tunnel ?? false,
        name: streetLabel(r),
        pts,
        pts7: k.classcode <= 4 || k.classcode === 6 ? simplifyPolyline(pts, Z7_DP_M) : null,
        pts5: k.classcode <= 2 ? simplifyPolyline(pts, Z5_DP_M) : null,
      });
    }
    if (used) {
      kept++;
      cnns.add(k.cnn);
      byClasscode[String(k.classcode)] = (byClasscode[String(k.classcode)] ?? 0) + 1;
    }
  }

  // ---- polygons
  const polys: MapSourcePoly[] = [];
  const counts = { land: 0, water: 0, piers: 0, landuse: 0 };
  const ALL = LEVEL_BIT[9] | LEVEL_BIT[7] | LEVEL_BIT[5];
  const simp = (r: ArrayLike<number>): number[] | null => {
    const o = openRing(r);
    if (o.length < 6) return null;
    const s = simplifyRing(o, POLY_DP_M);
    return s.length >= 6 && polyAreaM2(s) >= 25 ? s : null;
  };
  // land rings: outer rings (CCW) are land, holes (CW) are water painted over it; large rings first so islands inside holes come later
  const land = inp.water.landRings
    .map((r) => ({ r: simp(r), a: polyAreaM2(r), outer: ccwArea(r) >= 0 }))
    .filter((x): x is { r: number[]; a: number; outer: boolean } => x.r !== null)
    .sort((a, b) => b.a - a.a);
  for (const x of land) {
    polys.push({ kind: x.outer ? MapPolyKind.Land : MapPolyKind.Water, levels: ALL, rings: [x.r] });
    counts[x.outer ? 'land' : 'water']++;
  }
  for (const w of inp.water.waterPolys) {
    const r = simp(w);
    if (r) {
      polys.push({ kind: MapPolyKind.Water, levels: ALL, rings: [r] });
      counts.water++;
    }
  }
  for (const p of inp.water.piers) {
    const r = simp(p);
    if (r) {
      polys.push({ kind: MapPolyKind.Pier, levels: LEVEL_BIT[9] | LEVEL_BIT[7], rings: [r] });
      counts.piers++;
    }
  }
  for (const u of inp.water.landuse) {
    const kind = MapPolyKind.LanduseBase + MAP_LANDUSE_KINDS.indexOf(u.cls);
    const rings = u.rings.map((r) => simp(r)).filter((r): r is number[] => r !== null);
    if (rings.length === 0) continue;
    const area = polyAreaM2(rings[0] as number[]);
    const green = u.cls === 'park' || u.cls === 'grass' || u.cls === 'sand';
    const levels = (green && area >= 20_000 ? LEVEL_BIT[7] : 0) | (u.cls === 'park' && area >= 250_000 ? LEVEL_BIT[5] : 0) | LEVEL_BIT[9];
    polys.push({ kind, levels, rings });
    counts.landuse++;
  }

  // ---- neighbourhoods
  const hoods: MapSourceHood[] = [];
  const hoodRows = [...inp.water.hoods].sort((a: HoodPoly, b: HoodPoly) => cmpStr(a.name, b.name));
  for (const h of hoodRows) {
    const rings = h.polys.map((p) => ({ outer: simp(p.outer), holes: p.holes.map((x) => simp(x)).filter((x): x is number[] => x !== null) }));
    const usable = rings.filter((x): x is { outer: number[]; holes: number[][] } => x.outer !== null);
    if (usable.length === 0) continue;
    const biggest = usable.reduce((a, b) => (polyAreaM2(a.outer) >= polyAreaM2(b.outer) ? a : b));
    const lp = labelPoint(biggest.outer, biggest.holes);
    const total = usable.reduce((s, x) => s + polyAreaM2(x.outer), 0);
    hoods.push({
      name: h.name,
      slug: slugOf(h.name),
      tier: total >= 3_000_000 ? 1 : total >= 1_000_000 ? 2 : 3,
      labelX: lp.x,
      labelZ: lp.z,
      polys: usable.map((x) => ({ rings: [x.outer, ...x.holes] })),
    });
  }

  // ---- labels
  const labels: MapSourceLabel[] = [];
  for (const l of [...inp.landmarks].sort((a, b) => cmpStr(a.id, b.id))) labels.push({ kind: 4, text: labelFromKey(l.nameKey), x: l.x, z: l.z });

  // ---- hillshade
  const minX = Math.floor(inp.box.minX / HILL_CELL_M) * HILL_CELL_M, minZ = Math.floor(inp.box.minZ / HILL_CELL_M) * HILL_CELL_M;
  const cols = Math.ceil((inp.box.maxX - minX) / HILL_CELL_M), rows = Math.ceil((inp.box.maxZ - minZ) / HILL_CELL_M);
  const heights = new Float32Array(cols * rows);
  const has = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const h = inp.heightAt(minX + (i + 0.5) * HILL_CELL_M, minZ + (j + 0.5) * HILL_CELL_M);
      if (h !== null && h > 0.05) {
        heights[j * cols + i] = h;
        has[j * cols + i] = 1;
      }
    }
  }
  const cells = new Uint8Array(cols * rows).fill(128);
  const at = (i: number, j: number, fallback: number): number => {
    const ci = i < 0 ? 0 : i >= cols ? cols - 1 : i, cj = j < 0 ? 0 : j >= rows ? rows - 1 : j;
    return has[cj * cols + ci] ? (heights[cj * cols + ci] as number) : fallback;
  };
  // light from the north-west (x east, z south): L = (-0.5, 0.7071, -0.5); flat ground gives 0.7071
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (!has[j * cols + i]) continue;
      const c = heights[j * cols + i] as number;
      const dzdx = (at(i + 1, j, c) - at(i - 1, j, c)) / (2 * HILL_CELL_M);
      const dzdz = (at(i, j + 1, c) - at(i, j - 1, c)) / (2 * HILL_CELL_M);
      const inv = 1 / Math.sqrt(dzdx * dzdx + 1 + dzdz * dzdz);
      const shade = (-dzdx * -0.5 + 0.7071 + -dzdz * -0.5) * inv;
      cells[j * cols + i] = Math.max(1, Math.min(255, Math.round(128 + (shade - 0.7071) * 255)));
    }
  }

  const src: MapSource = {
    bakeId: inp.bakeId,
    hoods,
    polys,
    labels,
    hill: { cellM: HILL_CELL_M, minX, minZ, cols, rows, cells },
    streets,
  };
  const map = encodeMap(src);

  // ---- footprints
  const items: BldgSourceItem[] = [];
  let dropped = 0;
  const chunkKeys = [...inp.buildings.keys()].sort(cmpStr);
  for (const key of chunkKeys) {
    const m = /^9\/(\d+)\/(\d+)$/.exec(key);
    if (!m) continue;
    const ox = GRID_MIN_M + Number(m[1]) * CHUNK_EDGE_M[9], oz = GRID_MIN_M + Number(m[2]) * CHUNK_EDGE_M[9];
    for (const b of (inp.buildings.get(key) as readonly BakedBuilding[]).slice().sort((a, c) => cmpStr(a.sid, c.sid))) {
      const ring: number[] = [];
      for (let i = 0; i + 1 < b.ringDm.length; i += 2) ring.push(ox + (b.ringDm[i] as number) / 10, oz + (b.ringDm[i + 1] as number) / 10);
      const open = openRing(ring);
      const s = open.length >= 6 ? simplifyRing(open, BLDG_DP_M) : open;
      if (s.length < 6 || polyAreaM2(s) < BLDG_MIN_AREA_M2) {
        dropped++;
        continue;
      }
      items.push({ heightClass: bldgHeightClass(b.heightDm / 10), ring: s });
    }
  }
  const bldg = encodeMapBuildings({ bakeId: inp.bakeId, buildings: items });

  const rec = (lv: 'pts' | 'pts7' | 'pts5'): number => streets.filter((s) => s[lv] !== null).length;
  const report: MapReport = {
    streets: { rows: inp.streets.length, kept, cnns: cnns.size, byClasscode },
    polys: { total: polys.length, ...counts },
    hoods: hoods.length,
    labels: labels.length,
    hill: { cols, rows, bytes: cells.length },
    records: { z9: rec('pts'), z7: rec('pts7'), z5: rec('pts5') },
    buildings: { kept: items.length, dropped },
    mapBytes: map.length,
    bldgBytes: bldg.length,
  };
  return { map, bldg, report, hoodPoints: hoods.map((h) => ({ name: h.name, x: h.labelX, z: h.labelZ })) };
}
