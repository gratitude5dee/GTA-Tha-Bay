/**
 * Mesh building for the vehicle and prop recipes (M10d1): a small indexed-triangle builder with a part id per vertex, flat boxes,
 * surfaces of revolution and the grid loft that the car bodies are made of. Everything is a pure function of its arguments (no clocks,
 * no randomness), so two runs produce the same bytes. Frame of every recipe: +Y up, +Z forward, +X to the model's left (glTF).
 */
import { PART } from '../../../../packages/shared/src/assets/art-parts.ts';

export type V3 = readonly [number, number, number];
export type V2 = readonly [number, number];

/** sRGB hex to linear RGB (glTF vertex colours are linear). */
export function lin(hex: number): V3 {
  const f = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [f(((hex >> 16) & 255) / 255), f(((hex >> 8) & 255) / 255), f((hex & 255) / 255)];
}

export interface Style {
  /** The primitive (glTF material) the faces go to. */
  material: string;
  part: number;
  color: V3;
}

/** One primitive: positions, normals, linear colours, part ids and triangle indices. */
export class Mesh {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly part: number[] = [];
  readonly idx: number[] = [];

  constructor(readonly material: string) {}

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  vertex(p: V3, n: V3, c: V3, part: number): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]);
    this.part.push(part);
    return this.vertexCount - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  /** Appends `o` (offsetting its indices). */
  append(o: Mesh): void {
    const base = this.vertexCount;
    this.pos.push(...o.pos);
    this.nor.push(...o.nor);
    this.col.push(...o.col);
    this.part.push(...o.part);
    for (const i of o.idx) this.idx.push(i + base);
  }

  /** A copy moved by `t` and rotated about Y by `yaw` radians first. */
  moved(t: V3, yaw = 0): Mesh {
    const out = new Mesh(this.material);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let i = 0; i < this.pos.length; i += 3) {
      const x = this.pos[i] as number, y = this.pos[i + 1] as number, z = this.pos[i + 2] as number;
      out.pos.push(x * c + z * s + t[0], y + t[1], -x * s + z * c + t[2]);
      const nx = this.nor[i] as number, ny = this.nor[i + 1] as number, nz = this.nor[i + 2] as number;
      out.nor.push(nx * c + nz * s, ny, -nx * s + nz * c);
    }
    out.col.push(...this.col);
    out.part.push(...this.part);
    out.idx.push(...this.idx);
    return out;
  }

  /** A copy scaled per axis about the origin (normals corrected for non-uniform scale). */
  scaled(sx: number, sy: number, sz: number): Mesh {
    const out = new Mesh(this.material);
    for (let i = 0; i < this.pos.length; i += 3) {
      out.pos.push((this.pos[i] as number) * sx, (this.pos[i + 1] as number) * sy, (this.pos[i + 2] as number) * sz);
      const nx = (this.nor[i] as number) / sx, ny = (this.nor[i + 1] as number) / sy, nz = (this.nor[i + 2] as number) / sz;
      const l = Math.hypot(nx, ny, nz) || 1;
      out.nor.push(nx / l, ny / l, nz / l);
    }
    out.col.push(...this.col);
    out.part.push(...this.part);
    out.idx.push(...this.idx);
    return out;
  }

  /** A mirror image about the plane x = 0 with the winding turned back outward. */
  mirroredX(): Mesh {
    const out = new Mesh(this.material);
    for (let i = 0; i < this.pos.length; i += 3) {
      out.pos.push(-(this.pos[i] as number), this.pos[i + 1] as number, this.pos[i + 2] as number);
      out.nor.push(-(this.nor[i] as number), this.nor[i + 1] as number, this.nor[i + 2] as number);
    }
    out.col.push(...this.col);
    out.part.push(...this.part);
    for (let i = 0; i < this.idx.length; i += 3) out.idx.push(this.idx[i] as number, this.idx[i + 2] as number, this.idx[i + 1] as number);
    return out;
  }

  /** Bounds as [minX, minY, minZ, maxX, maxY, maxZ]; all zero for an empty mesh. */
  bounds(): [number, number, number, number, number, number] {
    if (this.pos.length === 0) return [0, 0, 0, 0, 0, 0];
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

/** A set of primitives by material name, in first-use order. */
export class MeshSet {
  private readonly byName = new Map<string, Mesh>();

  get(material: string): Mesh {
    let m = this.byName.get(material);
    if (!m) {
      m = new Mesh(material);
      this.byName.set(material, m);
    }
    return m;
  }

  list(): Mesh[] {
    return [...this.byName.values()].filter((m) => m.idx.length > 0);
  }

  append(o: MeshSet): void {
    for (const m of o.list()) this.get(m.material).append(m);
  }

  moved(t: V3, yaw = 0): MeshSet {
    const out = new MeshSet();
    for (const m of this.list()) out.get(m.material).append(m.moved(t, yaw));
    return out;
  }
}

export const style = (material: string, part: number, hex: number): Style => ({ material, part, color: lin(hex) });

// ---- vector helpers ---------------------------------------------------------------------------------------------------------

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ---- flat shapes ------------------------------------------------------------------------------------------------------------

const FACES: readonly { n: V3; v: readonly V3[] }[] = [
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
];

/** A flat-shaded box: 24 vertices. `skip` names faces to leave out (`+x`, `-x`, `+y`, `-y`, `+z`, `-z`). */
export function addBox(m: Mesh, c: V3, size: V3, color: V3, part: number, skip: readonly string[] = []): void {
  for (const f of FACES) {
    const tag = (f.n[0] !== 0 ? (f.n[0] > 0 ? '+x' : '-x') : f.n[1] !== 0 ? (f.n[1] > 0 ? '+y' : '-y') : f.n[2] > 0 ? '+z' : '-z');
    if (skip.includes(tag)) continue;
    const ids = f.v.map((v) => m.vertex([c[0] + (v[0] * size[0]) / 2, c[1] + (v[1] * size[1]) / 2, c[2] + (v[2] * size[2]) / 2], f.n, color, part));
    m.quad(ids[0] as number, ids[1] as number, ids[2] as number, ids[3] as number);
  }
}

/** A flat quad from four corners given counter-clockwise seen from the side the normal points to. */
export function addQuadFlat(m: Mesh, a: V3, b: V3, c: V3, d: V3, color: V3, part: number): void {
  const n = norm(cross(sub(b, a), sub(c, a)));
  const ids = [a, b, c, d].map((p) => m.vertex(p, n, color, part));
  m.quad(ids[0] as number, ids[1] as number, ids[2] as number, ids[3] as number);
}

export type Axis = 'x' | 'y' | 'z';

/**
 * A surface of revolution. `profile` is a list of `[along, radius]` pairs with `along` increasing; the surface turns about `axis`
 * through `centre`. Normals follow the profile (smooth); `flatCaps` closes a profile that ends above radius 0 with flat discs.
 * `segs` is the number of steps around the axis. The face normals point away from the axis.
 */
export function addLathe(m: Mesh, centre: V3, axis: Axis, profile: readonly V2[], segs: number, color: V3, part: number, opts: { flatCaps?: boolean; hardEdges?: boolean } = {}): void {
  const place = (a: number, r: number, ang: number): V3 => {
    const u = r * Math.cos(ang), v = r * Math.sin(ang);
    if (axis === 'x') return [centre[0] + a, centre[1] + u, centre[2] + v];
    if (axis === 'y') return [centre[0] + u, centre[1] + a, centre[2] + v];
    return [centre[0] + u, centre[1] + v, centre[2] + a];
  };
  const dir = (na: number, nr: number, ang: number): V3 => {
    const u = nr * Math.cos(ang), v = nr * Math.sin(ang);
    if (axis === 'x') return [na, u, v];
    if (axis === 'y') return [u, na, v];
    return [u, v, na];
  };
  const n = profile.length;
  const normals: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = profile[Math.max(0, i - 1)] as V2, p1 = profile[Math.min(n - 1, i + 1)] as V2;
    const da = p1[0] - p0[0], dr = p1[1] - p0[1];
    const l = Math.hypot(da, dr) || 1;
    normals.push([-dr / l, da / l]);
  }
  // one ring of vertices per profile point, or two (one per adjoining segment) with hard edges
  const rows: number[][] = [];
  const segNormal = (i: number): V2 => {
    const p0 = profile[i] as V2, p1 = profile[i + 1] as V2;
    const da = p1[0] - p0[0], dr = p1[1] - p0[1];
    const l = Math.hypot(da, dr) || 1;
    return [-dr / l, da / l];
  };
  const ring = (i: number, nn: V2): number[] => {
    const ids: number[] = [];
    const p = profile[i] as V2;
    for (let s = 0; s <= segs; s++) {
      const ang = (s / segs) * Math.PI * 2;
      ids.push(m.vertex(place(p[0], p[1], ang), dir(nn[0], nn[1], ang), color, part));
    }
    return ids;
  };
  if (opts.hardEdges) {
    for (let i = 0; i < n - 1; i++) {
      const sn = segNormal(i);
      const a = ring(i, sn), b = ring(i + 1, sn);
      for (let s = 0; s < segs; s++) m.quad(a[s] as number, b[s] as number, b[s + 1] as number, a[s + 1] as number);
    }
  } else {
    for (let i = 0; i < n; i++) rows.push(ring(i, normals[i] as V2));
    for (let i = 0; i < n - 1; i++) {
      const a = rows[i] as number[], b = rows[i + 1] as number[];
      for (let s = 0; s < segs; s++) m.quad(a[s] as number, b[s] as number, b[s + 1] as number, a[s + 1] as number);
    }
  }
  if (opts.flatCaps) {
    for (const end of [0, n - 1]) {
      const p = profile[end] as V2;
      if (p[1] <= 1e-6) continue;
      const sign = end === 0 ? -1 : 1;
      const hub = m.vertex(place(p[0], 0, 0), dir(sign, 0, 0), color, part);
      const ids: number[] = [];
      for (let s = 0; s <= segs; s++) ids.push(m.vertex(place(p[0], p[1], (s / segs) * Math.PI * 2), dir(sign, 0, 0), color, part));
      for (let s = 0; s < segs; s++) m.tri(hub, ids[s] as number, ids[s + 1] as number);
    }
  }
  fixWinding(m);
}

