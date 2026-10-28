/**
 * The colour grade (M02g1): analytic lift/gamma/gain, a warm-sun/cool-shade split tone and a saturation. No lookup table and no node of
 * its own (C13 `PostNode` is unchanged): it is a function of the colour that `tonemap` applies after the tone mapping, or the fog
 * nodes apply on a list that is only `tonemap` (a tier that draws straight to the canvas). The identity is lift 0, gamma 1, gain 1,
 * warm 1, cool 1, saturation 1. TSL only.
 */
import { dot, float, mix, pow, smoothstep, uniform, vec3 } from 'three/tsl';
import { Vector3 } from 'three/webgpu';

export interface GradeParams {
  lift: readonly [number, number, number];
  gamma: number;
  gain: readonly [number, number, number];
  saturation: number;
  /** Multiplies the lit end of the picture. */
  warm: readonly [number, number, number];
  /** Multiplies the shade. */
  cool: readonly [number, number, number];
}

export const GRADE_IDENTITY: Readonly<GradeParams> = Object.freeze<GradeParams>({
  lift: [0, 0, 0], gamma: 1, gain: [1, 1, 1], saturation: 1, warm: [1, 1, 1], cool: [1, 1, 1],
});

/** The luminance range the split tone fades over (display-referred). */
export const SPLIT_LOW = 0.2;
export const SPLIT_HIGH = 0.8;
const LUMA: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** The grade in plain numbers: what the shader computes, for the tests and the report. `rgb` is display-referred, 0..1. */
export function gradeReference(rgb: readonly [number, number, number], p: Readonly<GradeParams>): [number, number, number] {
  const x: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let v = (rgb[i] as number) + (p.lift[i] as number) * (1 - (rgb[i] as number));
    v *= p.gain[i] as number;
    x[i] = Math.pow(Math.max(v, 0), 1 / p.gamma);
  }
  const l0 = LUMA[0] * x[0] + LUMA[1] * x[1] + LUMA[2] * x[2];
  const t = smooth(SPLIT_LOW, SPLIT_HIGH, l0);
  for (let i = 0; i < 3; i++) x[i] = (x[i] as number) * ((p.cool[i] as number) + ((p.warm[i] as number) - (p.cool[i] as number)) * t);
  const l1 = LUMA[0] * x[0] + LUMA[1] * x[1] + LUMA[2] * x[2];
  for (let i = 0; i < 3; i++) x[i] = Math.max(0, l1 + ((x[i] as number) - l1) * p.saturation);
  return x;
}

/** Linear blend of two grades (the weather blend). */
export function blendGrade(a: Readonly<GradeParams>, b: Readonly<GradeParams>, t: number): GradeParams {
  const k = Math.max(0, Math.min(1, t));
  const v3 = (x: readonly number[], y: readonly number[]): [number, number, number] => [
    (x[0] as number) + ((y[0] as number) - (x[0] as number)) * k,
    (x[1] as number) + ((y[1] as number) - (x[1] as number)) * k,
    (x[2] as number) + ((y[2] as number) - (x[2] as number)) * k,
  ];
  return {
    lift: v3(a.lift, b.lift),
    gamma: a.gamma + (b.gamma - a.gamma) * k,
    gain: v3(a.gain, b.gain),
    saturation: a.saturation + (b.saturation - a.saturation) * k,
    warm: v3(a.warm, b.warm),
    cool: v3(a.cool, b.cool),
  };
}

/** The uniform nodes of a grade; one set is shared by the graph that applies it, and written once per frame. */
export interface GradeUniforms {
  lift: { value: Vector3 };
  gain: { value: Vector3 };
  warm: { value: Vector3 };
  cool: { value: Vector3 };
  gamma: { value: number };
  saturation: { value: number };
  /** 1 grades, 0 leaves the colour as it is (a switched-off layer, or the other path owns the grade). */
  weight: { value: number };
}

