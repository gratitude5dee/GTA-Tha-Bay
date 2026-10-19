/**
 * S3 water, landuse and street trees (02-world-bake.md section 4).
 *
 * Coastline: `natural=coastline` ways (land on the left) are chained by endpoint (0.1 m), clipped to the area box and
 * closed along the box perimeter; rings below the area's floor are dropped; Douglas-Peucker 4 m. Land is the even-odd
 * fill of the rings. Lakes (`natural=water` polygons) are painted as water afterwards, so a polygon that overlaps the
 * sea cannot flip the parity.
 */
import { enuFromLatLng, fnv32 } from '../../../../packages/shared/src/index.ts';
import type { AreaGrid } from '../config.ts';
import { simplifyRing } from '../geom/dp.ts';
import { ccwArea, clipRingToBox, openRing, type Bbox } from '../geom/rings.ts';
import { Raster } from '../geom/raster.ts';
import { linesOf, polygonsOf, type Geometry, type OsmFeature, type PolyEnu } from '../sources/geo.ts';

export type LanduseClass = 'residential' | 'commercial' | 'industrial' | 'grass' | 'park' | 'sand' | 'plaza' | 'rock';
/** Paint order: kind-only classes first, ground classes after. */
export const LANDUSE_ORDER: readonly LanduseClass[] = ['residential', 'commercial', 'industrial', 'grass', 'park', 'sand', 'plaza', 'rock'];
/** Values of the building-kind raster. */
export const KIND_CODE: Record<'none' | 'residential' | 'commercial' | 'industrial', number> = { none: 0, residential: 1, commercial: 2, industrial: 3 };

export interface LandusePoly { cls: LanduseClass; rings: number[][] }
export interface HoodPoly { name: string; polys: PolyEnu[] }

export interface WaterProduct {
  /** Land rings (flat ENU), CCW outer boundaries and CW holes, simplified. */
  landRings: number[][];
  /** `natural=water` polygons (lakes, reservoirs): painted as water after the land fill. */
  waterPolys: number[][];
  /** Pier polygons (man_made=pier areas and buffered ways). */
  piers: number[][];
  landuse: LandusePoly[];
  /** Street trees: x, z, scale, species per tree. */
  trees: number[];
  hoods: HoodPoly[];
  stats: { coastChains: number; openPieces: number; ringsKept: number; ringsDropped: number; droppedKm2: number; baseLand: boolean };
}

// ---- coastline assembly ------------------------------------------------------------------------------------------

const key01 = (x: number, z: number): string => `${Math.round(x * 10)},${Math.round(z * 10)}`;

/** Chains ways end to start (0.1 m). Ways keep their direction; the result is deterministic for a sorted input. */
export function chainWays(ways: readonly (readonly number[])[]): number[][] {
  const starts = new Map<string, number[]>();
  const ends = new Map<string, number[]>();
  ways.forEach((w, i) => {
    const sk = key01(w[0] as number, w[1] as number);
    const ek = key01(w[w.length - 2] as number, w[w.length - 1] as number);
    (starts.get(sk) ?? starts.set(sk, []).get(sk)!).push(i);
    (ends.get(ek) ?? ends.set(ek, []).get(ek)!).push(i);
  });
  const used = new Uint8Array(ways.length);
  const out: number[][] = [];
  const pick = (m: Map<string, number[]>, k: string): number => {
    for (const i of m.get(k) ?? []) if (!used[i]) return i;
    return -1;
  };
  for (let i = 0; i < ways.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain = Array.from(ways[i] as readonly number[]);
    const startKey = key01(chain[0] as number, chain[1] as number);
    let closed = false;
    for (;;) {
      const ek = key01(chain[chain.length - 2] as number, chain[chain.length - 1] as number);
      if (ek === startKey && chain.length > 4) { closed = true; break; }
      const j = pick(starts, ek);
      if (j < 0) break;
      used[j] = 1;
      const w = ways[j] as readonly number[];
      for (let k = 2; k < w.length; k++) chain.push(w[k] as number);
    }
    while (!closed) {
      const sk = key01(chain[0] as number, chain[1] as number);
      const j = pick(ends, sk);
      if (j < 0) break;
      used[j] = 1;
      const w = ways[j] as readonly number[];
      chain = [...Array.from(w.slice(0, w.length - 2)), ...chain];
    }
    out.push(chain);
  }
  return out;
}

