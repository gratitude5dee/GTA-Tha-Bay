/**
 * Baked transit routes and polyline paths (M03b2). `data/transit-routes.v1` is a tool-owned data asset (M02a2, DL-664); the world
 * reads it as JSON. Movers read their paths only from it, and never invent a route.
 * Pure; C02 lint applies.
 */
import { dsqrt } from '@dv/shared';

/** The shape of `data/transit-routes.v1` (tools/map `TransitRoutes`); points are flat x, z pairs in ENU metres. */
export interface TransitRoutesData {
  schema: 'transit-routes/1';
  bakeId: string;
  metro: { id: string; nameKey: string; points: number[] }[];
  bus: { id: string; nameKey: string; edges: number[]; stops: { id: string; nameKey: string; edge: number; s: number }[] }[];
  ferry: { id: string; nameKey: string; source: 'osm' | 'authored'; points: number[] }[];
  cablecar: { id: string; nameKey: string; points: number[] }[];
  air: { id: string; nameKey: string; altitudeM: [number, number]; points: number[] }[];
}

export const EMPTY_ROUTES: TransitRoutesData = { schema: 'transit-routes/1', bakeId: '', metro: [], bus: [], ferry: [], cablecar: [], air: [] };

/** UTF-8 to string without `TextDecoder` (the sim tsconfig has no DOM lib); the baked file is ASCII, other bytes are decoded as code points. */
function utf8(u8: Uint8Array): string {
  let out = '';
  for (let i = 0; i < u8.length; ) {
    const b = u8[i++] as number;
    if (b < 0x80) out += String.fromCharCode(b);
    else if (b < 0xe0) out += String.fromCharCode(((b & 31) << 6) | ((u8[i++] as number) & 63));
    else if (b < 0xf0) out += String.fromCharCode(((b & 15) << 12) | (((u8[i++] as number) & 63) << 6) | ((u8[i++] as number) & 63));
    else {
      const cp = ((b & 7) << 18) | (((u8[i++] as number) & 63) << 12) | (((u8[i++] as number) & 63) << 6) | ((u8[i++] as number) & 63);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

/** Parses the bytes of `data/transit-routes.v1`; null when they are not that file. */
export function parseRoutes(bytes: ArrayBuffer | Uint8Array): TransitRoutesData | null {
  try {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const v = JSON.parse(utf8(u8)) as Partial<TransitRoutesData>;
    if (v.schema !== 'transit-routes/1') return null;
    return {
      schema: v.schema,
      bakeId: String(v.bakeId ?? ''),
      metro: v.metro ?? [],
      bus: v.bus ?? [],
      ferry: v.ferry ?? [],
      cablecar: v.cablecar ?? [],
      air: v.air ?? [],
    };
  } catch {
    return null;
  }
}

/** A polyline with cumulative lengths. */
export class Path {
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  /** Cumulative arc length at each vertex. */
  readonly cum: Float64Array;
  readonly length: number;

  constructor(points: readonly number[]) {
    const n = Math.floor(points.length / 2);
    this.xs = new Float64Array(n);
    this.zs = new Float64Array(n);
    this.cum = new Float64Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      this.xs[i] = points[i * 2] as number;
      this.zs[i] = points[i * 2 + 1] as number;
      if (i > 0) {
        const dx = (this.xs[i] as number) - (this.xs[i - 1] as number), dz = (this.zs[i] as number) - (this.zs[i - 1] as number);
        acc += dsqrt(dx * dx + dz * dz);
      }
      this.cum[i] = acc;
    }
    this.length = acc;
  }

  get count(): number {
    return this.xs.length;
  }

  /** x, z and the unit direction (tx, tz) at `s` metres from the start, into `out` (4 slots). */
  at(s: number, out: Float64Array): void {
    const n = this.xs.length;
    if (n === 0) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = -1;
      return;
    }
    if (n === 1) {
      out[0] = this.xs[0] as number;
      out[1] = this.zs[0] as number;
      out[2] = 0;
      out[3] = -1;
      return;
    }
    const q = s < 0 ? 0 : s > this.length ? this.length : s;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((this.cum[mid] as number) <= q) lo = mid;
      else hi = mid;
    }
    const x0 = this.xs[lo] as number, z0 = this.zs[lo] as number, x1 = this.xs[hi] as number, z1 = this.zs[hi] as number;
    const seg = (this.cum[hi] as number) - (this.cum[lo] as number);
    const u = seg > 0 ? (q - (this.cum[lo] as number)) / seg : 0;
    out[0] = x0 + (x1 - x0) * u;
    out[1] = z0 + (z1 - z0) * u;
    if (seg > 0) {
      out[2] = (x1 - x0) / seg;
      out[3] = (z1 - z0) / seg;
    } else {
      out[2] = 0;
      out[3] = -1;
    }
  }

  /** The arc length of the point nearest to (x, z), and its distance. */
  nearest(x: number, z: number): { s: number; d: number } {
    const n = this.xs.length;
    let best = Infinity, bs = 0;
    for (let i = 0; i + 1 < n; i++) {
      const x0 = this.xs[i] as number, z0 = this.zs[i] as number;
      const dx = (this.xs[i + 1] as number) - x0, dz = (this.zs[i + 1] as number) - z0;
      const l2 = dx * dx + dz * dz;
      let u = l2 > 0 ? ((x - x0) * dx + (z - z0) * dz) / l2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const px = x0 + dx * u - x, pz = z0 + dz * u - z;
      const d2 = px * px + pz * pz;
      if (d2 < best) {
        best = d2;
        bs = (this.cum[i] as number) + dsqrt(l2) * u;
      }
    }
    if (n === 1) {
      const dx = (this.xs[0] as number) - x, dz = (this.zs[0] as number) - z;
      best = dx * dx + dz * dz;
    }
    return { s: bs, d: dsqrt(best) };
  }
}
