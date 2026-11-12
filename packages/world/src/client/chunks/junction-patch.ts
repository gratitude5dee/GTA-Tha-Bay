/**
 * The geometry rules behind the street markings (M02h1): where road ribbons end at a junction, the plain patch that replaces their
 * overlap, the crosswalk and stop-bar quads, and the helpers the ribbon builder shares (clipping, collinear-vertex removal, the two sides of
 * a ribbon). Pure and deterministic: no `three`, no `Math.random`, so it runs in asset.worker and in the unit tests.
 *
 * The bake gives every segment to one chunk (the one that owns its lower-id edge) and every junction to the chunk of its node, so a
 * junction's roads are often in a neighbouring chunk. The mesher job therefore hands over the chunks of the whole z7 tile
 * (`MeshChunkOptions.tile`); the plan below is made once per tile (`WeakMap` by the array's identity) and every chunk of the tile reads
 * the same answer: the clip distance of a segment end, and the patch of a junction that lies in the chunk. A road owned by a chunk of the
 * next tile is unknown to this tile's plan; its end stays unclipped, as before M02h1, and the junction's patch is built from the roads
 * the tile knows (counted in `skipped` when too few remain).
 */
import { NodeControl, PedEdgeKind, type Junction, type PedNode, type RoadEdge, type RoadNode, type RoadSegment, type SimChunk } from '@dv/shared';
import type { LayoutConfig, RoadLayout } from '../look/road-layout.ts';
import { carriagewayOuterM, carriagewayShift, packRoad } from '../look/road-layout.ts';

export interface Pt3 {
  x: number;
  y: number;
  z: number;
}
/** A point of a ribbon centreline: `s` is the arc length from the first point of the original segment. */
export interface RibbonPoint extends Pt3 {
  s: number;
}

// ---- polylines ------------------------------------------------------------------------------------------------------------------

/** Total length of a polyline of (x, y, z) triples, measured in the ground plane like the bake's `lengthM`. */
export function arcLength(pts: Float32Array): number {
  let s = 0;
  for (let i = 1; i < pts.length / 3; i++) s += Math.hypot((pts[i * 3] as number) - (pts[i * 3 - 3] as number), (pts[i * 3 + 2] as number) - (pts[i * 3 - 1] as number));
  return s;
}

/**
 * The polyline with `clipStart` metres cut off its start and `clipEnd` off its end: the cut points are interpolated, the vertices between
 * them kept, each with its arc length from the original first point. Null when nothing (under 5 cm) is left.
 */
export function clippedPolyline(pts: Float32Array, clipStart: number, clipEnd: number): RibbonPoint[] | null {
  const n = pts.length / 3;
  if (n < 2) return null;
  const sAt: number[] = [0];
  for (let i = 1; i < n; i++) sAt.push((sAt[i - 1] as number) + Math.hypot((pts[i * 3] as number) - (pts[i * 3 - 3] as number), (pts[i * 3 + 2] as number) - (pts[i * 3 - 1] as number)));
  const total = sAt[n - 1] as number;
  const s0 = Math.max(0, clipStart);
  const s1 = total - Math.max(0, clipEnd);
  if (s1 - s0 < 0.05) return null;
  const at = (s: number): RibbonPoint => {
    let i = 1;
    while (i < n - 1 && (sAt[i] as number) < s) i++;
    const a = sAt[i - 1] as number, b = sAt[i] as number;
    const t = b > a ? Math.min(1, Math.max(0, (s - a) / (b - a))) : 0;
    const p = (k: number): number => pts[(i - 1) * 3 + k] as number;
    const q = (k: number): number => pts[i * 3 + k] as number;
    return { x: p(0) + (q(0) - p(0)) * t, y: p(1) + (q(1) - p(1)) * t, z: p(2) + (q(2) - p(2)) * t, s };
  };
  const out: RibbonPoint[] = [s0 <= 0 ? { x: pts[0] as number, y: pts[1] as number, z: pts[2] as number, s: 0 } : at(s0)];
  for (let i = 1; i < n - 1; i++) {
    const s = sAt[i] as number;
    if (s > s0 + 0.01 && s < s1 - 0.01) out.push({ x: pts[i * 3] as number, y: pts[i * 3 + 1] as number, z: pts[i * 3 + 2] as number, s });
  }
  out.push(s1 >= total ? { x: pts[(n - 1) * 3] as number, y: pts[(n - 1) * 3 + 1] as number, z: pts[(n - 1) * 3 + 2] as number, s: total } : at(s1));
  return out;
}

