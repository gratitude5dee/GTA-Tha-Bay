/**
 * S8 pedestrian graph (02-world-bake.md section 4 S8, 02-world-living.md section 4.1).
 *
 * Sidewalks are offset polylines at +-(widthM / 2 + 1.6 m) beside every Arterial, Collector and Local segment that OSM does
 * not tag `sidewalk=no`; they end a few metres short of each junction, corner links join the facing sides of neighbouring
 * approaches, and a crosswalk across each approach of a junction carries the junction id and the id of the parallel straight
 * movement (the one crossing the approach at the most right angle) so the signal program can time it. OSM `highway=crossing`
 * nodes add mid-block crossings; footway, path, steps, pedestrian and track ways add paths and stairs; plazas and park lawns
 * get a 12 m lattice clipped to the polygon minus prisms and water. Freeways, ramps and service roads have none.
 *
 * The pack wants each chunk's ped graph self-contained, so every edge is cut at the 256 m grid lines and the cut points
 * become duplicate nodes at the same position in both chunks. Connectivity (largest component per 1,024 m tile, warn
 * under 85 %) is measured before the cut.
 */
import {
  GRID_MIN_M, PedEdgeKind, PedNodeFlag, chunkKeyAt, enuFromLatLng, type ChunkKey, type Junction, type PedEdge, type PedNode, type RoadEdge,
} from '../../../../packages/shared/src/index.ts';
import { PointGrid, morton, pointAt, polyLength, resample } from '../geom/poly.ts';
import { pointInRing, ringBbox, type Bbox } from '../geom/rings.ts';
import { type PrismIndex } from '../geom/prisms.ts';
import type { OsmFeature } from '../sources/geo.ts';
import { linesOf } from '../sources/geo.ts';
import type { LandusePoly } from './s3-water.ts';
import type { TerrainField } from './s2-terrain.ts';
import type { NodeB, SegB } from './s5-roads.ts';
import { edgeXz, headingOf } from './s6-junctions.ts';

export const SIDEWALK_OFFSET_M = 1.6;
export const LATTICE_M = 12;
export const PED_EDGE_LIMIT = 1500;
const PATH_HIGHWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'track']);

export interface PedInputs {
  segs: readonly SegB[];
  edges: readonly RoadEdge[];
  nodes: readonly NodeB[];
  junctions: readonly Junction[];
  osm: readonly OsmFeature[];
  field: TerrainField;
  landuse: readonly LandusePoly[];
  prisms: PrismIndex;
  isWater(x: number, z: number): boolean;
  box: Bbox;
}

export interface PedChunk { nodes: PedNode[]; edges: PedEdge[] }
export interface PedReport {
  nodes: number;
  edges: number;
  sidewalkKm: number;
  crosswalks: number;
  paths: number;
  latticeNodes: number;
  maxEdgesPerChunk: number;
  thinnedChunks: number;
  overLimit: string[];
  tilesBelow85: { tile: string; fraction: number }[];
  minTileFraction: number;
}
export interface PedProduct {
  chunks: Map<ChunkKey, PedChunk>;
  report: PedReport;
  /** Sidewalk length per chunk in metres, and lattice node count per chunk (inputs of the S9 pedSlots formula). */
  sidewalkM: Map<ChunkKey, number>;
  latticeNodes: Map<ChunkKey, number>;
  /** All ped nodes before the chunk split, for snapping (POIs, transit, arrival poses). */
  points: { x: number; y: number; z: number; flags: number }[];
}

interface GNode { x: number; z: number; y: number; flags: number; lattice: boolean }
interface GEdge { a: number; b: number; kind: PedEdgeKind; w: number; junction: number; movement: number }

const SKIP_CLASS = new Set([0, 1, 5]);   // Freeway, Ramp, Service

function leftNormal(tx: number, tz: number): [number, number] {
  return [tz, -tx];
}

function tangentAt(pts: number[], s: number): [number, number] {
  const a = pointAt(pts, Math.max(0, s - 0.75)), b = pointAt(pts, s + 0.75);
  const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return [(b.x - a.x) / d, (b.z - a.z) / d];
}

