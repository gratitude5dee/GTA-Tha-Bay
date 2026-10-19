/**
 * S9 tags (02-world-bake.md section 4 S9 table; contract rule 15). The seven tag types per chunk:
 * hidingSpots (viaduct undersides every 60 m, multi-storey and underground garage entrances, alleys, car washes, rail
 * tunnel portals), pursuitBreakers (authored, snapped to an edge within 12 m), chokePoints (bridge and tunnel mouths, ramps
 * with at most two lanes, narrow streets), jumpZones (crests with vertical curvature above 0.02 /m at speeds from 11 m/s,
 * at most three per chunk), portals (authored bridge, ferry and tunnel seeds snapped to the graph, plus one `county-line`
 * portal per drivable edge that leaves the neighbourhood union on land and is not on an island, DL-706), shoreNodes (land-side coastline samples every
 * 40 m with the outward normal, piers included) and teleportNodes (XR nodes at stairs and slopes of 15 % and more; landmark
 * and transit nodes come from S10, which runs after this stage).
 * A chunk holds at most 24 records per type (contract rule 20): derived records beyond that are thinned in hash order and
 * counted in the report, never silently dropped.
 */
import {
  PedEdgeKind, PedNodeFlag, RoadClass, chunkKeyAt, enuFromLatLng, fnv32,
  type ChunkKey, type ChunkTags, type Portal, type RoadEdge,
} from '../../../../packages/shared/src/index.ts';
import { PointGrid, nearestOnPoly, pointAt3, polyLength, yawOf } from '../geom/poly.ts';
import { ccwArea, type Bbox } from '../geom/rings.ts';
import type { ContentWorld } from '../content.ts';
import type { OsmFeature } from '../sources/geo.ts';
import { linesOf, polygonsOf } from '../sources/geo.ts';
import type { TerrainField } from './s2-terrain.ts';
import type { NodeB, SegB } from './s5-roads.ts';
import type { BridgesConfig } from './s7-grading.ts';
import type { PedProduct } from './s8-ped.ts';
import { ringCentroid } from '../geom/rings.ts';

export const TAG_LIMIT = 24;
export const JUMP_PER_CHUNK = 3;
export const XR_PER_CHUNK = 12;

export interface TagsInputs {
  segs: readonly SegB[];
  edges: readonly RoadEdge[];
  nodes: readonly NodeB[];
  ped: PedProduct;
  osm: readonly OsmFeature[];
  field: TerrainField;
  landRings: readonly number[][];
  pierRings: readonly number[][];
  box: Bbox;
  inUnion(x: number, z: number): boolean;
  isLand(x: number, z: number): boolean;
  content: ContentWorld;
  bridges: BridgesConfig;
}

export interface TagsReport {
  counts: Record<string, number>;
  thinned: Record<string, number>;
  breakersSnapped: number;
  breakersDropped: string[];
  portalsSnapped: string[];
  portalsMissing: string[];
  countyLine: number;
}
export interface TagsProduct { tags: Map<ChunkKey, ChunkTags>; portals: Portal[]; report: TagsReport }

type Rec = Record<string, unknown> & { id: string; x: number; y: number; z: number };

const dmq = (v: number): number => Math.round(v * 10) / 10;

