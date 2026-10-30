/**
 * The street paint (M02h1; TSL only). Lane lines, edge lines, parking Ts, the bus tint, crosswalks and stop bars are computed in the
 * fragment shader of the L0 `roads` material from the per-vertex `road` attribute (`look/road-layout.ts` says what it holds); the
 * rules are the ones of `markingAt` in road-layout.ts, which the unit tests check against the mesher's data.
 *
 * Every pattern is the exact box filter of its ideal shape over the pixel footprint of its own coordinate (`fwidth` of the distance across a
 * line, of the distance along a dash): a line wider than a pixel keeps its edges, a line narrower than the footprint spreads its paint
 * over the footprint and keeps its mean, never going to 0. That blend is the distance fade, and it is what keeps the paint from
 * sparkling at a graze. The debug toggle `uMarkAA` swaps the filter for a hard step to show what the fade removes.
 *
 * Modes: `worn` (full, lite) breaks the paint up with value noise and gives it its own roughness; `flat` (min, XR) is the colour alone.
 */
import {
  attribute, cameraPosition, clamp, float, floor, fwidth, max, min, mix, mod, positionWorld, select, smoothstep, step, varying, vec2, vec3, type L,
} from '../sky/tsl.ts';
import type { LookNodes } from './common.ts';
import { srgbHexToLinear, type MarkingsFile } from './config.ts';
import { pickFloat, pixelFootprint, vnoiseAA } from './noise.ts';
import { ROAD_SCALE } from './road-layout.ts';
import { Surf } from './surfaces.ts';

export type MarkingsMode = 'worn' | 'flat';

/** The `road` attribute decoded: `s` and `t` in metres (smooth), `z` and `w` the packed integers (flat across a triangle). */
export function roadNodes(): { s: L; t: L; z: L; w: L } {
  const raw = attribute('road', 'vec4');
  const flat = varying(raw.mul(ROAD_SCALE).round()).setInterpolation('flat', null);
  return { s: raw.x.mul(ROAD_SCALE / 10), t: raw.y.mul(ROAD_SCALE / 100), z: flat.z, w: flat.w };
}

/** `floor(x / d) mod 2` of a flat integer (a bit of the packed `w`). */
const bit = (w: L, k: number): L => mod(floor(w.div(2 ** k)), 2);

/**
 * The share (0..1) of a pixel footprint `fp` wide, centred at signed distance `d` from the middle of an isolated line of half width `hw`,
 * that the line covers: the line filtered by a box of the footprint. Inside a wide line it is 1, across an edge it ramps over `fp`, and a line
 * narrower than `fp` keeps its paint (`2 hw / fp` at the peak) spread over `fp`.
 */
export function paintAA(d: L, hw: L | number, fp: L): L {
  const f = fp.max(1e-4);
  const h = float(hw as never);
  const lo = max(d.sub(f.mul(0.5)), h.negate());
  const hi = min(d.add(f.mul(0.5)), h);
  return clamp(max(hi.sub(lo), 0).div(f), 0, 1);
}

/** The hard form of `paintAA` (1 inside the line, 0 outside), for the debug toggle that shows the sparkle. */
export const paintHard = (d: L, hw: L | number): L => step(d.abs(), float(hw as never));

/**
 * Coverage of a periodic line: in each `period` the paint occupies `[from, from + width]`. The exact box filter over `fp` of the square
 * wave, so a dash 3 m long every 12 m reads 0.25 once a pixel covers a period.
 */
export const periodicAA = (x: L, period: number, from: number | L, width: number | L, fp: L): L => {
  const f = fp.max(1e-4);
  const integral = (v: L): L => floor(v.div(period)).mul(float(width as never)).add(clamp(mod(v, period).sub(float(from as never)), 0, float(width as never)));
  return clamp(integral(x.add(f.mul(0.5))).sub(integral(x.sub(f.mul(0.5)))).div(f), 0, 1);
};

export const periodicHard = (x: L, period: number, from: number | L, width: number | L): L => {
  const m = mod(x, period).sub(float(from as never));
  return step(0, m).mul(step(m, float(width as never)));
};

export interface PaintInput {
  look: MarkingsFile;
  nodes: LookNodes;
  mode: MarkingsMode;
  /** The surface id node (flat across a triangle). */
  id: L;
  /** The colour (linear) and roughness of the asphalt under the paint. */
  color: L;
  roughness: L;
}

export interface PaintOutput {
  color: L;
  roughness: L;
  /** 0..1, the share of the pixel that is paint (the layer switch and the distance fade included). */
  coverage: L;
}