/** Turns every triangle whose geometric normal opposes the mean of its vertex normals. */
export function fixWinding(m: Mesh): void {
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t] as number, b = m.idx[t + 1] as number, c = m.idx[t + 2] as number;
    const pa: V3 = [m.pos[a * 3] as number, m.pos[a * 3 + 1] as number, m.pos[a * 3 + 2] as number];
    const pb: V3 = [m.pos[b * 3] as number, m.pos[b * 3 + 1] as number, m.pos[b * 3 + 2] as number];
    const pc: V3 = [m.pos[c * 3] as number, m.pos[c * 3 + 1] as number, m.pos[c * 3 + 2] as number];
    const f = cross(sub(pb, pa), sub(pc, pa));
    const nx = (m.nor[a * 3] as number) + (m.nor[b * 3] as number) + (m.nor[c * 3] as number);
    const ny = (m.nor[a * 3 + 1] as number) + (m.nor[b * 3 + 1] as number) + (m.nor[c * 3 + 1] as number);
    const nz = (m.nor[a * 3 + 2] as number) + (m.nor[b * 3 + 2] as number) + (m.nor[c * 3 + 2] as number);
    if (dot(f, [nx, ny, nz]) < 0) {
      m.idx[t + 1] = c;
      m.idx[t + 2] = b;
    }
  }
}

