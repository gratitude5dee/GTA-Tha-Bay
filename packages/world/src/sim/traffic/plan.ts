/**
 * Where an agent is and where it goes next (02-world-living.md section 2.1.2 and 2.1.4; M03b1).
 *
 *  - `EdgePaths`: positions and headings along a resident edge's lane, the curve speed cap along it, its grade.
 *  - `planTurn`: 40 m before the end of an edge, a legal movement is chosen with the weights straight 0.60, right 0.22, left 0.18
 *    (renormalized over the movements that exist), never the reverse twin, never a closed or unloaded edge. A dead end has the
 *    U-turn only.
 *  - The lane an agent takes for a turn: right turn from lane 0, left turn from the leftmost lane.
 *
 * Pure; C02 lint applies.
 */
import {
  EdgeFlag, TWO_PI, datan2, dsqrt, type EdgeId, type Junction, type Movement, type NodeId, type RoadEdge,
} from '@dv/shared';
import type { RoadNetwork } from '../graph/adjacency.ts';
import { polylineLength } from '../graph/geometry.ts';
import type { RoadGraph } from '../graph/query.ts';
import { Turn } from './components.ts';
import { curveLimit, gradeScale } from './idm.ts';

/** Metres before the end of an edge at which the next edge is chosen, and within which the lane for the turn is taken. */
export const PLAN_DISTANCE_M = 40;
/** Turn weights (living part 2.1.2). */
export const TURN_WEIGHT = { straight: 0.6, right: 0.22, left: 0.18 } as const;

/** Half length of a junction box along an edge: the connector runs from `len - BOX_HALF_M` of the in edge to `BOX_HALF_M` of the out edge. */
export const BOX_HALF_M = 6;

export interface CurveProfile {
  /** Arc length of each interior vertex along the directed edge, metres, ascending. */
  s: Float32Array;
  /** Speed cap at that vertex from the curvature there, m/s. */
  v: Float32Array;
}

const NO_CAP: CurveProfile = { s: new Float32Array(0), v: new Float32Array(0) };
const CACHE_LIMIT = 6000;

export class EdgePaths {
  private readonly profiles = new Map<EdgeId, CurveProfile>();
  private readonly tmp = new Float64Array(5);
  private readonly tmp2 = new Float64Array(5);

  constructor(readonly net: RoadNetwork, readonly graph: RoadGraph) {}

  /** Length of a directed edge, metres. */
  len(e: EdgeId): number {
    return this.net.lenDm(e) / 10;
  }

  /** The resident detail of an edge, or null when its chunk is not resident. */
  edge(e: EdgeId): Readonly<RoadEdge> | null {
    return this.net.resident(e)?.edge ?? null;
  }

  /** Speed limit of an edge, m/s. */
  limit(e: EdgeId): number {
    return this.net.speedMps(e);
  }

  /** Lateral offset of a lane centre from the centreline, metres, positive to the right of travel (C08 rule 10). */
  laneOffset(e: EdgeId, lane: number): number {
    const ed = this.edge(e);
    if (!ed) return 1.5 * (lane + 0.5);
    return (ed.flags & EdgeFlag.OneWay) !== 0 || ed.twin < 0
      ? (lane + 0.5 - ed.lanes / 2) * ed.laneWidthM
      : ed.medianM / 2 + (lane + 0.5) * ed.laneWidthM;
  }

  /**
   * x, y, z and yaw of a position `s` along edge `e`, `lat` metres right of the centreline, then the unit travel direction
   * (tx, tz) in slots 4 and 5. Yaw is about +Y with 0 facing -Z (a prefab placement). Returns false when the edge has no geometry.
   */
  pose(e: EdgeId, s: number, lat: number, out: Float64Array): boolean {
    const t = this.tmp;
    if (!this.graph.pointOnEdge(e, s, t)) return false;
    const tx = t[3] as number, tz = t[4] as number;
    out[0] = (t[0] as number) - tz * lat;
    out[1] = t[1] as number;
    out[2] = (t[2] as number) + tx * lat;
    let yaw = datan2(-tx, -tz);
    if (yaw < 0) yaw += TWO_PI;
    out[3] = yaw;
    out[4] = tx;
    out[5] = tz;
    return true;
  }

