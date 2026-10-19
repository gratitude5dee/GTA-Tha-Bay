/**
 * S10 places (02-world-bake.md sections 7 to 9): the landmark table with arrival poses, the POI table bound to pedestrian
 * nodes, the district records with density profile indices, the transit nodes, landmark proxies and the `replaces` lists.
 *
 * Landmarks come from `content/world/landmarks.json`: the position is converted from lat/lng. The distance to the OSM feature
 * with the seed's id is measured to its geometry (0 inside an area, the area export `a<2N>` / `a<2N+1>` before the line; DL-708):
 * a seed inside stays put, one outside within 120 m snaps to the nearest point of the feature (inside an area), never to a
 * centroid, and farther than 120 m is a failure (a seed is corrected from OSM in the file, never waived). The arrival pose is
 * the nearest pedestrian node within 120 m that stands on ground, at least 3 m from water and from every prism; with none,
 * on `sf` the nearest such node at any distance (its distance goes to the report), on the offline areas a 2 m spiral on the
 * land pad; the landmark faces it.
 * The footprints a proxy replaces are the largest few whose centroid lies inside `replaceRadiusM` (hero 4, major 3, minor 2).
 */
import {
  enuFromLatLng, latLngFromEnu, chunkKeyAt, type ChunkKey, type LandmarkRecord, type PoiRecord, type TeleportNode, type TransitNode,
  type QualityTierId, type AssetRef,
} from '../../../../packages/shared/src/index.ts';
import { PointGrid, nearestOnPoly, yawOf } from '../geom/poly.ts';
import { ccwArea, pointInRing, ringBbox, ringCentroid, type Bbox } from '../geom/rings.ts';
import { type PrismIndex } from '../geom/prisms.ts';
import type { ContentWorld, LandmarkSeed } from '../content.ts';
import type { DensityConfig } from '../config.ts';
import type { OsmFeature } from '../sources/geo.ts';
import { polygonsOf, linesOf } from '../sources/geo.ts';
import type { BuildingsProduct } from './s4-buildings.ts';
import type { HoodPoly } from './s3-water.ts';
import type { PedProduct } from './s8-ped.ts';
import { districtRecords, slugOf } from '../districts-seed.ts';

export const FEATURE_SNAP_M = 120;
export const ARRIVAL_RADIUS_M = 120;
export const SWAP_M: Record<QualityTierId, number> = { 'desktop-ultra': 1200, desktop: 1200, 'xr-visionpro': 900, mobile: 500, 'xr-quest': 400, 'mobile-low': 350 };
const REPLACE_MAX = { hero: 4, major: 3, minor: 2 } as const;

