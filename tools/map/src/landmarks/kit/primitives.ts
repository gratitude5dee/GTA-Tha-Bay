/**
 * Landmark recipe primitives (M02d1). Everything here is plain geometry written into a `Geo` accumulator: no textures, no images,
 * no randomness, no clock. Coordinates are the world's: metres, +X east, +Y up, +Z south (-Z north), origin at the landmark seed
 * with y = 0 at the ground. Triangles wind counter-clockwise seen from outside (glTF front faces).
 *
 * Shapes: extruded footprints with setbacks, tapered towers, domes and drums, arches and colonnades, struts and tubes (lattice,
 * cables), terraces and stairs, hill mounds. Spans (decks, cables, suspension towers) are in `spans.ts`.
 */
import { MAT_CLASSES, resolveColor, scaleRgb, type ColorRef, type MatClass, type Rgb } from './palette.ts';
import type { Rules } from './fidelity.ts';

export type V3 = readonly [number, number, number];
export type V2 = readonly [number, number];

// ---- vector helpers ----------------------------------------------------------------------------------------------------------

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.sqrt(dot(a, a));
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Rotates the point (x, z) about the origin by `yaw` radians (positive turns +X toward +Z, clockwise seen from above). */
export function rotY(x: number, z: number, yaw: number): [number, number] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [x * c + z * s, -x * s + z * c];
}

/** A rectangle ring centred on (cx, cz), `w` along local X, `d` along local Z, turned by `yaw` radians. */
export function rectRing(cx: number, cz: number, w: number, d: number, yaw = 0): V2[] {
  const pts: V2[] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  return pts.map(([x, z]) => {
    const [rx, rz] = rotY(x, z, yaw);
    return [cx + rx, cz + rz] as V2;
  });
}

/** An n-gon (or ellipse) ring, the first vertex at angle `rot`. */
export function circleRing(cx: number, cz: number, rx: number, rz: number, n: number, rot = 0): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]);
  }
  return out;
}

const ring3 = (pts: readonly V2[], y: number): V3[] => pts.map(([x, z]) => [x, y, z] as V3);

// ---- the accumulator ---------------------------------------------------------------------------------------------------------

interface Buf { pos: number[]; nor: number[]; col: number[]; idx: number[] }

/** The finished buffers of one material class. */
export interface ClassBuffers { cls: MatClass; pos: Float32Array<ArrayBuffer>; nor: Float32Array<ArrayBuffer>; col: Float32Array<ArrayBuffer>; idx: Uint32Array<ArrayBuffer> }

export interface PartOpts { color: ColorRef; cls?: MatClass }

export class Geo {
  readonly rules: Rules;
  private readonly bufs: Record<MatClass, Buf> = {
    matte: { pos: [], nor: [], col: [], idx: [] },
    metal: { pos: [], nor: [], col: [], idx: [] },
    glass: { pos: [], nor: [], col: [], idx: [] },
  };

  private yawC = 1;
  private yawS = 0;

  constructor(rules: Rules) {
    this.rules = rules;
  }

  /** Turns everything added from now on about the vertical axis through the origin (radians, `rotY` convention). */
  setYaw(yaw: number): void {
    this.yawC = Math.cos(yaw);
    this.yawS = Math.sin(yaw);
  }

  private buf(cls: MatClass): Buf {
    return this.bufs[this.rules.cls(cls)];
  }

  /** Adds one vertex and returns its index in the class buffer. */
  vert(cls: MatClass, p: V3, n: V3, c: Rgb): number {
    const b = this.buf(cls);
    const i = b.pos.length / 3;
    const yc = this.yawC, ys = this.yawS;
    b.pos.push(p[0] * yc + p[2] * ys, p[1], -p[0] * ys + p[2] * yc);
    b.nor.push(n[0] * yc + n[2] * ys, n[1], -n[0] * ys + n[2] * yc);
    b.col.push(c[0], c[1], c[2]);
    return i;
  }

  tri(cls: MatClass, a: number, b: number, c: number): void {
    this.buf(cls).idx.push(a, b, c);
  }

