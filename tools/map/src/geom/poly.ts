/**
 * Polyline helpers on flat [x0, z0, x1, z1, ...] arrays in ENU metres, a point hash grid, and Morton order for the
 * chunk-ordered ids of C08 rule 8. Pure and deterministic; nothing here uses randomness or the clock.
 */

export function polyLength(p: ArrayLike<number>): number {
  let s = 0;
  for (let i = 2; i < p.length; i += 2) s += Math.hypot((p[i] as number) - (p[i - 2] as number), (p[i + 1] as number) - (p[i - 1] as number));
  return s;
}

/** Inserts points so that no two neighbours are further apart than `maxStep`; the original vertices are kept. */
export function resample(p: ArrayLike<number>, maxStep: number): number[] {
  const out: number[] = [p[0] as number, p[1] as number];
  for (let i = 2; i < p.length; i += 2) {
    const x0 = p[i - 2] as number, z0 = p[i - 1] as number, x1 = p[i] as number, z1 = p[i + 1] as number;
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(d / maxStep - 1e-9));
    for (let k = 1; k < n; k++) out.push(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n);
    out.push(x1, z1);
  }
  return out;
}

export interface PolyPoint { x: number; z: number; /** unit tangent */ tx: number; tz: number; s: number }

/** Point at arc length `s` (clamped) with its unit tangent. */
export function pointAt(p: ArrayLike<number>, s: number): PolyPoint {
  let acc = 0;
  const n = p.length / 2;
  for (let i = 1; i < n; i++) {
    const x0 = p[i * 2 - 2] as number, z0 = p[i * 2 - 1] as number, x1 = p[i * 2] as number, z1 = p[i * 2 + 1] as number;
    const d = Math.hypot(x1 - x0, z1 - z0);
    if (acc + d >= s || i === n - 1) {
      const t = d === 0 ? 0 : Math.min(1, Math.max(0, (s - acc) / d));
      const tx = d === 0 ? 1 : (x1 - x0) / d, tz = d === 0 ? 0 : (z1 - z0) / d;
      return { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, tx, tz, s };
    }
    acc += d;
  }
  return { x: p[0] as number, z: p[1] as number, tx: 1, tz: 0, s: 0 };
}

export interface Nearest { d: number; s: number; x: number; z: number; tx: number; tz: number; seg: number }

/** Nearest point of the polyline to (x, z): distance, arc length, point, unit tangent and segment index. */
export function nearestOnPoly(p: ArrayLike<number>, x: number, z: number): Nearest {
  let best: Nearest = { d: Infinity, s: 0, x: 0, z: 0, tx: 1, tz: 0, seg: 0 };
  let acc = 0;
  const n = p.length / 2;
  for (let i = 1; i < n; i++) {
    const ax = p[i * 2 - 2] as number, az = p[i * 2 - 1] as number, bx = p[i * 2] as number, bz = p[i * 2 + 1] as number;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const l2 = len * len;
    let t = l2 === 0 ? 0 : ((x - ax) * dx + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(px - x, pz - z);
    if (d < best.d) best = { d, s: acc + len * t, x: px, z: pz, tx: len === 0 ? 1 : dx / len, tz: len === 0 ? 0 : dz / len, seg: i - 1 };
    acc += len;
  }
  return best;
}

/** Sub-polyline between arc lengths s0 and s1 (s0 < s1), with interpolated end points. */
export function slice(p: ArrayLike<number>, s0: number, s1: number): number[] {
  const out: number[] = [];
  const a = pointAt(p, s0);
  out.push(a.x, a.z);
  let acc = 0;
  const n = p.length / 2;
  for (let i = 1; i < n; i++) {
    acc += Math.hypot((p[i * 2] as number) - (p[i * 2 - 2] as number), (p[i * 2 + 1] as number) - (p[i * 2 - 1] as number));
    if (acc > s0 + 1e-6 && acc < s1 - 1e-6) out.push(p[i * 2] as number, p[i * 2 + 1] as number);
  }
  const b = pointAt(p, s1);
  out.push(b.x, b.z);
  return out;
}

export const reversePoly = (p: ArrayLike<number>): number[] => {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i] as number, p[i + 1] as number);
  return out;
};

