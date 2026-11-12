/**
 * The objective beam of a mission (M05a1, final art M10d1): an emissive column whose brightness falls with height (the model carries
 * the gradient in its vertex colours) and that fades out as the camera comes within 12 m of it, so a player standing in the zone is
 * not looking through a solid yellow bar. One shared material; additive, no depth write, drawn from both sides. TSL only.
 */
import { cameraPosition, distance, positionWorld, smoothstep, vertexColor } from 'three/tsl';
import { AdditiveBlending, DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';

/** Metres from the camera at which the beam is gone and fully there. */
export const BEAM_FADE_NEAR_M = 3;
export const BEAM_FADE_FAR_M = 12;

let material: MeshBasicNodeMaterial | null = null;

export function beamMaterial(): MeshBasicNodeMaterial {
  if (material) return material;
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending });
  const fade = smoothstep(BEAM_FADE_NEAR_M, BEAM_FADE_FAR_M, distance(cameraPosition, positionWorld));
  const col = vertexColor(0);
  m.colorNode = col;
  m.opacityNode = fade;
  material = m;
  return m;
}

/** The camera fade as a number, for tests and the QA bridge. */
export function beamFade(distanceM: number): number {
  const t = Math.min(1, Math.max(0, (distanceM - BEAM_FADE_NEAR_M) / (BEAM_FADE_FAR_M - BEAM_FADE_NEAR_M)));
  return t * t * (3 - 2 * t);
}