/** The longest quad the ribbon builder emits: the `road` attribute's `x` has 396 m of room past its wrap (`ROAD_WRAP_M`). */
export const MAX_QUAD_M = 200;

/**
 * Drops the vertices that lie within `tolM` of the line between their kept neighbours (in 3D, so a grade change keeps its vertex) and
 * never leaves a gap over `MAX_QUAD_M`. The ribbon is the same surface to within a centimetre with fewer quads; the paint coordinates
 * interpolate linearly along `s`, so they do not change.
 */
export function simplifyPoints(points: readonly RibbonPoint[], tolM = 0.01): RibbonPoint[] {
  if (points.length <= 2) return points.slice();
  const keep: RibbonPoint[] = [points[0] as RibbonPoint];
  let anchorAt = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const anchor = points[anchorAt] as RibbonPoint;
    const next = points[i + 1] as RibbonPoint;
    // would dropping vertices anchor+1 .. i (a line from the anchor to the next vertex) move any of them more than tolM?
    let ok = next.s - anchor.s <= MAX_QUAD_M;
    for (let j = anchorAt + 1; ok && j <= i; j++) {
      const p = points[j] as RibbonPoint;
      const t = (p.s - anchor.s) / (next.s - anchor.s || 1);
      const dx = p.x - (anchor.x + (next.x - anchor.x) * t), dy = p.y - (anchor.y + (next.y - anchor.y) * t), dz = p.z - (anchor.z + (next.z - anchor.z) * t);
      if (Math.hypot(dx, dy, dz) > tolM) ok = false;
    }
    if (!ok) {
      keep.push(points[i] as RibbonPoint);
      anchorAt = i;
    }
  }
  keep.push(points[points.length - 1] as RibbonPoint);
  return keep;
}

/**
 * The two sides of a ribbon of half width `halfM` along `points`: `left[i]` and `right[i]` stand at point `i` on either side, found from
 * the direction between its neighbours (the ends use their one neighbour). `left` is the side at (-tz, +tx), which is the RIGHT of the
 * traveller along the point order in these x-east, z-south coordinates; `right` is the traveller's left, where the `road` attribute is `+`.
 */
export function ribbonSides(points: readonly RibbonPoint[], halfM: number): { left: Pt3[]; right: Pt3[] } {
  const n = points.length;
  const left: Pt3[] = [];
  const right: Pt3[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)] as RibbonPoint, b = points[Math.min(n - 1, i + 1)] as RibbonPoint;
    let tx = b.x - a.x, tz = b.z - a.z;
    const len = Math.sqrt(tx * tx + tz * tz) || 1;
    tx /= len;
    tz /= len;
    const p = points[i] as RibbonPoint;
    left.push({ x: p.x - tz * halfM, y: p.y, z: p.z + tx * halfM });
    right.push({ x: p.x + tz * halfM, y: p.y, z: p.z - tx * halfM });
  }
  return { left, right };
}

