/**
 * Walls (M02e; TSL only): the procedural façade of a building class. A floor index from the wall height (`floor(v / floorM)`), a bay
 * from the position along the wall (`fract(u / bayM)`, the wall stretched to a whole number of bays by the mesher, +-12 % window
 * width per bay from the seed), window cells by `winW`, `winH` and `sillM`, a taller ground-floor band with shop glass on Commercial,
 * Tower and Civic, a roof band without windows, a curtain wall with mullions on Tower, few large openings on Industrial.
 *
 * Wall albedo is the class palette crossed with the bake's palette index; roughness is per class. Glass is dark and low roughness and
 * reflects the environment on `full` (metallic, so the sky map is its colour), and takes a Fresnel tint toward the sky's bottom colour
 * on `lite`. At night the per-building on/off decision and the blackout stay M02b2's rule (`buildingLit`, called not copied); inside a
 * lit building a per-window hash keeps a share of the cells lit (by the hour since M02g1, `look/windows.ts`), and the glow is emissive HDR
 * so bloom picks it up. Where no environment map exists the glass carries the analytic sky reflection (`look/sky-reflect.ts`).
 *
 * The `min` profile (`mobile-low`) keeps the vertex colour by day and uses only the window grid, as the night emissive mask.
 *
 * M02h7 (the facade kit, `chunks/facade-kit.ts`): a wall flagged `FLAG_SHOP` draws a storefront on its ground floor (kick plate, M02e's
 * shop glass, a transom, a plain sign panel of one palette-hash colour between pilasters; no text, glyph or logo); signs and shop glass
 * glow at night by `windows.shop` (`uShopGlow`). On `full` the window reveal is a bump of an analytic height (`look/noise.ts`
 * `bumpNormal`, the dFdx/dFdy form of three's `bumpMap`, which samples only texture nodes), faded with `detailK`; a wall top without
 * cornice geometry tilts its normal up and takes a lighter tone. The glass reflects `skyReflect` along the bumped normal wherever no
 * environment map carries the reflection. `min` adds flat bands only (shopfront, awning stripe, sign, night glow). `albedo` is the seam
 * of the wall albedo (M10d2's façade atlas, M10d0's brick and stucco): never applied to glass, trim, sign, awning or emissive.
 */
import type { Texture } from 'three/webgpu';
import { buildingLit, windowThreshold } from '../sky/night.ts';
import { cameraViewMatrix, reflect, transformDirection } from 'three/tsl';
import { clamp, dot, float, floor, fract, max, min, mix, mod, normalView, normalize, positionViewDirection, positionWorld, pow, select, smoothstep, step, vec2, vec3, vec4, type L } from '../sky/tsl.ts';
import type { LookNodes } from './common.ts';
import { fresnel, skyReflect } from './sky-reflect.ts';
import { FACADE_KEYS, srgbHexToLinear, type LookFile } from './config.ts';
import { around1, bumpNormal, hash11, hash21, pickColor, pickFloat, pixelFootprint, vnoise } from './noise.ts';

/** Per-class design values that are not worth a config key: the trim width around a window, metres, in `BuildingKind` order. */
const TRIM_M = [0.18, 0.12, 0.1, 0, 0.05, 0.2] as const;
/** 1 where the ground floor is shop glass (Commercial, Tower, Civic). */
const SHOP = [0, 0, 1, 1, 0, 1] as const;
/** The window frame width inside the glass, metres. */
const FRAME_M = 0.07;

export type WallProfile = 'full' | 'lite' | 'min';

export interface WallInput {
  profile: WallProfile;
  look: LookFile;
  n: LookNodes;
  /** From the surf attribute. */
  kind: L;
  pal: L;
  flags: L;
  /** From the facade attribute (metres; seed 0..1). */
  fac: { u: L; v: L; top: L; seed: L };
  foundationM: number;
  parapetM: number;
  /**
   * M02h7: the seam of the wall albedo (M10d2's façade atlas, M10d0's brick and stucco through `look-materials.ts`), applied once to the
   * wall colour on `full` and `lite` and never on `min`; never to awning, sign, glass, trim or emissive. Absent: the graph is unchanged.
   */
  albedo?: ((base: L) => L) | undefined;
}

