/**
 * Facade detail for the landmark recipes (M02d1): window strips and pitched roofs. Part of the kit with `primitives.ts`.
 */
import { resolveColor, scaleRgb, type MatClass } from './palette.ts';
import { box, type Geo, type PartOpts, type V3 } from './primitives.ts';

export type Side = 'x+' | 'x-' | 'z+' | 'z-';

export interface BandOpts extends PartOpts {
  sides?: readonly Side[];
  /** Fraction of the facade length the strip covers (default 0.86). */
  frac?: number;
  /** Strip height as a fraction of the floor height (default 0.45). */
  height?: number;
  /** How far the strip stands off the wall (default 0.35). */
  proud?: number;
}

/**
 * Window strips: one thin box per floor and facade of the block (cx, cz, w along X, d along Z) from y0 up `floors` floors of
 * height `floorH`. The strips take the glass class, so they fall into the matte class at `lo` (a dark band on the wall). The
 * rules thin the floors at `mid` and `lo`.
 */
export function windowBands(g: Geo, cx: number, y0: number, cz: number, w: number, d: number, floors: number, floorH: number, o: BandOpts): void {
  const sides = o.sides ?? ['x+', 'x-', 'z+', 'z-'];
  const frac = o.frac ?? 0.86;
  const hh = floorH * (o.height ?? 0.45);
  const proud = o.proud ?? 0.35;
  const cls: MatClass = o.cls ?? 'glass';
  const n = g.rules.count(floors);
  const stride = floors / n;
  for (let k = 0; k < n; k++) {
    const fl = Math.min(floors - 1, Math.floor(k * stride));
    const y = y0 + fl * floorH + floorH * 0.28;
    for (const s of sides) {
      const alongX = s === 'z+' || s === 'z-';
      const len = (alongX ? w : d) * frac;
      const off = (alongX ? d : w) / 2 + proud / 2 - 0.05;
      const sx = s === 'x+' ? 1 : s === 'x-' ? -1 : 0, sz = s === 'z+' ? 1 : s === 'z-' ? -1 : 0;
      box(g, cx + sx * off, y, cz + sz * off, alongX ? len : proud, hh, alongX ? proud : len, { color: o.color, cls, top: false });
    }
  }
}

/** A gable or hip roof over a rectangle: ridge along local X (`ridgeAlongX`) or Z; `inset` > 0 pulls the ridge ends in (hip). */
export function roof(g: Geo, cx: number, y: number, cz: number, w: number, d: number, rise: number, o: PartOpts & { ridgeAlongX?: boolean; inset?: number; overhang?: number }): void {
  const oh = o.overhang ?? 0;
  const hw = w / 2 + oh, hd = d / 2 + oh;
  const c = resolveColor(o.color);
  const cls = o.cls ?? 'matte';
  const alongX = o.ridgeAlongX ?? w >= d;
  const inset = o.inset ?? 0;
  const a: V3 = [cx - hw, y, cz - hd], b: V3 = [cx + hw, y, cz - hd], cc: V3 = [cx + hw, y, cz + hd], dd: V3 = [cx - hw, y, cz + hd];
  const top = y + rise;
  if (alongX) {
    const r0: V3 = [cx - hw + inset, top, cz], r1: V3 = [cx + hw - inset, top, cz];
    g.poly([a, b, r1, r0], [0, 1, -1], c, cls);
    g.poly([cc, dd, r0, r1], [0, 1, 1], scaleRgb(c, 0.9), cls);
    g.poly([dd, a, r0], [-1, 0.4, 0], scaleRgb(c, 0.8), cls);
    g.poly([b, cc, r1], [1, 0.4, 0], scaleRgb(c, 0.8), cls);
  } else {
    const r0: V3 = [cx, top, cz - hd + inset], r1: V3 = [cx, top, cz + hd - inset];
    g.poly([a, dd, r1, r0], [-1, 1, 0], c, cls);
    g.poly([cc, b, r0, r1], [1, 1, 0], scaleRgb(c, 0.9), cls);
    g.poly([a, b, r0], [0, 0.4, -1], scaleRgb(c, 0.8), cls);
    g.poly([cc, dd, r1], [0, 0.4, 1], scaleRgb(c, 0.8), cls);
  }
}