/** The convex hull of 2D points (x, z) as indices in counter-clockwise order of the (x, z) plane; ties broken by index, so it is deterministic. */
export function convexHull(pts: readonly { x: number; z: number }[]): number[] {
  const idx = pts.map((_, i) => i).sort((a, b) => (pts[a] as { x: number }).x - (pts[b] as { x: number }).x || (pts[a] as { z: number }).z - (pts[b] as { z: number }).z || a - b);
  if (idx.length < 3) return idx;
  const cross = (o: number, a: number, b: number): number => {
    const po = pts[o] as { x: number; z: number }, pa = pts[a] as { x: number; z: number }, pb = pts[b] as { x: number; z: number };
    return (pa.x - po.x) * (pb.z - po.z) - (pa.z - po.z) * (pb.x - po.x);
  };
  const lower: number[] = [];
  for (const i of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as number, lower[lower.length - 1] as number, i) <= 1e-9) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (const i of [...idx].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2] as number, upper[upper.length - 1] as number, i) <= 1e-9) upper.pop();
    upper.push(i);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** How far inside the hull (metres, positive inside) the point `i` of `pts` lies; the hull is the output of `convexHull`. */
export function depthInsideHull(pts: readonly { x: number; z: number }[], hull: readonly number[], i: number): number {
  const p = pts[i] as { x: number; z: number };
  let depth = Infinity;
  for (let k = 0; k < hull.length; k++) {
    const a = pts[hull[k] as number] as { x: number; z: number }, b = pts[hull[(k + 1) % hull.length] as number] as { x: number; z: number };
    const ex = b.x - a.x, ez = b.z - a.z;
    const len = Math.hypot(ex, ez) || 1;
    // counter-clockwise hull: the inside is on the left of every edge
    depth = Math.min(depth, (ex * (p.z - a.z) - ez * (p.x - a.x)) / len);
  }
  return depth;
}

// ---- the tile's road data ---------------------------------------------------------------------------------------------------------

export interface CrosswalkRec {
  /** The ped edge's two nodes. */
  a: Pt3;
  b: Pt3;
  widthM: number;
  junction: number;
  chunk: string;
}

/** What the planner reads, indexed once per tile. */
export interface RoadsContext {
  chunks: readonly SimChunk[];
  segById: Map<number, RoadSegment>;
  edgeById: Map<number, RoadEdge>;
  edgesBySeg: Map<number, RoadEdge[]>;
  edgesAtNode: Map<number, RoadEdge[]>;
  nodeById: Map<number, RoadNode>;
  junctionById: Map<number, Junction>;
  /** The chunk that holds each junction. */
  junctionChunk: Map<number, string>;
  crosswalks: Map<string, CrosswalkRec[]>;
  crosswalksByJunction: Map<number, CrosswalkRec[]>;
  /** Class of each segment (its first edge's), and the segment's axis-aligned bounds for the nearest-road search. */
  clsOfSeg: Map<number, number>;
  bounds: Map<number, [number, number, number, number]>;
}

const contexts = new WeakMap<readonly SimChunk[], RoadsContext>();
const singles = new WeakMap<SimChunk, readonly SimChunk[]>();

/** The chunks the roads of `sim` are planned over: the job's tile when it holds `sim`, else `sim` alone (one array per chunk, so the plan is memoised). */
export function tileOf(sim: SimChunk, tile?: readonly SimChunk[]): readonly SimChunk[] {
  if (tile && tile.includes(sim)) return tile;
  let one = singles.get(sim);
  if (!one) {
    one = [sim];
    singles.set(sim, one);
  }
  return one;
}

