/**
 * Spawn and despawn rules of ambient agents (02-world-living.md sections 2.2 and 7; M03b1).
 *
 *  - A traffic slot `(cell, slot)` spawns at a seeded point on a road edge of its cell, 0.6 to 1.0 x `R_amb` from the player, never in
 *    the +-55 degree forward cone closer than 0.9 x `R_amb`; it despawns beyond 1.25 x `R_amb`, or when it is unseen and stuck for 30 s.
 *  - The point is a pure function of `(worldSeed, cell, slot, epoch)`: a retry after a rejected point raises the epoch, so a slot's
 *    plan can later be agreed on by a room (`02-world-living.md` section 8 rule 0).
 *  - A parked car `(cell, 512 + i)` sits at its baked place on the parking lane.
 *
 * Pure; C02 lint applies.
 */
import { chunkBounds, ctrU32, ambientKey, type ChunkKey, type EdgeId, type ParkedSlot, type RoadSegment, type SimChunk } from '@dv/shared';
import type { RoadNetwork } from '../graph/adjacency.ts';
import { pointAlong, polylineLength } from '../graph/geometry.ts';
import { dsqrt } from '@dv/shared';
import { boxHalf } from './junction.ts';
import type { EdgePaths } from './plan.ts';

/** Spawn ring as shares of `R_amb`, the forward cone and the despawn distance (living part 2.2). */
export const SPAWN_MIN = 0.6;
export const SPAWN_MAX = 1.0;
export const CONE_CLEAR = 0.9;
export const CONE_COS = 0.5735764363510461; // cos 55 degrees
export const DESPAWN = 1.25;
/** Nearest an initial-fill agent may start to the player, metres. */
export const FILL_MIN_M = 20;

const INV = 1 / 4294967296;

/** A unit-interval draw from the plan of slot `(cell, slot)` at `epoch`, purpose `n`. */
export function slotUnit(seed: number, cell: ChunkKey, slot: number, epoch: number, n: number): number {
  return ctrU32(seed, ambientKey(cell, slot), epoch * 8 + n) * INV;
}

export interface Candidate {
  edge: EdgeId;
  s: number;
  lane: number;
}

/**
 * The seeded point for slot `(cell, slot)` at `epoch`: an open edge owned by the cell (weighted by length and lanes), a distance
 * along it clear of the junction box, a lane. Null when the cell has no usable edge.
 */
export function candidateFor(seed: number, cell: ChunkKey, slot: number, epoch: number, net: RoadNetwork, paths: EdgePaths, closed: (e: EdgeId) => boolean): Candidate | null {
  const edges = net.chunkEdges(cell);
  if (edges.length === 0) return null;
  let total = 0;
  for (const e of edges) {
    if (closed(e)) continue;
    const len = paths.len(e);
    if (len < 20) continue;
    total += len * (paths.edge(e)?.lanes ?? 1);
  }
  if (total <= 0) return null;
  let t = slotUnit(seed, cell, slot, epoch, 0) * total;
  let pick: EdgeId = -1;
  for (const e of edges) {
    if (closed(e)) continue;
    const len = paths.len(e);
    if (len < 20) continue;
    t -= len * (paths.edge(e)?.lanes ?? 1);
    pick = e;
    if (t < 0) break;
  }
  if (pick < 0) return null;
  const len = paths.len(pick);
  const lo = len * 0.1;
  const hi = len - boxHalf(len) - 10;
  const s = hi > lo ? lo + slotUnit(seed, cell, slot, epoch, 1) * (hi - lo) : len * 0.3;
  const lanes = paths.edge(pick)?.lanes ?? 1;
  let lane = Math.floor(slotUnit(seed, cell, slot, epoch, 2) * lanes);
  if (lane >= lanes) lane = lanes - 1;
  return { edge: pick, s, lane };
}

/** Nearest and farthest distance from (x, z) to the square of a chunk, metres. */
export function cellReach(cell: ChunkKey, x: number, z: number): { near: number; far: number } {
  const b = chunkBounds(cell);
  const nx = x < b.minX ? b.minX : x > b.maxX ? b.maxX : x;
  const nz = z < b.minZ ? b.minZ : z > b.maxZ ? b.maxZ : z;
  const fx = x - b.minX > b.maxX - x ? b.minX : b.maxX;
  const fz = z - b.minZ > b.maxZ - z ? b.minZ : b.maxZ;
  return { near: dsqrt((x - nx) * (x - nx) + (z - nz) * (z - nz)), far: dsqrt((x - fx) * (x - fx) + (z - fz) * (z - fz)) };
}

export interface TrafficFocus {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/**
 * Whether a spawn at distance `d` in direction (dx, dz) from the focus respects the ring and the forward cone. With `fill` the ring
 * is relaxed to 20 m to `R_amb` (the first population of a session or after a jump).
 */
export function ringAllows(f: TrafficFocus, px: number, pz: number, rAmb: number, fill: boolean): boolean {
  const dx = px - f.x, dz = pz - f.z;
  const d = dsqrt(dx * dx + dz * dz);
  if (fill) return d >= FILL_MIN_M && d <= rAmb * SPAWN_MAX;
  if (d < rAmb * SPAWN_MIN || d > rAmb * SPAWN_MAX) return false;
  const sp = dsqrt(f.vx * f.vx + f.vz * f.vz);
  if (sp > 1.5 && d < rAmb * CONE_CLEAR && (dx * f.vx + dz * f.vz) / (d * sp) > CONE_COS) return false;
  return true;
}

// ---- parked cars -----------------------------------------------------------------------------------------------------------

const segIndex = new WeakMap<SimChunk, Map<number, RoadSegment>>();

function segmentOf(c: SimChunk, id: number): RoadSegment | undefined {
  let m = segIndex.get(c);
  if (!m) {
    m = new Map();
    for (const s of c.segments) m.set(s.id, s);
    segIndex.set(c, m);
  }
  return m.get(id);
}

/** Radians per unit of the baked yaw jitter (BD-M03b1-04). */
export const YAW_JITTER_RAD = 0.01;

/**
 * Where a baked parked slot stands, in `out` (six slots): x, y, z, the yaw jitter (radians) and the unit heading (hx, hz). Parked cars sit `widthM / 2 - 1.15` m
 * from the centreline on their side and face the way traffic runs in that lane (right-hand traffic). False when the segment is missing.
 */
export function parkedPose(c: SimChunk, p: ParkedSlot, out: Float64Array): boolean {
  const seg = segmentOf(c, p.seg);
  if (!seg) return false;
  const poly = polylineLength(seg.pts);
  const s = seg.lengthM > 0 ? (p.s * poly) / seg.lengthM : p.s;
  pointAlong(seg.pts, s, false, out);
  const tx = out[3] as number, tz = out[4] as number;
  const off = (seg.widthM / 2 - 1.15) * p.side;
  const x = (out[0] as number) - tz * off;
  const z = (out[2] as number) + tx * off;
  const dir = p.side > 0 ? 1 : -1;
  const hx = tx * dir, hz = tz * dir;
  out[0] = x;
  out[2] = z;
  out[3] = p.yawJitterDm * YAW_JITTER_RAD;
  out[4] = hx;
  out[5] = hz;
  return true;
}
