/**
 * The street-tree forms (M02h4): original, seeded, procedural recipes, one geometry per form and set. Pure and `three`-free, so a test
 * (and asset.worker, should it ever mesh them) builds the same bytes; `vegetation-pool.ts` turns them into `BufferGeometry`.
 *
 * Every geometry stands at the origin, one unit tall (the instance scales it by the tree's height), opaque, vertex coloured, with
 * per-vertex `leaf` (1 on the crown, 0 on the trunk: the instance tint colours the crown only) and, on the `full` set only, `sway` (0
 * at the root to 1 at the crown top; `look/wind.ts` bends by its square). No alpha test, alpha-to-coverage or transparency: the palm's
 * fronds are double-sided by geometry (each strip twice, back to back), not by material.
 *
 *  - `full` (desktop tiers, at most 260 triangles each): Plane, a wide three-lobed crown on a mottled trunk; Ficus, a dense clipped crown;
 *    Conifer, flat-topped wind-swept tiers; Eucalyptus, a pale tall trunk with sparse high clumps; Palm, twelve arched fronds;
 *  - `lite` (`mobile`, at most 120): the same five, coarser;
 *  - `low` (`mobile-low`, the XR tiers and `world.look: false`, at most 48): two geometries, `crown` (Plane, Ficus, Conifer and
 *    Eucalyptus told apart by the instance's non-uniform scale and tint, `LOW_CROWN`) and `palm`;
 *  - `cone`: M02b1's cone (20 triangles), the one pool of `world.treeForms: false`.
 *
 * The colours are design values (sRGB hex, linearised here).
 */
import { Rng, TreeForm, splitmix32 } from '@dv/shared';
import { MESHER, hexToLinear, type Rgb } from './mesher.ts';

export type TreeSet = 'full' | 'lite' | 'low' | 'cone';
/** The geometries of a set, in pool order: the five forms on `full` and `lite`, `crown` and `palm` on `low`, one `cone`. */
export type TreeGeometryId = 'plane' | 'ficus' | 'conifer' | 'eucalyptus' | 'palm' | 'crown' | 'cone';

export interface TreeGeometryData {
  id: TreeGeometryId;
  positions: Float32Array;
  normals: Float32Array;
  /** Linear RGB. */
  colors: Float32Array;
  /** 1 on the crown, 0 on the trunk. */
  leaf: Float32Array;
  /** `full` only: 0 at the root, 1 at the top of the crown. */
  sway: Float32Array | null;
  indices: Uint16Array;
  triangles: number;
}

/** The triangle caps of a geometry per set (AC-3). */
export const TREE_TRIS_CAP: Readonly<Record<TreeSet, number>> = { full: 260, lite: 120, low: 48, cone: 20 };

/** The geometries of each set, in pool order. */
export const SET_GEOMETRIES: Readonly<Record<TreeSet, readonly TreeGeometryId[]>> = {
  full: ['plane', 'ficus', 'conifer', 'eucalyptus', 'palm'],
  lite: ['plane', 'ficus', 'conifer', 'eucalyptus', 'palm'],
  low: ['crown', 'palm'],
  cone: ['cone'],
};

/** The geometry a form draws with in a set. */
export function geometryOfForm(set: TreeSet, form: TreeForm): TreeGeometryId {
  if (set === 'cone') return 'cone';
  if (set === 'low') return form === TreeForm.Palm ? 'palm' : 'crown';
  return (['plane', 'ficus', 'conifer', 'eucalyptus', 'palm'] as const)[form] ?? 'plane';
}

/**
 * `low` crown per form: the instance's horizontal and vertical scale on top of the tree's height, and the crown colour (sRGB) the tint
 * multiplies the neutral crown by. Plane wide, Ficus round and dark, Conifer narrow and blue-green, Eucalyptus tall, sparse and grey.
 */
export const LOW_CROWN: Readonly<Record<number, { kx: number; ky: number; color: string }>> = {
  [TreeForm.Plane]: { kx: 1.25, ky: 1, color: '#5f8a3e' },
  [TreeForm.Ficus]: { kx: 1.05, ky: 0.9, color: '#3c6a32' },
  [TreeForm.Conifer]: { kx: 0.7, ky: 1, color: '#2f5a3f' },
  [TreeForm.Eucalyptus]: { kx: 0.85, ky: 1, color: '#7f9a78' },
  [TreeForm.Palm]: { kx: 1, ky: 1, color: '#5c8a3a' },
};
/** The neutral crown colour of the `low` crown geometry (the tint divides by it). */
export const LOW_CROWN_BASE = '#6a8a52';