/** Indexes the roads, junctions and crosswalks of the chunks of a tile (memoised on the array). */
export function roadsContext(chunks: readonly SimChunk[]): RoadsContext {
  const memo = contexts.get(chunks);
  if (memo) return memo;
  const ctx: RoadsContext = {
    chunks,
    segById: new Map(),
    edgeById: new Map(),
    edgesBySeg: new Map(),
    edgesAtNode: new Map(),
    nodeById: new Map(),
    junctionById: new Map(),
    junctionChunk: new Map(),
    crosswalks: new Map(),
    crosswalksByJunction: new Map(),
    clsOfSeg: new Map(),
    bounds: new Map(),
  };
  const pushTo = <K, V>(m: Map<K, V[]>, k: K, v: V): void => {
    const l = m.get(k);
    if (l) l.push(v);
    else m.set(k, [v]);
  };
  for (const c of chunks) {
    for (const s of c.segments) {
      ctx.segById.set(s.id, s);
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < s.pts.length; i += 3) {
        const x = s.pts[i] as number, z = s.pts[i + 2] as number;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      ctx.bounds.set(s.id, [minX, minZ, maxX, maxZ]);
    }
    for (const n of c.nodes) ctx.nodeById.set(n.id, n);
    for (const j of c.junctions) {
      ctx.junctionById.set(j.id, j);
      ctx.junctionChunk.set(j.id, c.key);
    }
  }
  for (const c of chunks) {
    for (const e of c.edges) {
      ctx.edgeById.set(e.id, e);
      pushTo(ctx.edgesBySeg, e.seg, e);
      pushTo(ctx.edgesAtNode, e.from, e);
      if (e.to !== e.from) pushTo(ctx.edgesAtNode, e.to, e);
      if (!ctx.clsOfSeg.has(e.seg)) ctx.clsOfSeg.set(e.seg, e.cls);
    }
  }
  for (const c of chunks) {
    const nodes = new Map<number, PedNode>();
    for (const n of c.pedNodes) nodes.set(n.id, n);
    const list: CrosswalkRec[] = [];
    for (const pe of c.pedEdges) {
      if (pe.kind !== PedEdgeKind.Crosswalk) continue;
      const a = nodes.get(pe.a), b = nodes.get(pe.b);
      if (!a || !b) continue;
      const rec: CrosswalkRec = { a: { x: a.x, y: a.y, z: a.z }, b: { x: b.x, y: b.y, z: b.z }, widthM: pe.widthM, junction: pe.junction, chunk: c.key };
      list.push(rec);
      if (pe.junction >= 0) pushTo(ctx.crosswalksByJunction, pe.junction, rec);
    }
    ctx.crosswalks.set(c.key, list);
  }
  contexts.set(chunks, ctx);
  return ctx;
}

/** The road under (x, z): the nearest centreline point of any segment of the tile within `maxM`, with the segment's half width and class. */
export interface NearRoad {
  y: number;
  halfM: number;
  cls: number;
  seg: number;
  /** The unit tangent of the segment there, and the nearest centreline point. */
  tx: number;
  tz: number;
  qx: number;
  qz: number;
  dist: number;
}

export function nearestRoad(ctx: RoadsContext, x: number, z: number, maxM = 30): NearRoad | null {
  let best: NearRoad | null = null;
  for (const [id, seg] of ctx.segById) {
    const b = ctx.bounds.get(id) as [number, number, number, number];
    const reach = maxM + seg.widthM / 2;
    if (x < b[0] - reach || x > b[2] + reach || z < b[1] - reach || z > b[3] + reach) continue;
    const p = seg.pts;
    for (let i = 0; i + 1 < p.length / 3; i++) {
      const ax = p[i * 3] as number, az = p[i * 3 + 2] as number, bx = p[i * 3 + 3] as number, bz = p[i * 3 + 5] as number;
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d <= maxM && (best === null || d < best.dist - 1e-9)) {
        const l = Math.sqrt(l2) || 1;
        best = {
          y: (p[i * 3 + 1] as number) + ((p[i * 3 + 4] as number) - (p[i * 3 + 1] as number)) * t,
          halfM: seg.widthM / 2,
          cls: ctx.clsOfSeg.get(id) ?? 4,
          seg: id,
          tx: dx / l,
          tz: dz / l,
          qx: ax + dx * t,
          qz: az + dz * t,
          dist: d,
        };
      }
    }
  }
  return best;
}

// ---- junctions ---------------------------------------------------------------------------------------------------------------------

