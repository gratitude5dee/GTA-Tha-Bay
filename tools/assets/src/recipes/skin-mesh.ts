/**
 * Skinned mesh building for the people recipes (M10d4): an indexed-triangle builder whose vertices carry a skin weight set on the 22
 * `bay_rig_v1` bones (at most four influences), an atlas UV, a baked shade and a class id, plus ring sweeps (`tube`) along a straight axis,
 * the ellipsoid, the bone-chain weight ramp and welded smooth normals. Everything is a pure function of its arguments: no clocks, no
 * randomness (the noise is an integer hash), so two runs give the same bytes.
 */
import { boneIndex, type Bone, type V3 } from './rig.ts';

/** (bone index, weight) pairs of one vertex. */
export type W = [number, number][];

/** A rectangle of the atlas page, in 0..1 texture space (v down). */
export interface Cell { u0: number; v0: number; u1: number; v1: number }

/** Class ids of a vertex (the glTF attribute `_PART`): they pick the tint at assembly and in the ped kit. */
export const PERSON_PART = {
  /** Skin: tinted by the skin tone. */
  skin: 0,
  /** The main garment colour (the palette colour of a ped, the part colour in the creator). */
  cloth: 1,
  /** The second garment colour: trims, soles' upper, a darker mix of the first. */
  cloth2: 2,
  hair: 3,
  /** Eyes, soles, plain metal: not tinted. */
  plain: 4,
  /** Lips and nails: skin tone pushed a little toward red. */
  lip: 5,
} as const;

export class SkinMesh {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly part: number[] = [];
  /** Baked shade 0..1 (ambient occlusion by hand), applied as the vertex colour. */
  readonly ao: number[] = [];
  readonly joints: number[] = [];
  readonly weights: number[] = [];
  readonly idx: number[] = [];
  /** Morph targets: name -> position deltas (3 per vertex, same length as `pos`). */
  morphs: Map<string, number[]> = new Map();

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  vertex(p: V3, uv: readonly [number, number], part: number, ao: number, w: W): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(0, 1, 0);
    this.uv.push(uv[0], uv[1]);
    this.part.push(part);
    this.ao.push(ao);
    const ws = normalizeWeights(w);
    for (let k = 0; k < 4; k++) {
      this.joints.push(ws[k]?.[0] ?? 0);
      this.weights.push(ws[k]?.[1] ?? 0);
    }
    return this.vertexCount - 1;
  }

  append(o: SkinMesh): void {
    const base = this.vertexCount;
    for (const a of ['pos', 'nor', 'uv', 'part', 'ao', 'joints', 'weights'] as const) this[a].push(...o[a]);
    for (const i of o.idx) this.idx.push(i + base);
  }

  /** A copy with every position mapped by `f` (normals are recomputed by the caller). */
  mapped(f: (p: V3, i: number) => V3): SkinMesh {
    const out = this.clone();
    for (let i = 0; i < this.vertexCount; i++) {
      const p = f([this.pos[i * 3] as number, this.pos[i * 3 + 1] as number, this.pos[i * 3 + 2] as number], i);
      out.pos[i * 3] = p[0];
      out.pos[i * 3 + 1] = p[1];
      out.pos[i * 3 + 2] = p[2];
    }
    return out;
  }

  clone(): SkinMesh {
    const out = new SkinMesh();
    for (const a of ['pos', 'nor', 'uv', 'part', 'ao', 'joints', 'weights', 'idx'] as const) out[a].push(...this[a]);
    for (const [k, v] of this.morphs) out.morphs.set(k, v.slice());
    return out;
  }

  /** Keeps the triangles whose three vertices pass `keep`, drops the unused vertices. */
  filtered(keep: (i: number) => boolean): SkinMesh {
    const out = new SkinMesh();
    const remap = new Map<number, number>();
    const take = (i: number): number => {
      let r = remap.get(i);
      if (r === undefined) {
        r = out.vertexCount;
        remap.set(i, r);
        out.pos.push(this.pos[i * 3] as number, this.pos[i * 3 + 1] as number, this.pos[i * 3 + 2] as number);
        out.nor.push(this.nor[i * 3] as number, this.nor[i * 3 + 1] as number, this.nor[i * 3 + 2] as number);
        out.uv.push(this.uv[i * 2] as number, this.uv[i * 2 + 1] as number);
        out.part.push(this.part[i] as number);
        out.ao.push(this.ao[i] as number);
        for (let k = 0; k < 4; k++) {
          out.joints.push(this.joints[i * 4 + k] as number);
          out.weights.push(this.weights[i * 4 + k] as number);
        }
      }
      return r;
    };
    for (let t = 0; t < this.idx.length; t += 3) {
      const a = this.idx[t] as number, b = this.idx[t + 1] as number, c = this.idx[t + 2] as number;
      if (keep(a) && keep(b) && keep(c)) out.idx.push(take(a), take(b), take(c));
    }
    return out;
  }

  /** Bounds as [minX, minY, minZ, maxX, maxY, maxZ]. */
  bounds(): [number, number, number, number, number, number] {
    const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = this.pos[i + k] as number;
        if (v < (b[k] as number)) b[k] = v;
        if (v > (b[k + 3] as number)) b[k + 3] = v;
      }
    }
    return b;
  }
}