const EPS = 1e-6;
function snapTo(v: number, edge: number): number {
  return Math.abs(v - edge) < EPS ? edge : v;
}

/** Clips an open polyline to the box; returns the pieces inside, with exact box coordinates at the cut points. */
export function clipChainToBox(pts: readonly number[], b: Bbox): number[][] {
  const pieces: number[][] = [];
  let cur: number[] | null = null;
  const inside = (x: number, z: number): boolean => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x0 = pts[i] as number, z0 = pts[i + 1] as number, x1 = pts[i + 2] as number, z1 = pts[i + 3] as number;
    const dx = x1 - x0, dz = z1 - z0;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dz, dz];
    const q = [x0 - b.minX, b.maxX - x0, z0 - b.minZ, b.maxZ - z0];
    let ok = true;
    for (let k = 0; k < 4; k++) {
      const pk = p[k] as number, qk = q[k] as number;
      if (pk === 0) { if (qk < 0) { ok = false; break; } continue; }
      const r = qk / pk;
      if (pk < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok || t0 > t1) {
      if (cur) { pieces.push(cur); cur = null; }
      continue;
    }
    const qx0 = t0 === 0 ? x0 : snapAll(x0 + t0 * dx, b, 'x');
    const qz0 = t0 === 0 ? z0 : snapAll(z0 + t0 * dz, b, 'z');
    const qx1 = t1 === 1 ? x1 : snapAll(x0 + t1 * dx, b, 'x');
    const qz1 = t1 === 1 ? z1 : snapAll(z0 + t1 * dz, b, 'z');
    if (!cur || t0 > 0) {
      if (cur) pieces.push(cur);
      cur = [qx0, qz0];
    }
    cur.push(qx1, qz1);
    if (t1 < 1 || !inside(x1, z1)) { pieces.push(cur); cur = null; }
  }
  if (cur) pieces.push(cur);
  return pieces.filter((p) => p.length >= 4);
}

function snapAll(v: number, b: Bbox, axis: 'x' | 'z'): number {
  return axis === 'x' ? snapTo(snapTo(v, b.minX), b.maxX) : snapTo(snapTo(v, b.minZ), b.maxZ);
}

/** Position of a perimeter point along the CCW (north-up) walk that starts at the NW corner and goes south first. */
export function perimeterT(x: number, z: number, b: Bbox): number {
  const W = b.maxX - b.minX, H = b.maxZ - b.minZ;
  if (Math.abs(x - b.minX) < 1e-4) return z - b.minZ;
  if (Math.abs(z - b.maxZ) < 1e-4) return H + (x - b.minX);
  if (Math.abs(x - b.maxX) < 1e-4) return H + W + (b.maxZ - z);
  return 2 * H + W + (b.maxX - x);
}

function cornersAfter(a: number, c: number, b: Bbox): number[] {
  const W = b.maxX - b.minX, H = b.maxZ - b.minZ, P = 2 * (W + H);
  const corners: [number, number, number][] = [[0, b.minX, b.minZ], [H, b.minX, b.maxZ], [H + W, b.maxX, b.maxZ], [2 * H + W, b.maxX, b.minZ]];
  const span = (c - a + P) % P || P;
  const out: { d: number; x: number; z: number }[] = [];
  for (const [t, x, z] of corners) {
    const d = (t - a + P) % P;
    if (d > 1e-6 && d < span - 1e-6) out.push({ d, x, z });
  }
  out.sort((p, q) => p.d - q.d);
  return out.flatMap((p) => [p.x, p.z]);
}

