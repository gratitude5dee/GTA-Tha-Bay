/**
 * The furniture materials and their sign faces (M02h6; TSL only, no texture, no font). The faces are signed-distance shapes on the `uv` of
 * the face quads (`kit.ts` `face` ids), original and generic:
 *
 *   stop     a red octagon with a white rim and "STOP" built from bars and arcs
 *   oneway   a black plate with a white arrow
 *   blade    a blank green street-name blade with a white rim (no street name)
 *   busFlag  a white plate with a blue band and a simple bus outline
 *
 * One material per pool and look profile: `MeshStandardNodeMaterial` on the vertex colours (rougher on `min`), receiving the sun's shadows,
 * never casting. The instance's `aKind` keeps its own parts (`kit.ts` `part`) and collapses the others to a point. The signal pool adds the
 * lens emission of `traffic/lights.ts` `signalEmissive` from the instance's `aAspect`.
 */
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { SkyNodes } from '../sky/nodes.ts';
import { abs, asNode, attribute, float, length, max, min, positionLocal, select, uv, vec2, vec3, vertexColor, type L } from '../sky/tsl.ts';
import { signalEmissive } from '../traffic/lights.ts';
import { FACE, type FurniturePoolName, type FurnitureProfile } from './kit.ts';

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex: string): L => {
  const n = parseInt(hex.slice(1), 16);
  return vec3(lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255));
};

/** 1 inside the axis-aligned box centred at (cx, cy) with half sizes (hx, hy), else 0. */
const inBox = (p: L, cx: number, cy: number, hx: number, hy: number): L => abs(p.x.sub(cx)).lessThan(hx).toFloat().mul(abs(p.y.sub(cy)).lessThan(hy).toFloat());
/** 1 on the ring of radius r and half width w around (cx, cy) (scaled by `sx`, `sy`), restricted to `side` (0 all, 1 the right half x > cx). */
const onRing = (p: L, cx: number, cy: number, sx: number, sy: number, r: number, w: number, side = 0): L => {
  const q = vec2(p.x.sub(cx).div(sx), p.y.sub(cy).div(sy));
  const ring = abs(length(q).sub(r)).lessThan(w).toFloat();
  return side === 1 ? ring.mul(p.x.greaterThan(cx).toFloat()) : ring;
};
const union = (...a: L[]): L => a.reduce((x, y) => max(x, y));

/** "STOP" in the octagon's uv (0..1, centre 0.5): four letters about 0.13 wide, 0.2 high, from bars and arcs. */
function stopLetters(p: L): L {
  const t = 0.022, h = 0.1, y = 0.5;
  // S: three bars and two half-height verticals
  const sX = 0.25;
  const S = union(inBox(p, sX, y + h, 0.06, t), inBox(p, sX, y, 0.06, t), inBox(p, sX, y - h, 0.06, t), inBox(p, sX - 0.05, y + h / 2, t, h / 2), inBox(p, sX + 0.05, y - h / 2, t, h / 2));
  // T: the top bar and the stem
  const tX = 0.42;
  const T = union(inBox(p, tX, y + h, 0.065, t), inBox(p, tX, y, t, h));
  // O: a ring
  const O = onRing(p, 0.59, y, 0.62, 1, 0.1, t);
  // P: the stem and a half ring on its upper half
  const pX = 0.73;
  const P = union(inBox(p, pX, y, t, h + t), onRing(p, pX, y + h / 2, 1.1, 1, 0.055, t, 1), inBox(p, pX + 0.02, y + h, 0.02, t), inBox(p, pX + 0.02, y, 0.02, t));
  return union(S, T, O, P);
}

/** The face colour of `face` at `uv` over `base` (the vertex colour) where the vertex has no face. */
export function faceColor(face: L, p: L, base: L): L {
  const white = rgb('#ecebe6');
  // stop: red octagon, white rim and letters (the octagon's own edge is the geometry's)
  const centre = vec2(p.x.sub(0.5), p.y.sub(0.5));
  const octR = max(max(abs(centre.x), abs(centre.y)), abs(centre.x).add(abs(centre.y)).mul(0.7071));
  const stopWhite = max(octR.greaterThan(0.43).toFloat(), stopLetters(p));
  const stop = select(stopWhite.greaterThan(0.5), white, rgb('#b3261e'));
  // one-way: a white arrow pointing right on black
  const shaft = inBox(p, 0.42, 0.5, 0.27, 0.09);
  const headX = p.x.sub(0.69);
  const head = headX.greaterThan(0).toFloat().mul(headX.lessThan(0.17).toFloat()).mul(abs(p.y.sub(0.5)).lessThan(float(0.3).sub(headX.mul(1.75))).toFloat());
  const oneway = select(max(shaft, head).greaterThan(0.5), white, rgb('#151617'));
  // blade: green with a thin white rim
  const rim = min(min(p.x, p.y), min(float(1).sub(p.x), float(1).sub(p.y))).lessThan(0.06).toFloat();
  const blade = select(rim.greaterThan(0.5), white, rgb('#2f6b45'));
  // bus flag: white with a blue band at the top and a bus outline: a rounded body and two wheels
  const band = p.y.greaterThan(0.78).toFloat();
  const body = inBox(p, 0.5, 0.42, 0.3, 0.16);
  const wheel = max(length(vec2(p.x.sub(0.32), p.y.sub(0.24))).lessThan(0.06).toFloat(), length(vec2(p.x.sub(0.68), p.y.sub(0.24))).lessThan(0.06).toFloat());
  const window = inBox(p, 0.5, 0.48, 0.24, 0.05);
  const bus = select(max(band, max(body, wheel)).greaterThan(0.5), select(window.greaterThan(0.5), white, rgb('#2c4f8a')), white);
  const is = (id: number): L => abs(face.sub(id)).lessThan(0.5).toFloat();
  return select(is(FACE.stop).greaterThan(0.5), stop, select(is(FACE.oneway).greaterThan(0.5), oneway, select(is(FACE.blade).greaterThan(0.5), blade, select(is(FACE.busFlag).greaterThan(0.5), bus, base))));
}

export interface FurnitureMaterialOptions {
  pool: FurniturePoolName;
  profile: FurnitureProfile;
  sky: SkyNodes;
}

/** The material of one furniture pool. */
export function createFurnitureMaterial(o: FurnitureMaterialOptions): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: o.profile === 'min' ? 0.9 : 0.7, metalness: 0 });
  // the instance keeps its own parts; the other kinds' parts collapse to the item's foot
  const keep = abs(attribute('part', 'float').sub(attribute('aKind', 'float'))).lessThan(0.5).toFloat();
  m.positionNode = asNode(positionLocal.mul(keep));
  const base = vertexColor(0);
  const hasFaces = o.pool === 'post' || o.pool === 'shelter';
  m.colorNode = asNode(hasFaces ? faceColor(attribute('face', 'float'), uv(), base) : base);
  if (o.pool === 'signal') m.emissiveNode = signalEmissive(o.sky, attribute('aAspect', 'float'), attribute('lamp', 'float'));
  if (o.pool === 'wire') m.roughness = 0.5;
  return m;
}