/** Per-instance crown tints (the record's `tint`, 0..7): a small brightness and hue spread around 1. */
export const TINTS: readonly Rgb[] = [
  [1, 1, 1], [0.9, 0.94, 0.86], [1.08, 1.05, 0.95], [0.94, 1.02, 0.98], [1.04, 0.96, 0.88], [0.86, 0.9, 0.86], [1.1, 1.08, 1], [0.97, 0.92, 0.95],
];

const C = {
  planeBark: '#a39c86', planeBark2: '#7d7563', planeLeaf: '#5a8a3c', planeLeaf2: '#6f9a45',
  ficusBark: '#6e6658', ficusLeaf: '#2f5e2c', ficusLeaf2: '#3d6e33',
  coniferBark: '#5a4636', coniferLeaf: '#2c4f36', coniferLeaf2: '#36603f',
  eucBark: '#d8d2c2', eucBark2: '#b7ad99', eucLeaf: '#7a957a', eucLeaf2: '#8aa486',
  palmTrunk: '#8a7660', palmKnob: '#6e7d3a', palmFrond: '#4f7f34', palmFrond2: '#61913d',
  crown: LOW_CROWN_BASE, crownTrunk: '#6b4a2f',
} as const;

// ---- the builder -----------------------------------------------------------------------------------------------------------

