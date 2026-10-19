/**
 * A loosely typed view of the TSL functions the sky code uses. three's static node types reject mixed shapes (a float node against a
 * vec3 node, a number against a uniform), which the shader code here relies on, so the sky works through `L` and casts at the edges
 * (`asNode`). The functions are three's own; only the types are wider.
 */
import * as T from 'three/tsl';
import type { Node } from 'three/webgpu';

export type Arg = L | number | string;

/** A TSL node of any shape. Swizzles are properties, operators are methods. */
export interface L {
  add(...a: Arg[]): L;
  sub(...a: Arg[]): L;
  mul(...a: Arg[]): L;
  div(...a: Arg[]): L;
  negate(): L;
  oneMinus(): L;
  clamp(lo?: Arg, hi?: Arg): L;
  min(b: Arg): L;
  max(b: Arg): L;
  abs(): L;
  acos(): L;
  exp(): L;
  length(): L;
  normalize(): L;
  toFloat(): L;
  greaterThan(b: Arg): L;
  lessThan(b: Arg): L;
  lessThanEqual(b: Arg): L;
  greaterThanEqual(b: Arg): L;
  equal(b: Arg): L;
  and(b: Arg): L;
  or(b: Arg): L;
  floor(): L;
  fract(): L;
  sqrt(): L;
  mod(b: Arg): L;
  pow(b: Arg): L;
  round(): L;
  toVar(name?: string): L;
  assign(b: Arg): L;
  addAssign(b: Arg): L;
  mulAssign(b: Arg): L;
  setInterpolation(type: string, sampling?: string | null): L;

  readonly x: L;
  readonly y: L;
  readonly z: L;
  readonly w: L;
  readonly xy: L;
  readonly xz: L;
  readonly xyz: L;
  readonly rgb: L;
  readonly r: L;
  readonly g: L;
  readonly b: L;
  readonly a: L;
}

type Fn = (...a: Arg[]) => L;
const f = (name: string): Fn => (T as unknown as Record<string, Fn>)[name] as Fn;

export const float = f('float');
export const vec2 = f('vec2');
export const vec3 = f('vec3');
export const vec4 = f('vec4');
export const mix = f('mix');
export const smoothstep = f('smoothstep');
export const step = f('step');
export const clamp = f('clamp');
export const dot = f('dot');
export const cross = f('cross');
export const normalize = f('normalize');
export const length = f('length');
export const fract = f('fract');
export const floor = f('floor');
export const sin = f('sin');
export const cos = f('cos');
export const exp = f('exp');
export const exp2 = f('exp2');
export const pow = f('pow');
export const max = f('max');
export const min = f('min');
export const mod = f('mod');
export const select = f('select');
export const abs = f('abs');
export const sqrt = f('sqrt');
export const varying = f('varying');
export const attribute = f('attribute');
/** TSL `If`: a branch whose arms assign to `toVar()` variables. */
export interface IfChain {
  ElseIf(cond: L, body: () => void): IfChain;
  Else(body: () => void): void;
}
export const If = T.If as unknown as (cond: L, body: () => void) => IfChain;
export const round = f('round');
export const sign = f('sign');
export const sqrtF = f('sqrt');
export const reflect = f('reflect');
export const transformNormalToView = f('transformNormalToView');
export const fwidth = f('fwidth');
export const atan = f('atan2');
export const tan = f('tan');
export const log2 = f('log2');
export const ceil = f('ceil');

export const positionLocal = T.positionLocal as unknown as L;
export const positionWorld = T.positionWorld as unknown as L;
export const positionView = T.positionView as unknown as L;
export const normalLocal = T.normalLocal as unknown as L;
export const vertexColor = T.vertexColor as unknown as Fn;
export const output = T.output as unknown as L;
export const normalWorld = T.normalWorld as unknown as L;
export const normalView = T.normalView as unknown as L;
export const cameraPosition = T.cameraPosition as unknown as L;
export const positionViewDirection = (T as unknown as { positionViewDirection: L }).positionViewDirection;
export const normalGeometry = T.normalGeometry as unknown as L;
export const cameraProjectionMatrix = T.cameraProjectionMatrix as unknown as L;
export const cameraViewMatrix = T.cameraViewMatrix as unknown as L;
export const screenCoordinate = T.screenCoordinate as unknown as L;
export const uv = T.uv as unknown as Fn;

/** A uniform node: a loose node with a settable value. */
export interface U<V> extends L {
  value: V;
}

/** Hands a loose node to three, which wants its own static type. */
export const asNode = (n: L): Node<'vec3'> => n as unknown as Node<'vec3'>;
/** A uniform node (as built by `createSkyNodes`) viewed loosely. */
export const loose = (n: unknown): L => n as L;
