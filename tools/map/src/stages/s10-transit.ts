/**
 * S10 transit routes (M02a2, DL-664): the tool-owned data asset `data/transit-routes.v1`. All positions are real data in
 * ENU metres; names and liveries are fictional and appear only as NameRegistry keys, never as source strings.
 *
 *   metro     surface splines from OSM `railway=light_rail|tram` ways (tunnel ways dropped)
 *   bus       one pattern per `9exe-acju` shape, snapped to the road graph as an EdgeId list, with the `i28k-bkz6` stops of
 *             the pattern bound to (edge, s) within 25 m
 *   ferry     OSM `route=ferry` ways, else the authored lines of content/world/transit-lines.json
 *   cablecar  splines from the street-name chains of content/world/cablecars.json (each leg a path along edges of that street
 *             between its two cross streets; U-W6: a missing chain fails on `sf`, other areas skip them)
 *   air       the 3 authored corridors
 */
import { enuFromLatLng, type RoadEdge } from '../../../../packages/shared/src/index.ts';
import { PointGrid, nearestOnPoly, polyLength, resample } from '../geom/poly.ts';
import type { ContentWorld } from '../content.ts';
import type { EdgeGraph } from '../graph/route.ts';
import { route } from '../graph/route.ts';
import type { Geometry, OsmFeature } from '../sources/geo.ts';
import { linesOf } from '../sources/geo.ts';
import { normalizeStreetName, type NodeB, type SegB } from './s5-roads.ts';
import { edgeXz } from './s6-junctions.ts';

export interface RouteRow { route_name?: string; lineabbr?: string; direction?: string; shape?: Geometry }
export interface StopRow { stopname?: string; stopid?: string | number; latitude?: string | number; longitude?: string | number }

export interface TransitRoutes {
  schema: 'transit-routes/1';
  bakeId: string;
  metro: { id: string; nameKey: string; points: number[] }[];
  bus: { id: string; nameKey: string; edges: number[]; stops: { id: string; nameKey: string; edge: number; s: number }[] }[];
  ferry: { id: string; nameKey: string; source: 'osm' | 'authored'; points: number[] }[];
  cablecar: { id: string; nameKey: string; points: number[] }[];
  air: { id: string; nameKey: string; altitudeM: [number, number]; points: number[] }[];
}

export interface TransitReport {
  metro: number; bus: number; busStops: number; ferry: number; ferrySource: 'osm' | 'authored' | 'none'; cablecar: number; air: number;
  cablecarMissing: string[]; busGaps: number; busUnbound: number;
}

export interface TransitInputs {
  bakeId: string;
  osm: readonly OsmFeature[];
  routes: readonly RouteRow[];
  stops: readonly StopRow[];
  segs: readonly SegB[];
  edges: readonly RoadEdge[];
  nodes: readonly NodeB[];
  graph: EdgeGraph;
  content: ContentWorld;
  box: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** `sf` fails on a missing cable-car chain; other areas skip the chains. */
  requireCablecars: boolean;
}