class Builder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly leaf: number[] = [];
  readonly idx: number[] = [];
  constructor(private readonly crownTop: number) {}

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: Rgb, leaf: number): number {
    const i = this.pos.length / 3;
    const l = Math.hypot(nx, ny, nz) || 1;
    this.pos.push(x, y, z);
    this.nrm.push(nx / l, ny / l, nz / l);
    this.col.push(c[0], c[1], c[2]);
    this.leaf.push(leaf);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** A tapered open prism (no caps) from `(x0, y0, z0)` to `(x1, y1, z1)`: `sides * 2` triangles. */
  trunk(x0: number, y0: number, z0: number, r0: number, x1: number, y1: number, z1: number, r1: number, sides: number, c0: Rgb, c1: Rgb, rot = 0): void {
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < sides; i++) {
      const t = rot + (i / sides) * Math.PI * 2;
      const cx = Math.cos(t), sz = Math.sin(t);
      a.push(this.vertex(x0 + cx * r0, y0, z0 + sz * r0, cx, (r0 - r1) / Math.max(1e-6, y1 - y0), sz, c0, 0));
      b.push(this.vertex(x1 + cx * r1, y1, z1 + sz * r1, cx, (r0 - r1) / Math.max(1e-6, y1 - y0), sz, c1, 0));
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.tri(a[i] as number, b[j] as number, a[j] as number);
      this.tri(a[i] as number, b[i] as number, b[j] as number);
    }
  }

  /**
   * A low-poly ellipsoid: `segs` around, `rings` bands from the bottom apex to the top apex (rings - 1 rings of vertices): `2 * segs * (rings - 1)`
   * triangles. The colour moves from `lo` at the bottom to `hi` at the top, with a seeded per-vertex jitter of the radius (a clipped,
   * irregular crown rather than a ball).
   */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, segs: number, rings: number, lo: Rgb, hi: Rgb, rng: Rng, jitter = 0.12, rot = 0): void {
    const ids: number[][] = [];
    const bottom = this.vertex(cx, cy - ry, cz, 0, -1, 0, lo, 1);
    for (let r = 1; r < rings; r++) {
      const phi = Math.PI * (r / rings);
      const y = -Math.cos(phi);
      const s = Math.sin(phi);
      const row: number[] = [];
      for (let i = 0; i < segs; i++) {
        const t = rot + ((i + (r % 2) * 0.5) / segs) * Math.PI * 2;
        const k = 1 + (rng.nextFloat() - 0.5) * 2 * jitter;
        const nx = Math.cos(t) * s, nz = Math.sin(t) * s;
        const tone = (y + 1) / 2;
        const c: Rgb = [lo[0] + (hi[0] - lo[0]) * tone, lo[1] + (hi[1] - lo[1]) * tone, lo[2] + (hi[2] - lo[2]) * tone];
        row.push(this.vertex(cx + nx * rx * k, cy + y * ry * k, cz + nz * rz * k, nx / rx, y / ry, nz / rz, c, 1));
      }
      ids.push(row);
    }
    const top = this.vertex(cx, cy + ry, cz, 0, 1, 0, hi, 1);
    const first = ids[0] as number[];
    const last = ids[ids.length - 1] as number[];
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      this.tri(bottom, first[i] as number, first[j] as number);
      this.tri(top, last[j] as number, last[i] as number);
    }
    for (let r = 0; r + 1 < ids.length; r++) {
      const a = ids[r] as number[], b = ids[r + 1] as number[];
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % segs;
        this.tri(a[i] as number, b[i] as number, a[j] as number);
        this.tri(a[j] as number, b[i] as number, b[j] as number);
      }
    }
  }

  /**
   * A palm frond: an arched strip from the crown `(x, y, z)` out along `angle`, `segs` quads, both faces (each quad twice, back to back):
   * `4 * segs` triangles. It rises a little, then droops (`droop` of its length below its root at the tip).
   */
  frond(x: number, y: number, z: number, angle: number, length: number, width: number, segs: number, droop: number, c0: Rgb, c1: Rgb): void {
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const px = -dz, pz = dx;
    const pts: [number, number, number, number][] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const out = length * t;
      const up = length * (0.35 * t - (0.35 + droop) * t * t);
      const w = width * (i === 0 ? 0.35 : i === segs ? 0.15 : 1 - 0.5 * t);
      pts.push([x + dx * out, y + up, z + dz * out, w]);
    }
    for (const side of [1, -1]) {
      const l: number[] = [];
      const r: number[] = [];
      for (let i = 0; i <= segs; i++) {
        const p = pts[i] as [number, number, number, number];
        const c: Rgb = i === 0 ? c0 : c1;
        // the face normal, (side vector) x (along the strip): up, tipped back along the slope; the back face points the other way
        const q = pts[Math.min(segs, i + 1)] as [number, number, number, number];
        const o = pts[Math.max(0, i - 1)] as [number, number, number, number];
        const sx = q[0] - o[0], sy = q[1] - o[1], sz = q[2] - o[2];
        const n: [number, number, number] = [-(sy * dx), sx * dx + sz * dz, -(sy * dz)];
        l.push(this.vertex(p[0] + px * p[3], p[1], p[2] + pz * p[3], n[0] * side, n[1] * side, n[2] * side, c, 1));
        r.push(this.vertex(p[0] - px * p[3], p[1], p[2] - pz * p[3], n[0] * side, n[1] * side, n[2] * side, c, 1));
      }
      for (let i = 0; i < segs; i++) {
        // counter-clockwise seen from the face's own normal: the front from above, the back from below
        if (side > 0) {
          this.tri(l[i] as number, l[i + 1] as number, r[i] as number);
          this.tri(l[i + 1] as number, r[i + 1] as number, r[i] as number);
        } else {
          this.tri(l[i] as number, r[i] as number, l[i + 1] as number);
          this.tri(l[i + 1] as number, r[i] as number, r[i + 1] as number);
        }
      }
    }
  }

  build(id: TreeGeometryId, withSway: boolean): TreeGeometryData {
    const n = this.pos.length / 3;
    let sway: Float32Array | null = null;
    if (withSway) {
      sway = new Float32Array(n);
      // 0 at the root, 1 at the top of the crown: the trunk bends little, the crown most
      for (let i = 0; i < n; i++) sway[i] = Math.min(1, Math.max(0, (this.pos[i * 3 + 1] as number) / this.crownTop));
    }
    return {
      id,
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      colors: new Float32Array(this.col),
      leaf: new Float32Array(this.leaf),
      sway,
      indices: new Uint16Array(this.idx),
      triangles: this.idx.length / 3,
    };
  }
}