export function runTags(inp: TagsInputs): TagsProduct {
  const lists = new Map<ChunkKey, Record<string, Rec[]>>();
  const add = (type: keyof ChunkTags, rec: Rec): void => {
    rec.x = dmq(rec.x); rec.y = dmq(rec.y); rec.z = dmq(rec.z);
    if (rec.x < inp.box.minX || rec.x > inp.box.maxX || rec.z < inp.box.minZ || rec.z > inp.box.maxZ) return;
    const key = chunkKeyAt(9, rec.x, rec.z);
    let m = lists.get(key);
    if (!m) lists.set(key, (m = {}));
    (m[type] ??= []).push(rec);
  };
  const idAt = (p: string, x: number, z: number): string => `${p}.${Math.round(x * 10)}.${Math.round(z * 10)}`;
  const groundY = (x: number, z: number): number => inp.field.heightAt(x, z) ?? 0;

  // -- hiding spots
  inp.segs.forEach((s) => {
    if (!s.bridge || s.cls > RoadClass.Ramp) return;
    const L = polyLength(s.pts);
    for (let d = 30; d < L; d += 60) {
      const p = pointAt3(s.pts, s.ys, d);
      const g = groundY(p.x, p.z);
      if (p.y - g >= 4) add('hidingSpots', { id: idAt('hs.viaduct', p.x, p.z), x: p.x, y: g, z: p.z, radiusM: 6, kind: 'viaduct' });
    }
  });
  const centroid = (f: OsmFeature): { x: number; z: number } | null => {
    if (f.geometry.type === 'Point') { const c = f.geometry.coordinates as number[]; const e = enuFromLatLng(c[1] as number, c[0] as number); return { x: e.x, z: e.z }; }
    const poly = polygonsOf(f.geometry)[0];
    return poly ? ringCentroid(poly.outer) : null;
  };
  for (const f of [...inp.osm].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const t = f.tags;
    if (t['amenity'] === 'parking' && (t['parking'] === 'multi-storey' || t['parking'] === 'underground')) {
      const c = centroid(f);
      if (c) add('hidingSpots', { id: idAt('hs.garage', c.x, c.z), x: c.x, y: groundY(c.x, c.z), z: c.z, radiusM: 8, kind: 'garage' });
    } else if (t['amenity'] === 'car_wash') {
      const c = centroid(f);
      if (c) add('hidingSpots', { id: idAt('hs.carwash', c.x, c.z), x: c.x, y: groundY(c.x, c.z), z: c.z, radiusM: 6, kind: 'carwash' });
    } else if (t['highway'] === 'service' && t['service'] === 'alley') {
      for (const line of linesOf(f.geometry)) {
        for (let i = 0; i + 3 < line.length; i += 2) {
          const x = ((line[i] as number) + (line[i + 2] as number)) / 2, z = ((line[i + 1] as number) + (line[i + 3] as number)) / 2;
          if (i % 8 === 0) add('hidingSpots', { id: idAt('hs.alley', x, z), x, y: groundY(x, z), z, radiusM: 5, kind: 'alley' });
        }
      }
    } else if ((t['railway'] === 'light_rail' || t['railway'] === 'tram' || t['railway'] === 'subway') && t['tunnel'] === 'yes') {
      for (const line of linesOf(f.geometry)) {
        for (const [x, z] of [[line[0], line[1]], [line[line.length - 2], line[line.length - 1]]] as [number, number][]) {
          add('hidingSpots', { id: idAt('hs.portal', x, z), x, y: groundY(x, z), z, radiusM: 7, kind: 'tunnel-portal' });
        }
      }
    }
  }

  // -- edge index for snapping
  const grid = new PointGrid<number>(32);
  inp.segs.forEach((s, i) => {
    const L = polyLength(s.pts);
    for (let d = 0; d <= L; d += 8) { const p = pointAt3(s.pts, s.ys, d); grid.add(p.x, p.z, i); }
    const e = pointAt3(s.pts, s.ys, L);
    grid.add(e.x, e.z, i);
  });
  const edgeOfSeg = (s: SegB): number => (s.eF >= 0 ? s.eF : s.eB);

  // -- pursuit breakers
  const report: TagsReport = { counts: {}, thinned: {}, breakersSnapped: 0, breakersDropped: [], portalsSnapped: [], portalsMissing: [], countyLine: 0 };
  for (const b of inp.content.pursuitBreakers) {
    const e = enuFromLatLng(b.lat, b.lng);
    const hit = grid.nearest(e.x, e.z, 12);
    if (!hit) { report.breakersDropped.push(b.id); continue; }
    const s = inp.segs[hit.item] as SegB;
    const near = nearestOnPoly(s.pts, e.x, e.z);
    if (near.d > 12) { report.breakersDropped.push(b.id); continue; }
    const p = pointAt3(s.pts, s.ys, near.s);
    add('pursuitBreakers', { id: b.id, x: p.x, y: p.y, z: p.z, triggerRadiusM: b.triggerRadiusM, kind: b.kind, prefab: b.prefab, mission: b.mission });
    report.breakersSnapped++;
  }

  // -- choke points
  inp.segs.forEach((s) => {
    const edge = edgeOfSeg(s);
    if (edge < 0) return;
    const p = pointAt3(s.pts, s.ys, 0);
    if (s.bridge && s.cls !== RoadClass.Service) add('chokePoints', { id: idAt('cp.bridge', p.x, p.z), x: p.x, y: p.y, z: p.z, edge, widthM: s.widthM, kind: 'bridge' });
    else if (s.tunnel) add('chokePoints', { id: idAt('cp.tunnel', p.x, p.z), x: p.x, y: p.y, z: p.z, edge, widthM: s.widthM, kind: 'tunnel' });
    else if (s.cls === RoadClass.Ramp && Math.max(s.lanesF, s.lanesB) <= 2) add('chokePoints', { id: idAt('cp.ramp', p.x, p.z), x: p.x, y: p.y, z: p.z, edge, widthM: s.widthM, kind: 'ramp' });
    else if ((s.cls === RoadClass.Local || s.cls === RoadClass.Collector) && s.widthM <= 6.2 && polyLength(s.pts) >= 40) {
      const m = pointAt3(s.pts, s.ys, polyLength(s.pts) / 2);
      add('chokePoints', { id: idAt('cp.narrow', m.x, m.z), x: m.x, y: m.y, z: m.z, edge, widthM: s.widthM, kind: 'narrow' });
    }
  });

  // -- jump zones: crests
  interface Crest { kappa: number; rec: Rec }
  const crests = new Map<ChunkKey, Crest[]>();
  inp.segs.forEach((s) => {
    if (s.bridge || s.tunnel || s.speedMps < 11 || s.cls < RoadClass.Arterial || s.cls > RoadClass.Local) return;
    const edge = edgeOfSeg(s);
    if (edge < 0) return;
    const L = polyLength(s.pts);
    if (L < 24) return;
    let acc = 0;
    for (let i = 1; i < s.pts.length / 2 - 1; i++) {
      acc += Math.hypot((s.pts[i * 2] as number) - (s.pts[i * 2 - 2] as number), (s.pts[i * 2 + 1] as number) - (s.pts[i * 2 - 1] as number));
      if (acc < 8 || acc > L - 8) continue;
      const a = pointAt3(s.pts, s.ys, acc - 8), c = pointAt3(s.pts, s.ys, acc), b = pointAt3(s.pts, s.ys, acc + 8);
      const before = (c.y - a.y) / 8, after = (b.y - c.y) / 8;
      const kappa = (before - after) / 8;
      if (before > 0 && after < 0 && kappa > 0.02) {
        const key = chunkKeyAt(9, c.x, c.z);
        const dir = s.eF >= 0 ? 1 : -1;
        const rec: Rec = { id: idAt('jz.crest', c.x, c.z), x: c.x, y: c.y, z: c.z, yaw: yawOf(c.tx * dir, c.tz * dir), lengthM: 30, kind: 'hill-crest' };
        const l = crests.get(key) ?? [];
        l.push({ kappa, rec });
        crests.set(key, l);
      }
    }
  });
  for (const [, l] of [...crests.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    l.sort((p, q) => q.kappa - p.kappa || (p.rec.id < q.rec.id ? -1 : 1));
    for (const c of l.slice(0, JUMP_PER_CHUNK)) add('jumpZones', c.rec);
  }

  // -- portals
  const portals: Portal[] = [];
  const found = new Set<string>();
  for (const p of inp.bridges.portals) {
    const e = enuFromLatLng(p.lat, p.lng);
    let best: { seg: SegB; d: number; s: number } | null = null;
    for (const h of grid.query(e.x, e.z, p.snapM)) {
      const s = inp.segs[h.item] as SegB;
      if (p.kind === 'bridge' && !s.bridge && !s.tunnel) continue;
      const near = nearestOnPoly(s.pts, e.x, e.z);
      if (!best || near.d < best.d) best = { seg: s, d: near.d, s: near.s };
    }
    if (!best) { report.portalsMissing.push(p.id); continue; }
    const pt = pointAt3(best.seg.pts, best.seg.ys, best.s);
    const edges = [best.seg.eF, best.seg.eB].filter((x) => x >= 0);
    const rec: Portal = { id: p.id, x: dmq(pt.x), y: dmq(pt.y), z: dmq(pt.z), yaw: yawOf(pt.tx, pt.tz), widthM: p.widthM, kind: p.kind === 'county-line' ? 'county-line' : p.kind, state: 'closed', toArea: p.toArea, edges };
    portals.push(rec);
    found.add(p.id);
    report.portalsSnapped.push(p.id);
    add('portals', rec as unknown as Rec);
  }
  inp.edges.forEach((e) => {
    const s = inp.segs[e.seg] as SegB;
    if (s.island === true) return;   // an island gets no portal (DL-706); dropped fragments are not in the graph
    const from = inp.nodes[e.from] as NodeB, to = inp.nodes[e.to] as NodeB;
    if (!inp.inUnion(from.x, from.z) || inp.inUnion(to.x, to.z) || !inp.isLand(to.x, to.z)) return;
    // the last point of the edge inside the union
    const n = s.pts.length / 2;
    let k = 0;
    const ox: number[] = [], oz: number[] = [], oy: number[] = [];
    for (let i = 0; i < n; i++) {
      const si = e.dir === 1 ? i : n - 1 - i;
      ox.push(s.pts[si * 2] as number); oz.push(s.pts[si * 2 + 1] as number); oy.push(s.ys[si] as number);
    }
    for (let i = 0; i < n; i++) if (inp.inUnion(ox[i] as number, oz[i] as number)) k = i;
    const j = Math.min(n - 1, k + 1);
    const dx = (ox[j] as number) - (ox[k] as number), dz = (oz[j] as number) - (oz[k] as number);
    const rec: Portal = {
      id: `portal.cl.${e.id}`, x: dmq(ox[k] as number), y: dmq(oy[k] as number), z: dmq(oz[k] as number), yaw: yawOf(dx, dz), widthM: inp.bridges.countyLine.widthM,
      kind: 'county-line', state: 'open', toArea: inp.bridges.countyLine.toArea, edges: [e.id],
    };
    portals.push(rec);
    report.countyLine++;
    add('portals', rec as unknown as Rec);
  });

  // -- shore nodes
  const rings = [...inp.landRings, ...inp.pierRings];
  const edgeTol = 3;
  for (const r of rings) {
    const n = r.length / 2;
    if (n < 3) continue;
    const outward = ccwArea(r) >= 0 ? 1 : -1;
    let acc = 0, next = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = r[i * 2] as number, z0 = r[i * 2 + 1] as number, x1 = r[j * 2] as number, z1 = r[j * 2 + 1] as number;
      const d = Math.hypot(x1 - x0, z1 - z0);
      if (d === 0) continue;
      const dx = (x1 - x0) / d, dz = (z1 - z0) / d;
      const nx = outward * -dz, nz = outward * dx;
      while (next < acc + d) {
        const u = next - acc;
        const px = x0 + dx * u, pz = z0 + dz * u;
        next += 40;
        const b = inp.box;
        if (px < b.minX + edgeTol || px > b.maxX - edgeTol || pz < b.minZ + edgeTol || pz > b.maxZ - edgeTol) continue;
        const lx = px - nx * 2, lz = pz - nz * 2;
        add('shoreNodes', { id: idAt('sn', lx, lz), x: lx, y: groundY(lx, lz), z: lz, nx: Math.round(nx * 127) / 127, nz: Math.round(nz * 127) / 127 });
      }
      acc += d;
    }
  }

  // -- teleport nodes: stairs and steep walkways (XR comfort); none beside an island (DL-706)
  const islandGrid = new PointGrid<number>(32);
  inp.segs.forEach((s, i) => {
    if (s.island !== true) return;
    const L = polyLength(s.pts);
    for (let d = 0; d <= L; d += 8) { const p = pointAt3(s.pts, s.ys, d); islandGrid.add(p.x, p.z, i); }
  });
  const nearIsland = (x: number, z: number): boolean => islandGrid.nearest(x, z, 14) !== null;
  for (const [key, c] of inp.ped.chunks) {
    const byId = new Map(c.nodes.map((n) => [n.id, n] as const));
    for (const n of c.nodes) {
      if ((n.flags & PedNodeFlag.Stairs) !== 0 && !nearIsland(n.x, n.z)) add('teleportNodes', { id: idAt('tp.xr', n.x, n.z), x: n.x, y: n.y, z: n.z, yaw: 0, kind: 'xr' });
    }
    for (const e of c.edges) {
      if (e.kind !== PedEdgeKind.Sidewalk && e.kind !== PedEdgeKind.Path) continue;
      const a = byId.get(e.a), b = byId.get(e.b);
      if (!a || !b) continue;
      const h = Math.hypot(b.x - a.x, b.z - a.z);
      if (h >= 4 && Math.abs(b.y - a.y) / h >= 0.15 && !nearIsland(a.x, a.z)) add('teleportNodes', { id: idAt('tp.xr', a.x, a.z), x: a.x, y: a.y, z: a.z, yaw: yawOf(b.x - a.x, b.z - a.z), kind: 'xr' });
    }
    void key;
  }

  // -- assemble: thin to the limit in hash order, stable order by id
  const tags = new Map<ChunkKey, ChunkTags>();
  const types: (keyof ChunkTags)[] = ['hidingSpots', 'pursuitBreakers', 'chokePoints', 'jumpZones', 'portals', 'shoreNodes', 'teleportNodes'];
  for (const [key, m] of [...lists.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const out: Record<string, Rec[]> = {};
    for (const type of types) {
      let l = m[type] ?? [];
      const seen = new Set<string>();
      l = l.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
      // XR comfort nodes are samples of every steep walkway: thinning them is expected and not reported; the room left
      // under the limit (12 of 24) is for the landmark and transit nodes that S10 adds
      const limit = type === 'teleportNodes' ? XR_PER_CHUNK : TAG_LIMIT;
      if (l.length > limit) {
        if (type !== 'teleportNodes') report.thinned[type] = (report.thinned[type] ?? 0) + (l.length - limit);
        l = [...l].sort((p, q) => fnv32(p.id) - fnv32(q.id) || (p.id < q.id ? -1 : 1)).slice(0, limit);
      }
      l.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
      out[type] = l;
      report.counts[type] = (report.counts[type] ?? 0) + l.length;
    }
    tags.set(key, out as unknown as ChunkTags);
  }
  return { tags, portals: portals.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), report };
}
