import type { StaticShapeSet, Vec3 } from './backend.ts';

/**
 * Pure conversion of a `StaticShapeSet` into the shapes Rapier takes. No Rapier import, so it is tested alone.
 * All arithmetic is + - x and comparisons, so every engine produces the same pieces.
 */

export interface HeightfieldLayout {
  nrows: number;
  ncols: number;
  /** Column-major, (nrows + 1) x (ncols + 1) samples, as Rapier expects. */
  heights: Float32Array;
  scale: { x: number; y: number; z: number };
  /** ENU centre of the heightfield: Rapier centres a heightfield on its translation. */
  centre: Vec3;
}

/**
 * Rapier's rows run along Z and its columns along X (checked against ray casts in physics.backend.spec.ts).
 * `StaticShapeSet.heightfield.heights` is row-major by Z: heights[iz * nx + ix], with `at` the NW corner (minimum X and Z).
 */
export function heightfieldLayout(h: NonNullable<StaticShapeSet['heightfield']>): HeightfieldLayout {
  const { nx, nz, cell } = h;
  if (!Number.isInteger(nx) || !Number.isInteger(nz) || nx < 2 || nz < 2) throw new RangeError('heightfield needs at least 2 x 2 samples');
  if (h.heights.length !== nx * nz) throw new RangeError(`heightfield has ${h.heights.length} samples, expected ${nx * nz}`);
  if (!(cell > 0)) throw new RangeError('heightfield cell size must be positive');
  const out = new Float32Array(nx * nz);
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) out[ix * nz + iz] = h.heights[iz * nx + ix] as number;
  }
  const ex = cell * (nx - 1);
  const ez = cell * (nz - 1);
  return {
    nrows: nz - 1,
    ncols: nx - 1,
    heights: out,
    scale: { x: ex, y: 1, z: ez },
    centre: [h.at[0] + ex / 2, h.at[1], h.at[2] + ez / 2],
  };
}

/** One convex piece: flat xyz points in ENU (absolute, f64 values held in a plain array). */
export type ConvexPiece = number[];

function cross2(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

/**
 * Splits a packed prism list into convex pieces. A convex footprint becomes one piece (2n points); a concave one is
 * ear-clipped into triangles, one piece (6 points) each. Rings with fewer than 3 vertices or no area are skipped.
 */
export function prismPieces(pack: Float32Array): ConvexPiece[] {
  const pieces: ConvexPiece[] = [];
  let i = 0;
  while (i < pack.length) {
    const n = pack[i] as number;
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`prism pack: bad vertex count ${n} at ${i}`);
    const end = i + 3 + 2 * n;
    if (end > pack.length) throw new RangeError('prism pack: truncated ring');
    const base = pack[i + 1] as number;
    const top = base + (pack[i + 2] as number);
    const xs: number[] = [];
    const zs: number[] = [];
    for (let k = 0; k < n; k++) {
      xs.push(pack[i + 3 + 2 * k] as number);
      zs.push(pack[i + 4 + 2 * k] as number);
    }
    i = end;
    if (n < 3 || !(top > base)) continue;
    let area2 = 0;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      area2 += (xs[k] as number) * (zs[k1] as number) - (xs[k1] as number) * (zs[k] as number);
    }
    if (area2 === 0) continue;
    if (area2 < 0) {
      xs.reverse();
      zs.reverse();
    }
    let convex = true;
    for (let k = 0; k < n && convex; k++) {
      const a = (k + n - 1) % n;
      const c = (k + 1) % n;
      const turn = cross2((xs[k] as number) - (xs[a] as number), (zs[k] as number) - (zs[a] as number), (xs[c] as number) - (xs[k] as number), (zs[c] as number) - (zs[k] as number));
      if (turn < 0) convex = false;
    }
    if (convex) {
      const pts: number[] = [];
      for (let k = 0; k < n; k++) pts.push(xs[k] as number, base, zs[k] as number, xs[k] as number, top, zs[k] as number);
      pieces.push(pts);
      continue;
    }
    for (const tri of earClip(xs, zs)) {
      const pts: number[] = [];
      for (const k of tri) pts.push(xs[k] as number, base, zs[k] as number, xs[k] as number, top, zs[k] as number);
      pieces.push(pts);
    }
  }
  return pieces;
}

/** Ear clipping of a counter-clockwise polygon (positive signed area in x, z). Returns index triples. */
export function earClip(xs: readonly number[], zs: readonly number[]): [number, number, number][] {
  const idx: number[] = [];
  for (let k = 0; k < xs.length; k++) idx.push(k);
  const out: [number, number, number][] = [];
  const inside = (p: number, a: number, b: number, c: number): boolean => {
    const px = xs[p] as number;
    const pz = zs[p] as number;
    const d1 = cross2((xs[b] as number) - (xs[a] as number), (zs[b] as number) - (zs[a] as number), px - (xs[a] as number), pz - (zs[a] as number));
    const d2 = cross2((xs[c] as number) - (xs[b] as number), (zs[c] as number) - (zs[b] as number), px - (xs[b] as number), pz - (zs[b] as number));
    const d3 = cross2((xs[a] as number) - (xs[c] as number), (zs[a] as number) - (zs[c] as number), px - (xs[c] as number), pz - (zs[c] as number));
    return d1 >= 0 && d2 >= 0 && d3 >= 0;
  };
  let guard = idx.length * idx.length + 8;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let m = 0; m < idx.length; m++) {
      const a = idx[(m + idx.length - 1) % idx.length] as number;
      const b = idx[m] as number;
      const c = idx[(m + 1) % idx.length] as number;
      const turn = cross2((xs[b] as number) - (xs[a] as number), (zs[b] as number) - (zs[a] as number), (xs[c] as number) - (xs[b] as number), (zs[c] as number) - (zs[b] as number));
      if (turn <= 0) continue;
      let empty = true;
      for (const p of idx) {
        if (p === a || p === b || p === c) continue;
        if (inside(p, a, b, c)) {
          empty = false;
          break;
        }
      }
      if (!empty) continue;
      out.push([a, b, c]);
      idx.splice(m, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Degenerate ring (collinear runs, touching edges): clip the first vertex so the loop always ends.
      const a = idx[idx.length - 1] as number;
      const b = idx[0] as number;
      const c = idx[1] as number;
      out.push([a, b, c]);
      idx.splice(0, 1);
    }
  }
  if (idx.length === 3) out.push([idx[0] as number, idx[1] as number, idx[2] as number]);
  return out;
}