export interface WallOut {
  color: L;
  roughness: L;
  metalness: L;
  emissive: L;
  /** 1 inside a window pane (not the frame). */
  glass: L;
  /** M02h7, `full`: the view-space normal with the window reveal bump and the wall-top tilt; absent on `lite` and `min`. */
  normal?: L;
  /** M02h7, `min`: the flat bands (shopfront, awning stripe, sign) as a colour and its weight over the vertex colour. */
  band?: { color: L; k: L };
}

/** M02h7: the bits of `surf.w` (look/surfaces.ts): bit 1 shop front, bit 3 cornice geometry (the highest bit the mesher sets). */
export const flagBit = (flags: L, bit: 1 | 2 | 3): L => mod(floor(flags.div(1 << bit)), 2);

/** The hook M10d2's `chunks/facade.ts` fills on the desktop tiers; unused by this milestone's shaders. */
export interface FacadeAtlasHook {
  set(texture: Texture | null): void;
  get(): Texture | null;
}

export function createFacadeAtlasHook(): FacadeAtlasHook {
  let atlas: Texture | null = null;
  return { set: (t) => void (atlas = t), get: () => atlas };
}

/** `pickFloat` over the six classes of a facade property. */
const perClass = (kind: L, look: LookFile, f: (c: LookFile['facade'][(typeof FACADE_KEYS)[number]]) => number): L =>
  pickFloat(kind, FACADE_KEYS.map((k) => f(look.facade[k])));

