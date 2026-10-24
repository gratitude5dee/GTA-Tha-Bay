/**
 * Tiled roofs with lifted corners (M02d2): the gateway and the pagoda share them. A hip roof whose eave corners curl up and whose
 * eave mid-points sag, with a flat soffit; plus a tiered stack of them. Generic architecture: no ridge figures, no inscriptions.
 */
import { resolveColor, scaleRgb, type ColorRef, type MatClass } from './palette.ts';
import { box, rotY, type Geo, type V3 } from './primitives.ts';

export interface EaveOpts {
  color: ColorRef;
  cls?: MatClass;
  /** Eave corners are lifted this much above the eave line (the curl). */
  curl: number;
  /** Ridge length along local X at the top (0 = a point, a pyramid). */
  ridge?: number;
  yaw?: number;
  soffit?: ColorRef;
}

/** A hip roof over a w x d rectangle centred on (cx, cz) with its eave line at y and the top `rise` above it. */
export function tiledRoof(g: Geo, cx: number, y: number, cz: number, w: number, d: number, rise: number, o: EaveOpts): void {
  const yaw = o.yaw ?? 0;
  const c = resolveColor(o.color);
  const cls = o.cls ?? 'matte';
  const P = (lx: number, ly: number, lz: number): V3 => {
    const [rx, rz] = rotY(lx, lz, yaw);
    return [cx + rx, ly, cz + rz];
  };
  const hw = w / 2, hd = d / 2, top = y + rise, rl = (o.ridge ?? 0) / 2;
  const corners: V3[] = [P(-hw, y + o.curl, -hd), P(hw, y + o.curl, -hd), P(hw, y + o.curl, hd), P(-hw, y + o.curl, hd)];
  const mids: V3[] = [P(0, y, -hd), P(hw, y, 0), P(0, y, hd), P(-hw, y, 0)];
  const apex0 = P(-rl, top, 0), apex1 = P(rl, top, 0);
  const sideCol = [c, scaleRgb(c, 0.92), c, scaleRgb(c, 0.85)];
  for (let i = 0; i < 4; i++) {
    const a = corners[i] as V3, b = corners[(i + 1) % 4] as V3, m = mids[i] as V3;
    const out: V3 = [m[0] - cx, 0.6, m[2] - cz];
    // the two long sides meet the ridge ends, the two short ones the apex points
    const ap = rl > 0 ? (i === 0 ? [apex0, apex1] : i === 2 ? [apex0, apex1] : i === 1 ? [apex1] : [apex0]) : [apex0];
    g.poly([a, m, b, ...ap], out, sideCol[i] as V3, cls);
  }
  g.poly(corners, [0, -1, 0], o.soffit ?? scaleRgb(c, 0.55), cls);
}

export interface TierOpts {
  wall: ColorRef;
  roof: ColorRef;
  /** Width of the lowest tier and the factor each tier above it keeps. */
  w: number;
  shrink: number;
  tiers: number;
  tierH: number;
  roofRise: number;
  curl: number;
  overhang: number;
  yaw?: number;
}

/** A tiered tower: boxes with a lifted-corner roof each, narrowing upward. Returns the y of the top roof's apex. */
export function tiers(g: Geo, cx: number, y0: number, cz: number, o: TierOpts): number {
  let y = y0, w = o.w;
  for (let i = 0; i < o.tiers; i++) {
    box(g, cx, y, cz, w, o.tierH, w, { color: o.wall, yaw: o.yaw ?? 0, top: false });
    tiledRoof(g, cx, y + o.tierH, cz, w + 2 * o.overhang, w + 2 * o.overhang, o.roofRise, { color: o.roof, curl: o.curl, ...(o.yaw !== undefined ? { yaw: o.yaw } : {}) });
    y += o.tierH + o.roofRise;
    w *= o.shrink;
  }
  return y;
}
