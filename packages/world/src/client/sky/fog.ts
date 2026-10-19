/**
 * Fog (M02b2; TSL only). Two scene fog nodes share the sky uniforms:
 *
 *  - the world pass: linear fog between the keyed near and far distances on the mobile and Quest tiers (Quest also pulls the far
 *    end in to the draw distance, so the chunk edge fades), and a height-weighted version on the desktop tiers and Vision Pro that
 *    thins the haze with altitude and, in a Karl preset, keeps it below the marine layer's top (60 m scale height above it);
 *  - the backdrop pass: the same colour with the distances stretched, so the far ring stays readable in clear weather and
 *    disappears into a Karl or rain sky.
 *
 * Karl the Fog is heavier in the west: the fog amount is multiplied by `bankWeight(x)` (1 west of -1,500 m, 0.35 east of
 * 2,500 m) in proportion to the preset's marine-layer share `uBank`. `bankWeightNode` is the shader form of the pure
 * `bankWeight` in sky-keys.ts.
 */
import type { Node } from 'three/webgpu';
import type { SkyNodes } from './nodes.ts';
import type { FogKind } from './tiers.ts';
import { asNode, clamp, exp, float, max, mix, output, positionView, positionWorld, vec4, type L } from './tsl.ts';

/** Scale height of the haze above the marine layer, metres (the bank base of the spec). */
export const BANK_SCALE_HEIGHT_M = 60;
/** Scale height of the everyday ground haze for the height-fog tiers, metres. */
export const HAZE_SCALE_HEIGHT_M = 700;
/** The Quest tier fades the chunk edge: the fog's far end never exceeds this, metres. */
export const FADE_FAR_M = 1500;
/** The backdrop pass stretches the keyed fog distances by these factors. */
export const BACKDROP_NEAR_SCALE = 6;
export const BACKDROP_FAR_SCALE = 5;

/** Shader form of `bankWeight(x)`: 1 for x <= -1,500, 0.35 for x >= 2,500, linear between. */
export const bankWeightNode = (x: L): L => mix(float(1), float(0.35), clamp(x.add(1500).div(4000), 0, 1));

/** The world pass's scene fog node for a fog kind. Assign it to `scene.fogNode`. */
export function createWorldFog(n: SkyNodes, kind: FogKind): Node {
  const dist = positionView.z.negate();
  const far = kind === 'linear-fade' ? n.uFogFar.min(FADE_FAR_M) : n.uFogFar;
  const near = kind === 'linear-fade' ? n.uFogNear.min(far.mul(0.5)) : n.uFogNear;
  let amount = clamp(dist.sub(near).div(max(far.sub(near), 1)), 0, 1);
  // The Karl share of the fog is heavier in the west.
  amount = amount.mul(mix(float(1), bankWeightNode(positionWorld.x), n.uBank));
  if (kind === 'height') {
    const y = max(positionWorld.y, 0);
    const haze = exp(y.negate().div(HAZE_SCALE_HEIGHT_M));
    const bank = exp(max(y.sub(n.uBankTop), 0).negate().div(BANK_SCALE_HEIGHT_M));
    amount = amount.mul(mix(haze, bank, n.uBank));
  }
  return asNode(vec4(mix(output.rgb, n.uFogColor, amount), output.a));
}

/** The backdrop pass's fog node: the same colour, distances stretched. */
export function createBackdropFog(n: SkyNodes): Node {
  const dist = positionView.z.negate();
  const near = n.uFogNear.mul(BACKDROP_NEAR_SCALE);
  const far = n.uFogFar.mul(BACKDROP_FAR_SCALE);
  const amount = clamp(dist.sub(near).div(max(far.sub(near), 1)), 0, 1);
  return asNode(vec4(mix(output.rgb, n.uFogColor, amount), output.a));
}