export function runPed(inp: PedInputs): PedProduct {
  const build = (strideOf: (cx: number, cz: number) => number) => buildGlobal(inp, strideOf);
  let g = build(() => 1);
  // lattice thinning for chunks that would pass the edge limit
  const heavy = new Set<string>();
  const counts = countPerChunk(g.edges, g.nodes);
  for (const [k, n] of counts) if (n > PED_EDGE_LIMIT - 100) heavy.add(k);
  let thinned = 0;
  if (heavy.size > 0) {
    g = build((cx, cz) => (heavy.has(`9/${cx}/${cz}`) ? 2 : 1));
    thinned = heavy.size;
  }
  return finish(inp, g, thinned);
}

interface Global { nodes: GNode[]; edges: GEdge[]; sidewalkM: Map<string, number>; crosswalks: number; paths: number; sidewalkKm: number; latticeNodes: number }

function countPerChunk(edges: readonly GEdge[], nodes: readonly GNode[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of edges) {
    const a = nodes[e.a] as GNode, b = nodes[e.b] as GNode;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const parts = 1 + Math.floor(len / 200);
    const k = chunkKeyAt(9, (a.x + b.x) / 2, (a.z + b.z) / 2);
    m.set(k, (m.get(k) ?? 0) + parts);
  }
  return m;
}