export function wallNodes(i: WallInput): WallOut {
  const { look, n, kind, fac } = i;
  const floorM = perClass(kind, look, (c) => c.floorM);
  const gfM = perClass(kind, look, (c) => c.groundFloorM);
  const bayM = perClass(kind, look, (c) => c.bayM);
  const winW = perClass(kind, look, (c) => c.winW);
  const winH = perClass(kind, look, (c) => c.winH);
  const sillM = perClass(kind, look, (c) => c.sillM);
  const wallRough = perClass(kind, look, (c) => c.wallRoughness);
  const shop = pickFloat(kind, SHOP);
  const trimW = pickFloat(kind, TRIM_M);
  const isTower = step(2.5, kind).mul(step(kind, 3.5));

  // The pixel footprint in metres: the edges below are smoothed over it and the fine detail fades out when a pixel covers a cell.
  const fp = pixelFootprint(positionWorld).max(0.002);
  const detailK = float(1).sub(smoothstep(0.04, 0.22, fp));

  const v = fac.v.sub(i.foundationM);
  const seedI = fac.seed.mul(32767).round();
  const parapet = mod(i.flags, 2);
  // M02h7: the kit's flags, gated by the `facade` layer
  const kit = look.facadeKit;
  const shopF = flagBit(i.flags, 1).mul(n.uFacade);
  const corniceF = flagBit(i.flags, 3);
  const signTop = gfM.sub(kit.signTopBelowGfM);
  const signBot = gfM.sub(kit.signBottomBelowGfM);
  const transom = gfM.sub(kit.transomBelowGfM);

  // Floors: the ground floor has its own height, the upper ones repeat.
  const isGround = select(v.lessThan(gfM), float(1), float(0));
  const upperV = v.sub(gfM);
  const floorIdx = select(isGround.greaterThan(0.5), float(0), upperV.div(floorM).floor().add(1));
  const fv = select(isGround.greaterThan(0.5), v, mod(upperV, floorM));

  // Bays: the mesher stretched the wall to a whole number of bays, so a wall starts and ends on a pier.
  const bay = fac.u.div(bayM);
  const bayIdx = bay.floor();
  const bf = fract(bay);
  const jx = hash21(vec2(bayIdx.add(seedI.mul(0.013)), floorIdx.mul(0.91).add(seedI.mul(0.007))));

  const shopGf = isGround.mul(max(shop, shopF));
  const storeGf = isGround.mul(shopF);
  // a storefront's pane runs from pilaster to pilaster
  const wide = mix(bayM.mul(0.43), bayM.mul(0.5).sub(kit.pilasterM), storeGf);
  const normalHalf = min(winW.mul(jx.mul(0.24).add(0.88)).mul(0.5), bayM.mul(0.46));
  const halfW = mix(normalHalf, wide, shopGf);
  const dx = bf.sub(0.5).abs().mul(bayM);
  const y0 = mix(sillM, float(kit.kickM), shopGf);
  // M02h7: a storefront's shop glass stops at the transom bar, the sign panel above it
  const y1 = mix(sillM.add(winH), mix(gfM.sub(0.5), transom, storeGf), shopGf);
  const roofBand = mix(float(0.8), float(1.1), parapet);
  const belowBand = float(1).sub(smoothstep(fp.negate(), fp, v.sub(fac.top.sub(roofBand))));

  const ex = halfW.sub(dx);
  const ey = min(fv.sub(y0), y1.sub(fv));
  const edge = min(ex, ey);
  // Smooth over one pixel; at the coarsest the frame (7 cm) is wider than a pixel only up close.
  const inside = smoothstep(fp.negate(), fp, edge).mul(belowBand);
  const frame0 = inside.mul(float(1).sub(smoothstep(float(FRAME_M).sub(fp), float(FRAME_M).add(fp), edge)));
  // M02h7: the transom light of a storefront, from the transom bar to under the sign panel
  const band = (lo: L, hi: L, x: L): L => smoothstep(lo.sub(fp), lo.add(fp), x).mul(float(1).sub(smoothstep(hi.sub(fp), hi.add(fp), x)));
  const transomPane = storeGf.mul(band(transom.add(0.08), signBot.sub(0.1), fv)).mul(smoothstep(fp.negate(), fp, halfW.sub(dx).sub(FRAME_M)));
  const frame = max(frame0, storeGf.mul(band(transom, transom.add(0.08), fv)).mul(smoothstep(fp.negate(), fp, halfW.sub(dx))));
  const pane = max(inside.mul(float(1).sub(frame0)), transomPane).mul(float(1).sub(frame.mul(float(1).sub(inside))));

  // Night: the building's rule, then the window's own hash.
  const lit = buildingLit(n.sky, windowThreshold(hash11(seedI)));
  // M02g1: the share of lit windows follows the hour (`look.json` windows.litFrac, written to the uniforms by the look); 55 to 85 % fixed before.
  const litFrac = mix(n.uLitMin, n.uLitMax, hash11(seedI.mul(1.37)));
  const cellH = hash21(vec2(bayIdx.mul(1.713).add(seedI.mul(0.19)), floorIdx.mul(2.37).add(seedI.mul(0.31))));
  const winOn = step(float(1).sub(litFrac), cellH);
  const tint = hash21(vec2(bayIdx.mul(0.77).add(seedI.mul(0.43)), floorIdx.mul(1.91)));
  const warm = mix(vec3(1.0, 0.72, 0.4), vec3(1.0, 0.9, 0.72), tint);
  const cool = mix(warm, vec3(0.62, 0.74, 1.0), max(step(0.93, tint), isTower.mul(0.8)));
  // The window recess: the glass is darker toward its top and sides.
  const recess = float(1).sub(float(0.5).mul(float(1).sub(smoothstep(0, 0.4, y1.sub(fv))))).mul(float(1).sub(float(0.25).mul(float(1).sub(smoothstep(0, 0.3, ex)))));
  const glowAt = float(2.1);
  const litFar = clamp(winW.mul(winH).div(bayM.mul(floorM)).mul(1.1), 0, 0.85);
  const farGlow = smoothstep(bayM.mul(0.18), bayM.mul(0.7), fp);
  // Far away a pixel covers many windows: the share of them that is lit, so the night facades do not crawl with single windows.
  const emissive = mix(
    cool.mul(pane).mul(winOn).mul(float(0.6).add(recess.mul(0.4))),
    mix(warm, vec3(0.62, 0.74, 1.0), isTower.mul(0.8)).mul(litFar).mul(litFrac).mul(belowBand),
    farGlow,
  ).mul(lit).mul(glowAt);
  // M02h7: the sign panel of a storefront between its pilasters, and its colour (one per wall by seed, from the sign palette)
  const pilaster = storeGf.mul(smoothstep(bayM.mul(0.5).sub(kit.pilasterM).sub(fp), bayM.mul(0.5).sub(kit.pilasterM).add(fp), dx));
  const sign = storeGf.mul(band(signBot, signTop, fv)).mul(float(1).sub(pilaster));
  const signCol = pickColor(hash11(seedI.mul(0.613)).mul(kit.signPalette.length).floor(), kit.signPalette.map(srgbHexToLinear));
  // M02h7: shop signs and shop glass glow in the evening (`windows.shop`), off by day
  const shopGlow = n.uShopGlow.mul(storeGf);
  const kitGlow = signCol.mul(vec3(...kit.signGlow)).mul(sign).mul(1.6).add(vec3(...kit.shopGlow).mul(pane).mul(0.9)).mul(shopGlow);

  // M02h7, `full`: the window reveal as a bump of the analytic height (faded by detailK), and the wall top tilted up where no cornice ring is
  let nrm: L | undefined;
  if (i.profile === 'full') {
    const reveal = inside.mul(kit.recessM).negate().mul(detailK).mul(n.uFacade);
    const topBand = band(fac.top.sub(roofBand).sub(0.4), fac.top.sub(roofBand), v).mul(float(1).sub(corniceF)).mul(float(1).sub(isTower)).mul(n.uFacade);
    const upView = normalize((cameraViewMatrix as unknown as L).mul(vec4(0, 1, 0, 0)).xyz);
    nrm = normalize(mix(bumpNormal(reveal, float(1), normalView), upView, topBand.mul(kit.corniceTilt)));
  }
  // The sky in the glass where no environment map carries it (the layer weight is 0 otherwise); fades out with the far average. M02h7: along
  // the bumped normal, through `skyReflect`.
  const nv = nrm ?? normalView;
  const R = (transformDirection as unknown as (d: L, m: L) => L)((reflect as unknown as (a: L, b: L) => L)(positionViewDirection.negate(), nv), cameraViewMatrix as unknown as L);
  const ndv = clamp(dot(nv, positionViewDirection), 0, 1);
  const glassSky = pane.mul(skyReflect(n.sky, R).mul(fresnel(0.06, ndv)).mul(0.9).mul(n.sky.look.reflect.weight as unknown as L)).mul(float(1).sub(farGlow));
  const emissiveOut = emissive.add(glassSky).add(kitGlow);

  if (i.profile === 'min') {
    // M02h7: bands only, from `facade.v` and the shop flag (or the class's shop rule where the mesher sets no flags): shopfront, awning
    // stripe and sign by day, the sign and the shop glass glowing at night
    const shopMin = isGround.mul(max(shop.mul(float(1).sub(isTower)), shopF)).mul(n.uFacade);
    const glassB = step(kit.kickM, v).mul(step(v, transom));
    const awnB = step(transom, v).mul(step(v, signBot));
    const signB = step(signBot, v).mul(step(v, signTop));
    const awnCol = srgbHexToLinear(kit.awningPalette[0] as string);
    const bandColor = mix(mix(vec3(0.03, 0.035, 0.04), vec3(...awnCol), awnB), signCol, signB);
    const k = shopMin.mul(glassB.add(awnB).add(signB));
    const minGlow = signCol.mul(signB).add(vec3(...kit.shopGlow).mul(glassB).mul(0.5)).mul(shopMin).mul(n.uShopGlow);
    return { color: vec3(1, 1, 1), roughness: wallRough, metalness: float(0), emissive: emissive.add(glassSky).add(minGlow), glass: pane, band: { color: bandColor, k } };
  }

  // ---- albedo -----------------------------------------------------------------------------------------------------------
  const wallPal = pickColorByClass(kind, i.pal, i.look);
  const perBuilding = hash11(seedI.mul(0.77)).mul(0.16).add(0.92);
  const k0 = step(kind, 0.5);
  const k1 = step(0.5, kind).mul(step(kind, 1.5));
  const k2 = step(1.5, kind).mul(step(kind, 2.5));
  const k4 = step(3.5, kind).mul(step(kind, 4.5));
  const k5 = step(4.5, kind);
  const notTower = float(1).sub(isTower);

  let d: L = float(1);
  // Lap siding on the houses, ribs on the sheds, coursing on the stone, belts between floors, a lighter cornice, a darker plinth.
  d = d.sub(k0.mul(0.1).mul(detailK).mul(smoothstep(0.72, 1.0, fract(v.div(0.17)))));
  d = d.sub(k4.mul(0.13).mul(detailK).mul(float(1).sub(smoothstep(0, 0.16, fract(fac.u.div(0.25)).sub(0.5).abs()))));
  d = d.sub(k5.mul(0.08).mul(detailK).mul(float(1).sub(smoothstep(0, 0.025, fract(v.div(0.55))))));
  const belt = smoothstep(floorM.sub(0.3).sub(fp), floorM.sub(0.3).add(fp), fv).mul(float(1).sub(isGround));
  d = d.add(k1.add(k2).mul(0.1).mul(belt));
  d = d.add(notTower.mul(0.12).mul(smoothstep(fac.top.sub(roofBand).sub(fp), fac.top.sub(roofBand).add(fp), v)));
  d = d.sub(shop.mul(0.16).mul(float(1).sub(smoothstep(float(0.6).sub(fp), float(0.6).add(fp), v))));
  // Pilasters between the bays of the shop fronts and the stone.
  d = d.add(k2.add(k5).mul(0.07).mul(smoothstep(bayM.mul(0.5).sub(0.28).sub(fp), bayM.mul(0.5).sub(0.28).add(fp), dx)));

  // Weathering: dirt at the foot, vertical streaks, a slow tonal drift across the wall.
  const base = float(1).sub(smoothstep(0, 5, v));
  const nA = i.profile === 'full' ? vnoise(vec2(fac.u.mul(1.3).add(seedI), v.mul(0.5))) : float(0.5);
  const streak = vnoise(vec2(fac.u.mul(3.1).add(seedI.mul(0.37)), v.mul(0.12)));
  d = d.mul(float(1).sub(base.mul(0.3).mul(nA.mul(0.6).add(0.4))));
  d = d.mul(float(1).sub(smoothstep(0.55, 0.92, streak).mul(0.1).mul(detailK)));
  d = d.mul(around1(vnoise(vec2(fac.u.mul(0.21).add(seedI.mul(0.9)), v.mul(0.17))), 0.07));

  // M02h7: the wall top without cornice geometry takes a lighter tone (the tilt is on `full`)
  d = d.add(notTower.mul(0.08).mul(float(1).sub(corniceF)).mul(n.uFacade).mul(band(fac.top.sub(roofBand).sub(0.4), fac.top.sub(roofBand), v)));
  const wallBase = wallPal.mul(perBuilding).mul(d);
  // M02h7: the albedo seam (the atlas, brick and stucco) on the wall colour alone
  const wall = i.albedo ? i.albedo(wallBase) : wallBase;
  // Trim around the windows (pale on the houses and the stone), a sill under each.
  const ox = dx.sub(halfW);
  const oy = max(y0.sub(fv), fv.sub(y1));
  const od = max(ox, oy);
  const trim = smoothstep(fp.negate(), fp, od).mul(float(1).sub(smoothstep(trimW.sub(fp), trimW.add(fp), od))).mul(belowBand).mul(step(0.0001, trimW));
  const trimCol = mix(wallBase, vec3(0.78, 0.76, 0.7), 0.7);
  const sill = smoothstep(y0.sub(0.1).sub(fp), y0.sub(0.1).add(fp), fv).mul(float(1).sub(smoothstep(y0.sub(fp), y0.add(fp), fv))).mul(float(1).sub(smoothstep(halfW.add(0.1).sub(fp), halfW.add(0.1).add(fp), dx))).mul(belowBand);

  // ---- glass ------------------------------------------------------------------------------------------------------------
  const jv = hash21(vec2(bayIdx.mul(1.37).add(seedI.mul(0.11)), floorIdx.mul(0.53)));
  const dark = mix(vec3(0.012, 0.02, 0.03), vec3(0.034, 0.05, 0.068), jv);
  const glassBase = mix(dark, wallPal.mul(0.4), isTower.mul(0.7));
  let glassColor: L = glassBase.mul(recess);
  let glassRough: L = float(0.07).add(jv.mul(0.08));
  let glassMetal: L = float(0.88);
  if (i.profile === 'lite') {
    const f = pow(float(1).sub(clamp(dot(normalView, positionViewDirection), 0, 1)), 3);
    glassColor = mix(glassBase, n.sky.uSkyBottom.mul(0.55), float(0.22).add(f.mul(0.6))).mul(recess);
    glassRough = float(0.18);
    glassMetal = float(0);
  }

  let color: L = wall;
  color = mix(color, wallBase.mul(1.3), sill);
  color = mix(color, trimCol, trim);
  // M02h7: the storefront: pilasters a little lighter, the sign panel, the kick plate
  color = mix(color, wallBase.mul(1.12), pilaster.mul(isGround));
  color = mix(color, signCol, sign);
  color = mix(color, vec3(0.06, 0.06, 0.065), storeGf.mul(float(1).sub(step(kit.kickM, fv))).mul(float(1).sub(pilaster)));
  color = mix(color, vec3(0.04, 0.04, 0.045), frame);
  color = mix(color, glassColor, pane);
  // Far away a pixel covers many windows: the cell's average colour, so the facade does not shimmer.
  const cover = clamp(winW.mul(winH).div(bayM.mul(floorM)).mul(1.1), 0, 0.85);
  const average = mix(wall, glassColor, cover);
  const farK = smoothstep(bayM.mul(0.18), bayM.mul(0.7), fp);
  color = mix(color, average, farK);
  const roughness = mix(mix(mix(wallRough, float(0.4), frame), glassRough, pane), mix(wallRough, glassRough, cover.mul(0.6)), farK);
  // Metal is its reflection: with no environment map (dome sky, night) a metallic pane is black, and far away the pane is an average.
  const metalness = pane.mul(glassMetal).mul(clamp(n.uEnv.mul(2), 0, 1)).mul(float(1).sub(farK));
  return { color, roughness, metalness, emissive: emissiveOut, glass: pane, ...(nrm ? { normal: nrm } : {}) };
}