/** An ellipsoid (a lathe of a half ellipse about the Z axis by default). */
export function addEllipsoid(m: Mesh, c: V3, radii: V3, segs: number, color: V3, part: number): void {
  const rings = Math.max(3, Math.round(segs / 2));
  const profile: V2[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = (i / rings) * Math.PI;
    profile.push([-Math.cos(t), Math.max(1e-4, Math.sin(t))]);
  }
  const g = new Mesh(m.material);
  addLathe(g, [0, 0, 0], 'y', profile, segs, color, part);
  m.append(g.scaled(radii[0], radii[1], radii[2]).moved(c));
}

// ---- the grid loft -----------------------------------------------------------------------------------------------------------

export interface LoftStation {
  z: number;
  /** The ring of this station, (x, y) pairs; every station has the same number of points. */
  ring: readonly V2[];
}

export interface LoftOptions {
  /** Whether the ring closes (point n-1 joins point 0). Default true. */
  wrap?: boolean;
  /** Stations at which the surface breaks: normals are not averaged across them. */
  creaseStations?: ReadonlySet<number>;
  /** Ring points at which the surface breaks. */
  creaseCols?: ReadonlySet<number>;
  /** The style of the cell between stations s, s+1 and ring points c, c+1; null leaves the cell out. */
  cell: (s: number, c: number) => Style | null;
  /** Flat caps at the first and the last station. */
  caps?: { start?: Style | null; end?: Style | null };
}