function buildGlobal(inp: PedInputs, strideOf: (cx: number, cz: number) => number): Global {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const sidewalkM = new Map<string, number>();
  let crosswalks = 0, paths = 0, sidewalkKm = 0;
  const addNode = (x: number, z: number, flags = 0, lattice = false): number => { nodes.push({ x, z, y: 0, flags, lattice }); return nodes.length - 1; };
  const addEdge = (a: number, b: number, kind: PedEdgeKind, w: number, junction = -1, movement = -1): void => { if (a !== b) edges.push({ a, b, kind, w, junction, movement }); };

  // -- mid-block crossings from OSM points
  const crossPts: { x: number; z: number }[] = [];
  for (const f of inp.osm) {
    if (f.geometry.type !== 'Point' || f.tags['highway'] !== 'crossing') continue;
    const c = f.geometry.coordinates as number[];
    const e = enuFromLatLng(c[1] as number, c[0] as number);
    crossPts.push({ x: e.x, z: e.z });
  }

  // -- sidewalks
  interface SideEnds { left0: number; left1: number; right0: number; right1: number }
  const sides = new Map<number, SideEnds>();
  const segIndexGrid = new PointGrid<number>(64);
  inp.segs.forEach((s, i) => {
    if (SKIP_CLASS.has(s.cls) || s.tunnel || s.bridge || s.noSidewalk) return;
    for (let q = 0; q < s.pts.length; q += 2) segIndexGrid.add(s.pts[q] as number, s.pts[q + 1] as number, i);
  });
  const crossAt = new Map<number, number[]>();
  for (const cp of crossPts) {
    const hit = segIndexGrid.query(cp.x, cp.z, 12);
    let best: { seg: number; s: number; d: number } | null = null;
    for (const h of hit) {
      const seg = inp.segs[h.item] as SegB;
      const near = nearestArc(seg.pts, cp.x, cp.z);
      if (!best || near.d < best.d) best = { seg: h.item, s: near.s, d: near.d };
    }
    if (best && best.d <= 8) {
      const l = crossAt.get(best.seg) ?? [];
      l.push(best.s);
      crossAt.set(best.seg, l);
    }
  }
  const setback = new Map<string, number>();
  const sbOf = (nodeId: number): number => {
    const key = String(nodeId);
    const have = setback.get(key);
    if (have !== undefined) return have;
    let w = 0;
    for (const e of inp.nodes[nodeId]!.out) w = Math.max(w, (inp.segs[(inp.edges[e] as RoadEdge).seg] as SegB).widthM);
    for (const e of inp.nodes[nodeId]!.in) w = Math.max(w, (inp.segs[(inp.edges[e] as RoadEdge).seg] as SegB).widthM);
    const sb = Math.max(5, w / 2 + 2.5);
    setback.set(key, sb);
    return sb;
  };
  inp.segs.forEach((seg, i) => {
    if (SKIP_CLASS.has(seg.cls) || seg.tunnel || seg.bridge || seg.noSidewalk) return;
    const L = polyLength(seg.pts);
    let sbA = sbOf(seg.a), sbB = sbOf(seg.b);
    if (L < sbA + sbB + 2) { sbA = Math.max(0.4, (L - 1) / 2); sbB = sbA; }
    const off = seg.widthM / 2 + SIDEWALK_OFFSET_M;
    // sample arc lengths: setback ends, polyline vertices strictly between, crossings
    const ss: number[] = [sbA];
    let acc = 0;
    for (let q = 1; q < seg.pts.length / 2; q++) {
      acc += Math.hypot((seg.pts[q * 2] as number) - (seg.pts[q * 2 - 2] as number), (seg.pts[q * 2 + 1] as number) - (seg.pts[q * 2 - 1] as number));
      if (acc > sbA + 1 && acc < L - sbB - 1) ss.push(acc);
    }
    for (const c of crossAt.get(i) ?? []) if (c > sbA + 2 && c < L - sbB - 2) ss.push(c);
    ss.push(L - sbB);
    ss.sort((p, q) => p - q);
    const uniq: number[] = [];
    for (const v of ss) if (uniq.length === 0 || v - (uniq[uniq.length - 1] as number) > 0.8) uniq.push(v);
    if (uniq.length < 2) uniq.push((uniq[0] as number) + 0.01);
    const lids: number[] = [], rids: number[] = [];
    for (const sv of uniq) {
      const p = pointAt(seg.pts, sv);
      const [tx, tz] = tangentAt(seg.pts, sv);
      const [nx, nz] = leftNormal(tx, tz);
      lids.push(addNode(p.x + nx * off, p.z + nz * off));
      rids.push(addNode(p.x - nx * off, p.z - nz * off));
    }
    for (let q = 1; q < uniq.length; q++) {
      addEdge(lids[q - 1] as number, lids[q] as number, PedEdgeKind.Sidewalk, 1.6);
      addEdge(rids[q - 1] as number, rids[q] as number, PedEdgeKind.Sidewalk, 1.6);
    }
    const len = (uniq[uniq.length - 1] as number) - (uniq[0] as number);
    sidewalkKm += (2 * len) / 1000;
    const mid = pointAt(seg.pts, L / 2);
    const key = chunkKeyAt(9, mid.x, mid.z);
    if (seg.island !== true) sidewalkM.set(key, (sidewalkM.get(key) ?? 0) + 2 * len);   // islands get no ped slots (DL-706)
    sides.set(i, { left0: lids[0] as number, left1: lids[lids.length - 1] as number, right0: rids[0] as number, right1: rids[rids.length - 1] as number });
    // mid-block crosswalks
    for (const c of crossAt.get(i) ?? []) {
      const q = uniq.findIndex((v) => Math.abs(v - c) < 0.9);
      if (q < 0) continue;
      addEdge(lids[q] as number, rids[q] as number, PedEdgeKind.Crosswalk, 3);
      (nodes[lids[q] as number] as GNode).flags |= PedNodeFlag.Crossing | PedNodeFlag.Waiting;
      (nodes[rids[q] as number] as GNode).flags |= PedNodeFlag.Crossing | PedNodeFlag.Waiting;
      crosswalks++;
    }
  });

  // -- corners and crosswalks at graph nodes
  const ends = new Map<number, { seg: number; atA: boolean; ang: number; dx: number; dz: number }[]>();
  inp.segs.forEach((s, i) => {
    if (!sides.has(i)) return;
    const p0 = pointAt(s.pts, 2), pe = pointAt(s.pts, Math.max(0, polyLength(s.pts) - 2));
    const a = inp.nodes[s.a] as NodeB, b = inp.nodes[s.b] as NodeB;
    const dA: [number, number] = [p0.x - a.x, p0.z - a.z], dB: [number, number] = [pe.x - b.x, pe.z - b.z];
    const nA = Math.hypot(dA[0], dA[1]) || 1, nB = Math.hypot(dB[0], dB[1]) || 1;
    const push = (n: number, atA: boolean, d: [number, number], nn: number): void => {
      const l = ends.get(n) ?? [];
      l.push({ seg: i, atA, ang: Math.atan2(-d[1] / nn, d[0] / nn), dx: d[0] / nn, dz: d[1] / nn });
      ends.set(n, l);
    };
    push(s.a, true, dA, nA);
    push(s.b, false, dB, nB);
  });
  const leftEnd = (e: { seg: number; atA: boolean }): number => { const sd = sides.get(e.seg) as SideEnds; return e.atA ? sd.left0 : sd.right1; };
  const rightEnd = (e: { seg: number; atA: boolean }): number => { const sd = sides.get(e.seg) as SideEnds; return e.atA ? sd.right0 : sd.left1; };
  for (const [nid, list] of [...ends.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((p, q) => p.ang - q.ang || p.seg - q.seg);
    const n = list.length;
    if (n === 1) { addEdge(leftEnd(list[0]!), rightEnd(list[0]!), PedEdgeKind.Sidewalk, 1.6); continue; }
    for (let i = 0; i < n; i++) {
      const a = list[i] as (typeof list)[number], b = list[(i + 1) % n] as (typeof list)[number];
      if (n === 2 && i === 1 && a.seg === b.seg && a.atA === b.atA) continue;
      const la = leftEnd(a), rb = rightEnd(b);
      const pa = nodes[la] as GNode, pb = nodes[rb] as GNode;
      if (Math.hypot(pa.x - pb.x, pa.z - pb.z) <= 45) addEdge(la, rb, PedEdgeKind.Sidewalk, 1.6);
    }
    // crosswalks across each approach of a junction with three or more approaches
    const node = inp.nodes[nid] as NodeB;
    if (node.junction < 0 || n < 3) continue;
    const j = inp.junctions[node.junction] as Junction;
    for (const e of list) {
      const l = leftEnd(e), r = rightEnd(e);
      (nodes[l] as GNode).flags |= PedNodeFlag.Crossing | PedNodeFlag.Waiting;
      (nodes[r] as GNode).flags |= PedNodeFlag.Crossing | PedNodeFlag.Waiting;
      // inward heading of this approach is the negative of the outward direction
      const hx = -e.dx, hz = -e.dz;
      let best = -1, bestCross = 0.7;
      for (const m of j.movements) {
        if (m.turn !== 'straight') continue;
        const ie = inp.edges[m.inEdge] as RoadEdge;
        const hh = headingOf(edgeXz(inp.segs[ie.seg] as SegB, ie.dir), false);
        const cross = Math.abs(hx * hh.tz - hz * hh.tx);
        if (cross > bestCross + 1e-9 || (best < 0 && cross >= bestCross)) { best = m.id; bestCross = cross; }
      }
      addEdge(l, r, PedEdgeKind.Crosswalk, 3, j.id <= 32767 ? j.id : -1, best);
      crosswalks++;
    }
  }

  // -- paths and stairs from OSM footways
  const pathNodes = new PointGrid<number>(16);
  nodes.forEach((n, i) => pathNodes.add(n.x, n.z, i));
  const sorted = [...inp.osm].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const f of sorted) {
    const hw = f.tags['highway'];
    if (hw === undefined || !PATH_HIGHWAY.has(hw) || f.geometry.type === 'Point') continue;
    if (f.tags['footway'] === 'sidewalk' || f.tags['footway'] === 'crossing') continue;
    if (f.tags['area'] === 'yes') continue;
    for (const line of linesOf(f.geometry)) {
      if (line.length < 4) continue;
      const pts = resample(line, 16);
      const steps = hw === 'steps';
      const ids: number[] = [];
      for (let q = 0; q < pts.length; q += 2) {
        const x = pts[q] as number, z = pts[q + 1] as number;
        if (x < inp.box.minX || x > inp.box.maxX || z < inp.box.minZ || z > inp.box.maxZ) { ids.push(-1); continue; }
        ids.push(addNode(x, z, steps ? PedNodeFlag.Stairs : 0));
      }
      for (let q = 1; q < ids.length; q++) {
        const a = ids[q - 1] as number, b = ids[q] as number;
        if (a < 0 || b < 0) continue;
        addEdge(a, b, steps ? PedEdgeKind.Stairs : PedEdgeKind.Path, 2);
        paths++;
      }
      for (const end of [ids[0] as number, ids[ids.length - 1] as number]) {
        if (end < 0) continue;
        const en = nodes[end] as GNode;
        const hit = pathNodes.query(en.x, en.z, 10).find((h) => h.item !== end && !(nodes[h.item] as GNode).lattice);
        if (hit) addEdge(end, hit.item, PedEdgeKind.Path, 2);
      }
    }
  }

  // -- plaza and park lattices
  let latticeNodes = 0;
  const lat = new Map<string, number>();
  const gridOf = (i: number, j: number): string => `${i},${j}`;
  const polys = inp.landuse.filter((u) => u.cls === 'plaza' || u.cls === 'park');
  const latFlags = new Map<string, number>();
  for (const u of polys) {
    const outer = u.rings[0] as number[];
    const holes = u.rings.slice(1);
    const bb = ringBbox(outer);
    if (bb.maxX < inp.box.minX || bb.minX > inp.box.maxX || bb.maxZ < inp.box.minZ || bb.minZ > inp.box.maxZ) continue;
    const i0 = Math.ceil((Math.max(bb.minX, inp.box.minX) - GRID_MIN_M) / LATTICE_M), i1 = Math.floor((Math.min(bb.maxX, inp.box.maxX) - GRID_MIN_M) / LATTICE_M);
    const j0 = Math.ceil((Math.max(bb.minZ, inp.box.minZ) - GRID_MIN_M) / LATTICE_M), j1 = Math.floor((Math.min(bb.maxZ, inp.box.maxZ) - GRID_MIN_M) / LATTICE_M);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = GRID_MIN_M + i * LATTICE_M, z = GRID_MIN_M + j * LATTICE_M;
        const cx = Math.floor((x - GRID_MIN_M) / 256), cz = Math.floor((z - GRID_MIN_M) / 256);
        const stride = strideOf(cx, cz);
        if (i % stride !== 0 || j % stride !== 0) continue;
        if (!pointInRing(x, z, outer) || holes.some((h) => pointInRing(x, z, h))) continue;
        if (inp.isWater(x, z) || inp.prisms.near(x, z, 1)) continue;
        const key = gridOf(i, j);
        const flag = u.cls === 'plaza' ? PedNodeFlag.Plaza : PedNodeFlag.Park;
        latFlags.set(key, (latFlags.get(key) ?? 0) | flag);
        if (!lat.has(key)) lat.set(key, -1);
      }
    }
  }
  for (const key of [...lat.keys()].sort()) {
    const [si, sj] = key.split(',').map(Number) as [number, number];
    lat.set(key, addNode(GRID_MIN_M + si * LATTICE_M, GRID_MIN_M + sj * LATTICE_M, latFlags.get(key) as number, true));
    latticeNodes++;
  }
  const sizeStride = (i: number, j: number): number => strideOf(Math.floor((GRID_MIN_M + i * LATTICE_M - GRID_MIN_M) / 256), Math.floor((GRID_MIN_M + j * LATTICE_M - GRID_MIN_M) / 256));
  for (const [key, id] of lat) {
    const [si, sj] = key.split(',').map(Number) as [number, number];
    const st = sizeStride(si, sj);
    for (const [di, dj] of [[st, 0], [0, st]] as const) {
      const other = lat.get(gridOf(si + di, sj + dj));
      if (other !== undefined) addEdge(id, other, PedEdgeKind.Plaza, 12);
    }
  }
  const nonLat = new PointGrid<number>(16);
  nodes.forEach((n, i) => { if (!n.lattice) nonLat.add(n.x, n.z, i); });
  for (const [key, id] of lat) {
    const [si, sj] = key.split(',').map(Number) as [number, number];
    const st = sizeStride(si, sj);
    const full = [[st, 0], [-st, 0], [0, st], [0, -st]].every(([di, dj]) => lat.has(gridOf(si + (di as number), sj + (dj as number))));
    if (full) continue;
    const n = nodes[id] as GNode;
    const hit = nonLat.query(n.x, n.z, 14)[0];
    if (hit) addEdge(id, hit.item, PedEdgeKind.Path, 2);
  }

  // -- heights
  for (const n of nodes) n.y = Math.round(((inp.field.heightAt(n.x, n.z) ?? 0) + (n.lattice ? 0.05 : 0.12)) * 10) / 10;
  return { nodes, edges, sidewalkM, crosswalks, paths, sidewalkKm, latticeNodes };
}

