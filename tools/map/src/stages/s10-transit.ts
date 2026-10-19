/**
 * S10 transit routes (M02a2, DL-664): the tool-owned data asset `data/transit-routes.v1`. All positions are real data in
 * ENU metres; names and liveries are fictional and appear only as NameRegistry keys, never as source strings.
 *
 *   metro     surface splines from OSM `railway=light_rail|tram` ways (tunnel ways dropped)
 *   bus       one pattern per `9exe-acju` shape, snapped to the road graph as an EdgeId list, with the `i28k-bkz6` stops of
 *             the pattern bound to (edge, s) within 25 m
 *   ferry     OSM `route=ferry` ways, else the authored lines of content/world/transit-lines.json
 *   cablecar  splines from the street-name chains of content/world/cablecars.json (each leg a path along edges of that street
 *             and the OSM cable rails between its two cross streets; a chain end with no node carrying both street names
 *             resolves to the `railway=turntable` at that terminus; every resampled spline point must lie within 6 m of a
 *             street edge, a tram rail or a turntable; U-W6, DL-710: a missing chain or a point off the network fails on `sf`,
 *             other areas skip them)
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
  /** The 6 m check of every built cable-car spline (resampled every 5 m): worst distance, its anchor OSM id and the turntables the chain ends resolved to. */
  cablecarCheck: { id: string; points: number; worstM: number; worstAnchor: string; turntables: string[] }[];
  /** Lines with a spline point more than 6 m from every street edge, tram rail and turntable (a bake failure on sf). */
  cablecarOff: string[];
}
export const CABLE_CHECK_M = 6;
const TURNTABLE_JOIN_M = 20;

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
  const report: TransitReport = { metro: 0, bus: 0, busStops: 0, ferry: 0, ferrySource: 'none', cablecar: 0, air: 0, cablecarMissing: [], busGaps: 0, busUnbound: 0, cablecarCheck: [], cablecarOff: [] };
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

  // -- cable cars (U-W6, DL-710)
  cableCars(inp, sorted, out, report);

  // -- air corridors
  for (const a of inp.content.transitLines.air) {
    const pts: number[] = [];
    for (const p of a.points) { const e = enuFromLatLng(p.lat, p.lng); pts.push(e.x, e.z); }
    out.air.push({ id: a.id, nameKey: a.nameKey, altitudeM: [a.altitudeM[0], a.altitudeM[1]], points: flat(pts) });
  }
  report.air = out.air.length;
  return { routes: out, report };
}

// ---- cable cars -----------------------------------------------------------------------------------------------------------

interface CNode { x: number; z: number }
interface CEdge { to: number; len: number; pts: number[]; src: string }

/** Dijkstra over an explicit graph (a few thousand nodes: a scan for the minimum keeps the order deterministic). */
function shortest(adj: readonly (CEdge[] | undefined)[], starts: readonly number[], ends: ReadonlySet<number>): { nodes: number[]; edges: CEdge[] } | null {
  const dist = new Float64Array(adj.length).fill(Infinity);
  const prev = new Int32Array(adj.length).fill(-1);
  const prevEdge: (CEdge | null)[] = new Array(adj.length).fill(null);
  const queue: number[] = [];
  for (const s0 of starts) { dist[s0] = 0; queue.push(s0); }
  const done = new Uint8Array(adj.length);
  while (queue.length > 0) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) {
      const a = queue[i] as number, b = queue[bi] as number;
      if ((dist[a] as number) < (dist[b] as number) || ((dist[a] as number) === (dist[b] as number) && a < b)) bi = i;
    }
    const u = queue.splice(bi, 1)[0] as number;
    if (done[u]) continue;
    done[u] = 1;
    if (ends.has(u)) {
      const nodes: number[] = [u];
      const edges: CEdge[] = [];
      for (let v = u; prev[v] !== -1;) { edges.push(prevEdge[v] as CEdge); v = prev[v] as number; nodes.push(v); }
      return { nodes: nodes.reverse(), edges: edges.reverse() };
    }
    for (const e of adj[u] ?? []) {
      const nd = (dist[u] as number) + e.len;
      if (nd < (dist[e.to] as number)) { dist[e.to] = nd; prev[e.to] = u; prevEdge[e.to] = e; queue.push(e.to); }
    }
  }
  return null;
}

const revPts = (p: readonly number[]): number[] => {
  const o: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) o.push(p[i] as number, p[i + 1] as number);
  return o;
};

