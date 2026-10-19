/**
 * Ring helpers on flat [x0, z0, ...] arrays in ENU metres (x east, z south). "CCW" always means counter-clockwise on
 * a north-up map, which is the C08 prism orientation: with z pointing south it is a negative shoelace sum.
 */

/** Positive for a CCW ring (north-up), negative for CW, in m². */
export function ccwArea(r: ArrayLike<number>): number {
  const n = r.length / 2;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += (r[i * 2] as number) * (r[j * 2 + 1] as number) - (r[j * 2] as number) * (r[i * 2 + 1] as number);
  }
  return -s / 2;
}

export function reverseRing(r: ArrayLike<number>): number[] {
  const n = r.length / 2;
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(r[i * 2] as number, r[i * 2 + 1] as number);
  return out;
}

export function forceCcw(r: ArrayLike<number>): number[] {
  return ccwArea(r) >= 0 ? Array.from(r) : reverseRing(r);
}

/** Drops a repeated closing point and consecutive duplicates. */
export function openRing(r: ArrayLike<number>): number[] {
  const out: number[] = [];
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const x = r[i * 2] as number;
    const z = r[i * 2 + 1] as number;
    const m = out.length;
    if (m >= 2 && out[m - 2] === x && out[m - 1] === z) continue;
    out.push(x, z);
  }
  const m = out.length;
  if (m >= 4 && out[0] === out[m - 2] && out[1] === out[m - 1]) out.length = m - 2;
  return out;
}

export interface Bbox { minX: number; minZ: number; maxX: number; maxZ: number }

export function ringBbox(r: ArrayLike<number>): Bbox {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    const x = r[i] as number;
    const z = r[i + 1] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

/** Area centroid of a simple ring (falls back to the vertex mean for a degenerate ring). */
export function ringCentroid(r: ArrayLike<number>): { x: number; z: number } {
  const n = r.length / 2;
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = r[i * 2] as number, z0 = r[i * 2 + 1] as number, x1 = r[j * 2] as number, z1 = r[j * 2 + 1] as number;
    const f = x0 * z1 - x1 * z0;
    a += f;
    cx += (x0 + x1) * f;
    cz += (z0 + z1) * f;
  }
  if (Math.abs(a) < 1e-9) {
    let mx = 0, mz = 0;
    for (let i = 0; i < n; i++) { mx += r[i * 2] as number; mz += r[i * 2 + 1] as number; }
    return { x: mx / n, z: mz / n };
  }
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

/** Even-odd point in ring. */
export function pointInRing(x: number, z: number, r: ArrayLike<number>): boolean {
  const n = r.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2] as number, zi = r[i * 2 + 1] as number, xj = r[j * 2] as number, zj = r[j * 2 + 1] as number;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to the boundary of a ring. */
export function distToRing(x: number, z: number, r: ArrayLike<number>): number {
  const n = r.length / 2;
  let best = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = r[j * 2] as number, az = r[j * 2 + 1] as number, bx = r[i * 2] as number, bz = r[i * 2 + 1] as number;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 === 0 ? 0 : ((x - ax) * dx + (z - az) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + t * dx - x, ez = az + t * dz - z;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Removes vertices that sit within `minEdge` of the previous kept vertex (the closing edge included). */
export function collapseShortEdges(r: ArrayLike<number>, minEdge: number): number[] {
  const out: number[] = [];
  const n = r.length / 2;
  const m2 = minEdge * minEdge;
  for (let i = 0; i < n; i++) {
    const x = r[i * 2] as number;
    const z = r[i * 2 + 1] as number;
    const k = out.length;
    if (k >= 2) {
      const dx = x - (out[k - 2] as number), dz = z - (out[k - 1] as number);
      if (dx * dx + dz * dz < m2) continue;
    }
    out.push(x, z);
  }
  while (out.length > 6) {
    const dx = (out[0] as number) - (out[out.length - 2] as number), dz = (out[1] as number) - (out[out.length - 1] as number);
    if (dx * dx + dz * dz < m2) out.length -= 2;
    else break;
  }
  return out;
}

/** Sutherland-Hodgman clip of a ring against an axis-aligned box. */
export function clipRingToBox(r: ArrayLike<number>, b: Bbox): number[] {
  type P = [number, number];
  let poly: P[] = [];
  for (let i = 0; i < r.length; i += 2) poly.push([r[i] as number, r[i + 1] as number]);
  const edges: { inside: (p: P) => boolean; cut: (a: P, c: P) => P }[] = [
    { inside: (p) => p[0] >= b.minX, cut: (a, c) => [b.minX, a[1] + ((c[1] - a[1]) * (b.minX - a[0])) / (c[0] - a[0])] },
    { inside: (p) => p[0] <= b.maxX, cut: (a, c) => [b.maxX, a[1] + ((c[1] - a[1]) * (b.maxX - a[0])) / (c[0] - a[0])] },
    { inside: (p) => p[1] >= b.minZ, cut: (a, c) => [a[0] + ((c[0] - a[0]) * (b.minZ - a[1])) / (c[1] - a[1]), b.minZ] },
    { inside: (p) => p[1] <= b.maxZ, cut: (a, c) => [a[0] + ((c[0] - a[0]) * (b.maxZ - a[1])) / (c[1] - a[1]), b.maxZ] },
  ];
  for (const e of edges) {
    const input = poly;
    poly = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i] as P;
      const prev = input[(i + input.length - 1) % input.length] as P;
      if (e.inside(cur)) {
        if (!e.inside(prev)) poly.push(e.cut(prev, cur));
        poly.push(cur);
      } else if (e.inside(prev)) poly.push(e.cut(prev, cur));
    }
    if (poly.length === 0) return [];
  }
  return poly.flatMap((p) => p);
}
