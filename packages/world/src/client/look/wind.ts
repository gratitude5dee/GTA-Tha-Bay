/**
 * Wind sway of the street trees (M02h4), the `full` look profile only (desktop tiers): a TSL `positionNode` offset on the vegetation
 * pools' material. Render only: the sim and the colliders never see it.
 *
 *   offset = uWindDir x uWindAmp x uWindOn x sway^2 x heightM x sin(uLookTime x f + dot(position.xz, k))
 *
 * `sway` is the geometry's per-vertex weight (0 at the root, 1 at the crown top; `chunks/tree-forms.ts`, `full` set only) and `heightM`
 * the tree's height (the instance attribute `aTint.w`), so a tall eucalyptus bends further than a ficus. `position` is the vertex after
 * the instance transform (three applies the instance matrix before `positionNode`), so the phase moves through the city like a gust.
 * The clock is the look clock (`LookNodes.uLook`), which `shot()` freezes: a shot is still byte-identical with the wind on. The
 * amplitude follows the weather (`look.json` `vegetation.wind`, blended between presets by `windAmplitude`); `setLookLayer('wind', on)`
 * sets `uWindOn`.
 */
import { uniform as uniformNode } from 'three/tsl';
import type { WeatherPreset } from '@dv/shared';
import { attribute, dot, float, positionLocal, sin, vec2, vec3, type L, type U } from '../sky/tsl.ts';
import type { LookFile } from './config.ts';

const uniform = <V>(v: V): U<V> => uniformNode(v as never) as unknown as U<V>;

export interface WindNodes {
  /** The wind's direction in plan (x east, z south), unit length. */
  uWindDirX: U<number>;
  uWindDirZ: U<number>;
  /** Metres of sway per metre of tree height at the crown top. */
  uWindAmp: U<number>;
  /** The `wind` layer: 1 on, 0 off. */
  uWindOn: U<number>;
}

/** The vegetation block of `look.json` (M02h4). */
export interface VegetationLook {
  /** Sway amplitude per weather preset (a fraction of the tree's height at its top). */
  wind: Record<WeatherPreset, number>;
  /** The sway's angular frequency (radians per second of the look clock) and its spatial wave number (radians per metre). */
  freq: number;
  waveK: number;
  /** The wind's bearing in plan, degrees from east toward south (+z). */
  dirDeg: number;
}

export function createWindNodes(v: VegetationLook): WindNodes {
  const a = (v.dirDeg * Math.PI) / 180;
  return { uWindDirX: uniform(Math.cos(a)), uWindDirZ: uniform(Math.sin(a)), uWindAmp: uniform(v.wind.clear), uWindOn: uniform(1) };
}

/** The amplitude between two presets (`blend` 0..1 from `weather` to `next`), as the sky blends them. */
export function windAmplitude(look: LookFile, weather: WeatherPreset, next: WeatherPreset, blend: number): number {
  const w = look.vegetation.wind;
  const b = Math.max(0, Math.min(1, blend));
  return (w[weather] ?? w.clear) * (1 - b) + (w[next] ?? w.clear) * b;
}

/** The sway offset node for the trees' `positionNode` (add it to `positionLocal`). `uLook` is the look clock. */
export function windOffset(w: WindNodes, uLook: L, v: VegetationLook): L {
  const sway = attribute('sway', 'float') as L;
  const height = (attribute('aTint', 'vec4') as L).w;
  const phase = uLook.mul(v.freq).add(dot(vec2(positionLocal.x, positionLocal.z), vec2(v.waveK, v.waveK * 0.7)));
  const amount = w.uWindAmp.mul(w.uWindOn).mul(sway.mul(sway)).mul(height).mul(sin(phase));
  return vec3(w.uWindDirX, float(0), w.uWindDirZ).mul(amount);
}