/** Nodes at which a segment named `street` meets one named `cross`. */
function nodesWith(inp: TransitInputs, street: string, cross: string): number[] {
  const a = normalizeStreetName(street), b = normalizeStreetName(cross);
  const names = new Map<number, Set<string>>();
  for (const s of inp.segs) {
    const n = normalizeStreetName(s.name);
    if (!n) continue;
    for (const node of [s.a, s.b]) {
      let set = names.get(node);
      if (!set) names.set(node, (set = new Set()));
      set.add(n);
    }
  }
  const out: number[] = [];
  for (const n of inp.nodes) {
    const set = names.get(n.id);
    if (set && set.has(a) && set.has(b)) out.push(n.id);
  }
  return out;
}

/**
 * The cable-car chains (U-W6, DL-710). A leg walks the segments of its street, the OSM cable rails (`railway=tram`,
 * `cable_tram=cable`, not in a tunnel, no sidings) joined to the street nodes they share or lie within 6 m of, and the rail
 * ends at the turntables; a chain end with no node carrying both street names resolves to the `railway=turntable` at that
 * terminus. Every spline point (resampled every 5 m) is then tested against the 6 m rule.
 */
function cableCars(inp: TransitInputs, sorted: readonly OsmFeature[], out: TransitRoutes, report: TransitReport): void {
  if (inp.content.cablecars.lines.length === 0) return;
  const rails: { id: string; pts: number[] }[] = [];
  const turntables: { id: string; x: number; z: number; ring: number[] }[] = [];
  const tramAnchors: { id: string; pts: number[] }[] = [];
  for (const f of sorted) {
    const t = f.tags;
    if (t['railway'] === 'turntable') {
      if (f.geometry.type === 'Point') {
        const c = f.geometry.coordinates as number[];
        const e = enuFromLatLng(c[1] as number, c[0] as number);
        turntables.push({ id: f.id, x: e.x, z: e.z, ring: [e.x, e.z, e.x, e.z] });
      } else if (!f.id.startsWith('a')) {
        const line = linesOf(f.geometry)[0];
        if (line && line.length >= 4) {
          let sx = 0, sz = 0;
          const n = line.length / 2;
          for (let i = 0; i < line.length; i += 2) { sx += line[i] as number; sz += line[i + 1] as number; }
          turntables.push({ id: f.id, x: sx / n, z: sz / n, ring: line });
        }
      }
      continue;
    }
    if (t['railway'] !== 'tram' && t['railway'] !== 'light_rail') continue;
    if (t['tunnel'] !== undefined && t['tunnel'] !== 'no') continue;
    for (const [i, line] of linesOf(f.geometry).entries()) {
      if (line.length < 4) continue;
      const id = `${f.id}${i ? `-${i}` : ''}`;
      tramAnchors.push({ id, pts: line });
      if (t['cable_tram'] === 'cable' && t['service'] !== 'siding') rails.push({ id, pts: line });
    }
  }
  const streetNames = new Set<string>();
  for (const line of inp.content.cablecars.lines) for (const leg of line.legs) { streetNames.add(normalizeStreetName(leg.street)); streetNames.add(normalizeStreetName(leg.from)); streetNames.add(normalizeStreetName(leg.to)); }

  const cn: CNode[] = [];
  const keyOf = new Map<string, number>();
  const nodeAt = (key: string, x: number, z: number): number => {
    const h = keyOf.get(key);
    if (h !== undefined) return h;
    cn.push({ x, z });
    keyOf.set(key, cn.length - 1);
    return cn.length - 1;
  };
  const adj: CEdge[][] = [];
  const link = (a: number, b: number, pts: number[], src: string): void => {
    const len = polyLength(pts);
    (adj[a] ??= []).push({ to: b, len, pts, src });
    (adj[b] ??= []).push({ to: a, len, pts: revPts(pts), src });
  };
  const rk = (x: number, z: number): string => `r${x.toFixed(2)},${z.toFixed(2)}`;
  const streetNode = (id: number): number => nodeAt(`s${id}`, (inp.nodes[id] as NodeB).x, (inp.nodes[id] as NodeB).z);

  // joints: a street node within 6 m of a cable rail splits that rail edge at the projection and joins it
  const candidates = new Set<number>();
  inp.segs.forEach((sg) => { if (streetNames.has(normalizeStreetName(sg.name))) { candidates.add(sg.a); candidates.add(sg.b); } });
  const railEdges: { rail: number; ax: number; az: number; bx: number; bz: number }[] = [];
  rails.forEach((r, ri) => { for (let i = 2; i < r.pts.length; i += 2) railEdges.push({ rail: ri, ax: r.pts[i - 2] as number, az: r.pts[i - 1] as number, bx: r.pts[i] as number, bz: r.pts[i + 1] as number }); });
  const edgeGrid = new PointGrid<number>(32);
  railEdges.forEach((e, k) => { edgeGrid.add((e.ax + e.bx) / 2, (e.az + e.bz) / 2, k); });
  const jointsOn = new Map<number, { t: number; x: number; z: number; street: number }[]>();
  for (const id of [...candidates].sort((a, b) => a - b)) {
    const nd = inp.nodes[id] as NodeB;
    let best: { k: number; d: number; t: number; x: number; z: number } | null = null;
    for (const h of edgeGrid.query(nd.x, nd.z, 60)) {
      const e = railEdges[h.item] as (typeof railEdges)[number];
      const dx = e.bx - e.ax, dz = e.bz - e.az;
      const l2 = dx * dx + dz * dz;
      let t = l2 === 0 ? 0 : ((nd.x - e.ax) * dx + (nd.z - e.az) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = e.ax + dx * t, pz = e.az + dz * t;
      const d = Math.hypot(px - nd.x, pz - nd.z);
      if (d <= CABLE_CHECK_M && (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && h.item < best.k))) best = { k: h.item, d, t, x: px, z: pz };
    }
    if (best) {
      const l = jointsOn.get(best.k) ?? [];
      l.push({ t: best.t, x: best.x, z: best.z, street: id });
      jointsOn.set(best.k, l);
    }
  }
  railEdges.forEach((e, k) => {
    const js = (jointsOn.get(k) ?? []).sort((a, b) => a.t - b.t || a.street - b.street);
    const src = (rails[e.rail] as { id: string }).id;
    let px = e.ax, pz = e.az;
    let from = nodeAt(rk(px, pz), px, pz);
    for (const j of js) {
      const jn = nodeAt(`j${k}:${j.street}`, j.x, j.z);
      link(from, jn, [px, pz, j.x, j.z], src);
      link(jn, streetNode(j.street), [j.x, j.z, (inp.nodes[j.street] as NodeB).x, (inp.nodes[j.street] as NodeB).z], 'joint');
      px = j.x; pz = j.z; from = jn;
    }
    link(from, nodeAt(rk(e.bx, e.bz), e.bx, e.bz), [px, pz, e.bx, e.bz], src);
  });
  // a turntable centre joins every rail vertex within 20 m (the track ends a few metres short of the ring)
  const turnNode = new Map<string, number>();
  const railVertices = [...keyOf.entries()].filter(([key]) => key.startsWith('r'));
  for (const tt of turntables) {
    const tn = nodeAt(`t${tt.id}`, tt.x, tt.z);
    turnNode.set(tt.id, tn);
    for (const [, id] of railVertices) {
      const n = cn[id] as CNode;
      if (Math.hypot(n.x - tt.x, n.z - tt.z) <= TURNTABLE_JOIN_M) link(tn, id, [tt.x, tt.z, n.x, n.z], tt.id);
    }
  }
  // the segments of one street are added per leg
  const withStreet = (street: string): (CEdge[] | undefined)[] => {
    const sn = normalizeStreetName(street);
    const extra: [number, number, number[], string][] = [];
    inp.segs.forEach((sg) => { if (normalizeStreetName(sg.name) === sn) extra.push([streetNode(sg.a), streetNode(sg.b), sg.pts, `w${sg.osmWay}`]); });
    const a2: (CEdge[] | undefined)[] = [];
    for (let i = 0; i < cn.length; i++) a2.push(adj[i] ? [...(adj[i] as CEdge[])] : []);
    for (const [a, b, pts, src] of extra) {
      const len = polyLength(pts);
      (a2[a] as CEdge[]).push({ to: b, len, pts, src });
      (a2[b] as CEdge[]).push({ to: a, len, pts: revPts(pts), src });
    }
    return a2;
  };
  const distToStreet = (name: string, x: number, z: number): number => {
    const sn = normalizeStreetName(name);
    let best = Infinity;
    for (const sg of inp.segs) if (normalizeStreetName(sg.name) === sn) best = Math.min(best, nearestOnPoly(sg.pts, x, z).d);
    return best;
  };
  /** The street nodes carrying both names, and the turntable at that terminus (within 250 m of both streets) when there is one. */
  const endNodes = (street: string, cross: string): { nodes: number[]; turntable: { id: string; node: number } | null } => {
    const found = nodesWith(inp, street, cross).map(streetNode);
    let best: { id: string; score: number } | null = null;
    for (const tt of turntables) {
      const a = distToStreet(street, tt.x, tt.z), b = distToStreet(cross, tt.x, tt.z);
      if (a > 250 || b > 250) continue;
      const score = a + b;
      if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && tt.id < best.id)) best = { id: tt.id, score };
    }
    return { nodes: found, turntable: best && turnNode.has(best.id) ? { id: best.id, node: turnNode.get(best.id) as number } : null };
  };

  // the 6 m anchors: street edges, tram rails and turntable rings
  const anchorGrid = new PointGrid<string>(16);
  const addAnchor = (pts: readonly number[], id: string): void => {
    const r = resample(pts as number[], 3);
    for (let i = 0; i < r.length; i += 2) anchorGrid.add(r[i] as number, r[i + 1] as number, id);
  };
  for (const sg of inp.segs) addAnchor(sg.pts, `w${sg.osmWay}`);
  for (const r of tramAnchors) addAnchor(r.pts, r.id);
  for (const tt of turntables) addAnchor(tt.ring, tt.id);

  for (const line of inp.content.cablecars.lines) {
    const pts: number[] = [];
    const usedTurntables: string[] = [];
    let ok = true;
    let at = -1;
    for (const [li, leg] of line.legs.entries()) {
      const a2 = withStreet(leg.street);
      const s0 = endNodes(leg.street, leg.from), e0 = endNodes(leg.street, leg.to);
      // a chain end resolves to the turntable of its terminus (the real end of the track), else to the street node carrying both names
      const startSets: number[][] = li === 0 && s0.turntable ? [[s0.turntable.node], s0.nodes] : [s0.nodes];
      const endSets: number[][] = li === line.legs.length - 1 && e0.turntable ? [[e0.turntable.node], e0.nodes] : [e0.nodes];
      let res: { nodes: number[]; edges: CEdge[] } | null = null;
      for (const ss of startSets) {
        for (const es of endSets) {
          if (res || ss.length === 0 || es.length === 0) continue;
          res = shortest(a2, at >= 0 && ss.includes(at) ? [at] : ss, new Set(es));
        }
      }
      if (!res) { ok = false; break; }
      if (s0.turntable && res.nodes[0] === s0.turntable.node && !usedTurntables.includes(s0.turntable.id)) usedTurntables.push(s0.turntable.id);
      if (e0.turntable && res.nodes[res.nodes.length - 1] === e0.turntable.node && !usedTurntables.includes(e0.turntable.id)) usedTurntables.push(e0.turntable.id);
      for (const e of res.edges) {
        for (let i = 0; i < e.pts.length; i += 2) {
          const x = e.pts[i] as number, z = e.pts[i + 1] as number;
          if (pts.length >= 2 && Math.hypot(x - (pts[pts.length - 2] as number), z - (pts[pts.length - 1] as number)) < 0.05) continue;
          pts.push(x, z);
        }
      }
      at = res.nodes[res.nodes.length - 1] as number;
    }
    if (!(ok && polyLength(pts) > 0)) { report.cablecarMissing.push(line.id); continue; }
    out.cablecar.push({ id: line.id, nameKey: `transit.${line.id}`, points: flat(pts) });
    // every resampled spline point within 6 m of a street edge, a tram rail or a turntable (anchors are sampled every 3 m)
    const sample = resample(pts, 5);
    let worst = 0, worstAnchor = '';
    for (let i = 0; i < sample.length; i += 2) {
      const hit = anchorGrid.nearest(sample[i] as number, sample[i + 1] as number, 60);
      const d = hit ? hit.d : Infinity;
      if (d > worst) { worst = d; worstAnchor = hit ? hit.item : 'none'; }
    }
    report.cablecarCheck.push({ id: line.id, points: sample.length / 2, worstM: Number.isFinite(worst) ? Math.round(worst * 10) / 10 : 9999, worstAnchor, turntables: usedTurntables });
    if (worst > CABLE_CHECK_M) report.cablecarOff.push(line.id);
  }
  report.cablecar = out.cablecar.length;
}