/** The paint over the asphalt of the L0 roads: `color` and `roughness` come back with the lines, crosswalks and stop bars on them. */
export function paintNodes(i: PaintInput): PaintOutput {
  const m = i.look;
  const { s, t, z, w } = roadNodes();
  const aa = i.nodes.uMarkAA.greaterThan(0.5);
  const hw = m.lineM / 2;

  // the footprints of the coordinates the patterns are drawn in (derivatives at the top level of the shader, never inside a branch)
  const fpT = fwidth(t);
  const fpS = fwidth(s);
  const fpW = pixelFootprint(positionWorld).max(0.002);
  const line = (d: L, half: number | L): L => select(aa, paintAA(d, half, fpT), paintHard(d, half));
  const along = (x: L, period: number, from: number | L, width: number | L): L => select(aa, periodicAA(x, period, from, width, fpS), periodicHard(x, period, from, width));

  // ---- the lane layout of the vertex's segment -------------------------------------------------------------------------------
  const laneW = mod(z, 1024).mul(0.05).max(0.5);
  const median = floor(z.div(1024)).mul(0.5);
  const lanes = mod(w, 8);
  const parking = mod(floor(w.div(8)), 4);
  const oneWay = bit(w, 5);
  const divided = bit(w, 6);
  const bus = bit(w, 7);
  const noParking = bit(w, 8);
  const cls = mod(floor(w.div(512)), 8);

  const rules = m.classes.map((name) => m.rules[name]);
  const rule = (pick: (r: NonNullable<(typeof rules)[number]>) => number): L => pickFloat(cls, rules.map((r) => (r ? pick(r) : 0)));
  const ruleEdges = rule((r) => (r.edges ? 1 : 0));
  const ruleDashes = rule((r) => (r.dashes ? 1 : 0));
  const ruleCentre = rule((r) => (r.centre === 'never' ? 0 : r.centre === 'twoWay' ? 1 : 2));
  const ruleTs = rule((r) => (r.ts ? 1 : 0));
  const painted = step(0.5, cls);

  const parkMinus = step(0.5, parking);
  const parkPlus = step(1.5, parking);
  const twoWay = float(1).sub(oneWay);
  const outer = select(oneWay.greaterThan(0.5), lanes.mul(laneW).mul(0.5), median.mul(0.5).add(lanes.mul(laneW)));
  const widthM = median.add(lanes.mul(twoWay.add(1)).mul(laneW)).add(parking.mul(m.parkingM));
  const half = widthM.mul(0.5);
  const shift = parkMinus.sub(parkPlus).mul(m.parkingM / 2);
  const u = t.sub(shift);
  const au = u.abs();
  const m2 = median.mul(0.5);

  // ---- yellow: the centre line of a two-way road, or the edges of a median --------------------------------------------------
  const wantCentre = select(ruleCentre.greaterThan(1.5), step(m.centreWideMinM, widthM), step(0.5, ruleCentre));
  const doubleYellow = line(au.sub(m.doubleGapM / 2 + hw), hw).mul(wantCentre);
  const medianYellow = line(au.sub(m2), hw);
  const yellow = select(divided.greaterThan(0.5), medianYellow, doubleYellow).mul(twoWay);

  // ---- white: edge lines, lane dashes, parking Ts ----------------------------------------------------------------------------
  const plusPos = outer.sub(hw).sub(float(1).sub(parkPlus).mul(m.edgeInsetM));
  const minusPos = outer.sub(hw).sub(float(1).sub(parkMinus).mul(m.edgeInsetM));
  const edges = max(line(u.sub(plusPos), hw), line(u.add(minusPos), hw)).mul(ruleEdges);

  const q = select(oneWay.greaterThan(0.5), u.add(outer).div(laneW), au.sub(m2).div(laneW));
  const k = q.round();
  const inRange = step(0.5, k).mul(step(k, lanes.sub(1).add(0.5)));
  const dashes = line(q.sub(k).mul(laneW), hw).mul(along(s, m.dashOnM + m.dashOffM, 0, m.dashOnM)).mul(inRange).mul(ruleDashes);

  const curb = half.sub(t.abs());
  const onStrip = max(parkPlus.mul(step(0, t)), parkMinus.mul(step(t, 0)));
  const stemWindow = smoothstep(fpT.mul(-0.5), fpT.mul(0.5), curb).mul(float(1).sub(smoothstep(float(m.tStemM).sub(fpT.mul(0.5)), float(m.tStemM).add(fpT.mul(0.5)), curb)));
  const stem = stemWindow.mul(along(s, m.tEveryM, m.tEveryM / 2 - hw, hw * 2));
  const bar = line(curb.sub(m.tStemM), hw).mul(along(s, m.tEveryM, m.tEveryM / 2 - m.tBarM / 2, m.tBarM));
  const ts = max(stem, bar).mul(onStrip).mul(ruleTs).mul(float(1).sub(noParking));

  const whiteLane = max(max(edges, dashes), ts);

  // ---- the bus tint: the whole outer lane of each carriageway ----------------------------------------------------------------
  const lanePos = select(oneWay.greaterThan(0.5), u.add(outer).sub(laneW.mul(0.5)), au.sub(m2).sub(lanes.sub(0.5).mul(laneW)));
  const busLane = line(lanePos, laneW.mul(0.5)).mul(bus);

  // ---- the surface masks -----------------------------------------------------------------------------------------------------------
  const id = i.id;
  const isRibbon = step(Surf.RoadBase - 0.5, id).mul(step(id, Surf.RoadBase + 5.5));
  const isCross = step(Surf.Crosswalk - 0.5, id).mul(step(id, Surf.Crosswalk + 0.5));
  const isBar = step(Surf.StopBar - 0.5, id).mul(step(id, Surf.StopBar + 0.5));

  // crosswalk: `s` is the metres along the crossing, `t` across it, `z` holds the length (dm) x 2 and the ladder bit
  const len = floor(z.div(2)).mul(0.1);
  const ladder = mod(z, 2);
  const barHalf = m.crosswalk.barM / 2;
  const transverse = max(line(s.sub(barHalf), barHalf), line(s.sub(len.sub(barHalf)), barHalf));
  const rungPeriod = m.crosswalk.rungPeriodM;
  const fpV = fpT;
  const rungsRaw = select(aa, periodicAA(t.add(rungPeriod * 1000), rungPeriod, (rungPeriod - m.crosswalk.rungM) / 2, m.crosswalk.rungM, fpV), periodicHard(t.add(rungPeriod * 1000), rungPeriod, (rungPeriod - m.crosswalk.rungM) / 2, m.crosswalk.rungM));
  const between = smoothstep(fpS.mul(-0.5).add(m.crosswalk.barM), fpS.mul(0.5).add(m.crosswalk.barM), s).mul(float(1).sub(smoothstep(len.sub(m.crosswalk.barM).sub(fpS.mul(0.5)), len.sub(m.crosswalk.barM).add(fpS.mul(0.5)), s)));
  const crosswalk = max(transverse, rungsRaw.mul(between).mul(ladder));

  // decals fade to the asphalt past `decalFarM`: they are lifted 2 cm and a coarse depth buffer cannot hold them apart that far
  const dist = positionWorld.sub(cameraPosition).length();
  const decalFade = float(1).sub(smoothstep(m.decalFarM * 0.6, m.decalFarM, dist));
  const whiteDecal = max(crosswalk.mul(isCross), isBar).mul(decalFade);

  // ---- wear (worn mode) --------------------------------------------------------------------------------------------------------------
  const p = vec2(positionWorld.x, positionWorld.z);
  let wearMul: L = float(1);
  if (i.mode === 'worn') {
    const blotch = smoothstep(0.5, 0.85, vnoiseAA(p, 0.9, fpW));
    const grain = smoothstep(0.35, 0.8, vnoiseAA(p, 7.3, fpW));
    wearMul = float(1).sub(float(m.worn.wear).mul(blotch.mul(0.65).add(grain.mul(0.35))));
  }

  const on = i.nodes.uMarkings;
  const gate = painted.mul(isRibbon).mul(on);
  const yellowCov = yellow.mul(gate).mul(wearMul);
  const whiteCov = max(whiteLane.mul(gate), whiteDecal.mul(on)).mul(wearMul);
  const busCov = busLane.mul(gate).mul(m.busTint);

  const wet = i.nodes.sky.uWet;
  const dim = float(1).sub(wet.mul(0.3));
  const white = vec3(...srgbHexToLinear(m.paint.white)).mul(dim);
  const yel = vec3(...srgbHexToLinear(m.paint.yellow)).mul(dim);
  const busCol = vec3(...srgbHexToLinear(m.paint.bus)).mul(dim);

  let color = mix(i.color, busCol, busCov);
  color = mix(color, white, whiteCov);
  color = mix(color, yel, yellowCov);
  const coverage = max(max(yellowCov, whiteCov), busCov);
  const roughness = i.mode === 'worn' ? mix(i.roughness, float(m.worn.roughness), max(yellowCov, whiteCov)) : i.roughness;
  return { color, roughness, coverage };
}
