/**
 * Polyline helpers for the road queries (M02c1): the closest point of a 3D centreline to a position, the point at an arc length
 * in either direction of travel, and a coarse grid over the straight chords between topology nodes, which stands in for the
 * geometry of edges whose chunk is not resident. Pure; C02 lint applies (square roots through `detmath`).
 */
import { dsqrt, type EdgeId } from '@dv/shared';
import type { RoadNetwork } from './adjacency.ts';

export interface NearPoint {
  /** Horizontal distance. */
  d: number;
  x: number;
  y: number;
  z: number;
  /** Arc length from the first point, metres. */
  s: number;
  /** Unit tangent of the piece, in the direction the points run. */
  tx: number;
  tz: number;
}

/** Length of a polyline of x, y, z triples, horizontal metres. */
export function polylineLength(pts: ArrayLike<number>): number {
  let len = 0;
  for (let i = 3; i + 2 < pts.length; i += 3) {
    const dx = (pts[i] as number) - (pts[i - 3] as number);
    const dz = (pts[i + 2] as number) - (pts[i - 1] as number);
    len += dsqrt(dx * dx + dz * dz);
  }
  return len;
}

/** The point of a polyline (x, y, z triples) closest to (x, z) in the horizontal plane. Needs two points at least. */
export function nearestOnPolyline(pts: ArrayLike<number>, x: number, z: number): NearPoint {
  const n = Math.floor(pts.length / 3);
  let best: NearPoint = { d: Infinity, x: 0, y: 0, z: 0, s: 0, tx: 0, tz: -1 };
  let acc = 0;
  for (let i = 0; i + 1 < n; i++) {
    const ax = pts[i * 3] as number, ay = pts[i * 3 + 1] as number, az = pts[i * 3 + 2] as number;
    const bx = pts[i * 3 + 3] as number, by = pts[i * 3 + 4] as number, bz = pts[i * 3 + 5] as number;
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const l = dsqrt(l2);
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, pz = az + dz * t;
    const ex = x - px, ez = z - pz;
    const d = dsqrt(ex * ex + ez * ez);
    if (d < best.d) best = { d, x: px, y: ay + (by - ay) * t, z: pz, s: acc + l * t, tx: l > 0 ? dx / l : 0, tz: l > 0 ? dz / l : -1 };
    acc += l;
  }
  return best;
}

/**
 * The point at arc length `s` along a polyline, walking from the last point backwards when `reversed`. `out` receives
 * x, y, z and the unit tangent in the walking direction (tx, tz). `s` is clamped to the line.
 */
export function pointAlong(pts: ArrayLike<number>, s: number, reversed: boolean, out: Float64Array): void {
  const n = Math.floor(pts.length / 3);
  if (n < 2) {
    out[0] = (pts[0] as number) ?? 0;
    out[1] = (pts[1] as number) ?? 0;
    out[2] = (pts[2] as number) ?? 0;
    out[3] = 0;
    out[4] = -1;
    return;
  }
  let remaining = s < 0 ? 0 : s;
  for (let k = 0; k + 1 < n; k++) {
    const i = reversed ? n - 1 - k : k;
    const j = reversed ? i - 1 : i + 1;
    const ax = pts[i * 3] as number, ay = pts[i * 3 + 1] as number, az = pts[i * 3 + 2] as number;
    const bx = pts[j * 3] as number, by = pts[j * 3 + 1] as number, bz = pts[j * 3 + 2] as number;
    const dx = bx - ax, dz = bz - az;
    const l = dsqrt(dx * dx + dz * dz);
    if (remaining <= l || k === n - 2) {
      const t = l > 0 ? Math.min(1, remaining / l) : 0;
      out[0] = ax + dx * t;
      out[1] = ay + (by - ay) * t;
      out[2] = az + dz * t;
      out[3] = l > 0 ? dx / l : 0;
      out[4] = l > 0 ? dz / l : -1;
      return;
    }
    remaining -= l;
  }
}

/** A chord candidate: the closest point of an edge's straight line between its end nodes. */
export interface ChordHit {
  edge: EdgeId;
  /** Metres along the directed edge (the chord position scaled to the edge length). */
  s: number;
  /** Horizontal distance. */
  d: number;
  y: number;
}

const CELL_M = 256;

/** A grid over the straight chords between topology nodes, built once from a network that has a topology. */
export class ChordIndex {
  private readonly cells = new Map<number, EdgeId[]>();

  constructor(private readonly net: RoadNetwork) {
    const E = net.edgeCount;
    for (let e = 0; e < E; e++) {
      if (!net.has(e)) continue;
      const a = net.from(e), b = net.to(e);
      const x0 = net.nodeX(a), z0 = net.nodeZ(a), x1 = net.nodeX(b), z1 = net.nodeZ(b);
      const i0 = Math.floor(Math.min(x0, x1) / CELL_M), i1 = Math.floor(Math.max(x0, x1) / CELL_M);
      const j0 = Math.floor(Math.min(z0, z1) / CELL_M), j1 = Math.floor(Math.max(z0, z1) / CELL_M);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const key = this.keyOf(i, j);
          const list = this.cells.get(key);
          if (list) list.push(e);
          else this.cells.set(key, [e]);
        }
      }
    }
  }

  private keyOf(i: number, j: number): number {
    return (j + 4096) * 8192 + (i + 4096);
  }

  /**
   * Chord candidates within `maxM` (3D when `y` is given), best first: nearest, then the edge on whose right-hand side the point
   * lies, then the lower id. `mask` keeps the classes whose bit is set; `skip` drops edges (the resident ones, whose geometry is better).
   */
  nearest(x: number, z: number, y: number | undefined, maxM: number, mask: number | undefined, skip?: (e: EdgeId) => boolean): ChordHit | null {
    const net = this.net;
    const i0 = Math.floor((x - maxM) / CELL_M), i1 = Math.floor((x + maxM) / CELL_M);
    const j0 = Math.floor((z - maxM) / CELL_M), j1 = Math.floor((z + maxM) / CELL_M);
    let best: (ChordHit & { dist: number; key: number; right: number }) | null = null;
    const seen = new Set<EdgeId>();
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const list = this.cells.get(this.keyOf(i, j));
        if (!list) continue;
        for (const e of list) {
          if (seen.has(e)) continue;
          seen.add(e);
          if (mask !== undefined && ((mask >>> net.cls(e)) & 1) === 0) continue;
          if (skip && skip(e)) continue;
          const a = net.from(e), b = net.to(e);
          const ax = net.nodeX(a), az = net.nodeZ(a), ay = net.nodeY(a);
          const bx = net.nodeX(b), bz = net.nodeZ(b), by = net.nodeY(b);
          const dx = bx - ax, dz = bz - az;
          const l2 = dx * dx + dz * dz;
          let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + dx * t, pz = az + dz * t, py = ay + (by - ay) * t;
          const ex = x - px, ez = z - pz;
          const d = dsqrt(ex * ex + ez * ez);
          const dist = y === undefined ? d : dsqrt(d * d + (y - py) * (y - py));
          if (dist > maxM) continue;
          const key = Math.round(dist * 100);
          const l = dsqrt(l2);
          const right = l > 0 && (x - px) * (-dz / l) + (z - pz) * (dx / l) >= 0 ? 1 : 0;
          if (best === null || key < best.key || (key === best.key && (right > best.right || (right === best.right && e < best.edge)))) {
            best = { edge: e, s: t * (net.lenDm(e) / 10), d, y: py, dist, key, right };
          }
        }
      }
    }
    return best ? { edge: best.edge, s: best.s, d: best.dist, y: best.y } : null;
  }
}