/** The four heaviest influences, normalized to sum 1 (a vertex with no weight binds to bone 0). */
export function normalizeWeights(w: W): [number, number][] {
  const merged = new Map<number, number>();
  for (const [b, x] of w) if (x > 1e-6) merged.set(b, (merged.get(b) ?? 0) + x);
  let list = [...merged.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
  const sum = list.reduce((a, [, x]) => a + x, 0);
  if (sum <= 0) return [[0, 1]];
  list = list.map(([b, x]) => [b, x / sum] as [number, number]);
  return list;
}

// ---- weights ---------------------------------------------------------------------------------------------------------------------

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * Weights along a vertical chain of bones: `bones[0]` below the first ramp, `bones[k]` above ramp k-1; a ramp is a pair of heights between
 * which the weight moves smoothly from the bone below to the bone above. The ramps ascend.
 */
export function chainWeights(y: number, bones: readonly Bone[], ramps: readonly (readonly [number, number])[]): W {
  let k = 0;
  while (k < ramps.length && y >= (ramps[k] as readonly [number, number])[1]) k++;
  if (k >= ramps.length) return [[boneIndex(bones[bones.length - 1] as Bone), 1]];
  const [y0, y1] = ramps[k] as readonly [number, number];
  const t = smooth((y - y0) / (y1 - y0));
  const lo = boneIndex(bones[k] as Bone);
  const hi = boneIndex(bones[k + 1] as Bone);
  if (t <= 0) return [[lo, 1]];
  return [[lo, 1 - t], [hi, t]];
}

export const rigid = (bone: Bone): W => [[boneIndex(bone), 1]];

// ---- tubes -----------------------------------------------------------------------------------------------------------------------

export interface Ring {
  /** Centre of the ring. */
  c: V3;
  /** Radii along the frame's u and v axes. */
  ru: number;
  rv: number;
}

export interface Frame { u: V3; v: V3 }
/** Rings in the XZ plane (a limb or a trunk along Y). */
export const FRAME_Y: Frame = { u: [1, 0, 0], v: [0, 0, 1] };
/** Rings in the XY plane (a foot or a nose along Z). */
export const FRAME_Z: Frame = { u: [1, 0, 0], v: [0, 1, 0] };
/** Rings in the YZ plane (a sleeve or a strap along X). */
export const FRAME_X: Frame = { u: [0, 1, 0], v: [0, 0, 1] };

export interface TubeOptions {
  seg: number;
  frame?: Frame;
  cell: Cell;
  part: number;
  weights: (i: number, ring: Ring) => W;
  /** Shade of ring `i` at column `a` (0..seg-1); default 1. */
  ao?: (i: number, a: number) => number;
  capStart?: boolean;
  capEnd?: boolean;
  /** Angle where column 0 sits, radians (default 0: along +u). */
  phase?: number;
  /** Start and end of the swept angle in turns (default 0..1 = closed). An open sweep has no cap and a seam. */
  arc?: readonly [number, number];
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const inset = (c: Cell): Cell => {
  const du = (c.u1 - c.u0) * 0.04;
  const dv = (c.v1 - c.v0) * 0.04;
  return { u0: c.u0 + du, v0: c.v0 + dv, u1: c.u1 - du, v1: c.v1 - dv };
};

/** A sweep of elliptical rings; the winding is outward whichever way the rings run. Normals are filled in by `smoothNormals`. */
export function tube(rings: readonly Ring[], o: TubeOptions): SkinMesh {
  const m = new SkinMesh();
  const frame = o.frame ?? FRAME_Y;
  const cell = inset(o.cell);
  const n = rings.length;
  if (n < 2) return m;
  const arc = o.arc ?? [0, 1];
  const closed = arc[0] === 0 && arc[1] === 1;
  const phase = o.phase ?? 0;
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const r = rings[i] as Ring;
    const row: number[] = [];
    for (let a = 0; a <= o.seg; a++) {
      const turn = arc[0] + (a / o.seg) * (arc[1] - arc[0]);
      const ang = phase + turn * Math.PI * 2;
      const ca = Math.cos(ang) * r.ru;
      const sa = Math.sin(ang) * r.rv;
      const p: V3 = [
        r.c[0] + frame.u[0] * ca + frame.v[0] * sa,
        r.c[1] + frame.u[1] * ca + frame.v[1] * sa,
        r.c[2] + frame.u[2] * ca + frame.v[2] * sa,
      ];
      const uv: [number, number] = [cell.u0 + (a / o.seg) * (cell.u1 - cell.u0), cell.v0 + (i / (n - 1)) * (cell.v1 - cell.v0)];
      row.push(m.vertex(p, uv, o.part, o.ao ? o.ao(i, a % o.seg) : 1, o.weights(i, r)));
    }
    rows.push(row);
  }
  const axis = sub((rings[n - 1] as Ring).c, (rings[0] as Ring).c);
  const flip = dot(cross(frame.u, frame.v), axis) > 0;
  for (let i = 0; i < n - 1; i++) {
    const r0 = rows[i] as number[];
    const r1 = rows[i + 1] as number[];
    for (let a = 0; a < o.seg; a++) {
      const A = r0[a] as number, B = r0[a + 1] as number, C = r1[a + 1] as number, D = r1[a] as number;
      if (flip) m.idx.push(A, B, C, A, C, D);
      else m.idx.push(A, C, B, A, D, C);
    }
  }
  const cap = (ringIdx: number, atEnd: boolean): void => {
    const r = rings[ringIdx] as Ring;
    const row = rows[ringIdx] as number[];
    const w = o.weights(ringIdx, r);
    const centre = m.vertex(r.c, [(cell.u0 + cell.u1) / 2, ringIdx === 0 ? cell.v0 : cell.v1], o.part, o.ao ? o.ao(ringIdx, 0) : 1, w);
    const outward = atEnd ? 1 : -1;
    const sign = Math.sign(dot(cross(frame.u, frame.v), axis)) * outward;
    for (let a = 0; a < o.seg; a++) {
      const p = row[a] as number, q = row[a + 1] as number;
      // (centre, p, q) faces along +(u x v); the cap must face outward * the axis direction
      if (sign > 0) m.idx.push(centre, p, q);
      else m.idx.push(centre, q, p);
    }
  };
  if (closed && o.capStart) cap(0, false);
  if (closed && o.capEnd) cap(n - 1, true);
  return m;
}

/** An ellipsoid of revolution about Y (radii rx, ry, rz) as a pole-to-pole sweep. */
export function ellipsoid(c: V3, r: V3, seg: number, rings: number, o: Omit<TubeOptions, 'seg' | 'capStart' | 'capEnd'> & { weights: TubeOptions['weights'] }): SkinMesh {
  const list: Ring[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const th = Math.PI * t;
    list.push({ c: [c[0], c[1] - Math.cos(th) * r[1], c[2]], ru: Math.max(1e-4, Math.sin(th) * r[0]), rv: Math.max(1e-4, Math.sin(th) * r[2]) });
  }
  return tube(list, { ...o, seg });
}

// ---- normals ---------------------------------------------------------------------------------------------------------------------

/** Area-weighted normals, welded across vertices that share a position (the seam of a tube, the rim of a cap). */
export function smoothNormals(m: SkinMesh): void {
  const key = (i: number): string => `${Math.round((m.pos[i * 3] as number) * 1e5)},${Math.round((m.pos[i * 3 + 1] as number) * 1e5)},${Math.round((m.pos[i * 3 + 2] as number) * 1e5)}`;
  const acc = new Map<string, V3>();
  const keys: string[] = [];
  for (let i = 0; i < m.vertexCount; i++) keys.push(key(i));
  const P = (i: number): V3 => [m.pos[i * 3] as number, m.pos[i * 3 + 1] as number, m.pos[i * 3 + 2] as number];
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t] as number, b = m.idx[t + 1] as number, c = m.idx[t + 2] as number;
    const n = cross(sub(P(b), P(a)), sub(P(c), P(a)));
    for (const v of [a, b, c]) {
      const k = keys[v] as string;
      const cur = acc.get(k) ?? [0, 0, 0];
      acc.set(k, [cur[0] + n[0], cur[1] + n[1], cur[2] + n[2]]);
    }
  }
  for (let i = 0; i < m.vertexCount; i++) {
    const n = acc.get(keys[i] as string) ?? [0, 1, 0];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    m.nor[i * 3] = n[0] / l;
    m.nor[i * 3 + 1] = n[1] / l;
    m.nor[i * 3 + 2] = n[2] / l;
  }
}

// ---- helpers ---------------------------------------------------------------------------------------------------------------------

/** A deterministic hash noise in 0..1 of an integer pair. */
export function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Piecewise-linear value of a profile `[y, a, b, ...][]` at `y`. */
export function profileAt(points: readonly (readonly number[])[], y: number): number[] {
  const first = points[0] as readonly number[];
  const last = points[points.length - 1] as readonly number[];
  if (y <= (first[0] as number)) return first.slice(1);
  if (y >= (last[0] as number)) return last.slice(1);
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i] as readonly number[];
    const q = points[i + 1] as readonly number[];
    if (y <= (q[0] as number)) {
      const t = (y - (p[0] as number)) / ((q[0] as number) - (p[0] as number));
      return p.slice(1).map((v, k) => lerp(v, q[k + 1] as number, t));
    }
  }
  return last.slice(1);
}

export const addV = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