/** M02h7: the awning cloth (`Surf.Awning`): the vertex colour (the awning palette) with stripes by seed along the wall, roughness `awningRoughness`, wet in the rain. */
export function awningNodes(look: LookFile, n: LookNodes, vc: L, fac: { u: L; seed: L }): { color: L; roughness: L } {
  const kit = look.facadeKit;
  const seedI = fac.seed.mul(32767).round();
  const striped = step(0.45, hash11(seedI.mul(1.91)));
  const fp = pixelFootprint(positionWorld).max(0.002);
  const stripe = smoothstep(0.5 - 0.02, 0.5 + 0.02, fract(fac.u.div(0.5))).mul(striped).mul(float(1).sub(smoothstep(0.08, 0.3, fp)));
  const color = mix(vc, vec3(...srgbHexToLinear(kit.awningStripe)), stripe.mul(0.85)).mul(float(1).sub(n.sky.uWet.mul(0.2)));
  const roughness = mix(float(kit.awningRoughness), float(0.45), n.sky.uWet.mul(n.sky.uWetRough));
  return { color, roughness };
}

/** The wall colour of a class: the class palette indexed by the bake palette index. */
function pickColorByClass(kind: L, pal: L, look: LookFile): L {
  const colors = FACADE_KEYS.map((k) => {
    const palette = look.facade[k].palette.map(srgbHexToLinear);
    return pickColor(mod(pal, palette.length), palette);
  });
  let out: L = colors[colors.length - 1] as L;
  for (let k = colors.length - 2; k >= 0; k--) out = select(kind.lessThan(k + 0.5), colors[k] as L, out);
  return out;
}