/** One road ending at a junction. */
export interface Arm {
  seg: number;
  /** 0: the node is at the first point of the segment, 1: at the last. */
  end: 0 | 1;
  /** The edge that gave the arm (an edge of the segment at the node). */
  edge: number;
  halfM: number;
  cls: number;
  lengthM: number;
  /** Unit vector away from the node along the road. */
  dx: number;
  dz: number;
}

export interface Corner extends Pt3 {
  cls: number;
}

export interface PlannedJunction {
  id: number;
  x: number;
  z: number;
  /** Height of the node (no lift). */
  y: number;
  radiusM: number;
  arms: Arm[];
  /** The clipped ends of the arms, two per arm (the two sides of its ribbon at the clip), in arm order. */
  corners: Corner[];
  /** Indices into `corners`, counter-clockwise: the outline of the patch. */
  hull: number[];
  /** The class of the busiest arm (its colour and lift rank the patch). */
  cls: number;
  chunk: string;
}

export interface RoadsPlan {
  /** Metres to clip off the end of a segment, keyed `seg * 2 + end`. */
  clip: Map<number, number>;
  /** The junctions that got a patch, by junction id. */
  junctions: Map<number, PlannedJunction>;
  /** Junctions of three or more roads whose patch was skipped (too short a road, layered arms, a corner inside the hull). */
  skipped: number;
}

export const clipKey = (seg: number, end: 0 | 1): number => seg * 2 + end;

const plans = new WeakMap<RoadsContext, Map<number, RoadsPlan>>();

/** The deepest a ribbon corner may lie inside the patch outline (AC-3). */
export const CORNER_TOLERANCE_M = 0.05;

/**
 * The plan of a tile: for every junction with at least three known roads, the clip distance (the largest half width plus `extraM`), the
 * clipped corners and their convex hull. A junction whose roads are too short, differ in layer or leave a corner more than
 * `CORNER_TOLERANCE_M` inside the hull keeps its overlapping ribbons (M02g2) and is counted in `skipped`.
 */
export function planRoads(ctx: RoadsContext, extraM: number): RoadsPlan {
  let byExtra = plans.get(ctx);
  if (!byExtra) {
    byExtra = new Map();
    plans.set(ctx, byExtra);
  }
  const memo = byExtra.get(extraM);
  if (memo) return memo;
  const plan: RoadsPlan = { clip: new Map(), junctions: new Map(), skipped: 0 };
  const ids = [...ctx.junctionById.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const j = ctx.junctionById.get(id) as Junction;
    const arms = armsOf(ctx, j);
    if (arms === null) {
      plan.skipped++;
      continue;
    }
    if (arms.length < 3) continue;
    const radius = Math.max(...arms.map((a) => a.halfM)) + extraM;
    const layers = new Set(arms.map((a) => (ctx.edgeById.get(a.edge) as RoadEdge).layer));
    let ok = layers.size === 1;
    // every arm must be long enough for its clip, and not already clipped at its other end by a junction that took it first
    for (const a of arms) {
      const other = plan.clip.get(clipKey(a.seg, a.end === 0 ? 1 : 0)) ?? 0;
      if (a.lengthM < radius + other + 1) ok = false;
      if (plan.clip.has(clipKey(a.seg, a.end))) ok = false;
    }
    const nodeY = arms.length > 0 ? averageNodeY(ctx, j) : 0;
    const corners: Corner[] = [];
    if (ok) {
      for (const a of arms) {
        const seg = ctx.segById.get(a.seg) as RoadSegment;
        const cut = clippedPolyline(seg.pts, a.end === 0 ? radius : 0, a.end === 1 ? radius : 0);
        if (!cut) {
          ok = false;
          break;
        }
        const sides = ribbonSides(cut, a.halfM);
        const i = a.end === 0 ? 0 : cut.length - 1;
        corners.push({ ...(sides.left[i] as Pt3), cls: a.cls }, { ...(sides.right[i] as Pt3), cls: a.cls });
      }
    }
    let hull: number[] = [];
    if (ok) {
      hull = convexHull(corners);
      if (hull.length < 3) ok = false;
      for (let i = 0; ok && i < corners.length; i++) if (depthInsideHull(corners, hull, i) > CORNER_TOLERANCE_M) ok = false;
    }
    if (!ok) {
      plan.skipped++;
      continue;
    }
    for (const a of arms) plan.clip.set(clipKey(a.seg, a.end), radius);
    plan.junctions.set(id, {
      id, x: j.x, z: j.z, y: nodeY, radiusM: radius, arms, corners, hull, cls: Math.min(...arms.map((a) => a.cls)), chunk: ctx.junctionChunk.get(id) as string,
    });
  }
  byExtra.set(extraM, plan);
  return plan;
}

