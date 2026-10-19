/**
 * S4 buildings (02-world-bake.md section 4, rules 1-5 and 7-8; rule 6, landmark proxies, writes proxyOf = 0 until M02a2).
 *
 * DataSF `ynuv-fyni` rows to records: text height columns parsed, blended above 35 m, clamped 3.5-340 m; rings cleaned
 * (CCW, Douglas-Peucker 0.3 m for render and 1.0 m for prisms, minimum edge 0.8 m / 1.5 m low-rise, at most 28 / 8 vertices,
 * area at least 4 m2); kind, roof and palette by rule; OSM supplement (towers of 120 m and up that the 2010 model lacks, then
 * gap fill) capped at 5 % of the total with every addition listed by OSM id. Murals, signage and public art are never read.
 */
import { BuildingKind, chunkKeyAt, fnv32, type ChunkKey } from '../../../../packages/shared/src/index.ts';
import type { Raster } from '../geom/raster.ts';
import { ccwArea, collapseShortEdges, forceCcw, openRing, pointInRing, ringBbox, ringCentroid, distToRing, type Bbox } from '../geom/rings.ts';
import { simplifyRing } from '../geom/dp.ts';
import { polygonsOf, type Geometry, type OsmFeature } from '../sources/geo.ts';
import { KIND_CODE } from './s3-water.ts';
import type { TerrainField } from './s2-terrain.ts';

export const MIN_HEIGHT_M = 3.5;
export const MAX_HEIGHT_M = 340;
export const MIN_AREA_M2 = 4;
export const TOWER_M = 35;
export const BLEND_ABOVE_M = 35;
export const OSM_TOWER_MIN_M = 120;
export const OSM_GAP_MIN_AREA_M2 = 150;
export const OSM_OVERLAP_MAX = 0.2;
export const OSM_CENTROID_MIN_M = 15;
export const CHUNK_BUILDING_LIMIT = 1500;

export interface FootprintRow {
  sf16_bldgid?: string;
  shape?: Geometry;
  hgt_mediancm?: string | number;
  hgt_maxcm?: string | number;
  gnd_mediancm?: string | number;
  p2010_zmaxn88ft?: string | number;
}

export interface BakedBuilding {
  chunk: ChunkKey;
  sid: string;
  src: 'datasf' | 'osm';
  baseDm: number;
  heightDm: number;
  kind: BuildingKind;
  roof: 0 | 1 | 2;
  palette: number;
  seed: number;
  /** Render ring, decimetres relative to the chunk NW corner (0.1 m grid). */
  ringDm: Int16Array;
  /** Prism ring in ENU metres on the 0.1 m grid. */
  prism: number[];
}

// ---- heights ------------------------------------------------------------------------------------------------------

/** A text height column in centimetres to metres; null for blank, non-numeric or non-positive values. */
export function parseCm(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n / 100 : null;
}

export function buildingHeightM(row: FootprintRow): number {
  const median = parseCm(row.hgt_mediancm);
  const max = parseCm(row.hgt_maxcm);
  let h: number;
  if (median !== null) {
    h = median;
    if (h > BLEND_ABOVE_M && max !== null && max >= median) h = 0.65 * median + 0.35 * max;
  } else if (max !== null) {
    h = max;
  } else {
    const z = Number.parseFloat(String(row.p2010_zmaxn88ft ?? ''));
    const g = parseCm(row.gnd_mediancm);
    h = Number.isFinite(z) && g !== null ? z * 0.3048 - g : MIN_HEIGHT_M;
  }
  if (!Number.isFinite(h)) h = MIN_HEIGHT_M;
  return Math.min(MAX_HEIGHT_M, Math.max(MIN_HEIGHT_M, h));
}