const L = (hex: string): Rgb => hexToLinear(hex);
const seeded = (id: string, set: TreeSet): Rng => {
  let h = 2166136261;
  const s = `tree-form:${id}:${set}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return new Rng(splitmix32(h));
};

// ---- the recipes -----------------------------------------------------------------------------------------------------------

function plane(set: 'full' | 'lite'): TreeGeometryData {
  const b = new Builder(1);
  const rng = seeded('plane', set);
  const full = set === 'full';
  b.trunk(0, 0, 0, 0.034, 0.01, 0.5, 0, 0.024, full ? 6 : 4, L(C.planeBark2), L(C.planeBark));
  // three lobes around a central top, wide and low: the crown of a London plane
  const lobes = 3;
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + 0.4;
    b.blob(Math.cos(a) * 0.17, 0.6, Math.sin(a) * 0.17, 0.25, 0.2, 0.24, full ? 8 : 6, full ? 4 : 2, L(C.planeLeaf), L(C.planeLeaf2), rng, 0.14, a);
  }
  if (full) b.blob(0, 0.78, 0, 0.22, 0.17, 0.22, 8, 4, L(C.planeLeaf), L(C.planeLeaf2), rng, 0.12);
  return b.build('plane', full);
}

function ficus(set: 'full' | 'lite'): TreeGeometryData {
  const b = new Builder(1);
  const rng = seeded('ficus', set);
  const full = set === 'full';
  b.trunk(0, 0, 0, 0.05, 0, 0.36, 0, 0.04, full ? 6 : 4, L(C.ficusBark), L(C.ficusBark));
  // a dense clipped crown: one broad rounded mass with a second, offset, for an irregular silhouette
  b.blob(0, 0.64, 0, 0.36, 0.3, 0.36, full ? 12 : 8, full ? 6 : 3, L(C.ficusLeaf), L(C.ficusLeaf2), rng, 0.06);
  if (full) b.blob(0.1, 0.76, -0.06, 0.24, 0.2, 0.24, 8, 3, L(C.ficusLeaf), L(C.ficusLeaf2), rng, 0.08);
  else b.blob(0.08, 0.78, -0.05, 0.2, 0.16, 0.2, 6, 2, L(C.ficusLeaf), L(C.ficusLeaf2), rng, 0.08);
  return b.build('ficus', full);
}

function conifer(set: 'full' | 'lite'): TreeGeometryData {
  const b = new Builder(1);
  const rng = seeded('conifer', set);
  const full = set === 'full';
  // a leaning trunk and flat tiers swept to one side (+x): a coastal cypress under the wind; the top tier as wide as the one below
  b.trunk(0, 0, 0, 0.04, 0.08, 0.72, 0.01, 0.02, full ? 6 : 4, L(C.coniferBark), L(C.coniferBark));
  const tiers: [number, number, number, number][] = full
    ? [[0.04, 0.42, 0.3, 0.09], [0.1, 0.58, 0.33, 0.09], [0.16, 0.74, 0.3, 0.08], [0.2, 0.88, 0.3, 0.08]]
    : [[0.05, 0.5, 0.32, 0.11], [0.13, 0.7, 0.33, 0.1], [0.19, 0.87, 0.3, 0.09]];
  for (const [x, y, r, h] of tiers) b.blob(x, y, 0, r * 1.15, h, r, full ? 10 : 6, full ? 3 : 2, L(C.coniferLeaf), L(C.coniferLeaf2), rng, 0.16);
  return b.build('conifer', full);
}

function eucalyptus(set: 'full' | 'lite'): TreeGeometryData {
  const b = new Builder(1);
  const rng = seeded('eucalyptus', set);
  const full = set === 'full';
  // a pale, tall, slightly kinked trunk and a few sparse clumps high up
  const kinks: [number, number, number, number][] = full
    ? [[0, 0, 0, 0.03], [0.02, 0.35, 0.01, 0.022], [-0.01, 0.6, 0.02, 0.016], [0.02, 0.82, 0, 0.011]]
    : [[0, 0, 0, 0.03], [0.02, 0.45, 0.01, 0.02], [0.01, 0.8, 0.01, 0.012]];
  for (let i = 0; i + 1 < kinks.length; i++) {
    const p = kinks[i] as [number, number, number, number], q = kinks[i + 1] as [number, number, number, number];
    b.trunk(p[0], p[1], p[2], p[3], q[0], q[1], q[2], q[3], full ? 6 : 4, L(C.eucBark2), L(C.eucBark));
  }
  const clumps: [number, number, number, number][] = full
    ? [[0.12, 0.74, 0.04, 0.12], [-0.1, 0.8, -0.06, 0.11], [0.03, 0.92, 0.08, 0.1], [-0.02, 0.86, 0.12, 0.09]]
    : [[0.11, 0.76, 0.03, 0.13], [-0.09, 0.82, -0.05, 0.12], [0.02, 0.92, 0.07, 0.11]];
  for (const [x, y, z, r] of clumps) b.blob(x, y, z, r * 1.2, r * 0.75, r, full ? 7 : 6, full ? 3 : 2, L(C.eucLeaf), L(C.eucLeaf2), rng, 0.2);
  return b.build('eucalyptus', full);
}

function palm(set: 'full' | 'lite' | 'low'): TreeGeometryData {
  const b = new Builder(1);
  const rng = seeded('palm', set);
  const top = 0.84;
  // a thick straight trunk (a Canary palm), the leaf knob and the arched fronds
  if (set === 'full') {
    b.trunk(0, 0, 0, 0.065, 0, 0.4, 0, 0.058, 8, L(C.palmTrunk), L(C.palmTrunk));
    b.trunk(0, 0.4, 0, 0.058, 0, top, 0, 0.055, 8, L(C.palmTrunk), L(C.palmTrunk));
    b.blob(0, top + 0.02, 0, 0.08, 0.06, 0.08, 6, 2, L(C.palmKnob), L(C.palmKnob), rng, 0.05);
  } else if (set === 'lite') {
    b.trunk(0, 0, 0, 0.065, 0, top, 0, 0.055, 6, L(C.palmTrunk), L(C.palmTrunk));
  } else {
    b.trunk(0, 0, 0, 0.06, 0, top, 0, 0.05, 4, L(C.palmTrunk), L(C.palmTrunk));
  }
  const fronds = set === 'full' ? 12 : set === 'lite' ? 10 : 5;
  const segs = set === 'full' ? 3 : 2;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rng.nextFloat() * 0.3;
    const len = 0.36 + rng.nextFloat() * 0.06;
    b.frond(0, top + 0.02, 0, a, len, set === 'low' ? 0.08 : 0.06, segs, 0.25 + rng.nextFloat() * 0.2, L(C.palmKnob), i % 2 === 0 ? L(C.palmFrond) : L(C.palmFrond2));
  }
  return b.build('palm', set === 'full');
}

function crown(): TreeGeometryData {
  const b = new Builder(1);
  const rng = seeded('crown', 'low');
  b.trunk(0, 0, 0, 0.04, 0, 0.42, 0, 0.03, 4, L(C.crownTrunk), L(C.crownTrunk), Math.PI / 4);
  b.blob(0, 0.66, 0, 0.3, 0.32, 0.3, 6, 4, L(C.crown), L(C.crown), rng, 0.08);
  return b.build('crown', false);
}

/** M02b1's cone (one pool when `world.treeForms` is false): a four-sided trunk and a six-sided cone, 20 triangles, 6.2 m tall at scale 1. */
function cone(): TreeGeometryData {
  const b = new Builder(MESHER.tree.heightM);
  const trunk = L(MESHER.tree.trunk);
  const leaf = L(MESHER.tree.leaves[0] as string);
  b.trunk(0, 0, 0, 0.22, 0, 2.2, 0, 0.18, 4, trunk, trunk, Math.PI / 4);
  const ring: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ring.push(b.vertex(Math.cos(a) * 1.7, 1.8, Math.sin(a) * 1.7, Math.cos(a), 0.6, Math.sin(a), leaf, 1));
  }
  const apex = b.vertex(0, MESHER.tree.heightM, 0, 0, 1, 0, leaf, 1);
  for (let i = 0; i < 6; i++) b.tri(ring[i] as number, apex, ring[(i + 1) % 6] as number);
  return b.build('cone', false);
}

/** The geometries of a set, in pool order (`SET_GEOMETRIES`). Deterministic: the same bytes on every call. */
export function buildTreeSet(set: TreeSet): TreeGeometryData[] {
  if (set === 'cone') return [cone()];
  if (set === 'low') return [crown(), palm('low')];
  return [plane(set), ficus(set), conifer(set), eucalyptus(set), palm(set)];
}

/** The tint of the record's `form + 8 x tint` lane, as a multiplier of the geometry's crown colour (the `low` crown also takes the form's colour). */
export function tintOf(set: TreeSet, form: TreeForm, tint: number): Rgb {
  const t = TINTS[tint & 7] as Rgb;
  if (set !== 'low' || form === TreeForm.Palm) return t;
  const want = hexToLinear((LOW_CROWN[form] ?? LOW_CROWN[TreeForm.Plane] as { color: string }).color);
  const base = hexToLinear(LOW_CROWN_BASE);
  return [t[0] * (want[0] / base[0]), t[1] * (want[1] / base[1]), t[2] * (want[2] / base[2])];
}

/** The instance's scale: `[horizontal, vertical]` on top of the height (non-uniform on the `low` crown only). The cone is 6.2 m tall at 1. */
export function instanceScaleOf(set: TreeSet, form: TreeForm, heightM: number): [number, number] {
  if (set === 'cone') return [heightM / MESHER.tree.heightM, heightM / MESHER.tree.heightM];
  if (set === 'low' && form !== TreeForm.Palm) {
    const k = LOW_CROWN[form] ?? (LOW_CROWN[TreeForm.Plane] as { kx: number; ky: number });
    return [heightM * k.kx, heightM * k.ky];
  }
  return [heightM, heightM];
}