/** Joins pieces into closed land rings along the box perimeter (land on the left of each piece, north-up). */
export function closePieces(pieces: readonly number[][], b: Bbox): { rings: number[][]; unclosed: number } {
  const W = b.maxX - b.minX, H = b.maxZ - b.minZ, P = 2 * (W + H);
  const ps = pieces.map((pts) => ({
    pts,
    tIn: perimeterT(pts[0] as number, pts[1] as number, b),
    tOut: perimeterT(pts[pts.length - 2] as number, pts[pts.length - 1] as number, b),
    used: false,
  }));
  ps.sort((p, q) => p.tIn - q.tIn);
  const rings: number[][] = [];
  let unclosed = 0;
  for (const start of ps) {
    if (start.used) continue;
    const ring: number[] = [];
    let cur = start;
    for (;;) {
      cur.used = true;
      for (const v of cur.pts) ring.push(v);
      let best: (typeof ps)[number] | null = null;
      let bestD = Infinity;
      for (const q of ps) {
        if (q.used && q !== start) continue;
        const d = (q.tIn - cur.tOut + P) % P;
        if (d < bestD) { bestD = d; best = q; }
      }
      if (!best) { unclosed++; break; }
      for (const v of cornersAfter(cur.tOut, best.tIn, b)) ring.push(v);
      if (best === start) { rings.push(ring); break; }
      cur = best;
    }
  }
  return { rings, unclosed };
}

export interface LandInputs {
  coastWays: number[][];
  box: Bbox;
  minRingKm2: number;
  /** Used only when no coastline crosses the box: true when the box (outside closed rings) is land. */
  baseLandHint: () => boolean;
}

/**
 * Moves ring vertices that sit exactly on the box perimeter one post (4 m) outward. The posts of the last row and column
 * would otherwise fall outside the half-open scanline fill and read as water at the box edge.
 */
export function growBoundary(ring: readonly number[], b: Bbox, d = 4): number[] {
  const out = Array.from(ring);
  for (let i = 0; i < out.length; i += 2) {
    if (out[i] === b.maxX) out[i] = b.maxX + d;
    else if (out[i] === b.minX) out[i] = b.minX - d;
    if (out[i + 1] === b.maxZ) out[i + 1] = b.maxZ + d;
    else if (out[i + 1] === b.minZ) out[i + 1] = b.minZ - d;
  }
  return out;
}

export function assembleLand(inp: LandInputs): { rings: number[][]; stats: WaterProduct['stats'] } {
  const { box } = inp;
  const chains = chainWays(inp.coastWays);
  const pieces: number[][] = [];
  const closedInside: number[][] = [];
  const inBox = (x: number, z: number): boolean => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
  for (const c of chains) {
    const closed = c.length >= 8 && key01(c[0] as number, c[1] as number) === key01(c[c.length - 2] as number, c[c.length - 1] as number);
    let pts: number[] = c;
    if (closed) {
      let allIn = true;
      let firstOut = -1;
      for (let i = 0; i < c.length; i += 2) if (!inBox(c[i] as number, c[i + 1] as number)) { allIn = false; firstOut = i / 2; break; }
      if (allIn) { closedInside.push(openRing(c)); continue; }
      // rotate so the walk starts outside the box
      const body = c.slice(0, c.length - 2);
      const n = body.length / 2;
      const rot: number[] = [];
      for (let k = 0; k < n; k++) { const idx = (firstOut + k) % n; rot.push(body[idx * 2] as number, body[idx * 2 + 1] as number); }
      rot.push(rot[0] as number, rot[1] as number);
      pts = rot;
    }
    pieces.push(...clipChainToBox(pts, box));
  }
  const rings: number[][] = [];
  let unclosed = 0;
  let baseLand = false;
  if (pieces.length > 0) {
    const r = closePieces(pieces, box);
    rings.push(...r.rings.map((x) => growBoundary(x, box)));
    unclosed = r.unclosed;
  } else {
    baseLand = inp.baseLandHint();
    if (baseLand) rings.push(growBoundary([box.minX, box.minZ, box.minX, box.maxZ, box.maxX, box.maxZ, box.maxX, box.minZ], box));
  }
  rings.push(...closedInside);
  const minM2 = inp.minRingKm2 * 1e6;
  const kept: number[][] = [];
  let dropped = 0;
  let droppedM2 = 0;
  for (const r of rings) {
    const a = Math.abs(ccwArea(r));
    if (a < minM2) { dropped++; droppedM2 += a; continue; }
    kept.push(simplifyRing(r, 4));
  }
  void unclosed;
  return {
    rings: kept,
    stats: { coastChains: chains.length, openPieces: pieces.length, ringsKept: kept.length, ringsDropped: dropped, droppedKm2: droppedM2 / 1e6, baseLand },
  };
}