const OSM_TYPE_HEIGHT: Record<string, number> = {
  house: 7, detached: 7, residential: 8, apartments: 15, commercial: 12, retail: 8, office: 20, industrial: 9, warehouse: 9,
  civic: 14, public: 12, government: 14, church: 16, cathedral: 30, school: 10, hospital: 20, garage: 3.5, yes: 9,
};
export function osmHeightM(tags: Record<string, string>): number {
  const raw = tags['height'];
  if (raw) {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n > 0) return Math.min(MAX_HEIGHT_M, Math.max(MIN_HEIGHT_M, /ft|feet|'/.test(raw) ? n * 0.3048 : n));
  }
  const levels = Number.parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels > 0) return Math.min(MAX_HEIGHT_M, Math.max(MIN_HEIGHT_M, levels * 3.3 + 1.2));
  return OSM_TYPE_HEIGHT[tags['building'] ?? 'yes'] ?? 9;
}

// ---- kind, roof, palette ------------------------------------------------------------------------------------------

export type Landuse = 'none' | 'residential' | 'commercial' | 'industrial';
export interface KindInput { heightM: number; areaM2: number; landuse: Landuse; civic: boolean; industrialTag: boolean }

export function classifyKind(i: KindInput): BuildingKind {
  if (i.heightM >= TOWER_M) return BuildingKind.Tower;
  if (i.civic) return BuildingKind.Civic;
  if (i.industrialTag || (i.landuse === 'industrial' && i.areaM2 > 1500 && i.heightM < 14)) return BuildingKind.Industrial;
  if (i.heightM < 12 && i.areaM2 < 350) return BuildingKind.ResLow;
  if (i.heightM < TOWER_M && i.heightM >= 12 && (i.landuse === 'residential' || i.landuse === 'none')) return BuildingKind.ResMid;
  return BuildingKind.Commercial;
}

/** ResLow: gable 55 %, hip 15 %, flat 30 % by hash(id); everything else flat. 0 flat, 1 gable, 2 hip. */
export function roofOf(kind: BuildingKind, hash: number): 0 | 1 | 2 {
  if (kind !== BuildingKind.ResLow) return 0;
  const u = hash % 100;
  return u < 55 ? 1 : u < 70 ? 2 : 0;
}

export const paletteOf = (hash: number, palettes: number): number => ((hash >>> 8) % palettes) | 0;
export const seedOf = (hash: number): number => (hash >>> 16) & 0xffff;

export const OSM_CIVIC_AMENITY = new Set(['townhall', 'school', 'hospital', 'place_of_worship', 'courthouse', 'fire_station', 'police']);
export const OSM_CIVIC_BUILDING = new Set(['civic', 'public', 'government', 'church', 'cathedral', 'school', 'hospital', 'townhall']);
export const OSM_INDUSTRIAL_BUILDING = new Set(['industrial', 'warehouse', 'factory']);

export const isCivicTags = (t: Record<string, string>): boolean =>
  (t['amenity'] !== undefined && OSM_CIVIC_AMENITY.has(t['amenity'])) || (t['building'] !== undefined && OSM_CIVIC_BUILDING.has(t['building']));
export const isIndustrialTags = (t: Record<string, string>): boolean => t['building'] !== undefined && OSM_INDUSTRIAL_BUILDING.has(t['building']);

// ---- ring cleaning ------------------------------------------------------------------------------------------------

const q1 = (v: number): number => Math.round(v * 10) / 10;

function shrink(ring: number[], tol0: number, cap: number, minEdge: number): number[] {
  let tol = tol0;
  let out = ring;
  for (let k = 0; k < 14; k++) {
    const dp = simplifyRing(ring, tol);
    const collapsed = collapseShortEdges(dp, minEdge);
    out = collapsed.length >= 6 ? collapsed : dp;
    if (out.length / 2 <= cap) break;
    tol *= 1.6;
  }
  return out;
}

function quantize(r: readonly number[]): number[] {
  return openRing(r.map(q1));
}

export interface CleanedRings { render: number[]; prism: number[]; areaM2: number }