/** Hash grid of points with an item payload; queries return items within `r` (Euclidean) sorted by distance then insertion order. */
export class PointGrid<T> {
  private readonly cells = new Map<number, { x: number; z: number; item: T; n: number }[]>();
  private count = 0;
  constructor(private readonly cell: number) {}
  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }
  add(x: number, z: number, item: T): void {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let l = this.cells.get(k);
    if (!l) this.cells.set(k, (l = []));
    l.push({ x, z, item, n: this.count++ });
  }
  query(x: number, z: number, r: number): { item: T; d: number; x: number; z: number }[] {
    const out: { item: T; d: number; x: number; z: number; n: number }[] = [];
    const i0 = Math.floor((x - r) / this.cell), i1 = Math.floor((x + r) / this.cell);
    const j0 = Math.floor((z - r) / this.cell), j1 = Math.floor((z + r) / this.cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const l = this.cells.get(this.key(i, j));
        if (!l) continue;
        for (const e of l) {
          const d = Math.hypot(e.x - x, e.z - z);
          if (d <= r) out.push({ item: e.item, d, x: e.x, z: e.z, n: e.n });
        }
      }
    }
    out.sort((a, b) => a.d - b.d || a.n - b.n);
    return out;
  }
  /** Nearest item within `r`, or null. */
  nearest(x: number, z: number, r: number): { item: T; d: number; x: number; z: number } | null {
    const q = this.query(x, z, r);
    return q.length > 0 ? (q[0] as { item: T; d: number; x: number; z: number }) : null;
  }
}

/** Morton (z-order) code of chunk indices (cx, cy), 10 bits each. */
export function morton(cx: number, cy: number): number {
  let r = 0;
  for (let b = 0; b < 10; b++) r += ((cx >> b) & 1) * 2 ** (2 * b) + ((cy >> b) & 1) * 2 ** (2 * b + 1);
  return r;
}

/** Signed heading change from direction a to b in degrees, positive to the right on a north-up map with z south (x east). */
export function turnDeg(ax: number, az: number, bx: number, bz: number): number {
  // with z pointing south, cross = ax * bz - az * bx > 0 means b is clockwise from a, which is a right turn
  const cross = ax * bz - az * bx;
  const dot = ax * bx + az * bz;
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

export const dm = (v: number): number => Math.round(v * 10) / 10;

/** Engine yaw (radians in [0, 2 pi)) of a world direction: forward is (-sin yaw, -cos yaw), so yaw 0 faces north (-Z). */
export function yawOf(dx: number, dz: number): number {
  let y = Math.atan2(-dx, -dz);
  if (y < 0) y += 2 * Math.PI;
  return y;
}

export interface PolyPoint3 { x: number; y: number; z: number; tx: number; tz: number }

/** Point, height and unit tangent at arc length `s` of an xz polyline whose per-vertex heights are `ys`. */
export function pointAt3(pts: ArrayLike<number>, ys: ArrayLike<number>, s: number): PolyPoint3 {
  let acc = 0;
  const n = pts.length / 2;
  for (let i = 1; i < n; i++) {
    const x0 = pts[i * 2 - 2] as number, z0 = pts[i * 2 - 1] as number, x1 = pts[i * 2] as number, z1 = pts[i * 2 + 1] as number;
    const d = Math.hypot(x1 - x0, z1 - z0);
    if (acc + d >= s || i === n - 1) {
      const t = d === 0 ? 0 : Math.min(1, Math.max(0, (s - acc) / d));
      return {
        x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, y: (ys[i - 1] as number) * (1 - t) + (ys[i] as number) * t,
        tx: d === 0 ? 1 : (x1 - x0) / d, tz: d === 0 ? 0 : (z1 - z0) / d,
      };
    }
    acc += d;
  }
  return { x: pts[0] as number, y: ys[0] as number, z: pts[1] as number, tx: 1, tz: 0 };
}
