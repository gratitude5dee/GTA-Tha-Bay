/**
 * S10 places (02-world-bake.md sections 7 to 9): the landmark table with arrival poses, the POI table bound to pedestrian
 * nodes, the district records with density profile indices, the transit nodes, landmark proxies and the `replaces` lists.
 *
 * Landmarks come from `content/world/landmarks.json`: the position is converted from lat/lng; when an OSM feature with the
 * seed's id exists in the extract and lies within 120 m, the landmark snaps to its centroid, farther than that is a failure
 * (a seed is corrected from OSM in the file, never waived). The arrival pose is the nearest point (a pedestrian node first,
 * then a 2 m spiral) that stands on ground, at least 3 m from water and from every prism; the landmark faces it.
 * The footprints a proxy replaces are the largest few whose centroid lies inside `replaceRadiusM` (hero 4, major 3, minor 2).
 */
import {
  enuFromLatLng, latLngFromEnu, chunkKeyAt, type ChunkKey, type LandmarkRecord, type PoiRecord, type TeleportNode, type TransitNode,
  type QualityTierId, type AssetRef,
} from '../../../../packages/shared/src/index.ts';
import { PointGrid, yawOf } from '../geom/poly.ts';
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
}

export interface PlacesReport {
  landmarks: number;
  landmarksSkipped: string[];
  featureMissing: string[];
  featureTooFar: { id: string; distM: number }[];
  noArrival: string[];
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

/** Centroid of an OSM feature found by id (way, relation or node), or null. */
function featureCentroid(osm: readonly OsmFeature[], id: string): { x: number; z: number } | null {
  for (const f of osm) {
    if (f.id !== id) continue;
    if (f.geometry.type === 'Point') { const c = f.geometry.coordinates as number[]; const e = enuFromLatLng(c[1] as number, c[0] as number); return { x: e.x, z: e.z }; }
    const poly = polygonsOf(f.geometry)[0];
    if (poly) return ringCentroid(poly.outer);
    const line = linesOf(f.geometry)[0];
    if (line && line.length >= 2) { let sx = 0, sz = 0; for (let i = 0; i < line.length; i += 2) { sx += line[i] as number; sz += line[i + 1] as number; } return { x: sx / (line.length / 2), z: sz / (line.length / 2) }; }
  }
  return null;
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
    landmarks: 0, landmarksSkipped: [], featureMissing: [], featureTooFar: [], noArrival: [], snapped: 0, pois: 0, poisSkipped: [], poisUnbound: [],
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
  const arrivalFor = (x: number, z: number): { x: number; z: number } | null => {
    const near = pedGrid.query(x, z, 40);
    for (const h of near) {
      const p = inp.ped.points[h.item] as { x: number; z: number };
      if (valid(p.x, p.z)) return { x: p.x, z: p.z };
    }
    for (let r = 0; r <= ARRIVAL_RADIUS_M; r += 2) {
      const n = r === 0 ? 1 : Math.max(8, Math.ceil((2 * Math.PI * r) / 2));
      for (let k = 0; k < n; k++) {
        const a = (k * 2 * Math.PI) / n;
        const px = q1(x + Math.cos(a) * r), pz = q1(z + Math.sin(a) * r);
        if (valid(px, pz)) return { x: px, z: pz };
      }
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
      const f = featureCentroid(inp.osm, s.osm);
      if (!f) report.featureMissing.push(s.id);
      else {
        const d = Math.hypot(f.x - x, f.z - z);
        if (d > FEATURE_SNAP_M) report.featureTooFar.push({ id: s.id, distM: Math.round(d) });
        else { x = f.x; z = f.z; report.snapped++; }
      }
    }
    x = q1(x); z = q1(z);
    if (!inp.chunkExists(chunkKeyAt(9, x, z))) { report.landmarksSkipped.push(s.id); continue; }
    const arr = arrivalFor(x, z);
    if (!arr) { report.noArrival.push(s.id); continue; }
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
    let pedNode: number | null = null;
    const near = pedGrid.query(x, z, s.snap ? 80 : 25)[0];
    if (near) {
      const p = inp.ped.points[near.item] as { x: number; z: number };
      if (s.snap) { x = p.x; z = p.z; }
      pedNode = near.item;
    } else report.poisUnbound.push(s.id);
    x = q1(x); z = q1(z);
    const key = chunkKeyAt(9, x, z);
    if (!inp.chunkExists(key)) { report.poisSkipped.push(s.id); continue; }
    const hood = hoodAt(inp.hoods, x, z);
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
