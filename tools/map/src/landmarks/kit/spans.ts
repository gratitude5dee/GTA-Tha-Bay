/**
 * Landmark recipe spans (M02d1): decks, catenary cables with hangers, suspension towers, trusses, piers. Built on the primitives;
 * the same conventions (metres, +Y up, -Z north, counter-clockwise front faces).
 */
import { type ColorRef, type MatClass } from './palette.ts';
import { box, lerp3, norm, skin, strut, taperTower, tube, type Geo, type V3 } from './primitives.ts';

interface Part { color: ColorRef; cls?: MatClass }
const cl = (o: Part): { cls?: MatClass } => (o.cls ? { cls: o.cls } : {});

/** Points along a straight line from a to b, n + 1 of them. */
export function linePath(a: V3, b: V3, n: number): V3[] {
  return Array.from({ length: n + 1 }, (_, i) => lerp3(a, b, i / n));
}

/** A parabolic cable from a to b hanging `sag` metres below the straight line at mid span; n + 1 points. */
export function catenary(a: V3, b: V3, sag: number, n: number): V3[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const p = lerp3(a, b, t);
    return [p[0], p[1] - sag * 4 * t * (1 - t), p[2]] as V3;
  });
}

/** A horizontal unit vector perpendicular to the path tangent at index i (to the left when looking along +path, y up). */
function sideAt(path: readonly V3[], i: number): V3 {
  const a = path[Math.max(0, i - 1)] as V3, b = path[Math.min(path.length - 1, i + 1)] as V3;
  const t = norm([b[0] - a[0], 0, b[2] - a[2]]);
  return [t[2], 0, -t[0]];
}

/** A deck: a box girder of width `w` and depth `thick` whose top surface follows `path`. */
export function slab(g: Geo, path: readonly V3[], w: number, thick: number, o: Part & { capEnds?: boolean }): void {
  const rings = path.map((p, i) => {
    const s = sideAt(path, i);
    const l: V3 = [p[0] + s[0] * (w / 2), p[1], p[2] + s[2] * (w / 2)];
    const r: V3 = [p[0] - s[0] * (w / 2), p[1], p[2] - s[2] * (w / 2)];
    return [l, r, [r[0], r[1] - thick, r[2]], [l[0], l[1] - thick, l[2]]] as V3[];
  });
  skin(g, rings, { color: o.color, ...cl(o), smooth: false, capStart: o.capEnds ?? true, capEnd: o.capEnds ?? true });
}

/** A cable of radius r through `pts`: a tube of `sides` around. */
export function cable(g: Geo, pts: readonly V3[], r: number, sides: number, o: Part): void {
  tube(g, pts, r, sides, { color: o.color, ...cl(o) });
}

/**
 * Hangers between a cable and a deck: one every `every` path points, vertical. `cablePts` and `deckPts` must have the same
 * length; the hanger runs from the cable point straight down to the deck point's height.
 */
export function hangers(g: Geo, cablePts: readonly V3[], deckY: (i: number) => number, every: number, r: number, o: Part): void {
  for (let i = 1; i + 1 < cablePts.length; i += every) {
    const p = cablePts[i] as V3;
    if (p[1] < deckY(i) + 2) continue;
    strut(g, p, [p[0], deckY(i), p[2]], r, { color: o.color, ...cl(o), sides: 3 });
  }
}

export interface TowerOpts extends Part {
  /** Half distance between the two leg axes, measured across the span. */
  halfGap: number;
  legW: number;
  legD: number;
  /** Leg width/depth at the top relative to the base. */
  taper: number;
  /** Heights (0..1 of the tower) of the horizontal portal struts. */
  portals: readonly number[];
  portalH: number;
  yaw?: number;
}

/**
 * A suspension tower of two tapered legs joined by portal struts: centre (cx, cz), base y0, height h. The legs stand across
 * the span: leg offset is along local +Z rotated by `yaw` (the span runs along local X).
 */
export function suspensionTower(g: Geo, cx: number, y0: number, cz: number, h: number, o: TowerOpts): void {
  const yaw = o.yaw ?? 0;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const side of [-1, 1]) {
    const lx = cx + s * o.halfGap * side, lz = cz + c * o.halfGap * side;
    taperTower(g, lx, y0, lz, o.legW, o.legD, o.legW * o.taper, o.legD * o.taper, h, { color: o.color, ...cl(o), yaw, slices: g.rules.detail >= 2 ? 3 : 1, capTint: 0.9 });
  }
  for (const f of o.portals) {
    const y = y0 + h * f;
    const k = 1 - (1 - o.taper) * f;
    box(g, cx, y - o.portalH / 2, cz, o.legW * 0.7 * k, o.portalH, o.halfGap * 2 - o.legD * k, { color: o.color, ...cl(o), yaw, bottom: true });
  }
}

/** A Warren truss between a and b (same height pair), `bays` panels, chord size r: top and bottom chords and diagonals. */
export function truss(g: Geo, a: V3, b: V3, depth: number, bays: number, r: number, o: Part): void {
  const n = g.rules.count(bays, 2);
  const top = (i: number): V3 => lerp3([a[0], a[1] + depth, a[2]], [b[0], b[1] + depth, b[2]], i / n);
  const bot = (i: number): V3 => lerp3(a, b, i / n);
  strut(g, top(0), top(n), r, { color: o.color, ...cl(o) });
  strut(g, bot(0), bot(n), r, { color: o.color, ...cl(o) });
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) strut(g, bot(i), top(i + 1), r * 0.7, { color: o.color, ...cl(o), sides: 3 });
    else strut(g, top(i), bot(i + 1), r * 0.7, { color: o.color, ...cl(o), sides: 3 });
    if (g.rules.detail >= 2) strut(g, bot(i), top(i), r * 0.5, { color: o.color, ...cl(o), sides: 3 });
  }
}

/** A bridge pier: a tapered column from the water or ground up to the deck underside. */
export function pier(g: Geo, cx: number, y0: number, cz: number, w: number, d: number, h: number, o: Part & { yaw?: number }): void {
  taperTower(g, cx, y0, cz, w, d, w * 0.75, d * 0.75, h, { color: o.color, ...cl(o), yaw: o.yaw ?? 0, capTint: 0.9 });
}