  /**
   * A flat convex polygon (fan from the first point). `out` is the direction the face looks toward: the winding is flipped when
   * the geometric normal disagrees with it. Degenerate polygons (zero area) draw nothing.
   */
  poly(pts: readonly V3[], out: V3, color: ColorRef, cls: MatClass = 'matte'): void {
    if (pts.length < 3) return;
    let n: V3 = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) n = add(n, cross(pts[i] as V3, pts[(i + 1) % pts.length] as V3));
    if (len(n) < 1e-9) return;
    n = norm(n);
    const flip = dot(n, out) < 0;
    const ordered = flip ? [...pts].reverse() : pts;
    const nn = flip ? mul(n, -1) : n;
    const c = resolveColor(color);
    const ids = ordered.map((p) => this.vert(cls, p, nn, c));
    for (let i = 1; i + 1 < ids.length; i++) this.tri(cls, ids[0] as number, ids[i] as number, ids[i + 1] as number);
  }

  /** A flat quad given in any consistent order, facing `out`. */
  quad(a: V3, b: V3, c: V3, d: V3, out: V3, color: ColorRef, cls: MatClass = 'matte'): void {
    this.poly([a, b, c, d], out, color, cls);
  }

  triangles(): number {
    return MAT_CLASSES.reduce((n, c) => n + this.bufs[c].idx.length / 3, 0);
  }

  /** The non-empty class buffers, in the fixed class order. */
  classes(): ClassBuffers[] {
    const out: ClassBuffers[] = [];
    for (const cls of MAT_CLASSES) {
      const b = this.bufs[cls];
      if (b.idx.length === 0) continue;
      out.push({ cls, pos: Float32Array.from(b.pos), nor: Float32Array.from(b.nor), col: Float32Array.from(b.col), idx: Uint32Array.from(b.idx) });
    }
    return out;
  }
}

// ---- skins: rings joined into walls ------------------------------------------------------------------------------------------

export interface SkinOpts extends PartOpts {
  /** Shared vertices with averaged normals (round shapes) instead of flat faces. */
  smooth?: boolean;
  /** Close the first ring with a cap (default false). */
  capStart?: boolean;
  /** Close the last ring with a cap (default true). */
  capEnd?: boolean;
  /** Tint of the end caps relative to the wall colour. */
  capTint?: number;
  /** The rings are open (a strip, not a loop). */
  open?: boolean;
}

const samePoint = (a: V3, b: V3): boolean => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-7;

/**
 * Walls between consecutive rings (equal vertex counts), outward = away from the ring axis. A ring whose points all coincide is
 * an apex: its triangles are single. The axis is the centroid line through the ring centroids.
 */
