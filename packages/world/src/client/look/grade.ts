/**
 * The look's colour grade and haze as data (M02g1). `look.json` `grade` and `haze` hold one set of numbers per weather preset; this
 * module blends the set of the current weather with the next one by the weather blend (the same blend the sky keys use) and gives
 * the numbers to whichever path draws them:
 *
 *  - the `tonemap` node of the post stack (`PostStack.setGrade`), where the stack has a target;
 *  - the fog nodes (`sky/fog.ts`), where the node list is only `tonemap` (a tier that draws straight to the canvas), through the
 *    `FogGrade` uniforms here.
 *
 * The grade itself (the maths and the TSL) is `@dv/engine/platform/post/grade.ts`, so both paths run one function. The grade applies
 * exactly once per path: `gradeOwner` says which one owns it for a node list.
 */
import { blendGrade, createGradeUniforms, writeGrade, type GradeParams, type GradeUniforms } from '@dv/engine/platform/post';
import type { WeatherPreset } from '@dv/shared';
import { LOOK, type HazePreset, type LookFile } from './config.ts';

/** The grade for a weather and the next one at a blend (0..1). */
export function gradeFor(weather: WeatherPreset, next: WeatherPreset, blend: number, look: LookFile = LOOK): GradeParams {
  return blendGrade(look.grade[weather], look.grade[next], blend);
}

/** The haze for a weather and the next one at a blend (0..1). */
export function hazeFor(weather: WeatherPreset, next: WeatherPreset, blend: number, look: LookFile = LOOK): HazePreset {
  const a = look.haze[weather];
  const b = look.haze[next];
  const k = Math.max(0, Math.min(1, blend));
  return { sun: a.sun + (b.sun - a.sun) * k, blue: a.blue + (b.blue - a.blue) * k, ext: a.ext + (b.ext - a.ext) * k };
}

/**
 * The uniforms the fog nodes read for the grade (the fog path of a tonemap-only list) and the haze (every non-legacy profile).
 * One set per page, created with the sky nodes; the weights are 0 until the look writes them, so a world without a look draws as before.
 */
export interface FogLook {
  grade: GradeUniforms;
  /** In-scatter towards the sun, Rayleigh tint and extinction per kilometre; `weight` is the haze layer (0 off). */
  haze: { sun: { value: number }; blue: { value: number }; ext: { value: number }; weight: { value: number } };
  /** The analytic sky reflection (`look/sky-reflect.ts`): `weight` is 1 where the layer is on and no environment map carries the reflection. */
  reflect: { weight: { value: number } };
}

export function createFogLook(uniform: <V>(v: V) => { value: V }): FogLook {
  return {
    grade: createGradeUniforms(),
    haze: { sun: uniform(0), blue: uniform(0), ext: uniform(0), weight: uniform(0) },
    reflect: { weight: uniform(0) },
  };
}

export interface FogLookWrite {
  grade: Readonly<GradeParams>;
  /** 1 when the fog nodes own the grade on this frame (the list is only `tonemap`) and the grade layer is on. */
  gradeWeight: number;
  haze: Readonly<HazePreset>;
  /** 1 with the haze layer on. */
  hazeWeight: number;
  /** 1 with the skyReflect layer on and no environment map in use. */
  reflectWeight: number;
}

export function writeFogLook(f: FogLook, w: Readonly<FogLookWrite>): void {
  writeGrade(f.grade, w.grade, w.gradeWeight);
  f.haze.sun.value = w.haze.sun;
  f.haze.blue.value = w.haze.blue;
  f.haze.ext.value = w.haze.ext;
  f.haze.weight.value = w.hazeWeight;
  f.reflect.weight.value = w.reflectWeight;
}
