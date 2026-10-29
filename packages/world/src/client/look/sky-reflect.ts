/**
 * The analytic sky reflection (M02g1; TSL only). Where no environment map exists (every WebKit tier, `lite`, `min`) glass, water,
 * traffic paint and the player's vehicle reflect nothing, and the city reads matte. `skyReflect(R)` is the sky for a reflected
 * direction R: the horizon-to-zenith gradient of the sky's own uniforms plus a sun lobe, times a Fresnel term. No texture, no probe
 * render and no bake: a dozen ALU on the fragments that use it, so it is WebKit-safe.
 *
 * The layer weight `n.look.reflect.weight` is 1 where the layer is on and nothing else carries the reflection (the look writes 0 when
 * an environment map is in use, so the two never add up) and 0 on `legacy`.
 */
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import { asNode, clamp, dot, float, max, mix, pow, positionViewDirection, normalView, smoothstep, vec3, type L } from '../sky/tsl.ts';
import { reflectVector } from 'three/tsl';
import type { SkyNodes } from '../sky/nodes.ts';

/** Exponent of the sun lobe on a glossy surface (glass, paint): a small bright disc. */
export const SUN_SHININESS = 260;
/** Exponent of the wide sheen around the sun. */
export const SUN_SHEEN = 18;

/** The sky seen along a world-space direction `R` (unit), linear: gradient, ground bounce below the horizon, sun lobe above. */
export function skyReflect(n: SkyNodes, R: L, shininess: number = SUN_SHININESS): L {
  const t = smoothstep(-0.05, 0.6, R.y);
  const sky = mix(n.uSkyBottom, n.uSkyTop, t);
  // Below the horizon the reflection is the ground: the ambient colour, darker.
  const ground = n.uAmbient.mul(0.3);
  const below = smoothstep(0.02, -0.25, R.y);
  const base = mix(sky, ground, below);
  const sunUp = smoothstep(-0.02, 0.1, n.uSunDir.y);
  const cosSun = max(dot(R, n.uSunDir), 0);
  const disc = pow(cosSun, shininess).mul(6);
  const sheen = pow(cosSun, SUN_SHEEN).mul(0.12);
  return base.add(n.uSunColor.mul(disc.add(sheen)).mul(sunUp));
}

/** Schlick's Fresnel for a normal-incidence reflectance `f0` and the view-space normal and view direction of the fragment. */
export function fresnel(f0: number | L, ndv?: L): L {
  const c = ndv ?? clamp(dot(normalView, positionViewDirection), 0, 1);
  const f = float(f0 as number);
  return f.add(float(1).sub(f).mul(pow(float(1).sub(c), 5)));
}

/**
 * The reflection to add to a surface of normal-incidence reflectance `f0`, along `R` (default: the reflect vector of the fragment's
 * normal). It is 0 with the layer off, and `strength` scales it (a rough surface reflects less).
 */
export function reflectTerm(n: SkyNodes, f0: number | L, opts: { R?: L; shininess?: number; strength?: number | L; ndv?: L } = {}): L {
  const R = opts.R ?? (reflectVector as unknown as L);
  const k = opts.strength ?? 1;
  return skyReflect(n, R, opts.shininess ?? SUN_SHININESS)
    .mul(fresnel(f0, opts.ndv))
    .mul(k)
    .mul(n.look.reflect.weight as unknown as L);
}

/**
 * The engine's `setReflectHook` for the gray-box vehicles (the player's car among them): their emissive node becomes the colour the
 * material already had (lamps and signs) plus the analytic sky reflection. The weight is the layer's, 0 with an environment map.
 */
export function vehicleReflectHook(n: SkyNodes): (m: MeshStandardNodeMaterial) => void {
  return (m) => {
    const e = m.emissive;
    const k = m.emissiveIntensity;
    m.emissiveNode = asNode(vec3(e.r * k, e.g * k, e.b * k).add(reflectTerm(n, 0.05, { strength: 0.9 })));
    m.needsUpdate = true;
  };
}