/** CCW, simplified, quantised render and prism rings; null when the footprint is degenerate or under 4 m2. */
export function cleanRings(raw: readonly number[], lowRise: boolean): CleanedRings | null {
  let r = openRing(raw);
  if (r.length < 6) return null;
  r = forceCcw(r);
  const area0 = ccwArea(r);
  if (!(area0 >= MIN_AREA_M2)) return null;
  const cap = lowRise ? 8 : 28;
  const minEdge = lowRise ? 1.5 : 0.8;
  let render = quantize(shrink(r, 0.3, cap, minEdge));
  if (render.length < 6 || ccwArea(render) < MIN_AREA_M2) {
    render = quantize(simplifyRing(r, 0.3));
    if (render.length / 2 > cap) render = quantize(shrink(r, 1.0, cap, 0));
  }
  if (render.length < 6 || render.length / 2 > cap || ccwArea(render) < MIN_AREA_M2) return null;
  let prism = quantize(shrink(r, 1.0, cap, minEdge));
  if (prism.length < 6 || ccwArea(prism) <= 0) prism = render;
  return { render, prism, areaM2: area0 };
}

// ---- spatial index ----------------------------------------------------------------------------------------------

export class PolyIndex {
  private readonly cells = new Map<string, number[]>();
  readonly rings: number[][] = [];
  private readonly boxes: Bbox[] = [];
  constructor(private readonly cell = 32) {}

  add(ring: number[]): number {
    const id = this.rings.length;
    const b = ringBbox(ring);
    this.rings.push(ring);
    this.boxes.push(b);
    for (let i = Math.floor(b.minX / this.cell); i <= Math.floor(b.maxX / this.cell); i++) {
      for (let j = Math.floor(b.minZ / this.cell); j <= Math.floor(b.maxZ / this.cell); j++) {
        const k = `${i},${j}`;
        (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(id);
      }
    }
    return id;
  }

  /** Candidate ids whose bbox cells touch the box (may repeat none; deduplicated). */
  near(b: Bbox): number[] {
    const seen = new Set<number>();
    for (let i = Math.floor(b.minX / this.cell); i <= Math.floor(b.maxX / this.cell); i++) {
      for (let j = Math.floor(b.minZ / this.cell); j <= Math.floor(b.maxZ / this.cell); j++) {
        for (const id of this.cells.get(`${i},${j}`) ?? []) seen.add(id);
      }
    }
    return [...seen].sort((a, c) => a - c);
  }

  contains(x: number, z: number): boolean {
    for (const id of this.near({ minX: x, maxX: x, minZ: z, maxZ: z })) {
      const b = this.boxes[id] as Bbox;
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && pointInRing(x, z, this.rings[id] as number[])) return true;
    }
    return false;
  }

  /** Distance to the nearest ring boundary within `maxM`, or Infinity. */
  distanceWithin(x: number, z: number, maxM: number): number {
    let best = Infinity;
    for (const id of this.near({ minX: x - maxM, maxX: x + maxM, minZ: z - maxM, maxZ: z + maxM })) {
      const ring = this.rings[id] as number[];
      const d = pointInRing(x, z, ring) ? 0 : distToRing(x, z, ring);
      if (d < best) best = d;
    }
    return best <= maxM ? best : Infinity;
  }
}

/** Fraction of a lattice of points inside `ring` that fall inside any footprint (point sampling; BD note). */
export function overlapFraction(ring: number[], index: PolyIndex, lattice = 7): number {
  const b = ringBbox(ring);
  let n = 0, m = 0;
  for (let i = 0; i < lattice; i++) {
    for (let j = 0; j < lattice; j++) {
      const x = b.minX + ((i + 0.5) / lattice) * (b.maxX - b.minX);
      const z = b.minZ + ((j + 0.5) / lattice) * (b.maxZ - b.minZ);
      if (!pointInRing(x, z, ring)) continue;
      n++;
      if (index.contains(x, z)) m++;
    }
  }
  if (n === 0) {
    const c = ringCentroid(ring);
    return index.contains(c.x, c.z) ? 1 : 0;
  }
  return m / n;
}

// ---- the stage -----------------------------------------------------------------------------------------------------

