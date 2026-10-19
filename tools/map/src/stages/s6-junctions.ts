/**
 * S6 junctions (02-world-bake.md section 4 S6, 02-world-living.md sections 1.4 to 1.6).
 *
 * Graph nodes with three or more segment ends, a control tag or a roundabout become junction candidates. Candidates within
 * 25 m on the same layer merge into one Junction when they share a street name, both carry a signal or a segment of at
 * most 25 m joins them, and the merged junction keeps at most eight approaches. Dead ends become one-node junctions with
 * a U-turn. Movements pair every incoming edge of a member node with every outgoing edge of that node (no reverse twin
 * except at a dead end, no U-turn class otherwise, `type=restriction` removals applied); each gets a cubic Bezier
 * connector between lane-0 points and a conflict list (curves within 2 m, at most 12, never the same incoming edge).
 */
import {
  GRID_MIN_M, NodeControl, RoadClass, type Junction, type Movement, type Turn,
} from '../../../../packages/shared/src/index.ts';
import { PointGrid, morton, polyLength, turnDeg } from '../geom/poly.ts';
import { buildProgram, type Approach } from './s6-signals.ts';
import type { NodeB, RoadsProduct, SegB } from './s5-roads.ts';

export const MERGE_M = 25;
export const MAX_APPROACHES = 8;
export const MAX_CONFLICTS = 12;
export const CONFLICT_M = 2;
export const MAX_JUNCTION_ID = 32767;

const CONTROL_NAMES = ['None', 'Signal', 'AllWayStop', 'MinorStop', 'Yield', 'DeadEnd', 'Roundabout'] as const;

export interface JunctionsReport {
  junctions: number;
  byControl: Record<string, number>;
  movements: number;
  restrictionsApplied: number;
  restrictionsUnmatched: number;
  maxApproaches: number;
  maxOutDegree: number;
  signalNoProgram: number;
  mergedClusters: number;
  signalMatch: { total: number; matched: number; ratio: number; unmatched: { x: number; z: number }[] };
}
export interface JunctionsProduct { nodes: NodeB[]; junctions: Junction[]; report: JunctionsReport }

/** Oriented xz polyline of an edge (the segment reversed for dir -1). */
export function edgeXz(seg: SegB, dir: 1 | -1): number[] {
  if (dir === 1) return seg.pts;
  const out: number[] = [];
  for (let i = seg.pts.length - 2; i >= 0; i -= 2) out.push(seg.pts[i] as number, seg.pts[i + 1] as number);
  return out;
}

/** Unit heading over the first (atStart) or last 8 m of an oriented polyline. */
export function headingOf(p: number[], atStart: boolean, span = 8): { x: number; z: number; tx: number; tz: number } {
  const n = p.length / 2;
  if (atStart) {
    const x0 = p[0] as number, z0 = p[1] as number;
    for (let i = 1; i < n; i++) {
      const d = Math.hypot((p[i * 2] as number) - x0, (p[i * 2 + 1] as number) - z0);
      if (d >= span || i === n - 1) return { x: x0, z: z0, tx: d === 0 ? 1 : ((p[i * 2] as number) - x0) / d, tz: d === 0 ? 0 : ((p[i * 2 + 1] as number) - z0) / d };
    }
  }
  const x1 = p[(n - 1) * 2] as number, z1 = p[(n - 1) * 2 + 1] as number;
  for (let i = n - 2; i >= 0; i--) {
    const d = Math.hypot(x1 - (p[i * 2] as number), z1 - (p[i * 2 + 1] as number));
    if (d >= span || i === 0) return { x: x1, z: z1, tx: d === 0 ? 1 : (x1 - (p[i * 2] as number)) / d, tz: d === 0 ? 0 : (z1 - (p[i * 2 + 1] as number)) / d };
  }
  return { x: x1, z: z1, tx: 1, tz: 0 };
}

function ptSeg(px: number, pz: number, x0: number, z0: number, x1: number, z1: number): number {
  const vx = x1 - x0, vz = z1 - z0;
  const l2 = vx * vx + vz * vz;
  let t = l2 === 0 ? 0 : ((px - x0) * vx + (pz - z0) * vz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x0 + vx * t - px, z0 + vz * t - pz);
}

