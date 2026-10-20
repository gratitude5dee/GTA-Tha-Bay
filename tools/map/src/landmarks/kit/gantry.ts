/**
 * Portal gantry crane (M02d2): two legs on a rail gauge, a cross girder, a boom that reaches over the water and a cab. Used by the
 * shipyard and the island quay. Original geometry; no markings.
 */
import type { ColorRef } from './palette.ts';
import { box, strut, rotY, type Geo, type V3 } from './primitives.ts';

export interface GantryOpts {
  /** Gauge between the two legs across the rails, metres. */
  gauge: number;
  /** Height of the girder above the rails. */
  legH: number;
  /** Boom reach beyond the leg line (toward local +X). */
  boom: number;
  /** Boom rise at its tip. */
  boomRise: number;
  /** Length of the back-reach behind the legs (toward local -X). */
  back: number;
  yaw?: number;
  color: ColorRef;
  accent: ColorRef;
}

/** A crane standing at (x, z) on the ground y0 with its boom along local +X turned by `yaw`; legs stand across local Z. */
export function gantryCrane(g: Geo, x: number, y0: number, z: number, o: GantryOpts): void {
  const yaw = o.yaw ?? 0;
  const at = (lx: number, ly: number, lz: number): V3 => {
    const [rx, rz] = rotY(lx, lz, yaw);
    return [x + rx, y0 + ly, z + rz];
  };
  const half = o.gauge / 2;
  // legs: tapering struts with a bogie at the foot, joined by a lower tie
  for (const s of [-1, 1]) {
    strut(g, at(-1.4, 0, s * half), at(-0.8, o.legH, s * half), 0.7, { color: o.color, cls: 'metal' });
    strut(g, at(1.4, 0, s * half), at(0.8, o.legH, s * half), 0.7, { color: o.color, cls: 'metal' });
    box(g, ...flat3(at(0, 0, s * half)), 4.4, 1.2, 1.8, { color: 'darkSteel', cls: 'metal', yaw });
  }
  if (g.rules.detail >= 1) {
    strut(g, at(0, o.legH * 0.18, -half), at(0, o.legH * 0.18, half), 0.45, { color: o.color, cls: 'metal', sides: 3 });
    strut(g, at(-1.2, o.legH * 0.55, -half), at(1.2, o.legH * 0.55, half), 0.35, { color: o.color, cls: 'metal', sides: 3 });
  }
  // the girder across the legs and the boom out over the water, with its back-reach
  box(g, ...flat3(at(0, o.legH, 0)), 3.2, 2.2, o.gauge + 3, { color: o.color, cls: 'metal', yaw });
  strut(g, at(0, o.legH + 1.1, 0), at(o.boom, o.legH + 1.1 + o.boomRise, 0), 0.8, { color: o.accent, cls: 'metal' });
  strut(g, at(0, o.legH + 1.1, 0), at(-o.back, o.legH + 0.6, 0), 0.8, { color: o.accent, cls: 'metal' });
  if (g.rules.detail >= 1) {
    strut(g, at(o.boom * 0.6, o.legH + 1.1 + o.boomRise * 0.6, 0), at(0, o.legH + 9, 0), 0.25, { color: 'darkSteel', cls: 'metal', sides: 3 });
    strut(g, at(0, o.legH + 9, 0), at(o.boom, o.legH + 1.1 + o.boomRise, 0), 0.25, { color: 'darkSteel', cls: 'metal', sides: 3 });
    strut(g, at(0, o.legH + 9, 0), at(-o.back, o.legH + 0.6, 0), 0.25, { color: 'darkSteel', cls: 'metal', sides: 3 });
  }
  // the cab hanging at the boom, and the machinery house at the back
  box(g, ...flat3(at(o.boom * 0.5, o.legH - 2.8 + o.boomRise * 0.5, 0)), 3.2, 3.4, 3.2, { color: 'white', cls: 'metal', yaw });
  box(g, ...flat3(at(-o.back * 0.7, o.legH + 1.3, 0)), 5, 3.6, 4.4, { color: o.accent, cls: 'metal', yaw });
}

const flat3 = (p: V3): [number, number, number] => [p[0], p[1], p[2]];