export function skin(g: Geo, rings: readonly (readonly V3[])[], o: SkinOpts): void {
  if (rings.length < 2) return;
  const n = (rings[0] as readonly V3[]).length;
  const color = resolveColor(o.color);
  const cls = o.cls ?? 'matte';
  const centroid = (r: readonly V3[]): V3 => {
    let s: V3 = [0, 0, 0];
    for (const p of r) s = add(s, p);
    return mul(s, 1 / r.length);
  };
  const cents = rings.map(centroid);
  const segs = o.open ? n - 1 : n;
  if (o.smooth) {
    // Per-ring-vertex normals: the sum of the adjacent face normals.
    const normals: V3[][] = rings.map(() => Array.from({ length: n }, () => [0, 0, 0] as V3));
    const face = (r: number, i: number): V3 => {
      const j = (i + 1) % n;
      const a = (rings[r] as readonly V3[])[i] as V3, b = (rings[r] as readonly V3[])[j] as V3;
      const c = (rings[r + 1] as readonly V3[])[j] as V3, d = (rings[r + 1] as readonly V3[])[i] as V3;
      let nn = cross(sub(c, a), sub(d, b));
      if (len(nn) < 1e-9) nn = cross(sub(b, a), sub(d, a));
      if (len(nn) < 1e-9) return [0, 0, 0];
      nn = norm(nn);
      const mid = mul(add(add(a, b), add(c, d)), 0.25);
      const axis = lerp3(cents[r] as V3, cents[r + 1] as V3, 0.5);
      const radial = sub(mid, axis);
      return dot(nn, radial) < 0 && len(radial) > 1e-6 ? mul(nn, -1) : nn;
    };
    for (let r = 0; r + 1 < rings.length; r++) {
      for (let i = 0; i < segs; i++) {
        const f = face(r, i);
        const j = (i + 1) % n;
        for (const [rr, ii] of [[r, i], [r, j], [r + 1, j], [r + 1, i]] as const) normals[rr]![ii] = add(normals[rr]![ii] as V3, f);
      }
    }
    const ids: number[][] = rings.map((ring, r) => ring.map((p, i) => g.vert(cls, p, norm(normals[r]![i] as V3), color)));
    for (let r = 0; r + 1 < rings.length; r++) {
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % n;
        const a = (rings[r] as readonly V3[])[i] as V3, b = (rings[r] as readonly V3[])[j] as V3;
        const c = (rings[r + 1] as readonly V3[])[j] as V3, d = (rings[r + 1] as readonly V3[])[i] as V3;
        const A = ids[r]![i] as number, B = ids[r]![j] as number, C = ids[r + 1]![j] as number, D = ids[r + 1]![i] as number;
        const outv = face(r, i);
        // Wind each triangle to agree with the face normal.
        const emit = (p: number, q: number, s: number, pa: V3, pb: V3, pc: V3): void => {
          const tn = cross(sub(pb, pa), sub(pc, pa));
          if (len(tn) < 1e-9) return;
          if (dot(tn, outv) >= 0) g.tri(cls, p, q, s);
          else g.tri(cls, p, s, q);
        };
        emit(A, B, C, a, b, c);
        emit(A, C, D, a, c, d);
      }
    }
  } else {
    for (let r = 0; r + 1 < rings.length; r++) {
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % n;
        const a = (rings[r] as readonly V3[])[i] as V3, b = (rings[r] as readonly V3[])[j] as V3;
        const c = (rings[r + 1] as readonly V3[])[j] as V3, d = (rings[r + 1] as readonly V3[])[i] as V3;
        const mid = mul(add(add(a, b), add(c, d)), 0.25);
        const radial = sub(mid, lerp3(cents[r] as V3, cents[r + 1] as V3, 0.5));
        // Distinct corners only: a ring collapsed to a point makes one triangle.
        const pts: V3[] = [a, b, c, d].filter((p, k, all) => !samePoint(p, all[(k + all.length - 1) % all.length] as V3));
        if (pts.length >= 3) g.poly(pts, radial, color, cls);
      }
    }
  }
  const tint = o.capTint ?? 1;
  const capCol = scaleRgb(color, tint);
  const first = rings[0] as readonly V3[], last = rings[rings.length - 1] as readonly V3[];
  const nr = rings.length;
  const axisEnd = sub(cents[nr - 1] as V3, cents[nr - 2] as V3);
  const outEnd: V3 = len(axisEnd) > 1e-9 ? axisEnd : [0, 1, 0];
  const axisStart = sub(cents[0] as V3, cents[1] as V3);
  const outStart: V3 = len(axisStart) > 1e-9 ? axisStart : [0, -1, 0];
  if (!o.open && o.capEnd !== false) g.poly(dedupe(last), outEnd, capCol, cls);
  if (!o.open && o.capStart) g.poly(dedupe(first), outStart, capCol, cls);
}

function dedupe(r: readonly V3[]): V3[] {
  return r.filter((p, k) => !samePoint(p, r[(k + r.length - 1) % r.length] as V3));
}

// ---- solids ------------------------------------------------------------------------------------------------------------------

export interface BoxOpts extends PartOpts {
  yaw?: number;
  /** Draw the bottom face (default false: boxes stand on the ground). */
  bottom?: boolean;
  /** Omit the top (open boxes, roofs placed separately). */
  top?: boolean;
  topColor?: ColorRef;
}

/** A box standing on `y0`: centre (cx, cz), `w` x `d` footprint turned by `yaw`, height `h`. */
export function box(g: Geo, cx: number, y0: number, cz: number, w: number, h: number, d: number, o: BoxOpts): void {
  prism(g, rectRing(cx, cz, w, d, o.yaw ?? 0), y0, y0 + h, o);
}

/** A convex footprint extruded from `y0` to `y1`. */
export function prism(g: Geo, ring: readonly V2[], y0: number, y1: number, o: BoxOpts): void {
  const c = resolveColor(o.color);
  const cls = o.cls ?? 'matte';
  const top = ring3(ring, y1), bot = ring3(ring, y0);
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const mx = ((ring[i] as V2)[0] + (ring[j] as V2)[0]) / 2 - cx, mz = ((ring[i] as V2)[1] + (ring[j] as V2)[1]) / 2 - cz;
    g.poly([bot[i] as V3, bot[j] as V3, top[j] as V3, top[i] as V3], [mx, 0, mz], c, cls);
  }
  if (o.top !== false) g.poly(top, [0, 1, 0], o.topColor ?? scaleRgb(c, 0.85), cls);
  if (o.bottom) g.poly(bot, [0, -1, 0], scaleRgb(c, 0.6), cls);
}