  /** The unit travel direction (tx, tz) at the end of an edge (`atEnd`) or at its start. Null without geometry. */
  tangent(e: EdgeId, atEnd: boolean, out: Float64Array): boolean {
    const len = this.len(e);
    if (!this.graph.pointOnEdge(e, atEnd ? len : 0, this.tmp2)) return false;
    out[0] = this.tmp2[3] as number;
    out[1] = this.tmp2[4] as number;
    return true;
  }

  private profile(e: EdgeId): CurveProfile {
    const have = this.profiles.get(e);
    if (have) return have;
    const r = this.net.resident(e);
    if (!r) return NO_CAP;
    if (this.profiles.size > CACHE_LIMIT) this.profiles.clear();
    const pts = r.seg.pts;
    const n = Math.floor(pts.length / 3);
    const rev = r.edge.dir === -1;
    const poly = polylineLength(pts);
    const scale = poly > 0 ? this.len(e) / poly : 1;
    const ss: number[] = [];
    const vv: number[] = [];
    // vertices in travel order
    const idx = (k: number): number => (rev ? n - 1 - k : k);
    let acc = 0;
    for (let k = 1; k + 1 < n; k++) {
      const p0 = idx(k - 1), p1 = idx(k), p2 = idx(k + 1);
      const ax = (pts[p1 * 3] as number) - (pts[p0 * 3] as number), az = (pts[p1 * 3 + 2] as number) - (pts[p0 * 3 + 2] as number);
      const bx = (pts[p2 * 3] as number) - (pts[p1 * 3] as number), bz = (pts[p2 * 3 + 2] as number) - (pts[p1 * 3 + 2] as number);
      const la = dsqrt(ax * ax + az * az), lb = dsqrt(bx * bx + bz * bz);
      acc += la;
      if (la < 0.01 || lb < 0.01) continue;
      const ang = datan2(ax * bz - az * bx, ax * bx + az * bz);
      const kappa = (ang < 0 ? -ang : ang) / ((la + lb) / 2);
      const cap = curveLimit(kappa);
      if (cap < Infinity) {
        ss.push(acc * scale);
        vv.push(cap);
      }
    }
    const prof: CurveProfile = ss.length === 0 ? NO_CAP : { s: Float32Array.from(ss), v: Float32Array.from(vv) };
    this.profiles.set(e, prof);
    return prof;
  }

  /** The curve speed cap for a car at `s` looking `ahead` metres forward; Infinity on a straight run. */
  curveCap(e: EdgeId, s: number, ahead: number): number {
    const p = this.profile(e);
    let cap = Infinity;
    for (let k = 0; k < p.s.length; k++) {
      const at = p.s[k] as number;
      if (at < s - 3) continue;
      if (at > s + ahead) break;
      if ((p.v[k] as number) < cap) cap = p.v[k] as number;
    }
    return cap;
  }

  /** The desired-speed scale from the edge's grade. */
  grade(e: EdgeId): number {
    const ed = this.edge(e);
    return ed ? gradeScale(ed.maxGradePct) : 1;
  }

  /** Forgets the cached profiles (a new topology or bake). */
  reset(): void {
    this.profiles.clear();
  }
}

/** The signed heading change between two unit directions, radians: positive is a right turn on the ground plane (+X east, -Z north). */
function headingChange(ax: number, az: number, bx: number, bz: number): number {
  return datan2(ax * bz - az * bx, ax * bx + az * bz);
}

/** Turn class of a heading change (living part 1.4: straight within 30 degrees, U-turn beyond 150). */
export function turnOfAngle(ang: number): number {
  const a = ang < 0 ? -ang : ang;
  if (a <= 0.5235987755982988) return Turn.Straight;
  if (a > 2.617993877991494) return Turn.UTurn;
  return ang > 0 ? Turn.Right : Turn.Left;
}

const TURN_OF_NAME: Readonly<Record<string, number>> = { straight: Turn.Straight, right: Turn.Right, left: Turn.Left, uturn: Turn.UTurn };

export interface PlanChoice {
  next: EdgeId;
  turn: number;
  /** Movement id in the junction, -1 when the node is not a junction. */
  mov: number;
  /** Junction id, -1 when the node is not a junction. */
  jct: number;
}