// ---- landuse, piers, trees ----------------------------------------------------------------------------------------

const PARK_LEISURE = new Set(['park', 'garden', 'pitch', 'playground', 'nature_reserve', 'golf_course']);
const GRASS_LANDUSE = new Set(['grass', 'meadow', 'recreation_ground', 'village_green', 'cemetery', 'forest']);

export function landuseOfTags(t: Record<string, string>): LanduseClass | null {
  if (t['leisure'] && PARK_LEISURE.has(t['leisure'])) return 'park';
  if (t['landuse'] && GRASS_LANDUSE.has(t['landuse'])) return 'grass';
  if (t['natural'] === 'beach') return 'sand';
  if (t['natural'] === 'bare_rock' || t['natural'] === 'scree') return 'rock';
  if (t['place'] === 'square' || (t['highway'] === 'pedestrian' && t['area'] === 'yes')) return 'plaza';
  if (t['landuse'] === 'industrial') return 'industrial';
  if (t['landuse'] === 'commercial' || t['landuse'] === 'retail') return 'commercial';
  if (t['landuse'] === 'residential') return 'residential';
  return null;
}

/** A buffered line as one quad per segment (width at least 8 m so a 4 m post grid always catches it). */
export function bufferLine(line: readonly number[], widthM: number): number[][] {
  const half = Math.max(widthM, 8) / 2;
  const quads: number[][] = [];
  for (let i = 0; i + 3 < line.length; i += 2) {
    const x0 = line[i] as number, z0 = line[i + 1] as number, x1 = line[i + 2] as number, z1 = line[i + 3] as number;
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const nx = (-dz / len) * half, nz = (dx / len) * half;
    quads.push([x0 + nx, z0 + nz, x1 + nx, z1 + nz, x1 - nx, z1 - nz, x0 - nx, z0 - nz]);
  }
  return quads;
}

export interface TreeRow { latitude?: string | number; longitude?: string | number; species?: string }
export interface HoodRow { nhood?: string; the_geom?: Geometry }
export interface ParkRow { property_name?: string; shape?: Geometry }

export interface WaterInputs {
  grid: AreaGrid;
  osm: readonly OsmFeature[];
  parks: readonly ParkRow[];
  hoods: readonly HoodRow[];
  trees: readonly TreeRow[];
  minRingKm2: number;
  baseLandHint: () => boolean;
}

export function treeRecord(lat: number, lng: number, speciesName: string): [number, number, number, number] {
  const p = enuFromLatLng(lat, lng);
  const h = fnv32(`${speciesName}|${lat.toFixed(7)}|${lng.toFixed(7)}`);
  const scale = (24 + (h % 17)) / 32; // 0.75 .. 1.25
  return [p.x, p.z, scale, fnv32(speciesName) % 8];
}

export function runWater(inp: WaterInputs): WaterProduct {
  const box: Bbox = { minX: inp.grid.minX, minZ: inp.grid.minZ, maxX: inp.grid.maxX, maxZ: inp.grid.maxZ };
  const coastWays: number[][] = [];
  const waterPolys: number[][] = [];
  const piers: number[][] = [];
  const landuse: LandusePoly[] = [];
  const treeOut: number[] = [];

  const sorted = [...inp.osm].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const f of sorted) {
    const t = f.tags;
    if (t['natural'] === 'coastline') {
      for (const l of linesOf(f.geometry)) if (l.length >= 4) coastWays.push(l);
      continue;
    }
    if (t['natural'] === 'water') {
      for (const p of polygonsOf(f.geometry)) {
        waterPolys.push(p.outer);
      }
      continue;
    }
    if (t['man_made'] === 'pier') {
      for (const p of polygonsOf(f.geometry)) piers.push(p.outer);
      const w = Number.parseFloat(t['width'] ?? '');
      for (const l of linesOf(f.geometry)) piers.push(...bufferLine(l, Number.isFinite(w) ? w : 6));
      continue;
    }
    if (t['natural'] === 'tree' && f.geometry.type === 'Point') {
      const c = f.geometry.coordinates as number[];
      treeOut.push(...treeRecord(c[1] as number, c[0] as number, t['species'] ?? 'osm'));
      continue;
    }
    const cls = landuseOfTags(t);
    if (cls) for (const p of polygonsOf(f.geometry)) landuse.push({ cls, rings: [p.outer, ...p.holes] });
  }
  for (const r of inp.parks) for (const p of polygonsOf(r.shape)) landuse.push({ cls: 'park', rings: [p.outer, ...p.holes] });
  landuse.sort((a, b) => LANDUSE_ORDER.indexOf(a.cls) - LANDUSE_ORDER.indexOf(b.cls));

  for (const r of inp.trees) {
    const lat = Number(r.latitude), lng = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    treeOut.push(...treeRecord(lat, lng, String(r.species ?? 'unknown')));
  }

  const hoods: HoodPoly[] = [];
  for (const h of inp.hoods) {
    if (!h.nhood) continue;
    hoods.push({ name: h.nhood, polys: polygonsOf(h.the_geom) });
  }
  hoods.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const land = assembleLand({ coastWays, box, minRingKm2: inp.minRingKm2, baseLandHint: inp.baseLandHint });
  return { landRings: land.rings, waterPolys, piers, landuse, trees: treeOut, hoods, stats: land.stats };
}