export interface BuildingsReport {
  rows: number;
  baked: number;
  dropped: number;
  droppedReasons: Record<string, number>;
  records: number;
  kinds: Record<string, number>;
  maxPerChunk: number;
  overLimit: ChunkKey[];
  osm: { candidates: number; towers: number; gapFill: number; added: number; cap: number; ids: string[] };
}
export interface BuildingsProduct { byChunk: Map<ChunkKey, BakedBuilding[]>; report: BuildingsReport }

export interface BuildingsInputs {
  footprints: readonly FootprintRow[];
  osm: readonly OsmFeature[];
  terrain: TerrainField;
  kindRaster: Raster;
  palettes: number;
  maxOsmFraction: number;
}

const KIND_NAMES = ['ResLow', 'ResMid', 'Commercial', 'Tower', 'Industrial', 'Civic'];
const landuseAt = (r: Raster, x: number, z: number): Landuse => {
  const v = r.at(x, z, 0);
  return v === KIND_CODE.residential ? 'residential' : v === KIND_CODE.commercial ? 'commercial' : v === KIND_CODE.industrial ? 'industrial' : 'none';
};

function baseOf(field: TerrainField, prism: readonly number[], cx: number, cz: number): number | null {
  let min = Infinity;
  for (let i = 0; i < prism.length; i += 2) {
    const h = field.heightAt(prism[i] as number, prism[i + 1] as number);
    if (h !== null && h < min) min = h;
  }
  const c = field.heightAt(cx, cz);
  if (c !== null && c < min) min = c;
  return Number.isFinite(min) ? min - 0.2 : null;
}

