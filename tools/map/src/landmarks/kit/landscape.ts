/**
 * Landscape and ground parts shared by the recipes of M02d2: trees and palms, flat ground polygons, sloped rings (bowls, terraces),
 * lamp posts and fences. Built on the primitives; the same conventions (metres, +Y up, -Z north, counter-clockwise front faces).
 */
import type { ColorRef, MatClass } from './palette.ts';
import { box, circleRing, frustum, pole, rectRing, rotY, strut, type Geo, type V2, type V3 } from './primitives.ts';

const cl = (cls?: MatClass): { cls?: MatClass } => (cls ? { cls } : {});

/** A flat polygon on the plane y, facing up (a lawn, a pond, a court). */
export function flat(g: Geo, ring: readonly V2[], y: number, color: ColorRef, cls?: MatClass): void {
  g.poly(ring.map(([x, z]) => [x, y, z] as V3), [0, 1, 0], color, cls ?? 'matte');
}

/** A flat rectangle on the plane y: centre (cx, cz), `w` along local X, `d` along local Z, turned by `yaw`. */
export function flatRect(g: Geo, cx: number, y: number, cz: number, w: number, d: number, color: ColorRef, o: { yaw?: number; cls?: MatClass } = {}): void {
  flat(g, rectRing(cx, cz, w, d, o.yaw ?? 0), y, color, o.cls);
}

/** A flat ellipse on the plane y with `n` corners (thinned by the rules). */
export function flatDisc(g: Geo, cx: number, y: number, cz: number, rx: number, rz: number, n: number, color: ColorRef, cls?: MatClass): void {
  flat(g, circleRing(cx, cz, rx, rz, g.rules.segs(n)), y, color, cls);
}

/**
 * A sloped ring between two ellipses: (rx0, rz0) at height y0 and (rx1, rz1) at height y1, `n` corners; it faces up (a stadium
 * bowl, a terrace, a lawn slope) or, with `down`, down and out. `from`/`to` (radians) draw an arc instead of the full ring.
 */
export function annulus(g: Geo, cx: number, cz: number, rx0: number, rz0: number, y0: number, rx1: number, rz1: number, y1: number, n: number, color: ColorRef, o: { cls?: MatClass; down?: boolean; from?: number; to?: number } = {}): void {
  const segs = g.rules.segs(n);
  const a0 = o.from ?? 0, a1 = o.to ?? Math.PI * 2;
  const full = a1 - a0 >= Math.PI * 2 - 1e-9;
  const count = full ? segs : Math.max(2, Math.round((segs * (a1 - a0)) / (Math.PI * 2)));
  const at = (rx: number, rz: number, y: number, i: number): V3 => {
    const a = a0 + ((a1 - a0) * i) / count;
    return [cx + Math.cos(a) * rx, y, cz + Math.sin(a) * rz];
  };
  for (let i = 0; i < count; i++) {
    g.poly([at(rx0, rz0, y0, i), at(rx0, rz0, y0, i + 1), at(rx1, rz1, y1, i + 1), at(rx1, rz1, y1, i)], [0, o.down ? -1 : 1, 0], color, o.cls ?? 'matte');
  }
}

/** A tree: a trunk and a round or conical crown. `h` is the total height. */
export function tree(g: Geo, x: number, y0: number, z: number, h: number, r: number, o: { crown?: ColorRef; trunk?: ColorRef; cone?: boolean } = {}): void {
  const trunkH = h * (o.cone ? 0.25 : 0.4);
  pole(g, x, y0, z, r * 0.12, r * 0.08, trunkH, { color: o.trunk ?? 'woodDark', sides: 4 });
  if (o.cone) {
    frustum(g, x, y0 + trunkH * 0.7, z, r, 0, h - trunkH * 0.7, 6, { color: o.crown ?? 'hedge', smooth: false, capStart: true });
  } else {
    // an oblate crown: two cones read like a sphere at distance and cost a fraction of one
    frustum(g, x, y0 + trunkH, z, r * 0.55, r, (h - trunkH) * 0.45, 7, { color: o.crown ?? 'hedge', smooth: false });
    frustum(g, x, y0 + trunkH + (h - trunkH) * 0.45, z, r, 0, (h - trunkH) * 0.55, 7, { color: o.crown ?? 'hedge', smooth: false });
  }
}

/** A palm: a slender tapering trunk and a crown of drooping fronds. */
export function palm(g: Geo, x: number, y0: number, z: number, h: number, o: { fronds?: number; reach?: number } = {}): void {
  pole(g, x, y0, z, 0.42, 0.26, h, { color: 'timber', sides: g.rules.detail >= 1 ? 5 : 4 });
  const n = g.rules.count(o.fronds ?? 7, 3);
  const reach = o.reach ?? h * 0.34;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    strut(g, [x, y0 + h, z], [x + Math.cos(a) * reach, y0 + h - reach * 0.42, z + Math.sin(a) * reach], 0.32, { color: 'hedge', sides: 3 });
  }
}

/** A street lamp: a pole with a lamp head (the head takes the glass class). */
export function lampPost(g: Geo, x: number, y0: number, z: number, h: number, o: { color?: ColorRef } = {}): void {
  pole(g, x, y0, z, 0.16, 0.1, h, { color: o.color ?? 'darkSteel', cls: 'metal', sides: 4 });
  box(g, x, y0 + h, z, 0.7, 0.4, 0.7, { color: 'lamp', cls: 'glass' });
}

/** A fence: posts every `step` metres between two points with a top rail and a mid rail; the rules thin the posts. */
export function fence(g: Geo, x0: number, y0: number, z0: number, x1: number, z1: number, h: number, step: number, o: { color?: ColorRef; cls?: MatClass } = {}): void {
  const L = Math.hypot(x1 - x0, z1 - z0);
  const n = g.rules.count(Math.max(1, Math.round(L / step)), 1);
  const color = o.color ?? 'darkSteel';
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pole(g, x0 + (x1 - x0) * t, y0, z0 + (z1 - z0) * t, 0.07, 0.06, h, { color, ...cl(o.cls), sides: 3 });
  }
  strut(g, [x0, y0 + h, z0], [x1, y0 + h, z1], 0.05, { color, ...cl(o.cls), sides: 3 });
  if (g.rules.detail >= 1) strut(g, [x0, y0 + h * 0.5, z0], [x1, y0 + h * 0.5, z1], 0.04, { color, ...cl(o.cls), sides: 3 });
}

/** A point of a local frame turned by `yaw` about (cx, cz). */
export function local(cx: number, cz: number, lx: number, lz: number, yaw: number): V2 {
  const [rx, rz] = rotY(lx, lz, yaw);
  return [cx + rx, cz + rz];
}
