/**
 * One factory per C13 `PostNode` (M02e, DL-704), built from the verified r186 exports of `three/addons/tsl/display/` and
 * `three/tsl`. TSL only: no GLSL, no `postprocessing` package, no `n8ao` (D-07, D-10). The stack in `stack.ts` chains them.
 *
 * Order of work in the stack: the scene colour (backdrop composited under the world pass, linear HDR) goes through `gtao-half`
 * (multiplies), `bloom` (adds) and `traa` (temporal, still linear), then `tonemap` (the one tone mapping and the sRGB conversion of
 * the whole pipeline), then the spatial AA nodes `smaa` and `fxaa`, which need display-referred input, and `fsr1` last.
 */
import { renderOutput } from 'three/tsl';
import type { Camera, Node, Texture } from 'three/webgpu';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fsr1 } from 'three/addons/tsl/display/FSR1Node.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

/** Loosely typed TSL node: mixed shapes (a float against a vec4) are normal in a shader graph and three's static types reject them. */
export interface PNode {
  rgb: PNode;
  a: PNode;
  r: PNode;
  mul(b: PNode | number): PNode;
  add(b: PNode | number): PNode;
  sub(b: PNode | number): PNode;
  oneMinus(): PNode;
  greaterThan(b: number): PNode;
  lessThan(b: number): PNode;
}
export type Fn = (...a: unknown[]) => PNode;

/** Tuning of the nodes (design values, set for the city scale: metres). */
export const POST_TUNING = {
  gtao: { radius: 2.2, thickness: 1.2, scale: 1.0, samples: 12, resolutionScale: 0.5 },
  bloom: { strength: 0.32, radius: 0.55, threshold: 1.05 },
  fsr1: { sharpness: 0.2, denoise: false },
} as const;

export interface GtaoHandle {
  /** The AO factor as a node (1 = open), already at half resolution. */
  factor: PNode;
  node: { dispose(): void; radius: { value: number }; samples: { value: number }; resolutionScale: number };
}

/** `gtao-half`: ground-truth AO at half resolution from the world pass's depth and view normals. */
export function createGtao(depth: unknown, normal: unknown, camera: Camera): GtaoHandle {
  const node = ao(depth as Node, normal as Node, camera);
  node.resolutionScale = POST_TUNING.gtao.resolutionScale;
  node.radius.value = POST_TUNING.gtao.radius;
  node.thickness.value = POST_TUNING.gtao.thickness;
  node.scale.value = POST_TUNING.gtao.scale;
  node.samples.value = POST_TUNING.gtao.samples;
  return { factor: node.getTextureNode() as unknown as PNode, node: node as unknown as GtaoHandle['node'] };
}

/** `bloom`: adds the blurred highlights (lit windows, the sun glint on glass and water) to the HDR colour. */
export function createBloom(color: PNode): { add: PNode; node: { dispose(): void } } {
  const node = bloom(color as unknown as Node<'vec4'>, POST_TUNING.bloom.strength, POST_TUNING.bloom.radius, POST_TUNING.bloom.threshold);
  return { add: node as unknown as PNode, node: node as unknown as { dispose(): void } };
}

/** `traa`: temporal anti-aliasing from the world pass's velocity output (`desktop-ultra` only). */
export function createTraa(color: PNode, depth: unknown, velocity: unknown, camera: Camera): PNode {
  return (traa as unknown as (...a: unknown[]) => PNode)(color, depth, velocity, camera);
}

/** `tonemap`: the one tone mapping and colour-space conversion (renderer.toneMapping, `NeutralToneMapping`, and its exposure). */
export function createTonemap(color: PNode): PNode {
  return (renderOutput as unknown as Fn)(color);
}

export const createSmaa = (color: PNode): PNode => smaa(color as unknown as Node) as unknown as PNode;
export const createFxaa = (color: PNode): PNode => fxaa(color as unknown as Node) as unknown as PNode;
export const createFsr1 = (color: PNode): PNode =>
  (fsr1 as unknown as Fn)(color, POST_TUNING.fsr1.sharpness, POST_TUNING.fsr1.denoise);

/** Textures a pass owns, for the tests and the disposal path. */
export type PassTextures = { output: Texture };