export interface PlacesInputs {
  content: ContentWorld;
  box: Bbox;
  osm: readonly OsmFeature[];
  buildings: BuildingsProduct;
  prisms: PrismIndex;
  ped: PedProduct;
  hoods: readonly HoodPoly[];
  density: DensityConfig;
  chunkExists(k: ChunkKey): boolean;
  groundY(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
  /** `sf`: a landmark with no valid pedestrian node within 120 m arrives at the nearest valid one at any distance (DL-709 follow-up); other areas use a 2 m spiral on the land pads. */
  farArrival: boolean;
}

export interface PlacesReport {
  landmarks: number;
  landmarksSkipped: string[];
  featureMissing: string[];
  featureTooFar: { id: string; distM: number }[];
  /** Distance of every seed to its OSM feature's geometry (DL-708), in metres to 0.1. */
  featureDist: { id: string; distM: number; kind: 'area' | 'line' | 'node' }[];
  noArrival: string[];
  /** Landmarks whose arrival pose is farther than 120 m from the landmark (the nearest valid pedestrian node at any distance). */
  arrivalFar: { id: string; distM: number; x: number; z: number }[];
  snapped: number;
  pois: number;
  poisSkipped: string[];
  poisUnbound: string[];
  poisHoodMismatch: { id: string; hood: string }[];
  transit: number;
  proxies: number;
}
export interface PlacesProduct {
  landmarks: LandmarkRecord[];
  pois: PoiRecord[];
  districts: ReturnType<typeof districtRecords>;
  transit: TransitNode[];
  teleportNodes: Map<ChunkKey, TeleportNode[]>;
  /** footprint id to landmark index + 1 */
  proxies: Map<string, number>;
  /** landmark indices touching each chunk */
  lmrefs: Map<ChunkKey, number[]>;
  report: PlacesReport;
}

const q1 = (v: number): number => Math.round(v * 10) / 10;

export interface FeatureHit {
  /** The OSM object that was measured: `a<id>` for an area export, else the object itself. */
  id: string;
  kind: 'area' | 'line' | 'node';
  /** Metres from the query point to the geometry: 0 inside an area (outer ring, outside every hole). */
  distM: number;
  /** The query point when it is inside; else the nearest point of the feature (nudged into an area). */
  x: number;
  z: number;
  inside: boolean;
}

/** Export ids that carry the area of an OSM object: `a<2N>` for way N, `a<2N+1>` for relation N (osmium `--add-unique-id=type_id`). */
export function areaIdOf(osmId: string): string | null {
  const m = /^([wr])(\d+)$/.exec(osmId);
  if (!m) return null;
  const n = Number(m[2]);
  return `a${m[1] === 'w' ? 2 * n : 2 * n + 1}`;
}

/**
 * Distance from (x, z) to the OSM object `osmId`, measured to its geometry (DL-708). A way or relation is measured as its area
 * export when the extract has one, else as the line; a node as a point. Returns null when the extract holds none of them.
 */
export function nearestOnFeature(osm: readonly OsmFeature[], osmId: string, x: number, z: number): FeatureHit | null {
  const areaId = areaIdOf(osmId);
  let area: OsmFeature | undefined, other: OsmFeature | undefined;
  for (const f of osm) {
    if (areaId !== null && f.id === areaId) area = f;
    else if (f.id === osmId) other = f;
    if (area && other) break;
  }
  const f = area ?? other;
  if (!f) return null;
  if (f.geometry.type === 'Point') {
    const c = f.geometry.coordinates as number[];
    const e = enuFromLatLng(c[1] as number, c[0] as number);
    return { id: f.id, kind: 'node', distM: Math.hypot(e.x - x, e.z - z), x: e.x, z: e.z, inside: false };
  }
  const polys = polygonsOf(f.geometry);
  if (polys.length > 0) {
    let best = { d: Infinity, x: 0, z: 0 };
    for (const p of polys) {
      if (pointInRing(x, z, p.outer) && !p.holes.some((h) => pointInRing(x, z, h))) return { id: f.id, kind: 'area', distM: 0, x, z, inside: true };
      for (const ring of [p.outer, ...p.holes]) {
        const closed = ring.length >= 2 && (ring[0] !== ring[ring.length - 2] || ring[1] !== ring[ring.length - 1]) ? [...ring, ring[0] as number, ring[1] as number] : ring;
        const near = nearestOnPoly(closed, x, z);
        if (near.d < best.d) best = { d: near.d, x: near.x, z: near.z };
      }
    }
    // nudge the snapped point 0.5 m into the area (the nearest boundary point lies on the edge itself)
    let sx = best.x, sz = best.z;
    if (best.d > 0) {
      const ux = (best.x - x) / best.d, uz = (best.z - z) / best.d;
      const cx = best.x + ux * 0.5, cz = best.z + uz * 0.5;
      if (polys.some((p) => pointInRing(cx, cz, p.outer) && !p.holes.some((h) => pointInRing(cx, cz, h)))) { sx = cx; sz = cz; }
    }
    return { id: f.id, kind: 'area', distM: best.d, x: sx, z: sz, inside: false };
  }
  let best = { d: Infinity, x: 0, z: 0 };
  for (const line of linesOf(f.geometry)) {
    if (line.length < 4) continue;
    const near = nearestOnPoly(line, x, z);
    if (near.d < best.d) best = { d: near.d, x: near.x, z: near.z };
  }
  if (best.d === Infinity) return null;
  return { id: f.id, kind: 'line', distM: best.d, x: best.x, z: best.z, inside: false };
}

export function hoodAt(hoods: readonly HoodPoly[], x: number, z: number): string | null {
  for (const h of hoods) for (const p of h.polys) {
    const bb = ringBbox(p.outer);
    if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ) continue;
    if (pointInRing(x, z, p.outer) && !p.holes.some((hole) => pointInRing(x, z, hole))) return h.name;
  }
  return null;
}