export interface PlanWorld {
  readonly net: RoadNetwork;
  readonly graph: RoadGraph;
  isClosed(e: EdgeId): boolean;
}

const weightOf = (turn: number): number =>
  turn === Turn.Straight ? TURN_WEIGHT.straight : turn === Turn.Right ? TURN_WEIGHT.right : turn === Turn.Left ? TURN_WEIGHT.left : 0;

/** Scratch lists reused between calls (planning runs for a few agents per tick). */
const candNext: number[] = [];
const candTurn: number[] = [];
const candMov: number[] = [];

/**
 * Chooses the movement after edge `e` with the unit draw `u` in [0, 1). Null when nothing legal remains (a dead end with no
 * U-turn, or every way closed or not loaded). A dead end whose only movement is the U-turn returns that.
 */
export function planTurn(w: PlanWorld, paths: EdgePaths, e: EdgeId, u: number): PlanChoice | null {
  const net = w.net;
  const node: NodeId = net.to(e);
  const j: Junction | undefined = w.graph.junctions.junctionAt(node);
  candNext.length = 0;
  candTurn.length = 0;
  candMov.length = 0;
  let uturn: { next: EdgeId; mov: number } | null = null;
  if (j) {
    for (const m of j.movements as readonly Movement[]) {
      if (m.inEdge !== e) continue;
      if (!net.resident(m.outEdge) || w.isClosed(m.outEdge)) continue;
      const turn = TURN_OF_NAME[m.turn] ?? Turn.Straight;
      if (turn === Turn.UTurn) {
        uturn = { next: m.outEdge, mov: m.id };
        continue;
      }
      candNext.push(m.outEdge);
      candTurn.push(turn);
      candMov.push(m.id);
    }
  } else {
    const outs = net.out(node);
    const a = new Float64Array(2), b = new Float64Array(2);
    const haveA = paths.tangent(e, true, a);
    for (let i = 0; i < outs.length; i++) {
      const o = outs[i] as number;
      if (net.isReverseOf(o, e) || !net.resident(o) || w.isClosed(o)) continue;
      let turn: number = Turn.Straight;
      if (haveA && paths.tangent(o, false, b)) turn = turnOfAngle(headingChange(a[0] as number, a[1] as number, b[0] as number, b[1] as number));
      if (turn === Turn.UTurn) continue;
      candNext.push(o);
      candTurn.push(turn);
      candMov.push(-1);
    }
  }
  const jct = j ? j.id : -1;
  if (candNext.length === 0) return uturn ? { next: uturn.next, turn: Turn.UTurn, mov: uturn.mov, jct } : null;
  let total = 0;
  for (let i = 0; i < candNext.length; i++) total += candMov[i] === -1 && candNext.length === 1 ? 1 : weightOf(candTurn[i] as number);
  if (total <= 0) {
    return { next: candNext[0] as number, turn: candTurn[0] as number, mov: candMov[0] as number, jct };
  }
  let t = u * total;
  for (let i = 0; i < candNext.length; i++) {
    t -= candMov[i] === -1 && candNext.length === 1 ? 1 : weightOf(candTurn[i] as number);
    if (t < 0) return { next: candNext[i] as number, turn: candTurn[i] as number, mov: candMov[i] as number, jct };
  }
  const last = candNext.length - 1;
  return { next: candNext[last] as number, turn: candTurn[last] as number, mov: candMov[last] as number, jct };
}

/** The lane an agent wants on its edge for a turn: right from lane 0, left from the leftmost lane, straight keeps its own. */
export function laneForTurn(turn: number, lanes: number, current: number): number {
  const top = lanes > 0 ? lanes - 1 : 0;
  if (turn === Turn.Right) return 0;
  if (turn === Turn.Left || turn === Turn.UTurn) return top;
  return current > top ? top : current;
}

/** The lane an agent lands in after a turn onto an edge with `lanes` lanes. */
export function landingLane(turn: number, lanes: number, current: number): number {
  const top = lanes > 0 ? lanes - 1 : 0;
  if (turn === Turn.Right) return 0;
  if (turn === Turn.Left || turn === Turn.UTurn) return top;
  return current > top ? top : current;
}