function segSegDist(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  // minimum distance between segments ab and cd
  const d1x = bx - ax, d1z = bz - az, d2x = dx - cx, d2z = dz - cz;
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) > 1e-12) {
    const t = ((cx - ax) * d2z - (cz - az) * d2x) / den;
    const u = ((cx - ax) * d1z - (cz - az) * d1x) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(ptSeg(ax, az, cx, cz, dx, dz), ptSeg(bx, bz, cx, cz, dx, dz), ptSeg(cx, cz, ax, az, bx, bz), ptSeg(dx, dz, ax, az, bx, bz));
}

/** Minimum distance between two polylines when it is at most `within`, else Infinity (segment boxes prune the pairs). */
export function polyPolyDist(a: readonly number[], b: readonly number[], within = Infinity): number {
  let best = Infinity;
  for (let i = 2; i < a.length; i += 2) {
    const ax0 = a[i - 2] as number, az0 = a[i - 1] as number, ax1 = a[i] as number, az1 = a[i + 1] as number;
    const lx = Math.min(ax0, ax1) - within, hx = Math.max(ax0, ax1) + within, lz = Math.min(az0, az1) - within, hz = Math.max(az0, az1) + within;
    for (let j = 2; j < b.length; j += 2) {
      const bx0 = b[j - 2] as number, bz0 = b[j - 1] as number, bx1 = b[j] as number, bz1 = b[j + 1] as number;
      if ((bx0 < lx && bx1 < lx) || (bx0 > hx && bx1 > hx) || (bz0 < lz && bz1 < lz) || (bz0 > hz && bz1 > hz)) continue;
      const d = segSegDist(ax0, az0, ax1, az1, bx0, bz0, bx1, bz1);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Cubic Bezier through 13 points between two oriented lane points. */
export function connector(p0: [number, number], t0: [number, number], p3: [number, number], t3: [number, number]): number[] {
  const k = Math.max(1, Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) / 3);
  const p1: [number, number] = [p0[0] + t0[0] * k, p0[1] + t0[1] * k];
  const p2: [number, number] = [p3[0] - t3[0] * k, p3[1] - t3[1] * k];
  const out: number[] = [];
  const N = 8;
  for (let s = 0; s <= N; s++) {
    const t = s / N, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push(a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]);
  }
  return out;
}

export function turnOf(inHeading: [number, number], outHeading: [number, number]): Turn {
  const a = turnDeg(inHeading[0], inHeading[1], outHeading[0], outHeading[1]);
  if (Math.abs(a) <= 30) return 'straight';
  if (Math.abs(a) > 150) return 'uturn';
  return a > 0 ? 'right' : 'left';
}

const nameSet = (segs: readonly SegB[], idx: readonly number[]): Set<string> => {
  const s = new Set<string>();
  for (const i of idx) {
    const n = (segs[i] as SegB).name;
    if (n) s.add(n.toUpperCase());
  }
  return s;
};

/** OSM signal nodes with a junction member node within 25 m (the S6 gate counts the ratio; the worst are listed). */
function signalMatch(points: readonly { x: number; z: number }[], junctions: readonly Junction[], nodes: readonly NodeB[]): JunctionsReport['signalMatch'] {
  const grid = new PointGrid<number>(MERGE_M);
  for (const j of junctions) for (const m of j.nodes) grid.add((nodes[m] as NodeB).x, (nodes[m] as NodeB).z, j.id);
  const unmatched: { x: number; z: number }[] = [];
  let matched = 0;
  for (const p of points) {
    if (grid.nearest(p.x, p.z, MERGE_M)) matched++;
    else unmatched.push({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 });
  }
  return { total: points.length, matched, ratio: points.length === 0 ? 1 : matched / points.length, unmatched: unmatched.slice(0, 20) };
}

export function buildJunctions(r: RoadsProduct): JunctionsProduct {
  const nodes: NodeB[] = r.nodes.map((n) => ({ ...n, control: NodeControl.None, junction: -1 }));
  const segs = r.segs;
  const edges = r.edges;

  // segment ends per node
  const segsAt: number[][] = nodes.map(() => []);
  segs.forEach((s, i) => { (segsAt[s.a] as number[]).push(i); (segsAt[s.b] as number[]).push(i); });
  const deg = segsAt.map((l) => l.length);
  const names = segsAt.map((l) => nameSet(segs, l));

  const linkable = (n: NodeB): boolean => deg[n.id] as number >= 3 || n.signal || n.roundabout;
  const cand = nodes.filter((n) => (deg[n.id] as number) >= 1);

  // -- clustering
  const parent = nodes.map((_n, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i] as number] as number; i = parent[i] as number; } return i; };
  const members = new Map<number, number[]>();
  const membersOf = (root: number): number[] => members.get(root) ?? [root];
  const approachesOf = (set: readonly number[]): number => {
    const inSet = new Set(set);
    let a = 0;
    for (const m of set) for (const si of segsAt[m] as number[]) {
      const s = segs[si] as SegB;
      const other = s.a === m ? s.b : s.a;
      if (!inSet.has(other) || s.a === s.b) a++;
    }
    return a;
  };
  const grid = new PointGrid<number>(MERGE_M);
  for (const n of cand) if (linkable(n)) grid.add(n.x, n.z, n.id);
  const pairs: { a: number; b: number; d: number }[] = [];
  for (const n of cand) {
    if (!linkable(n)) continue;
    for (const h of grid.query(n.x, n.z, MERGE_M)) {
      const m = h.item;
      if (m <= n.id) continue;
      const o = nodes[m] as NodeB;
      if (o.layer !== n.layer) continue;
      const shareName = [...(names[n.id] as Set<string>)].some((x) => (names[m] as Set<string>).has(x));
      const short = (segsAt[n.id] as number[]).some((si) => {
        const s = segs[si] as SegB;
        return (s.a === m || s.b === m) && s.lengthM <= MERGE_M;
      });
      if (shareName || (n.signal && o.signal) || short) pairs.push({ a: n.id, b: m, d: h.d });
    }
  }
  pairs.sort((p, q) => p.d - q.d || p.a - q.a || p.b - q.b);
  let merged = 0;
  for (const p of pairs) {
    const ra = find(p.a), rb = find(p.b);
    if (ra === rb) continue;
    const union = [...membersOf(ra), ...membersOf(rb)].sort((x, y) => x - y);
    if (approachesOf(union) > MAX_APPROACHES) continue;
    parent[rb] = ra;
    members.set(ra, union);
    members.delete(rb);
    merged++;
  }

  // -- clusters that become junctions
  const clusters: number[][] = [];
  const seen = new Set<number>();
  for (const n of cand) {
    const root = find(n.id);
    if (seen.has(root)) continue;
    seen.add(root);
    const set = membersOf(root).slice().sort((x, y) => x - y);
    const tagged = set.some((m) => (nodes[m] as NodeB).signal || (nodes[m] as NodeB).stop || (nodes[m] as NodeB).giveWay || (nodes[m] as NodeB).roundabout);
    const a = approachesOf(set);
    if (set.length === 1 && (deg[set[0] as number] as number) === 2 && !tagged) continue;
    if (a === 0) continue;
    clusters.push(set);
  }
  const centroid = (set: readonly number[]): { x: number; z: number } => {
    let sx = 0, sz = 0;
    for (const m of set) { sx += (nodes[m] as NodeB).x; sz += (nodes[m] as NodeB).z; }
    return { x: sx / set.length, z: sz / set.length };
  };
  const placed = clusters.map((set) => ({ set, c: centroid(set) }));
  placed.sort((p, q) => {
    const cp = [Math.floor((p.c.x - GRID_MIN_M) / 256), Math.floor((p.c.z - GRID_MIN_M) / 256)] as const;
    const cq = [Math.floor((q.c.x - GRID_MIN_M) / 256), Math.floor((q.c.z - GRID_MIN_M) / 256)] as const;
    return morton(cp[0], cp[1]) - morton(cq[0], cq[1]) || Math.round(p.c.z * 10) - Math.round(q.c.z * 10) || Math.round(p.c.x * 10) - Math.round(q.c.x * 10) || (p.set[0] as number) - (q.set[0] as number);
  });

  const geom = new Map<number, number[]>();
  const edgeGeom = (id: number): number[] => {
    let g = geom.get(id);
    if (!g) {
      const e = edges[id] as { seg: number; dir: 1 | -1 };
      g = edgeXz(segs[e.seg] as SegB, e.dir);
      geom.set(id, g);
    }
    return g;
  };
  const laneOffset = (edgeId: number): number => {
    const e = edges[edgeId] as { lanes: number; laneWidthM: number; medianM: number; flags: number };
    // lane 0 is the rightmost lane; positive offsets lie to the right of the travel direction
    return (e.flags & 1) !== 0 ? (e.lanes / 2 - 0.5) * e.laneWidthM : e.medianM / 2 + 0.5 * e.laneWidthM;
  };

  const junctions: Junction[] = [];
  const usedRestrictions = new Set<number>();
  const byControl: Record<string, number> = {};
  let totalMovements = 0, maxApproaches = 0, signalNoProgram = 0;

  placed.forEach(({ set, c }, jid) => {
    const inSet = new Set(set);
    const mem = set.map((m) => nodes[m] as NodeB);
    const external = (id: number): boolean => !inSet.has((edges[id] as { from: number }).from);
    const inAll: number[] = [];
    for (const m of mem) for (const id of m.in) inAll.push(id);
    const approaches: Approach[] = [];
    for (const id of inAll.sort((a, b) => a - b)) {
      if (!external(id)) continue;
      const e = edges[id] as { cls: number };
      const h = headingOf(edgeGeom(id), false);
      approaches.push({ edge: id, hx: h.tx, hz: h.tz, cls: e.cls });
    }
    maxApproaches = Math.max(maxApproaches, approaches.length);

    // -- control
    const isDead = set.length === 1 && (deg[set[0] as number] as number) === 1;
    let control: NodeControl = NodeControl.None;
    let stopApproaches: number[] = [];
    const anySignal = mem.some((m) => m.signal);
    if (isDead) control = NodeControl.DeadEnd;
    else if (anySignal && approaches.length >= 2) control = NodeControl.Signal;
    else if (mem.some((m) => m.roundabout)) control = NodeControl.Roundabout;
    else {
      const worst = Math.max(...approaches.map((a) => a.cls), 0);
      const best = Math.min(...approaches.map((a) => a.cls), 5);
      const lowest = approaches.filter((a) => a.cls === worst).map((a) => a.edge);
      if (mem.some((m) => m.stopAll)) { control = NodeControl.AllWayStop; stopApproaches = approaches.map((a) => a.edge); }
      else if (mem.some((m) => m.stop)) {
        if (worst === best) { control = NodeControl.AllWayStop; stopApproaches = approaches.map((a) => a.edge); }
        else { control = NodeControl.MinorStop; stopApproaches = lowest; }
      } else if (mem.some((m) => m.giveWay)) {
        control = NodeControl.Yield;
        stopApproaches = worst === best ? approaches.map((a) => a.edge) : lowest;
      } else if (approaches.length >= 3 && approaches.every((a) => a.cls === RoadClass.Local)) {
        control = NodeControl.AllWayStop;
        stopApproaches = approaches.map((a) => a.edge);
      }
    }
    byControl[CONTROL_NAMES[control] ?? String(control)] = (byControl[CONTROL_NAMES[control] ?? String(control)] ?? 0) + 1;

    // -- movements
    const moves: Movement[] = [];
    const curves: number[][] = [];
    const rs = r.restrictions.filter((q) => inSet.has(q.via));
    const removed = (inE: number, outE: number): boolean => {
      let drop = false;
      rs.forEach((q) => {
        const ie = edges[inE] as { seg: number; to: number };
        const oe = edges[outE] as { seg: number; from: number };
        if (ie.to !== q.via || oe.from !== q.via) return;
        const inWay = (segs[ie.seg] as SegB).osmWay, outWay = (segs[oe.seg] as SegB).osmWay;
        const idxQ = r.restrictions.indexOf(q);
        if (q.kind.startsWith('only_')) {
          if (inWay === q.fromWay && outWay !== q.toWay) { drop = true; usedRestrictions.add(idxQ); }
        } else if (inWay === q.fromWay && outWay === q.toWay) { drop = true; usedRestrictions.add(idxQ); }
      });
      return drop;
    };
    for (const m of mem) {
      const ins = [...m.in].sort((a, b) => a - b);
      const outs = [...m.out].sort((a, b) => a - b);
      for (const i of ins) {
        const ie = edges[i] as { twin: number };
        const ig = edgeGeom(i);
        const ih = headingOf(ig, false);
        for (const o of outs) {
          const isTwin = ie.twin === o;
          if (removed(i, o)) continue;
          if (isTwin && !(isDead && deg[m.id] === 1)) continue;
          const og = edgeGeom(o);
          const oh = headingOf(og, true);
          const turn = isTwin ? 'uturn' : turnOf([ih.tx, ih.tz], [oh.tx, oh.tz]);
          if (turn === 'uturn' && !isTwin) continue;
          const lenI = polyLength(ig), lenO = polyLength(og);
          const sb = Math.min(6, 0.4 * lenI), sa = Math.min(6, 0.4 * lenO);
          const ip: [number, number] = [ih.x - ih.tx * sb, ih.z - ih.tz * sb];
          const op: [number, number] = [oh.x + oh.tx * sa, oh.z + oh.tz * sa];
          const offI = laneOffset(i), offO = laneOffset(o);
          const p0: [number, number] = [ip[0] - ih.tz * offI, ip[1] + ih.tx * offI];
          const p3: [number, number] = [op[0] - oh.tz * offO, op[1] + oh.tx * offO];
          const curve = connector(p0, [ih.tx, ih.tz], p3, [oh.tx, oh.tz]);
          curves.push(curve);
          moves.push({ id: moves.length, inEdge: i, outEdge: o, turn, lengthM: Math.round(polyLength(curve) * 10) / 10, conflicts: [] });
        }
      }
    }
    const boxes = curves.map((cv) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let q = 0; q < cv.length; q += 2) {
        const x = cv[q] as number, z = cv[q + 1] as number;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      return [x0 - CONFLICT_M, z0 - CONFLICT_M, x1 + CONFLICT_M, z1 + CONFLICT_M] as const;
    });
    for (let a = 0; a < moves.length; a++) {
      const ma = moves[a] as Movement;
      const hits: { id: number; d: number }[] = [];
      const ba = boxes[a] as readonly number[];
      for (let b = 0; b < moves.length; b++) {
        if (a === b) continue;
        const mb = moves[b] as Movement;
        if (ma.inEdge === mb.inEdge) continue;
        const bb = boxes[b] as readonly number[];
        if (ma.outEdge !== mb.outEdge && ((ba[2] as number) < (bb[0] as number) || (bb[2] as number) < (ba[0] as number) || (ba[3] as number) < (bb[1] as number) || (bb[3] as number) < (ba[1] as number))) continue;
        const d = ma.outEdge === mb.outEdge ? 0 : polyPolyDist(curves[a] as number[], curves[b] as number[], CONFLICT_M);
        if (d <= CONFLICT_M) hits.push({ id: b, d });
      }
      hits.sort((p, q) => p.d - q.d || p.id - q.id);
      ma.conflicts = hits.slice(0, MAX_CONFLICTS).map((h) => h.id).sort((p, q) => p - q);
    }
    totalMovements += moves.length;

    let program = null;
    if (control === NodeControl.Signal) {
      program = buildProgram({ junctionId: jid, approaches, movements: moves });
      if (!program) { signalNoProgram++; control = NodeControl.None; }
    }
    const j: Junction = { id: jid, nodes: set, x: Math.round(c.x * 10) / 10, z: Math.round(c.z * 10) / 10, control, movements: moves, program, stopApproaches: stopApproaches.sort((a, b) => a - b) };
    junctions.push(j);
    for (const m of mem) { m.junction = jid; m.control = control; }
  });

  let maxOut = 0;
  for (const n of nodes) maxOut = Math.max(maxOut, n.out.length);
  const report: JunctionsReport = {
    junctions: junctions.length, byControl: Object.fromEntries(Object.entries(byControl).sort(([a], [b]) => (a < b ? -1 : 1))), movements: totalMovements,
    restrictionsApplied: usedRestrictions.size, restrictionsUnmatched: r.restrictions.length - usedRestrictions.size, maxApproaches, maxOutDegree: maxOut,
    signalNoProgram, mergedClusters: merged, signalMatch: signalMatch(r.signalPoints, junctions, nodes),
  };
  return { nodes, junctions, report };
}