function nearestArc(pts: number[], x: number, z: number): { d: number; s: number } {
  let best = { d: Infinity, s: 0 };
  let acc = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2] as number, az = pts[i - 1] as number, bx = pts[i] as number, bz = pts[i + 1] as number;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const l2 = len * len;
    let t = l2 === 0 ? 0 : ((x - ax) * dx + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best.d) best = { d, s: acc + len * t };
    acc += len;
  }
  return best;
}

// ---- chunk split ---------------------------------------------------------------------------------------------------

function finish(inp: PedInputs, g: Global, thinned: number): PedProduct {
  const q1 = (v: number): number => Math.round(v * 10) / 10;
  // connectivity per 1,024 m tile, before the cut
  const parent = g.nodes.map((_n, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i] as number] as number; i = parent[i] as number; } return i; };
  const tileOf = (n: GNode): string => `${Math.floor((n.x - GRID_MIN_M) / 1024)}-${Math.floor((n.z - GRID_MIN_M) / 1024)}`;
  for (const e of g.edges) {
    const a = g.nodes[e.a] as GNode, b = g.nodes[e.b] as GNode;
    if (tileOf(a) !== tileOf(b)) continue;
    const ra = find(e.a), rb = find(e.b);
    if (ra !== rb) parent[rb] = ra;
  }
  const tileNodes = new Map<string, Map<number, number>>();
  g.nodes.forEach((n, i) => {
    const t = tileOf(n);
    const m = tileNodes.get(t) ?? new Map<number, number>();
    const r = find(i);
    m.set(r, (m.get(r) ?? 0) + 1);
    tileNodes.set(t, m);
  });
  const tilesBelow: { tile: string; fraction: number }[] = [];
  let minFrac = 1;
  for (const [t, m] of [...tileNodes.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    let total = 0, big = 0;
    for (const c of m.values()) { total += c; big = Math.max(big, c); }
    if (total < 20) continue;
    const f = big / total;
    minFrac = Math.min(minFrac, f);
    if (f < 0.85) tilesBelow.push({ tile: t, fraction: Math.round(f * 1000) / 1000 });
  }

  // cut every edge at the 256 m grid lines; chunk-local nodes are keyed by position
  interface LNode { x: number; y: number; z: number; flags: number }
  const chunkNodes = new Map<ChunkKey, Map<string, LNode>>();
  const chunkEdges = new Map<ChunkKey, { a: string; b: string; kind: PedEdgeKind; w: number; junction: number; movement: number }[]>();
  const nodeIn = (key: ChunkKey, x: number, z: number, y: number, flags: number): string => {
    const k = `${Math.round(x * 10)},${Math.round(z * 10)}`;
    let m = chunkNodes.get(key);
    if (!m) chunkNodes.set(key, (m = new Map()));
    const have = m.get(k);
    if (have) have.flags |= flags;
    else m.set(k, { x: q1(x), y: q1(y), z: q1(z), flags });
    return k;
  };
  const edgeKeys = new Map<string, boolean>();
  for (const e of g.edges) {
    const a = g.nodes[e.a] as GNode, b = g.nodes[e.b] as GNode;
    const ts: number[] = [0, 1];
    const cut = (u0: number, u1: number): void => {
      if (u0 === u1) return;
      const lo = Math.min(u0, u1), hi = Math.max(u0, u1);
      for (let k = Math.floor((lo - GRID_MIN_M) / 256) + 1; GRID_MIN_M + k * 256 < hi; k++) ts.push((GRID_MIN_M + k * 256 - u0) / (u1 - u0));
    };
    cut(a.x, b.x);
    cut(a.z, b.z);
    ts.sort((p, q) => p - q);
    for (let i = 1; i < ts.length; i++) {
      const t0 = ts[i - 1] as number, t1 = ts[i] as number;
      if (t1 - t0 < 1e-9) continue;
      const p0 = { x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0, y: a.y + (b.y - a.y) * t0 };
      const p1 = { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1, y: a.y + (b.y - a.y) * t1 };
      const key = chunkKeyAt(9, (p0.x + p1.x) / 2, (p0.z + p1.z) / 2);
      const mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2;
      if (mx < inp.box.minX || mx > inp.box.maxX || mz < inp.box.minZ || mz > inp.box.maxZ) continue;
      const fa = t0 === 0 ? a.flags : 0, fb = t1 === 1 ? b.flags : 0;
      const ka = nodeIn(key, p0.x, p0.z, p0.y, fa), kb = nodeIn(key, p1.x, p1.z, p1.y, fb);
      if (ka === kb) continue;
      const ek = `${key}|${ka < kb ? ka : kb}|${ka < kb ? kb : ka}|${e.kind}`;
      if (edgeKeys.has(ek)) continue;
      edgeKeys.set(ek, true);
      let l = chunkEdges.get(key);
      if (!l) chunkEdges.set(key, (l = []));
      l.push({ a: ka, b: kb, kind: e.kind, w: e.w, junction: e.junction, movement: e.movement });
    }
  }

  const keys = [...chunkNodes.keys()].sort((p, q) => {
    const pp = p.split('/').map(Number) as [number, number, number], qq = q.split('/').map(Number) as [number, number, number];
    return morton(pp[1], pp[2]) - morton(qq[1], qq[2]);
  });
  const out = new Map<ChunkKey, PedChunk>();
  const points: { x: number; y: number; z: number; flags: number }[] = [];
  let nextId = 0, totalEdges = 0, maxEdges = 0;
  const over: string[] = [];
  for (const key of keys) {
    const m = chunkNodes.get(key) as Map<string, LNode>;
    const order = [...m.entries()].sort(([, a], [, b]) => a.z - b.z || a.x - b.x);
    const idOf = new Map<string, number>();
    const nodes: PedNode[] = order.map(([k, n]) => { const id = nextId++; idOf.set(k, id); return { id, x: n.x, y: n.y, z: n.z, flags: n.flags }; });
    for (const n of nodes) points.push({ x: n.x, y: n.y, z: n.z, flags: n.flags });
    const edges: PedEdge[] = (chunkEdges.get(key) ?? []).map((e) => ({
      a: idOf.get(e.a) as number, b: idOf.get(e.b) as number, kind: e.kind, widthM: e.w, junction: e.junction, movement: e.movement,
    }));
    edges.sort((p, q) => p.a - q.a || p.b - q.b || p.kind - q.kind);
    out.set(key as ChunkKey, { nodes, edges });
    totalEdges += edges.length;
    maxEdges = Math.max(maxEdges, edges.length);
    if (edges.length > PED_EDGE_LIMIT) over.push(`${key} (${edges.length})`);
  }
  const sidewalkM = new Map<ChunkKey, number>();
  for (const [k, v] of g.sidewalkM) sidewalkM.set(k as ChunkKey, v);
  // lattice nodes per chunk
  const latticeBy = new Map<ChunkKey, number>();
  for (const n of g.nodes) if (n.lattice) { const k = chunkKeyAt(9, n.x, n.z); latticeBy.set(k, (latticeBy.get(k) ?? 0) + 1); }
  const report: PedReport = {
    nodes: nextId, edges: totalEdges, sidewalkKm: Math.round(g.sidewalkKm * 100) / 100, crosswalks: g.crosswalks, paths: g.paths, latticeNodes: g.latticeNodes,
    maxEdgesPerChunk: maxEdges, thinnedChunks: thinned, overLimit: over, tilesBelow85: tilesBelow, minTileFraction: Math.round(minFrac * 1000) / 1000,
  };
  return { chunks: out, report, sidewalkM, latticeNodes: latticeBy, points };
}
