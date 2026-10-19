/**
 * Douglas-Peucker simplification on flat [x0, z0, x1, z1, ...] arrays (ENU metres). Iterative: SF coastline chains
 * hold tens of thousands of points, so recursion is not an option. Deterministic: ties keep the lower index.
 */

function sqSegDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - px;
  const cz = az + t * dz - pz;
  return cx * cx + cz * cz;
}

/** Keeps the first and last point; returns the simplified open polyline. */
export function simplifyPolyline(pts: ArrayLike<number>, tol: number): number[] {
  const n = pts.length / 2;
  if (n <= 2) return Array.from(pts);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = tol * tol;
  const stack: number[] = [0, n - 1];
  while (stack.length > 0) {
    const hi = stack.pop() as number;
    const lo = stack.pop() as number;
    if (hi - lo < 2) continue;
    const ax = pts[lo * 2] as number;
    const az = pts[lo * 2 + 1] as number;
    const bx = pts[hi * 2] as number;
    const bz = pts[hi * 2 + 1] as number;
    let best = -1;
    let bestD = tol2;
    for (let i = lo + 1; i < hi; i++) {
      const d = sqSegDist(pts[i * 2] as number, pts[i * 2 + 1] as number, ax, az, bx, bz);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push(lo, best, best, hi);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2] as number, pts[i * 2 + 1] as number);
  return out;
}

/**
 * Closed ring without a repeated closing point. The ring is split at point 0 and the point farthest from it, each
 * half is simplified as a polyline, so the result never collapses below a triangle unless the input does.
 */
export function simplifyRing(ring: ArrayLike<number>, tol: number): number[] {
  const n = ring.length / 2;
  if (n <= 3) return Array.from(ring);
  let far = 1;
  let farD = -1;
  const x0 = ring[0] as number;
  const z0 = ring[1] as number;
  for (let i = 1; i < n; i++) {
    const dx = (ring[i * 2] as number) - x0;
    const dz = (ring[i * 2 + 1] as number) - z0;
    const d = dx * dx + dz * dz;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a: number[] = [];
  for (let i = 0; i <= far; i++) a.push(ring[i * 2] as number, ring[i * 2 + 1] as number);
  const b: number[] = [];
  for (let i = far; i < n; i++) b.push(ring[i * 2] as number, ring[i * 2 + 1] as number);
  b.push(x0, z0);
  const sa = simplifyPolyline(a, tol);
  const sb = simplifyPolyline(b, tol);
  const out = sa.slice(0, sa.length);
  for (let i = 2; i < sb.length - 2; i++) out.push(sb[i] as number);
  return out;
}