// ---- rasters ----------------------------------------------------------------------------------------------------------

export function postRaster(grid: AreaGrid): Raster {
  return new Raster(grid.minX, grid.minZ, 4, grid.postsX, grid.postsY, 0);
}
export function cellRaster(grid: AreaGrid, init = 0): Raster {
  return new Raster(grid.minX, grid.minZ, 4, grid.nx * 64, grid.ny * 64, 0.5, init);
}

/** 1 where land (even-odd over the land rings) and not lake; sampled at the posts or the cell centres. */
export function landMask(r: Raster, w: WaterProduct): Raster {
  r.fillRings(w.landRings, 1);
  for (const lake of w.waterPolys) r.fillRings([lake], 0);
  return r;
}

export function pierMask(r: Raster, w: WaterProduct): Raster {
  for (const p of w.piers) r.fillRings([p], 1);
  return r;
}

export function hoodUnionMask(r: Raster, w: WaterProduct, box: Bbox): Raster {
  for (const h of w.hoods) for (const p of h.polys) {
    const clipped = clipRingToBox(p.outer, box);
    if (clipped.length < 6) continue;
    r.fillRings([clipped, ...p.holes.map((x) => clipRingToBox(x, box)).filter((x) => x.length >= 6)], 1);
  }
  return r;
}

/** Building-kind raster (0 none, 1 residential, 2 commercial, 3 industrial) at cell centres. */
export function kindMask(r: Raster, w: WaterProduct): Raster {
  for (const u of w.landuse) {
    if (u.cls === 'residential') r.fillRings(u.rings, KIND_CODE.residential);
    else if (u.cls === 'commercial') r.fillRings(u.rings, KIND_CODE.commercial);
    else if (u.cls === 'industrial') r.fillRings(u.rings, KIND_CODE.industrial);
  }
  return r;
}

export interface WaterGate {
  ratio: number;
  unionKm2: number;
  landInUnionKm2: number;
  landOutsideUnionKm2: number;
}

/** S3 gate numbers inside the area box: area(land ∩ union) / area(union), and area(land \ union) reported only (DL-655). */
export function waterGate(land: Raster, union: Raster, box: Bbox): WaterGate {
  let u = 0, both = 0, landOnly = 0;
  for (let j = 0; j < land.h; j++) {
    const z = land.zOf(j);
    if (z < box.minZ || z >= box.maxZ) continue;
    for (let i = 0; i < land.w; i++) {
      const x = land.xOf(i);
      if (x < box.minX || x >= box.maxX) continue;
      const l = land.data[j * land.w + i] === 1;
      const n = union.data[j * union.w + i] === 1;
      if (n) { u++; if (l) both++; } else if (l) landOnly++;
    }
  }
  const cell = 16 / 1e6;
  return { ratio: u === 0 ? 0 : both / u, unionKm2: u * cell, landInUnionKm2: both * cell, landOutsideUnionKm2: landOnly * cell };
}