export function createGradeUniforms(): GradeUniforms {
  const u = uniform as unknown as (v: unknown) => unknown;
  return {
    lift: u(new Vector3(0, 0, 0)) as GradeUniforms['lift'],
    gain: u(new Vector3(1, 1, 1)) as GradeUniforms['gain'],
    warm: u(new Vector3(1, 1, 1)) as GradeUniforms['warm'],
    cool: u(new Vector3(1, 1, 1)) as GradeUniforms['cool'],
    gamma: u(1) as GradeUniforms['gamma'],
    saturation: u(1) as GradeUniforms['saturation'],
    weight: u(0) as GradeUniforms['weight'],
  };
}

export function writeGrade(u: GradeUniforms, p: Readonly<GradeParams>, weight: number): void {
  u.lift.value.set(p.lift[0], p.lift[1], p.lift[2]);
  u.gain.value.set(p.gain[0], p.gain[1], p.gain[2]);
  u.warm.value.set(p.warm[0], p.warm[1], p.warm[2]);
  u.cool.value.set(p.cool[0], p.cool[1], p.cool[2]);
  u.gamma.value = p.gamma;
  u.saturation.value = p.saturation;
  u.weight.value = weight;
}

/** A TSL node of any shape (three's static types reject the mixed shapes a colour grade uses). */
export interface GNode {
  rgb: GNode;
  a: GNode;
  max(b: unknown): GNode;
  div(b: unknown): GNode;
  mul(b: unknown): GNode;
  add(b: unknown): GNode;
  oneMinus(): GNode;
}
type Tsl = (...a: unknown[]) => GNode;
const tsl = {
  dot: dot as unknown as Tsl,
  float: float as unknown as Tsl,
  mix: mix as unknown as Tsl,
  pow: pow as unknown as Tsl,
  smoothstep: smoothstep as unknown as Tsl,
  vec3: vec3 as unknown as Tsl,
};

/**
 * The grade as a TSL expression on the rgb of `color` (display-referred, 0..1), returning a vec3. `weight` 0 returns the colour
 * unchanged. The same function serves both paths, so they differ only in the space they are given (`gradeLinear`).
 */
export function gradeColor(color: unknown, u: GradeUniforms): GNode {
  const c = (color as GNode).rgb;
  const un = u as unknown as Record<string, GNode>;
  let x = c.add((un['lift'] as GNode).mul(c.oneMinus()));
  x = x.mul(un['gain']);
  x = x.max(0);
  x = tsl.pow(x, tsl.float(1).div(un['gamma']));
  const luma = tsl.vec3(LUMA[0], LUMA[1], LUMA[2]);
  const t = tsl.smoothstep(SPLIT_LOW, SPLIT_HIGH, tsl.dot(x, luma));
  x = x.mul(tsl.mix(un['cool'], un['warm'], t));
  const l1 = tsl.dot(x, luma);
  x = tsl.mix(tsl.vec3(l1, l1, l1), x, un['saturation']).max(0);
  return tsl.mix(c, x, un['weight']);
}

/**
 * The grade for a colour that is still scene-linear and before the tone mapping (the fog nodes of a tonemap-only list): it is
 * applied in an approximate display space (gamma 2.2) so the same numbers do the same thing as in `tonemap`.
 */
export function gradeLinear(color: unknown, u: GradeUniforms): GNode {
  const c = (color as GNode).rgb;
  const disp = tsl.pow(c.max(0), 1 / 2.2);
  const graded = gradeColor(disp, u);
  return tsl.pow(graded.max(0), 2.2);
}

/** Where the grade runs for a list of post nodes: in `tonemap` when the stack has a target, in the fog nodes when the list is only `tonemap`. */
export function gradeOwner(nodes: readonly string[], mode: 'pipeline' | 'direct'): 'tonemap' | 'fog' | null {
  if (mode === 'pipeline') return nodes.includes('tonemap') ? 'tonemap' : null;
  return 'fog';
}