function averageNodeY(ctx: RoadsContext, j: Junction): number {
  let sum = 0, n = 0;
  for (const id of j.nodes) {
    const node = ctx.nodeById.get(id);
    if (node) {
      sum += node.y;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** The roads of the tile that end at the junction's nodes: one arm per (segment, end); null when one of them joins two nodes of the junction. */
export function armsOf(ctx: RoadsContext, j: Junction): Arm[] | null {
  const arms: Arm[] = [];
  const seen = new Set<number>();
  const nodes = new Set(j.nodes);
  for (const nid of j.nodes) {
    for (const e of ctx.edgesAtNode.get(nid) ?? []) {
      const seg = ctx.segById.get(e.seg);
      if (!seg || seg.pts.length < 6) continue;
      // the end of the segment at this node: the edge runs from the first point to the last when `dir` is 1
      const end: 0 | 1 = e.from === nid ? (e.dir === 1 ? 0 : 1) : e.dir === 1 ? 1 : 0;
      // a segment that joins two nodes of the same junction is internal to it: the patch cannot take it
      const otherNode = e.from === nid ? e.to : e.from;
      if (nodes.has(otherNode)) return null;
      const key = clipKey(seg.id, end);
      if (seen.has(key)) continue;
      seen.add(key);
      const p = seg.pts;
      const n = p.length / 3;
      const k = end === 0 ? 0 : n - 1;
      // direction away from the node: towards the first vertex that is at least half a metre off
      let dx = 0, dz = 0;
      for (let i = 1; i < n; i++) {
        const q = end === 0 ? i : n - 1 - i;
        dx = (p[q * 3] as number) - (p[k * 3] as number);
        dz = (p[q * 3 + 2] as number) - (p[k * 3 + 2] as number);
        if (Math.hypot(dx, dz) >= 0.5) break;
      }
      const l = Math.hypot(dx, dz) || 1;
      arms.push({ seg: seg.id, end, edge: e.id, halfM: seg.widthM / 2, cls: ctx.clsOfSeg.get(seg.id) ?? 4, lengthM: arcLength(p), dx: dx / l, dz: dz / l });
    }
  }
  return arms.sort((a, b) => a.seg - b.seg || a.end - b.end);
}

// ---- crosswalks and stop bars -----------------------------------------------------------------------------------------------------

/** A decal quad of the roads object: four corners in order around the quad, each with the paint coordinates (`u` along, `v` across). */
export interface DecalQuad {
  corners: { x: number; y: number; z: number; u: number; v: number }[];
  /** Class of the road under it (its colour). */
  cls: number;
  /** Crosswalks: the crossing length in metres and whether the ladder is drawn. */
  lengthM: number;
  ladder: boolean;
}

/**
 * The quad of one crosswalk: from `a` to `b`, `widthM` wide, trimmed to the carriageway it crosses (the ped nodes stand on the sidewalks
 * either side of it). `raiseM` goes on top of the road's height under each corner: the highest ribbon lift plus the decal lift.
 */
export function crosswalkQuad(ctx: RoadsContext, rec: CrosswalkRec, ladder: boolean, raiseM: number): DecalQuad | null {
  const dx = rec.b.x - rec.a.x, dz = rec.b.z - rec.a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1) return null;
  const ux = dx / len, uz = dz / len;
  const road = nearestRoad(ctx, (rec.a.x + rec.b.x) / 2, (rec.a.z + rec.b.z) / 2, 40);
  // the span of the crossing that lies over the carriageway: the lateral offset from the road's centreline is linear along the crossing
  let l0 = 0, l1 = len;
  if (road) {
    const nx = -road.tz, nz = road.tx;
    const c0 = (rec.a.x - road.qx) * nx + (rec.a.z - road.qz) * nz;
    const c1 = ux * nx + uz * nz;
    if (Math.abs(c1) > 0.2) {
      const lo = (-road.halfM - c0) / c1, hi = (road.halfM - c0) / c1;
      const a = Math.max(0, Math.min(lo, hi)), b = Math.min(len, Math.max(lo, hi));
      if (b - a >= 0.5) {
        l0 = a;
        l1 = b;
      }
    }
  }
  const w = rec.widthM / 2;
  const px = -uz, pz = ux;
  const corner = (l: number, side: number): DecalQuad['corners'][number] => {
    const x = rec.a.x + ux * l + px * w * side, z = rec.a.z + uz * l + pz * w * side;
    const r = nearestRoad(ctx, x, z, 40);
    return { x, y: (r?.y ?? road?.y ?? rec.a.y) + raiseM, z, u: l - l0, v: w * side };
  };
  return {
    corners: [corner(l0, -1), corner(l0, 1), corner(l1, 1), corner(l1, -1)],
    cls: road?.cls ?? 4,
    lengthM: l1 - l0,
    ladder,
  };
}

/** The approach edges of a junction that get a stop bar: its `stopApproaches` and, at a signal, the `inEdge` of every movement. */
export function approachesOf(j: Junction): number[] {
  const out = new Set<number>(j.stopApproaches);
  if (j.control === NodeControl.Signal) for (const m of j.movements) out.add(m.inEdge);
  return [...out].sort((a, b) => a - b);
}

export interface StopBarOptions {
  depthM: number;
  behindCrosswalkM: number;
  /** Added to the road height under each corner: the highest ribbon lift plus the decal lift. */
  raiseM: number;
  layout: LayoutConfig;
}

/**
 * The stop bar of one approach edge of junction `j`: `depthM` deep, behind the crosswalk of that arm (or where it would stand, the clip
 * distance plus the crosswalk width, when the arm has none), across the approach's own lanes from the median edge to the parking lane.
 * Null when the edge or its segment is not in the tile.
 */
export function stopBarQuad(ctx: RoadsContext, j: Junction, planned: PlannedJunction | undefined, edgeId: number, o: StopBarOptions): DecalQuad | null {
  const e = ctx.edgeById.get(edgeId);
  if (!e) return null;
  const seg = ctx.segById.get(e.seg);
  if (!seg || seg.pts.length < 6) return null;
  const nodes = new Set(j.nodes);
  if (!nodes.has(e.to)) return null;
  const end: 0 | 1 = e.dir === 1 ? 1 : 0;
  const p = seg.pts;
  const n = p.length / 3;
  const k = end === 0 ? 0 : n - 1;
  // the arm's polyline from the node outwards
  const arm: Float32Array = new Float32Array(p.length);
  for (let i = 0; i < n; i++) {
    const q = end === 0 ? i : n - 1 - i;
    arm[i * 3] = p[q * 3] as number;
    arm[i * 3 + 1] = p[q * 3 + 1] as number;
    arm[i * 3 + 2] = p[q * 3 + 2] as number;
  }
  void k;
  const edges = ctx.edgesBySeg.get(seg.id) ?? [e];
  const layout: RoadLayout = packRoad(seg, edges, o.layout);
  const halfW = seg.widthM / 2;
  const axis = { dx: 0, dz: 0 };
  {
    let dx = 0, dz = 0;
    for (let i = 1; i < n; i++) {
      dx = (arm[i * 3] as number) - (arm[0] as number);
      dz = (arm[i * 3 + 2] as number) - (arm[2] as number);
      if (Math.hypot(dx, dz) >= 0.5) break;
    }
    const l = Math.hypot(dx, dz) || 1;
    axis.dx = dx / l;
    axis.dz = dz / l;
  }
  // where the crosswalk of this arm stands: along the arm from the node, and its width
  const radius = planned?.radiusM ?? halfW + 1;
  let cwDist = radius + 1.5, cwWidth = 3;
  let best = Infinity;
  for (const cw of ctx.crosswalksByJunction.get(j.id) ?? []) {
    const mx = (cw.a.x + cw.b.x) / 2 - j.x, mz = (cw.a.z + cw.b.z) / 2 - j.z;
    const along = mx * axis.dx + mz * axis.dz;
    const across = Math.abs(-mx * axis.dz + mz * axis.dx);
    if (along > 0 && across < halfW + 3 && across < best) {
      best = across;
      cwDist = along;
      cwWidth = cw.widthM;
    }
  }
  const d0 = cwDist + cwWidth / 2 + o.behindCrosswalkM;
  const d1 = d0 + o.depthM;
  if (d1 > arcLength(arm) - 0.5) return null;
  // across: the approach's lanes. `t` is + on the left of `dir 1`; traffic of dir 1 uses the - half.
  const shift = carriagewayShift(layout, o.layout.parkingM);
  const outer = carriagewayOuterM(layout);
  const m = layout.oneWay ? 0 : layout.medianM / 2;
  let tLo: number, tHi: number;
  if (layout.oneWay) [tLo, tHi] = [shift - outer, shift + outer];
  else if (e.dir === 1) [tLo, tHi] = [shift - outer, shift - m];
  else [tLo, tHi] = [shift + m, shift + outer];
  // the polyline of the arm runs away from the node: the `dir 1` direction is that of the segment, i.e. away from the node when end is 0
  const sign = end === 0 ? 1 : -1;
  const at = (d: number): { x: number; y: number; z: number; tx: number; tz: number } => {
    let acc = 0;
    for (let i = 0; i + 1 < n; i++) {
      const ax = arm[i * 3] as number, ay = arm[i * 3 + 1] as number, az = arm[i * 3 + 2] as number;
      const bx = arm[i * 3 + 3] as number, by = arm[i * 3 + 4] as number, bz = arm[i * 3 + 5] as number;
      const l = Math.hypot(bx - ax, bz - az);
      if (acc + l >= d || i + 2 >= n) {
        const t = l > 0 ? Math.min(1, Math.max(0, (d - acc) / l)) : 0;
        return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, z: az + (bz - az) * t, tx: (bx - ax) / (l || 1), tz: (bz - az) / (l || 1) };
      }
      acc += l;
    }
    return { x: arm[0] as number, y: arm[1] as number, z: arm[2] as number, tx: axis.dx, tz: axis.dz };
  };
  const corner = (d: number, t: number): DecalQuad['corners'][number] => {
    const c = at(d);
    // the left of `dir 1`: (tz, -tx) of the `dir 1` tangent, which is the arm tangent times `sign`
    const lx = c.tz * sign, lz = -c.tx * sign;
    return { x: c.x + lx * t, y: c.y + o.raiseM, z: c.z + lz * t, u: d - d0, v: t };
  };
  return {
    corners: [corner(d0, tLo), corner(d0, tHi), corner(d1, tHi), corner(d1, tLo)],
    cls: ctx.clsOfSeg.get(seg.id) ?? 4,
    lengthM: o.depthM,
    ladder: false,
  };
}