/**
 * Lofts a tube through stations and gives it smooth normals (area-weighted vertex normals, split at the creases). The winding is
 * chosen so that the faces look away from the axis of the ring centroids.
 */
export function addLoft(set: MeshSet, stations: readonly LoftStation[], o: LoftOptions): void {
  const S = stations.length;
  if (S < 2) return;
  const C = (stations[0] as LoftStation).ring.length;
  const wrap = o.wrap !== false;
  const cols = wrap ? C : C - 1;
  const P = (s: number, c: number): V3 => {
    const st = stations[s] as LoftStation;
    const r = st.ring[((c % C) + C) % C] as V2;
    return [r[0], r[1], st.z];
  };
  // face normal (unnormalised, area weighted) of each cell
  const fn: V3[][] = [];
  let outward = 0;
  for (let s = 0; s < S - 1; s++) {
    const row: V3[] = [];
    for (let c = 0; c < cols; c++) {
      const a = P(s, c), b = P(s, c + 1), cc = P(s + 1, c + 1), d = P(s + 1, c);
      const n = cross(sub(cc, a), sub(d, b));
      row.push(n);
      const mid: V3 = [(a[0] + b[0] + cc[0] + d[0]) / 4, (a[1] + b[1] + cc[1] + d[1]) / 4, 0];
      // the ring centroid of this strip
      const st0 = stations[s] as LoftStation, st1 = stations[s + 1] as LoftStation;
      let cx = 0, cy = 0;
      for (const r of st0.ring) { cx += r[0]; cy += r[1]; }
      for (const r of st1.ring) { cx += r[0]; cy += r[1]; }
      cx /= 2 * C; cy /= 2 * C;
      outward += dot(n, [mid[0] - cx, mid[1] - cy, 0]);
    }
    fn.push(row);
  }
  const flip = outward < 0;
  const key = new Map<string, number>();
  const emit = (mesh: Mesh, s: number, c: number, ds: number, dc: number, st: Style): number => {
    const vs = s + ds, vc = c + dc;
    const rowSide = ds === 0 ? 'a' : 'b';
    const colSide = dc === 0 ? 'a' : 'b';
    const sCrease = o.creaseStations?.has(vs) === true;
    const cCrease = o.creaseCols?.has(((vc % C) + C) % C) === true;
    const k = `${st.material}|${st.part}|${st.color.join(',')}|${vs}|${((vc % C) + C) % C}|${sCrease ? rowSide : '-'}|${cCrease ? colSide : '-'}`;
    const hit = key.get(k);
    if (hit !== undefined) return hit;
    let nx = 0, ny = 0, nz = 0;
    for (const s2 of [vs - 1, vs]) {
      if (s2 < 0 || s2 >= S - 1) continue;
      if (sCrease && s2 !== s) continue;
      for (const c2 of [vc - 1, vc]) {
        if (!wrap && (c2 < 0 || c2 >= cols)) continue;
        if (cCrease && ((c2 % C) + C) % C !== ((c % C) + C) % C) continue;
        const f = (fn[s2] as V3[])[((c2 % cols) + cols) % cols] as V3;
        nx += f[0]; ny += f[1]; nz += f[2];
      }
    }
    const n = norm(flip ? [-nx, -ny, -nz] : [nx, ny, nz]);
    const id = mesh.vertex(P(vs, vc), n, st.color, st.part);
    key.set(k, id);
    return id;
  };
  for (let s = 0; s < S - 1; s++) {
    for (let c = 0; c < cols; c++) {
      const st = o.cell(s, c);
      if (!st) continue;
      const mesh = set.get(st.material);
      const a = emit(mesh, s, c, 0, 0, st), b = emit(mesh, s, c, 0, 1, st), cc = emit(mesh, s, c, 1, 1, st), d = emit(mesh, s, c, 1, 0, st);
      const area = len(fn[s]?.[c] as V3);
      if (area < 1e-10) continue;
      if (flip) mesh.quad(a, d, cc, b);
      else mesh.quad(a, b, cc, d);
    }
  }
  const cap = (s: number, st: Style | null | undefined, sign: 1 | -1): void => {
    if (!st) return;
    const mesh = set.get(st.material);
    const ring = (stations[s] as LoftStation).ring;
    const z = (stations[s] as LoftStation).z;
    let cx = 0, cy = 0;
    for (const r of ring) { cx += r[0]; cy += r[1]; }
    cx /= C; cy /= C;
    const n: V3 = [0, 0, sign];
    const hub = mesh.vertex([cx, cy, z], n, st.color, st.part);
    const ids = ring.map((r) => mesh.vertex([r[0], r[1], z], n, st.color, st.part));
    for (let c = 0; c < cols; c++) {
      const i0 = ids[c] as number, i1 = ids[(c + 1) % C] as number;
      // keep the winding that faces `sign`
      const a = ring[c] as V2, b = ring[(c + 1) % C] as V2;
      const cr = (a[0] - cx) * (b[1] - cy) - (a[1] - cy) * (b[0] - cx);
      if ((cr > 0 ? 1 : -1) * sign > 0) mesh.tri(hub, i0, i1);
      else mesh.tri(hub, i1, i0);
    }
  };
  cap(0, o.caps?.start, -1);
  cap(S - 1, o.caps?.end, 1);
}

/** A rounded-rectangle ring (x, y) of `2 * (corner + 1)` points per half, from the bottom centre up the +x side to the top centre and back. */
export function roundedRing(halfW: number, y0: number, y1: number, r: number, cornerSteps = 2): V2[] {
  const pts: V2[] = [];
  const rr = Math.min(r, halfW, (y1 - y0) / 2);
  pts.push([0, y0]);
  // bottom right corner
  for (let i = 0; i <= cornerSteps; i++) {
    const a = (i / cornerSteps) * (Math.PI / 2);
    pts.push([halfW - rr + rr * Math.sin(a), y0 + rr - rr * Math.cos(a)]);
  }
  // top right corner
  for (let i = 0; i <= cornerSteps; i++) {
    const a = (i / cornerSteps) * (Math.PI / 2);
    pts.push([halfW - rr + rr * Math.cos(a), y1 - rr + rr * Math.sin(a)]);
  }
  pts.push([0, y1]);
  const right = pts;
  const left: V2[] = [];
  for (let i = right.length - 2; i >= 1; i--) left.push([-(right[i] as V2)[0], (right[i] as V2)[1]]);
  return [...right, ...left];
}

/** The mean of `n` evenly spaced steps from a to b (inclusive). */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
export const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

export { PART };