export interface Step { /** Height of this tier above the previous one. */ h: number; /** Footprint inset from the tier below, each side, metres. */ inset: number }

/** A stack of boxes, each tier inset from the one below (setbacks). Returns the top y. */
export function setbacks(g: Geo, cx: number, y0: number, cz: number, w: number, d: number, steps: readonly Step[], o: BoxOpts): number {
  let y = y0, ww = w, dd = d;
  for (const s of steps) {
    ww = Math.max(0.5, ww - 2 * s.inset);
    dd = Math.max(0.5, dd - 2 * s.inset);
    box(g, cx, y, cz, ww, s.h, dd, { ...o, ...(s === steps[steps.length - 1] ? {} : { top: false }) });
    y += s.h;
  }
  return y;
}

/**
 * A tower whose footprint changes linearly from (w0, d0) at `y0` to (w1, d1) at `y0 + h`: a tapered tower. `round` in [0, 1]
 * rounds the corners (0 = a box with four walls, 1 = an ellipse); the vertex count is `4 * (1 + k)` with k from the rules.
 */
export function taperTower(g: Geo, cx: number, y0: number, cz: number, w0: number, d0: number, w1: number, d1: number, h: number, o: PartOpts & { yaw?: number; round?: number; slices?: number; smooth?: boolean; capTint?: number }): void {
  const round = o.round ?? 0;
  const n = round > 0 ? g.rules.segs(24) : 4;
  const ringAt = (w: number, d: number): V2[] => {
    if (round <= 0) return rectRing(cx, cz, w, d, o.yaw ?? 0);
    // Super-ellipse blend between a rectangle and an ellipse.
    const e = 2 + (1 - round) * 6;
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const x = Math.sign(c) * Math.abs(c) ** (2 / e) * (w / 2), z = Math.sign(s) * Math.abs(s) ** (2 / e) * (d / 2);
      const [rx, rz] = rotY(x, z, o.yaw ?? 0);
      return [cx + rx, cz + rz] as V2;
    });
  };
  const slices = Math.max(1, o.slices ?? 1);
  const rings: V3[][] = [];
  for (let k = 0; k <= slices; k++) {
    const t = k / slices;
    rings.push(ring3(ringAt(w0 + (w1 - w0) * t, d0 + (d1 - d0) * t), y0 + h * t));
  }
  skin(g, rings, { color: o.color, ...(o.cls ? { cls: o.cls } : {}), smooth: o.smooth ?? round > 0, ...(o.capTint !== undefined ? { capTint: o.capTint } : {}) });
}

/** A vertical cylinder or cone frustum (radius r0 at y0, r1 at y0 + h). */
export function frustum(g: Geo, cx: number, y0: number, cz: number, r0: number, r1: number, h: number, segs: number, o: PartOpts & { rz0?: number; rz1?: number; smooth?: boolean; capStart?: boolean; capEnd?: boolean }): void {
  const n = g.rules.segs(segs);
  const rings = [ring3(circleRing(cx, cz, r0, o.rz0 ?? r0, n), y0), ring3(circleRing(cx, cz, r1, o.rz1 ?? r1, n), y0 + h)];
  skin(g, rings, {
    color: o.color, ...(o.cls ? { cls: o.cls } : {}), smooth: o.smooth ?? true,
    ...(o.capStart !== undefined ? { capStart: o.capStart } : {}), ...(o.capEnd !== undefined ? { capEnd: o.capEnd } : {}),
  });
}

/** A fluted shaft: a cylinder whose radius alternates between r and r * (1 - depth) around the circumference. */
export function flutedShaft(g: Geo, cx: number, y0: number, cz: number, r: number, h: number, flutes: number, depth: number, o: PartOpts & { rTop?: number }): void {
  const n = flutes * 2;
  const rTop = o.rTop ?? r;
  const ringAt = (rr: number, y: number): V3[] => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = i % 2 === 0 ? rr : rr * (1 - depth);
    return [cx + Math.cos(a) * k, y, cz + Math.sin(a) * k] as V3;
  });
  skin(g, [ringAt(r, y0), ringAt(rTop, y0 + h)], { color: o.color, ...(o.cls ? { cls: o.cls } : {}), smooth: false });
}

