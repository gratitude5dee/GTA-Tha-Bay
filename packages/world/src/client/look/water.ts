/**
 * Water (M02e; TSL only): the `Water` and `WaterShallow` cells of the terrain, the coarse water sheets and the backdrop sea.
 * Fragment-only waves: a sum of the `water.waves` directional sines on the normal, no vertex displacement, so the physics surface and
 * the meshes are unchanged. `amp` is the slope of a wave (the tilt of the normal), not a height. The waves flatten with distance so
 * the sea at the horizon is a calm mirror and does not shimmer.
 *
 *  - `full`: four waves, the sky reflected through the environment map and a sun glint from the light's specular term;
 *  - `lite`: two waves and a sky-colour Fresnel in the albedo;
 *  - `min`: a flat colour, no waves.
 *
 * M02g1: where no environment map exists (Safari `full`, `lite`, `min`) the analytic sky reflection (`look/sky-reflect.ts`) adds the
 * sky gradient and the sun glint along the reflected direction of the wave normal; the layer weight is 0 with an environment map.
 */
import { clamp, dot, float, mix, normalize, normalView, pow, positionViewDirection, positionWorld, smoothstep, sin, transformNormalToView, vec3, type L } from '../sky/tsl.ts';
import { cameraWorldMatrix } from 'three/tsl';
import type { LookNodes } from './common.ts';
import { srgbHexToLinear, type LookFile } from './config.ts';
import { reflectTerm } from './sky-reflect.ts';

export interface WaterOut {
  color: L;
  roughness: L;
  metalness: L;
  /** The view-space normal with the waves. */
  normal: L;
}

const DEG = Math.PI / 180;

/** The wave normal in world space (y up), for the first `count` waves, from the look clock. */
export function waveNormal(look: LookFile, n: LookNodes, count: number, fadeNear = 250, fadeFar = 3000): L {
  const p = positionWorld;
  let gx: L = float(0);
  let gz: L = float(0);
  const waves = look.water.waves.slice(0, count);
  for (const [dirDeg, lengthM, amp, speed] of waves) {
    const dx = Math.cos(dirDeg * DEG);
    const dz = Math.sin(dirDeg * DEG);
    const k = (2 * Math.PI) / lengthM;
    const phase = p.x.mul(dx * k).add(p.z.mul(dz * k)).sub(n.uLook.mul(speed * k));
    const slope = sin(phase.add(Math.PI / 2)).mul(amp * 6);
    gx = gx.add(slope.mul(dx));
    gz = gz.add(slope.mul(dz));
  }
  const dist = positionWorld.sub(n.sky.uCamPos).length();
  const calm = float(1).sub(smoothstep(fadeNear, fadeFar, dist));
  return normalize(vec3(gx.mul(calm).negate(), 1, gz.mul(calm).negate()));
}

/**
 * The water surface. `deepness` is 0 for shallow cells and 1 for deep water; `vertexColor` is the bake's blue, kept a little so
 * the change of colour along the coast stays smooth.
 */
export function waterNodes(profile: 'full' | 'lite' | 'min', look: LookFile, n: LookNodes, deepness: L, vertexColor: L): WaterOut {
  const deep = srgbHexToLinear(look.water.deep);
  const shallow = srgbHexToLinear(look.water.shallow);
  const tint = mix(vec3(...shallow), vec3(...deep), deepness);
  const base = mix(vertexColor, tint, 0.7);
  if (profile === 'min') return { color: base.add(reflectTerm(n.sky, 0.02)), roughness: float(0.35), metalness: float(0), normal: normalView };

  const waves = profile === 'full' ? 4 : 2;
  const world = waveNormal(look, n, waves);
  const normal = transformNormalToView(world);
  const ndv = clamp(dot(normal, positionViewDirection), 0, 1);
  const fres = pow(float(1).sub(ndv), 5);
  // The sky colour at grazing angles: full lets the environment map do most of it, lite fakes all of it.
  const sky = n.sky.uSkyBottom;
  // The baked sky tint of `lite` gives way to the analytic reflection when that layer is on (the weight is 1 then).
  const tintK = fres.mul(profile === 'full' ? 0.35 : 0.85).add(profile === 'full' ? 0 : 0.06).mul(profile === 'full' ? float(1) : float(1).sub(n.sky.look.reflect.weight as unknown as L).mul(0.6).add(0.4));
  const R = positionViewDirection.negate().reflect(normal).transformDirection(cameraWorldMatrix as unknown as L);
  const color = mix(base, sky.mul(0.9), tintK).add(reflectTerm(n.sky, 0.02, { R, ndv, shininess: 420 }));
  return { color, roughness: float(profile === 'full' ? 0.045 : 0.2), metalness: float(0), normal };
}
