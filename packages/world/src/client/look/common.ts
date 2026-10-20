/**
 * What every look material shares (M02e): the attribute reads (`surf`, `facade`), the fade and cover terms of M02b1's materials, the
 * look clock and the wetness. TSL only; the types are loose (see sky/tsl.ts).
 */
import { attribute, clamp, dot, exp2, float, floor, fract, mod, positionLocal, round, screenCoordinate, select, sin, varying, vec2, type L, type U } from '../sky/tsl.ts';
import { uniform as uniformNode } from 'three/tsl';
import type { SkyNodes } from '../sky/nodes.ts';
import { FACADE_SCALE, SURF_SCALE } from './surfaces.ts';

/** Cells per side of a coarse unit's cover mask (the same constant as chunks/materials.ts). */
const COARSE_CELLS = 4;

const uniform = <V>(v: V): U<V> => uniformNode(v as never) as unknown as U<V>;

export interface LookNodes {
  sky: SkyNodes;
  /** Seconds of the streaming clock (advanced by the chunk renderer): the fade-in. */
  uTime: U<number>;
  /** Seconds of the fade-in (0 swaps hard). */
  uFade: U<number>;
  /** The look clock: waves and anything that moves. Frozen by `shot()`. */
  uLook: U<number>;
  /** The façade material's night-emissive strength this frame, 0..1 (also reported by the bridge). */
  uWindowGlow: U<number>;
  /** How much of the light the environment map carries this frame, 0..1: metallic glass reflects it, so it fades out with it. */
  uEnv: U<number>;
}

export function createLookNodes(sky: SkyNodes, fadeSeconds: number): LookNodes {
  return { sky, uTime: uniform(0), uFade: uniform(fadeSeconds), uLook: uniform(0), uWindowGlow: uniform(0), uEnv: uniform(1) };
}

/** The `surf` attribute decoded: surface id (flat across a triangle), palette index, kind/roof code, flags. */
export function surfNodes(): { id: L; pal: L; kind: L; roof: L; flags: L } {
  const raw = attribute('surf', 'vec4');
  // The surface of a triangle is its first vertex's: interpolating an id between two classes would read as a third one.
  const flat = varying(raw.mul(SURF_SCALE).round()).setInterpolation('flat', null);
  const code = flat.z;
  return { id: flat.x, pal: flat.y, kind: mod(code, 16), roof: floor(code.div(16)), flags: flat.w };
}

/** The `facade` attribute decoded (metres): u along the wall, v above the foot of the skirt, the wall's top v, and the seed in 0..1. */
export function facadeNodes(): { u: L; v: L; top: L; seed: L } {
  const raw = attribute('facade', 'vec4');
  const k = FACADE_SCALE / 10;
  return { u: raw.x.mul(k), v: raw.y.mul(k), top: raw.z.mul(k), seed: raw.w };
}

/** The per-vertex birth time and baked AO of M02b1's geometry. */
export const baseAttributes = (): { aAO: L; aBirth: L; aCover: L; aCell: L } => ({
  aAO: attribute('aAO', 'float'),
  aBirth: attribute('aBirth', 'float'),
  aCover: attribute('aCover', 'float'),
  aCell: attribute('aCell', 'float'),
});

/** Dithered fade-in factor 0/1 (M02b1): a screen-space threshold against `(time - birth) / fade`. */
export function fadeShown(n: LookNodes, aBirth: L): L {
  const noise = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453));
  const fade = select(n.uFade.greaterThan(0), clamp(n.uTime.sub(aBirth).div(n.uFade), 0, 1), float(1));
  return select(noise.lessThanEqual(fade), float(1), float(0));
}

/** The cover mask of the coarse levels (M02b1): 1 where a finer resident unit covers the cell, so the fragment is discarded. */
export function coverMask(aCover: L, aCell: L): L {
  const cx = clamp(floor(positionLocal.x.div(aCell)), 0, COARSE_CELLS - 1);
  const cz = clamp(floor(positionLocal.z.div(aCell)), 0, COARSE_CELLS - 1);
  const bit = cz.mul(COARSE_CELLS).add(cx);
  return mod(floor(aCover.div(exp2(bit))), 2);
}

export { round };