/** A (part of a) sphere: a dome on a base ellipse (rx, rz) with height h, `from`/`to` in [0, 1] along the profile. */
export function dome(g: Geo, cx: number, y0: number, cz: number, rx: number, rz: number, h: number, segs: number, rings: number, o: PartOpts & { from?: number; to?: number; capStart?: boolean }): void {
  const n = g.rules.segs(segs);
  const m = Math.max(2, g.rules.segs(rings));
  const a0 = (o.from ?? 0) * (Math.PI / 2), a1 = (o.to ?? 1) * (Math.PI / 2);
  const rs: V3[][] = [];
  for (let k = 0; k <= m; k++) {
    const a = a0 + ((a1 - a0) * k) / m;
    const rr = Math.cos(a);
    const y = y0 + Math.sin(a) * h;
    const last = k === m && a1 >= Math.PI / 2 - 1e-9;
    rs.push(ring3(circleRing(cx, cz, last ? 0 : rx * rr, last ? 0 : rz * rr, n), y));
  }
  skin(g, rs, { color: o.color, ...(o.cls ? { cls: o.cls } : {}), smooth: true, capEnd: a1 < Math.PI / 2 - 1e-9, ...(o.capStart ? { capStart: true } : {}) });
}

/** A round hill: height h at the centre falling to the base ring, sunk `sink` metres below y0 so it meets the terrain. */
export function hillMound(g: Geo, cx: number, y0: number, cz: number, rx: number, rz: number, h: number, segs: number, rings: number, sink: number, o: PartOpts & { yaw?: number }): void {
  const n = g.rules.segs(segs);
  const m = Math.max(2, g.rules.segs(rings));
  const rs: V3[][] = [];
  for (let k = 0; k <= m; k++) {
    const t = k / m; // 0 at the rim, 1 at the summit
    const prof = t * t * (3 - 2 * t);
    const rr = 1 - t;
    const ring = circleRing(0, 0, rx * rr, rz * rr, n, 0).map(([x, z]) => {
      const [px, pz] = rotY(x, z, o.yaw ?? 0);
      return [cx + px, cz + pz] as V2;
    });
    rs.push(ring3(ring, y0 - sink + (h + sink) * prof));
  }
  const last = rs[rs.length - 1] as V3[];
  rs[rs.length - 1] = last.map((p) => [cx, p[1], cz] as V3);
  skin(g, rs, { color: o.color, ...(o.cls ? { cls: o.cls } : {}), smooth: true, capEnd: false });
}

// ---- arches, colonnades, stairs ------------------------------------------------------------------------------------------------

/**
 * A semicircular arch ring (an arched opening in a wall): inner radius r, thickness t, extruded depth d along local Z, centred at
 * (cx, cz) with its springing line at y0. Turned by yaw.
 */
export function archRing(g: Geo, cx: number, y0: number, cz: number, r: number, t: number, d: number, yaw: number, o: PartOpts): void {
  const n = Math.max(3, g.rules.segs(8));
  const pt = (rad: number, a: number, dz: number): V3 => {
    const [rx, rz] = rotY(Math.cos(a) * rad, dz, yaw);
    return [cx + rx, y0 + Math.sin(a) * rad, cz + rz];
  };
  const c = resolveColor(o.color);
  const cls = o.cls ?? 'matte';
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (i / n), b = Math.PI * ((i + 1) / n);
    const mid = (a + b) / 2;
    const up: V3 = [Math.cos(mid), Math.sin(mid), 0];
    const dir = (v: V3): V3 => { const [rx, rz] = rotY(v[0], v[2], yaw); return [rx, v[1], rz]; };
    // intrados (faces the opening), extrados (faces up and out), and the two fronts
    g.poly([pt(r, a, -d / 2), pt(r, b, -d / 2), pt(r, b, d / 2), pt(r, a, d / 2)], dir(mul(up, -1)), scaleRgb(c, 0.8), cls);
    g.poly([pt(r + t, a, -d / 2), pt(r + t, b, -d / 2), pt(r + t, b, d / 2), pt(r + t, a, d / 2)], dir(up), c, cls);
    g.poly([pt(r, a, d / 2), pt(r, b, d / 2), pt(r + t, b, d / 2), pt(r + t, a, d / 2)], dir([0, 0, 1]), c, cls);
    g.poly([pt(r, a, -d / 2), pt(r, b, -d / 2), pt(r + t, b, -d / 2), pt(r + t, a, -d / 2)], dir([0, 0, -1]), c, cls);
  }
}