export function runPlaces(inp: PlacesInputs): PlacesProduct {
  const c = inp.content;
  const report: PlacesReport = {
    landmarks: 0, landmarksSkipped: [], featureMissing: [], featureTooFar: [], featureDist: [], noArrival: [], arrivalFar: [], snapped: 0, pois: 0, poisSkipped: [], poisUnbound: [],
    poisHoodMismatch: [], transit: 0, proxies: 0,
  };

  // -- districts
  const districts = districtRecords(c, inp.density);
  const nhoodToDistrict = new Map<string, string>();
  for (const d of c.districts.districts) for (const n of d.nhoods) nhoodToDistrict.set(slugOf(n), d.id);

  // -- ped node index
  const pedGrid = new PointGrid<number>(32);
  inp.ped.points.forEach((p, i) => pedGrid.add(p.x, p.z, i));

  // -- arrival pose
  const valid = (x: number, z: number): boolean => {
    if (x < inp.box.minX + 4 || x > inp.box.maxX - 4 || z < inp.box.minZ + 4 || z > inp.box.maxZ - 4) return false;
    if (!inp.chunkExists(chunkKeyAt(9, x, z))) return false;
    if (inp.isWater(x, z)) return false;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      if (inp.isWater(x + Math.cos(a) * 3, z + Math.sin(a) * 3)) return false;
    }
    return !inp.prisms.near(x, z, 3);
  };
  const arrivalFor = (x: number, z: number): { x: number; z: number; farM?: number } | null => {
    for (const h of pedGrid.query(x, z, ARRIVAL_RADIUS_M)) {
      const p = inp.ped.points[h.item] as { x: number; z: number };
      if (valid(p.x, p.z)) return { x: p.x, z: p.z };
    }
    if (!inp.farArrival) {
      // the offline areas: landmarks stand on land pads that carry no sidewalks, so a 2 m spiral finds the ground
      for (let r = 0; r <= ARRIVAL_RADIUS_M; r += 2) {
        const n = r === 0 ? 1 : Math.max(8, Math.ceil((2 * Math.PI * r) / 2));
        for (let k = 0; k < n; k++) {
          const a = (k * 2 * Math.PI) / n;
          const px = q1(x + Math.cos(a) * r), pz = q1(z + Math.sin(a) * r);
          if (valid(px, pz)) return { x: px, z: pz };
        }
      }
      return null;
    }
    // sf: no pedestrian node within 120 m (a bridge deck over water, a closed shipyard): the nearest valid one at any distance
    const order = inp.ped.points.map((p, i) => ({ i, d: Math.hypot(p.x - x, p.z - z) })).sort((a, b) => a.d - b.d || a.i - b.i);
    for (const o of order) {
      const p = inp.ped.points[o.i] as { x: number; z: number };
      if (valid(p.x, p.z)) return { x: p.x, z: p.z, farM: o.d };
    }
    return null;
  };

  // -- footprints for proxies
  interface Fp { sid: string; x: number; z: number; area: number }
  const fps: Fp[] = [];
  const fpGrid = new PointGrid<number>(64);
  for (const list of inp.buildings.byChunk.values()) for (const b of list) {
    const cen = ringCentroid(b.prism);
    fpGrid.add(cen.x, cen.z, fps.length);
    fps.push({ sid: b.sid, x: cen.x, z: cen.z, area: Math.abs(ccwArea(b.prism)) });
  }

  // -- landmarks
  const landmarks: LandmarkRecord[] = [];
  const proxies = new Map<string, number>();
  const lmrefs = new Map<ChunkKey, number[]>();
  const teleportNodes = new Map<ChunkKey, TeleportNode[]>();
  const addTp = (n: TeleportNode): void => {
    const k = chunkKeyAt(9, n.x, n.z);
    const l = teleportNodes.get(k) ?? [];
    l.push(n);
    teleportNodes.set(k, l);
  };
  for (const s of c.landmarks as LandmarkSeed[]) {
    const e = enuFromLatLng(s.lat, s.lng);
    let x = e.x, z = e.z;
    if (x < inp.box.minX || x > inp.box.maxX || z < inp.box.minZ || z > inp.box.maxZ) { report.landmarksSkipped.push(s.id); continue; }
    if (/^[wrn]\d+$/.test(s.osm)) {
      const hit = nearestOnFeature(inp.osm, s.osm, x, z);
      if (!hit) report.featureMissing.push(s.id);
      else {
        report.featureDist.push({ id: s.id, distM: Math.round(hit.distM * 10) / 10, kind: hit.kind });
        if (hit.distM > FEATURE_SNAP_M) report.featureTooFar.push({ id: s.id, distM: Math.round(hit.distM) });
        else if (!hit.inside && hit.distM > 0) { x = hit.x; z = hit.z; report.snapped++; }   // inside stays put; outside snaps to the feature, never to a centroid
      }
    }
    x = q1(x); z = q1(z);
    if (!inp.chunkExists(chunkKeyAt(9, x, z))) { report.landmarksSkipped.push(s.id); continue; }
    const arr = arrivalFor(x, z);
    if (!arr) { report.noArrival.push(s.id); continue; }
    if (arr.farM !== undefined) report.arrivalFar.push({ id: s.id, distM: Math.round(arr.farM), x: arr.x, z: arr.z });
    const index = landmarks.length;
    // replaced footprints
    const cand = fpGrid.query(x, z, s.replaceRadiusM).map((h) => fps[h.item] as Fp).sort((a, b) => b.area - a.area || (a.sid < b.sid ? -1 : 1)).slice(0, REPLACE_MAX[s.cls]);
    const replaces = cand.map((f) => f.sid).sort();
    for (const f of cand) if (!proxies.has(f.sid)) proxies.set(f.sid, index + 1);
    const ll = latLngFromEnu(x, z);
    const hood = hoodAt(inp.hoods, x, z);
    const nh = hood ? slugOf(hood) : s.nhood;
    const slug = s.id.slice(3);
    const rec: LandmarkRecord = {
      id: s.id as LandmarkRecord['id'], nameKey: `place.${slug}`, lat: Math.round(ll.lat * 1e7) / 1e7, lng: Math.round(ll.lng * 1e7) / 1e7, x, z, chunk: chunkKeyAt(9, x, z),
      district: s.district, nhood: nh, cls: s.cls, asset: `building/${s.id}` as AssetRef, replaces, swapM: { ...SWAP_M }, skyline: s.skyline,
      arrival: { x: arr.x, z: arr.z, yaw: Math.round(yawOf(x - arr.x, z - arr.z) * 1000) / 1000 }, roles: [s.role],
    };
    landmarks.push(rec);
    const touching = new Set<ChunkKey>([rec.chunk]);
    for (const f of cand) touching.add(chunkKeyAt(9, f.x, f.z));
    for (const k of touching) { const l = lmrefs.get(k) ?? []; if (!l.includes(index)) l.push(index); lmrefs.set(k, l); }
    addTp({ id: `tp.${slug}`, x: arr.x, y: q1(inp.groundY(arr.x, arr.z)), z: arr.z, yaw: rec.arrival.yaw, kind: 'landmark' });
    report.landmarks++;
  }
  report.proxies = proxies.size;

  // -- transit nodes
  const transit: TransitNode[] = [];
  for (const s of c.transitLines.stations) {
    const e = enuFromLatLng(s.lat, s.lng);
    if (e.x < inp.box.minX || e.x > inp.box.maxX || e.z < inp.box.minZ || e.z > inp.box.maxZ) continue;
    let x = e.x, z = e.z;
    const hit = pedGrid.query(x, z, 80)[0];
    if (hit) { const p = inp.ped.points[hit.item] as { x: number; z: number }; x = p.x; z = p.z; }
    x = q1(x); z = q1(z);
    if (!inp.chunkExists(chunkKeyAt(9, x, z))) continue;
    transit.push({ id: s.id, kind: s.kind === 'city-metro' ? 'city-metro' : s.kind, x, z, nameKey: s.nameKey, fastTravel: s.fastTravel });
    addTp({ id: `tp.${s.id}`, x, y: q1(inp.groundY(x, z)), z, yaw: 0, kind: 'transit' });
    report.transit++;
  }
  transit.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // -- POIs
  const pois: PoiRecord[] = [];
  const lmById = new Map(landmarks.map((l) => [l.id as string, l] as const));
  for (const s of c.pois) {
    const e = enuFromLatLng(s.lat, s.lng);
    let x = e.x, z = e.z;
    if (x < inp.box.minX || x > inp.box.maxX || z < inp.box.minZ || z > inp.box.maxZ) { report.poisSkipped.push(s.id); continue; }
    const lmark = s.landmark ? lmById.get(s.landmark) : undefined;
    if (s.landmark && !lmark) { report.poisSkipped.push(s.id); continue; }
    if (lmark) { x = lmark.x; z = lmark.z; }
    // DL-709: the neighbourhood is tested at the anchor point (the landmark's point after S10, else the authored seed), never at a snapped node
    const anchorX = x, anchorZ = z;
    let pedNode: number | null = null;
    // a landmark POI binds to the ped node nearest its arrival pose (at most 25 m from the pose) and keeps its position at the landmark
    const bindX = lmark ? lmark.arrival.x : x, bindZ = lmark ? lmark.arrival.z : z;
    const near = pedGrid.query(bindX, bindZ, lmark ? 25 : s.snap ? 80 : 25)[0];
    if (near) {
      const p = inp.ped.points[near.item] as { x: number; z: number };
      if (s.snap && !lmark) { x = p.x; z = p.z; }
      pedNode = near.item;
    } else report.poisUnbound.push(s.id);
    x = q1(x); z = q1(z);
    const key = chunkKeyAt(9, x, z);
    if (!inp.chunkExists(key)) { report.poisSkipped.push(s.id); continue; }
    const hood = hoodAt(inp.hoods, anchorX, anchorZ);
    const nhood = hood ? slugOf(hood) : s.nhood;
    if (hood && slugOf(hood) !== s.nhood) report.poisHoodMismatch.push({ id: s.id, hood: slugOf(hood) });
    const district = nhoodToDistrict.get(nhood) ?? s.district;
    const ll = latLngFromEnu(x, z);
    pois.push({
      id: s.id as PoiRecord['id'], nameKey: s.nameKey, kind: s.kind as PoiRecord['kind'], lat: Math.round(ll.lat * 1e7) / 1e7, lng: Math.round(ll.lng * 1e7) / 1e7,
      x, y: q1(inp.groundY(x, z)), z, chunk: key, nhood, district, pedNode, hours: s.hours, landmark: lmark ? (lmark.id as PoiRecord['landmark']) : null,
    });
    report.pois++;
  }
  pois.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const l of teleportNodes.values()) l.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const l of lmrefs.values()) l.sort((a, b) => a - b);
  return { landmarks, pois, districts, transit, teleportNodes, proxies, lmrefs, report };
}