const q1 = (v: number): number => Math.round(v * 10) / 10;
const flat = (p: readonly number[]): number[] => p.map(q1);
const slugId = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function runTransit(inp: TransitInputs): { routes: TransitRoutes; report: TransitReport } {
  const report: TransitReport = { metro: 0, bus: 0, busStops: 0, ferry: 0, ferrySource: 'none', cablecar: 0, air: 0, cablecarMissing: [], busGaps: 0, busUnbound: 0 };
  const out: TransitRoutes = { schema: 'transit-routes/1', bakeId: inp.bakeId, metro: [], bus: [], ferry: [], cablecar: [], air: [] };
  const sorted = [...inp.osm].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const inBox = (x: number, z: number): boolean => x >= inp.box.minX && x <= inp.box.maxX && z >= inp.box.minZ && z <= inp.box.maxZ;

  // -- metro
  for (const f of sorted) {
    const t = f.tags;
    if ((t['railway'] !== 'light_rail' && t['railway'] !== 'tram') || t['tunnel'] === 'yes' || t['tunnel'] === 'building_passage') continue;
    for (const [i, line] of linesOf(f.geometry).entries()) {
      if (line.length < 4) continue;
      const pts = flat(resample(line, 40));
      out.metro.push({ id: `metro.${f.id}${i ? `-${i}` : ''}`, nameKey: `transit.metro.${f.id}${i ? `-${i}` : ''}`, points: pts });
    }
  }
  report.metro = out.metro.length;

  // -- edge index for snapping
  const grid = new PointGrid<number>(24);
  inp.edges.forEach((e) => {
    const g = edgeXz(inp.segs[e.seg] as SegB, e.dir);
    const pts = resample(g, 10);
    for (let i = 0; i < pts.length; i += 2) grid.add(pts[i] as number, pts[i + 1] as number, e.id);
  });
  const edgeGeom = (id: number): number[] => { const e = inp.edges[id] as RoadEdge; return edgeXz(inp.segs[e.seg] as SegB, e.dir); };

  // -- bus patterns
  const stopRows = inp.stops.map((s) => {
    const e = enuFromLatLng(Number(s.latitude), Number(s.longitude));
    return { id: String(s.stopid ?? ''), x: e.x, z: e.z };
  }).filter((s) => s.id && Number.isFinite(s.x) && inBox(s.x, s.z));
  for (const r of [...inp.routes].sort((a, b) => ((a.lineabbr ?? '') + (a.direction ?? '')).localeCompare((b.lineabbr ?? '') + (b.direction ?? '')))) {
    if (!r.shape) continue;
    const lines = linesOf(r.shape);
    const edgeSeq: number[] = [];
    for (const line of lines) {
      const pts = resample(line, 20);
      let last = -1;
      for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i] as number, z = pts[i + 1] as number;
        if (!inBox(x, z)) continue;
        // direction of the shape here
        const j = Math.min(pts.length - 2, i), k = Math.max(0, i - 2);
        const dx = (pts[Math.min(pts.length - 2, j + 2) ] as number) - (pts[k] as number), dz = (pts[Math.min(pts.length - 1, j + 3)] as number) - (pts[k + 1] as number);
        let best: { e: number; d: number } | null = null;
        for (const h of grid.query(x, z, 18)) {
          const e = inp.edges[h.item] as RoadEdge;
          const near = nearestOnPoly(edgeGeom(e.id), x, z);
          if (near.d > 15) continue;
          if (near.tx * dx + near.tz * dz <= 0) continue;
          if (!best || near.d < best.d - 1e-6 || (Math.abs(near.d - best.d) <= 1e-6 && e.id < best.e)) best = { e: e.id, d: near.d };
        }
        if (!best || best.e === last) continue;
        if (last >= 0) {
          const le = inp.edges[last] as RoadEdge, be = inp.edges[best.e] as RoadEdge;
          if (le.to !== be.from) {
            const r2 = route(inp.graph, last, best.e, undefined, 20000);
            if (r2) for (const e of r2.edges.slice(1, -1)) edgeSeq.push(e);
            else report.busGaps++;
          }
        }
        edgeSeq.push(best.e);
        last = best.e;
      }
    }
    // collapse repeats
    const edges = edgeSeq.filter((e, i) => i === 0 || e !== edgeSeq[i - 1]);
    if (edges.length === 0) continue;
    const abbr = slugId(r.lineabbr ?? r.route_name ?? 'x');
    const dir = slugId(r.direction ?? 'a');
    const id = `bus.${abbr}.${dir}`;
    // stops of this pattern
    const onPattern = new Set(edges);
    const stops: { id: string; nameKey: string; edge: number; s: number; order: number }[] = [];
    for (const st of stopRows) {
      let best: { e: number; d: number; s: number } | null = null;
      for (const h of grid.query(st.x, st.z, 25)) {
        if (!onPattern.has(h.item)) continue;
        const near = nearestOnPoly(edgeGeom(h.item), st.x, st.z);
        if (near.d > 25) continue;
        if (!best || near.d < best.d) best = { e: h.item, d: near.d, s: near.s };
      }
      if (!best) continue;
      stops.push({ id: `stop.${slugId(st.id)}`, nameKey: `transit.stop.${slugId(st.id)}`, edge: best.e, s: q1(best.s), order: edges.indexOf(best.e) * 1e6 + best.s });
    }
    stops.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
    const unique = stops.filter((s, i) => i === 0 || s.id !== (stops[i - 1] as { id: string }).id);
    out.bus.push({ id, nameKey: `transit.bus.${abbr}`, edges, stops: unique.map(({ order: _o, ...rest }) => rest) });
    report.busStops += unique.length;
  }
  out.bus.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  report.bus = out.bus.length;

  // -- ferry
  const ferries: TransitRoutes['ferry'] = [];
  for (const f of sorted) {
    if (f.tags['route'] !== 'ferry') continue;
    for (const [i, line] of linesOf(f.geometry).entries()) {
      if (line.length < 4) continue;
      ferries.push({ id: `ferry.${f.id}${i ? `-${i}` : ''}`, nameKey: `transit.ferry.${f.id}${i ? `-${i}` : ''}`, source: 'osm', points: flat(resample(line, 100)) });
    }
  }
  if (ferries.length > 0) { out.ferry = ferries; report.ferrySource = 'osm'; }
  else {
    for (const l of inp.content.transitLines.ferry) {
      const pts: number[] = [];
      for (const p of l.points) { const e = enuFromLatLng(p.lat, p.lng); pts.push(e.x, e.z); }
      out.ferry.push({ id: l.id, nameKey: l.nameKey, source: 'authored', points: flat(resample(pts, 100)) });
    }
    report.ferrySource = out.ferry.length > 0 ? 'authored' : 'none';
  }
  report.ferry = out.ferry.length;

  // -- cable cars
  const namesAt = new Map<string, Set<number>>();
  inp.segs.forEach((s, i) => {
    const n = normalizeStreetName(s.name);
    if (!n) return;
    for (const node of [s.a, s.b]) {
      const key = `${node}`;
      const set = namesAt.get(key) ?? new Set<number>();
      set.add(i);
      namesAt.set(key, set);
    }
  });
  const nodesWith = (street: string, cross: string): number[] => {
    const a = normalizeStreetName(street), b = normalizeStreetName(cross);
    const out2: number[] = [];
    for (const n of inp.nodes) {
      const segsHere = namesAt.get(`${n.id}`);
      if (!segsHere) continue;
      const names = new Set([...segsHere].map((i) => normalizeStreetName((inp.segs[i] as SegB).name)));
      if (names.has(a) && names.has(b)) out2.push(n.id);
    }
    return out2;
  };
  const legPath = (street: string, from: number, to: number): number[] | null => {
    // shortest path over segments named `street`, undirected
    const sn = normalizeStreetName(street);
    const adj = new Map<number, { seg: number; other: number }[]>();
    inp.segs.forEach((s, i) => {
      if (normalizeStreetName(s.name) !== sn) return;
      (adj.get(s.a) ?? adj.set(s.a, []).get(s.a)!).push({ seg: i, other: s.b });
      (adj.get(s.b) ?? adj.set(s.b, []).get(s.b)!).push({ seg: i, other: s.a });
    });
    const dist = new Map<number, number>([[from, 0]]);
    const prev = new Map<number, { node: number; seg: number }>();
    const queue = [from];
    while (queue.length > 0) {
      queue.sort((a, b) => (dist.get(a) as number) - (dist.get(b) as number) || a - b);
      const u = queue.shift() as number;
      if (u === to) break;
      for (const { seg, other } of adj.get(u) ?? []) {
        const nd = (dist.get(u) as number) + (inp.segs[seg] as SegB).lengthM;
        if (nd < (dist.get(other) ?? Infinity)) { dist.set(other, nd); prev.set(other, { node: u, seg }); queue.push(other); }
      }
    }
    if (!dist.has(to)) return null;
    const segsOut: number[] = [];
    for (let u = to; u !== from;) { const p = prev.get(u) as { node: number; seg: number }; segsOut.push(p.seg); u = p.node; }
    return segsOut.reverse();
  };
  for (const line of inp.content.cablecars.lines) {
    const pts: number[] = [];
    let ok = true;
    let at = -1;
    for (const leg of line.legs) {
      const starts = nodesWith(leg.street, leg.from), ends = nodesWith(leg.street, leg.to);
      if (starts.length === 0 || ends.length === 0) { ok = false; break; }
      let path: number[] | null = null;
      let startNode = -1;
      for (const s0 of at >= 0 && starts.includes(at) ? [at] : starts) {
        for (const e0 of ends) { const p = legPath(leg.street, s0, e0); if (p && (!path || p.length < path.length)) { path = p; startNode = s0; } }
      }
      if (!path) { ok = false; break; }
      // append the polylines in travel order
      let cur = startNode;
      for (const si of path) {
        const s = inp.segs[si] as SegB;
        const fwd = s.a === cur;
        const g = fwd ? s.pts : edgeXzRev(s.pts);
        for (let i = pts.length === 0 ? 0 : 2; i < g.length; i += 2) pts.push(g[i] as number, g[i + 1] as number);
        cur = fwd ? s.b : s.a;
      }
      at = cur;
    }
    if (ok && polyLength(pts) > 0) {
      out.cablecar.push({ id: line.id, nameKey: `transit.${line.id}`, points: flat(pts) });
    } else report.cablecarMissing.push(line.id);
  }
  report.cablecar = out.cablecar.length;

  // -- air corridors
  for (const a of inp.content.transitLines.air) {
    const pts: number[] = [];
    for (const p of a.points) { const e = enuFromLatLng(p.lat, p.lng); pts.push(e.x, e.z); }
    out.air.push({ id: a.id, nameKey: a.nameKey, altitudeM: [a.altitudeM[0], a.altitudeM[1]], points: flat(pts) });
  }
  report.air = out.air.length;
  return { routes: out, report };
}

function edgeXzRev(p: number[]): number[] {
  const o: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) o.push(p[i] as number, p[i + 1] as number);
  return o;
}