export interface ColonnadeOpts extends PartOpts {
  /** Arc in radians (a full circle is 2 pi). */
  from: number;
  to: number;
  count: number;
  columnR: number;
  height: number;
  /** Entablature (the beam) thickness and the colour of the beam. */
  beam: number;
  beamColor?: ColorRef;
}

/** Columns on a circular arc with a beam on top; `count` follows the rules. Returns the top y of the beam. */
export function colonnade(g: Geo, cx: number, y0: number, cz: number, radius: number, o: ColonnadeOpts): number {
  const count = g.rules.count(o.count, 4);
  const sides = g.rules.detail >= 2 ? 8 : g.rules.detail === 1 ? 6 : 4;
  const full = Math.abs(o.to - o.from) >= Math.PI * 2 - 1e-6;
  for (let i = 0; i < count; i++) {
    const t = full ? i / count : count === 1 ? 0.5 : i / (count - 1);
    const a = o.from + (o.to - o.from) * t;
    const x = cx + Math.cos(a) * radius, z = cz + Math.sin(a) * radius;
    frustum(g, x, y0, z, o.columnR, o.columnR * 0.9, o.height, sides, { color: o.color, ...(o.cls ? { cls: o.cls } : {}), smooth: false });
  }
  // the beam: a band of 4-corner cross-sections swept along the arc
  const segs = Math.max(6, g.rules.segs(24));
  const steps = full ? segs : Math.max(2, Math.round((segs * Math.abs(o.to - o.from)) / (Math.PI * 2)));
  const rin = radius - o.columnR * 1.6, rout = radius + o.columnR * 1.6;
  const section = (a: number): V3[] => {
    const c = Math.cos(a), s = Math.sin(a), yb = y0 + o.height, yt = yb + o.beam;
    return [[cx + c * rout, yb, cz + s * rout], [cx + c * rout, yt, cz + s * rout], [cx + c * rin, yt, cz + s * rin], [cx + c * rin, yb, cz + s * rin]];
  };
  const sweep: V3[][] = [];
  for (let i = 0; i <= steps; i++) sweep.push(section(o.from + ((o.to - o.from) * i) / steps));
  skin(g, sweep, { color: o.beamColor ?? o.color, ...(o.cls ? { cls: o.cls } : {}), smooth: false, capStart: !full, capEnd: !full });
  return y0 + o.height + o.beam;
}

export interface ArcadeOpts extends PartOpts {
  /** Number of bays along the wall (rules thin it). */
  bays: number;
  pierW: number;
  depth: number;
  /** Pier height below the arch springing. */
  pierH: number;
  /** Arch inner radius = half the clear opening. */
  openingW: number;
  archT: number;
  wallColor?: ColorRef;
}

/** A row of arched bays along the line (x0, z0) -> (x1, z1): piers and semicircular arches, with a spandrel wall above. */
export function arcade(g: Geo, x0: number, y0: number, z0: number, x1: number, z1: number, o: ArcadeOpts): void {
  const bays = g.rules.count(o.bays, 2);
  const dx = x1 - x0, dz = z1 - z0;
  const L = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dz, dx); // local X along the line
  const ux = dx / L, uz = dz / L;
  const pitch = L / bays;
  const clear = Math.min(o.openingW, pitch - o.pierW);
  for (let i = 0; i <= bays; i++) {
    const px = x0 + ux * pitch * i, pz = z0 + uz * pitch * i;
    box(g, px, y0, pz, o.pierW, o.pierH + clear / 2, o.depth, { color: o.color, ...(o.cls ? { cls: o.cls } : {}), yaw });
  }
  for (let i = 0; i < bays; i++) {
    const mx = x0 + ux * pitch * (i + 0.5), mz = z0 + uz * pitch * (i + 0.5);
    if (g.rules.detail >= 1) archRing(g, mx, y0 + o.pierH, mz, clear / 2, o.archT, o.depth, yaw, { color: o.color, ...(o.cls ? { cls: o.cls } : {}) });
    // spandrel above the arch crown, filling the gap between the arch and the next floor line
    box(g, mx, y0 + o.pierH + clear / 2 + o.archT, mz, pitch - o.pierW, 0.001, o.depth, { color: o.wallColor ?? o.color, ...(o.cls ? { cls: o.cls } : {}), yaw });
  }
}