export function bakeBuildings(inp: BuildingsInputs): BuildingsProduct {
  const byChunk = new Map<ChunkKey, BakedBuilding[]>();
  const reasons: Record<string, number> = {};
  const drop = (why: string): void => { reasons[why] = (reasons[why] ?? 0) + 1; };

  // OSM civic polygons for kind classification.
  const civic = new PolyIndex();
  const osmBuildings: { id: string; tags: Record<string, string>; ring: number[] }[] = [];
  for (const f of inp.osm) {
    const isBuilding = f.tags['building'] !== undefined && f.tags['building'] !== 'no';
    if (!isBuilding && !isCivicTags(f.tags)) continue;
    for (const p of polygonsOf(f.geometry)) {
      const ring = forceCcw(openRing(p.outer));
      if (ring.length < 6) continue;
      if (isCivicTags(f.tags)) civic.add(ring);
      if (isBuilding) osmBuildings.push({ id: f.id, tags: f.tags, ring });
    }
  }
  osmBuildings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const index = new PolyIndex();
  let baked = 0;
  let records = 0;
  const push = (b: BakedBuilding): void => {
    (byChunk.get(b.chunk) ?? byChunk.set(b.chunk, []).get(b.chunk)!).push(b);
    records++;
  };

  const make = (sid: string, src: 'datasf' | 'osm', rawRing: number[], heightM: number, tags: Record<string, string> | null): BakedBuilding | string => {
    const raw = openRing(rawRing);
    if (raw.length < 6) return 'ring-degenerate';
    const c0 = ringCentroid(raw);
    const area0 = Math.abs(ccwArea(raw));
    if (area0 < MIN_AREA_M2) return 'area<4m2';
    const civicHit = (tags ? isCivicTags(tags) : false) || civic.contains(c0.x, c0.z);
    const kind = classifyKind({
      heightM, areaM2: area0, landuse: landuseAt(inp.kindRaster, c0.x, c0.z), civic: civicHit, industrialTag: tags ? isIndustrialTags(tags) : false,
    });
    const cleaned = cleanRings(raw, kind === BuildingKind.ResLow);
    if (!cleaned) return 'area<4m2';
    const c = ringCentroid(cleaned.render);
    const key = chunkKeyAt(9, c.x, c.z);
    const gridChunk = inp.terrain.gridOf(key);
    if (!gridChunk) return 'outside-chunks';
    const base = baseOf(inp.terrain, cleaned.prism, c.x, c.z);
    if (base === null) return 'outside-chunks';
    const hash = fnv32(sid);
    const ox = gridChunk.originX, oz = gridChunk.originZ;
    const ringDm = new Int16Array(cleaned.render.length);
    for (let i = 0; i < cleaned.render.length; i += 2) {
      ringDm[i] = Math.round(((cleaned.render[i] as number) - ox) * 10);
      ringDm[i + 1] = Math.round(((cleaned.render[i + 1] as number) - oz) * 10);
    }
    return {
      chunk: key, sid, src, baseDm: Math.round(base * 10), heightDm: Math.round(heightM * 10), kind, roof: roofOf(kind, hash),
      palette: paletteOf(hash, inp.palettes), seed: seedOf(hash), ringDm, prism: cleaned.prism,
    };
  };

  const rows = inp.footprints.length;
  for (const row of inp.footprints) {
    const sid = String(row.sf16_bldgid ?? '');
    const polys = polygonsOf(row.shape);
    if (!sid || polys.length === 0) { drop('no-geometry'); continue; }
    const h = buildingHeightM(row);
    let any = false;
    let lastReason = 'ring-degenerate';
    polys.forEach((p, k) => {
      const b = make(k === 0 ? sid : `${sid}#${k}`, 'datasf', p.outer, h, null);
      if (typeof b === 'string') { lastReason = b; return; }
      push(b);
      index.add(forceCcw(b.prism));
      any = true;
    });
    if (any) baked++;
    else drop(lastReason);
  }

  // OSM supplement.
  const cap = Math.floor((inp.maxOsmFraction / (1 - inp.maxOsmFraction)) * baked);
  const towers: typeof osmBuildings = [];
  const gap: { b: (typeof osmBuildings)[number]; area: number }[] = [];
  let candidates = 0;
  for (const o of osmBuildings) {
    const hTag = Number.parseFloat(o.tags['height'] ?? '');
    const area = Math.abs(ccwArea(o.ring));
    const isTower = Number.isFinite(hTag) && hTag >= OSM_TOWER_MIN_M;
    if (!isTower && area < OSM_GAP_MIN_AREA_M2) continue;
    candidates++;
    if (overlapFraction(o.ring, index) >= OSM_OVERLAP_MAX) continue;
    if (isTower) { towers.push(o); continue; }
    const c = ringCentroid(o.ring);
    if (index.distanceWithin(c.x, c.z, OSM_CENTROID_MIN_M) !== Infinity) continue;
    gap.push({ b: o, area });
  }
  gap.sort((a, b) => b.area - a.area || (a.b.id < b.b.id ? -1 : 1));
  const order = [...towers.map((b) => ({ b, tower: true })), ...gap.map((g) => ({ b: g.b, tower: false }))];
  const osmIds: string[] = [];
  let addedTowers = 0, addedGap = 0;
  for (const { b, tower } of order) {
    if (osmIds.length >= cap) break;
    const made = make(`osm:${b.id}`, 'osm', b.ring, osmHeightM(b.tags), b.tags);
    if (typeof made === 'string') continue;
    push(made);
    osmIds.push(b.id);
    if (tower) addedTowers++; else addedGap++;
  }

  const kinds: Record<string, number> = {};
  let maxPerChunk = 0;
  const overLimit: ChunkKey[] = [];
  for (const [key, list] of [...byChunk.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    list.sort((a, b) => (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0));
    for (const b of list) kinds[KIND_NAMES[b.kind] as string] = (kinds[KIND_NAMES[b.kind] as string] ?? 0) + 1;
    if (list.length > maxPerChunk) maxPerChunk = list.length;
    if (list.length > CHUNK_BUILDING_LIMIT) overLimit.push(key);
  }
  return {
    byChunk,
    report: {
      rows, baked, dropped: rows - baked, droppedReasons: reasons, records, kinds, maxPerChunk, overLimit,
      osm: { candidates, towers: addedTowers, gapFill: addedGap, added: osmIds.length, cap, ids: osmIds.sort() },
    },
  };
}