export interface StairOpts extends PartOpts {
  yaw?: number;
}

/** Stairs rising toward local -Z: `steps` treads of width `w`, run `run` and rise `rise` each, starting at (cx, y0, cz). */
export function stairs(g: Geo, cx: number, y0: number, cz: number, w: number, steps: number, run: number, rise: number, o: StairOpts): void {
  const n = g.rules.count(steps, 2);
  const stepRun = (run * steps) / n, stepRise = (rise * steps) / n;
  const yaw = o.yaw ?? 0;
  for (let i = 0; i < n; i++) {
    const [ox, oz] = rotY(0, -(i + 0.5) * stepRun, yaw);
    box(g, cx + ox, y0, cz + oz, w, stepRise * (i + 1), stepRun, { color: o.color, ...(o.cls ? { cls: o.cls } : {}), yaw });
  }
}

/** A raised platform with a low parapet: a terrace. */
export function terrace(g: Geo, cx: number, y0: number, cz: number, w: number, d: number, h: number, parapet: number, o: PartOpts & { yaw?: number }): void {
  box(g, cx, y0, cz, w, h, d, { color: o.color, ...(o.cls ? { cls: o.cls } : {}), yaw: o.yaw ?? 0 });
  if (parapet > 0 && g.rules.detail >= 1) {
    const t = 0.5;
    const yaw = o.yaw ?? 0;
    const edge = (lx: number, lz: number, ew: number, ed: number): void => {
      const [rx, rz] = rotY(lx, lz, yaw);
      box(g, cx + rx, y0 + h, cz + rz, ew, parapet, ed, { color: o.color, ...(o.cls ? { cls: o.cls } : {}), yaw });
    };
    edge(0, -d / 2 + t / 2, w, t);
    edge(0, d / 2 - t / 2, w, t);
    edge(-w / 2 + t / 2, 0, t, d - 2 * t);
    edge(w / 2 - t / 2, 0, t, d - 2 * t);
  }
}

// ---- struts and tubes --------------------------------------------------------------------------------------------------------

/** A straight bar of `sides` sides (3 or 4) between a and b with half-width r. */
export function strut(g: Geo, a: V3, b: V3, r: number, o: PartOpts & { sides?: number }): void {
  tube(g, [a, b], r, o.sides ?? 4, o);
}

/** A bar swept along a polyline, `sides` around (rules do not thin it: the caller chooses). */
export function tube(g: Geo, path: readonly V3[], r: number, sides: number, o: PartOpts & { smooth?: boolean }): void {
  if (path.length < 2) return;
  const rings: V3[][] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i] as V3;
    const a = path[Math.max(0, i - 1)] as V3, b = path[Math.min(path.length - 1, i + 1)] as V3;
    const t = norm(sub(b, a));
    let up: V3 = Math.abs(t[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
    const s = norm(cross(t, up));
    up = norm(cross(s, t));
    const ring: V3[] = [];
    for (let k = 0; k < sides; k++) {
      const ang = (k / sides) * Math.PI * 2 + Math.PI / sides;
      ring.push(add(p, add(mul(s, Math.cos(ang) * r), mul(up, Math.sin(ang) * r))));
    }
    rings.push(ring);
  }
  skin(g, rings, { color: o.color, ...(o.cls ? { cls: o.cls } : {}), smooth: o.smooth ?? false, capStart: true, capEnd: true });
}

/** A vertical pole with a tapering radius. */
export function pole(g: Geo, cx: number, y0: number, cz: number, r0: number, r1: number, h: number, o: PartOpts & { sides?: number }): void {
  const n = o.sides ?? 4;
  skin(g, [ring3(circleRing(cx, cz, r0, r0, n, Math.PI / n), y0), ring3(circleRing(cx, cz, r1, r1, n, Math.PI / n), y0 + h)], { color: o.color, ...(o.cls ? { cls: o.cls } : {}), smooth: false });
}
