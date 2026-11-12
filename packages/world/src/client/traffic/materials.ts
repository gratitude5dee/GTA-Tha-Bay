/**
 * The materials of the final vehicles and props (M10d1; TSL only). One material per look profile reads the part id of each vertex
 * (`_PART` of the model, the geometry attribute `aPart`) and shades paint, glass, tyre, rim, trim, chrome and the lamps from it, so a
 * whole car is one draw per pass whatever its parts:
 *
 *   full    `MeshPhysicalNodeMaterial`: clearcoat 1 on the paint, the sky reflection on paint and glass, glass drawn as its own
 *           transparent pass (`pass: 'glass'`)
 *   lite    `MeshStandardNodeMaterial`, roughness 0.3 on the paint, the analytic sky reflection, glass in the opaque pass
 *   min     the same without a second sky term beyond the analytic one (no environment map exists there either)
 *   legacy  `MeshStandardNodeMaterial` on the vertex colours: no reflection (the XR tiers and the `world.look` rollback)
 *
 * `instanced` materials also read the instance attributes of the traffic renderer: `aTint` (the body colour, multiplying the paint part)
 * and `aLights` (a float with the light bits of the sim, `LIGHT`, plus `LIVERY_BIT` set by the renderer). The lamps follow the bits and the
 * darkness of the sky (`uDark`); the pool's materials (`instanced: false`) light them steadily like the gray-box kit did.
 */
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, type Material } from 'three/webgpu';
import { uniform as uniformNode } from 'three/tsl';
import type { ArtMaterialFactory, ArtProfile } from '@dv/engine/client/vehicle/art';
import { PART } from '@dv/shared';
import { HEADLIGHTS_DARK } from '../sky/night.ts';
import type { SkyNodes } from '../sky/nodes.ts';
import { asNode, attribute, float, floor, fract, mod, vec3, vertexColor, type L, type U } from '../sky/tsl.ts';
import { reflectTerm } from '../look/sky-reflect.ts';
import { LIGHT } from './lights.ts';

/** The livery bit of `aLights`: set by the renderer, not by the sim (whose bits are 1, 2 and 4). */
export const LIVERY_BIT = 16;

export type ArtMaterialKind = 'physical' | 'standard';

export interface ArtMaterialOptions {
  profile: ArtProfile;
  sky: SkyNodes;
  pass: 'opaque' | 'glass';
  /** Read `aTint` and `aLights` (the instanced traffic) instead of the vertex colours alone. */
  instanced: boolean;
  /** Seconds for the hazard flash; shared by the materials of one renderer. */
  uTime?: U<number>;
}

/** The material class a profile uses (`physical` only on `full`). */
export const materialKindOf = (profile: ArtProfile): ArtMaterialKind => (profile === 'full' ? 'physical' : 'standard');

const ROUGHNESS: Readonly<Record<number, number>> = {
  [PART.glass]: 0.06,
  [PART.tyre]: 0.92,
  [PART.rim]: 0.38,
  [PART.trim]: 0.7,
  [PART.chrome]: 0.22,
  [PART.lampHead]: 0.3,
  [PART.lampBrake]: 0.3,
  [PART.sirenRed]: 0.3,
  [PART.sirenBlue]: 0.3,
  [PART.dome]: 0.25,
  [PART.amber]: 0.3,
  [PART.glow]: 0.5,
  [PART.matte]: 0.85,
};

export function makeArtMaterial(o: ArtMaterialOptions): MeshStandardNodeMaterial | MeshPhysicalNodeMaterial {
  const part = attribute('aPart', 'float');
  const is = (id: number): L => part.sub(id).abs().lessThan(0.5).toFloat();
  const bits = o.instanced ? attribute('aLights', 'float') : float(0);
  const bit = (n: number): L => mod(floor(bits.div(n)), 2);
  const base = vertexColor(0);
  const paintK = is(PART.paint);
  const liveryK = is(PART.livery);
  const glassK = is(PART.glass);
  const paintRough = o.profile === 'full' ? 0.3 : 0.3;
  const paintLike = paintK.add(liveryK);

  // ---- colour: the vertex colour, the paint part times the instance tint, the livery panel on its bit
  let colour: L = base;
  if (o.instanced) {
    const tint = attribute('aTint', 'vec3');
    const livery = bit(LIVERY_BIT);
    const tinted = tint.mul(paintK).add(liveryK.mul(float(1).sub(livery)).mul(tint)).add(liveryK.mul(livery).mul(vec3(1, 1, 1))).add(float(1).sub(paintLike).mul(vec3(1, 1, 1)));
    colour = base.mul(tinted);
  }

  // ---- roughness and metalness by part
  let rough: L = paintLike.mul(paintRough);
  for (const [id, r] of Object.entries(ROUGHNESS)) rough = rough.add(is(Number(id)).mul(r));
  const metal: L = is(PART.rim).mul(0.85).add(is(PART.chrome).mul(0.9)).add(paintLike.mul(o.profile === 'full' ? 0.25 : 0.15)).add(0.02);

  // ---- emission: lamps from the bits and the darkness, the steady glow parts, the sky reflection
  const dark = (o.sky.uDark as unknown as L).sub(HEADLIGHTS_DARK).div(0.2).clamp(0, 1);
  const brake = bit(LIGHT.brake);
  const hazard = bit(LIGHT.hazard);
  const dome = bit(LIGHT.dome);
  const uTime = o.uTime ?? (uniformNode(0) as unknown as U<number>);
  const flash = fract(uTime.mul(1.5)).lessThan(0.5).toFloat();
  const amberOn = hazard.mul(flash);
  let emissive: L;
  if (o.instanced) {
    const head = base.mul(is(PART.lampHead)).mul(dark).mul(2.2);
    const tail = base.mul(is(PART.lampBrake)).mul(dark.mul(0.55).add(brake.mul(1.6)).min(1.8));
    const amber = vec3(1, 0.55, 0.05).mul(is(PART.lampHead).add(is(PART.lampBrake)).add(is(PART.amber)).min(1)).mul(amberOn).mul(2);
    const cyan = vec3(0.25, 0.9, 1).mul(is(PART.dome)).mul(dome).mul(1.4);
    const glow = base.mul(is(PART.glow).add(is(PART.sirenRed)).add(is(PART.sirenBlue))).mul(1.2);
    emissive = head.add(tail).add(amber).add(cyan).add(glow);
  } else {
    const lamps = is(PART.lampHead).add(is(PART.lampBrake)).add(is(PART.sirenRed)).add(is(PART.sirenBlue)).add(is(PART.dome)).add(is(PART.amber)).add(is(PART.glow)).min(1);
    emissive = base.mul(lamps).mul(1.4);
  }
  if (o.profile !== 'legacy') {
    emissive = emissive.add(reflectTerm(o.sky, 0.05, { strength: paintLike.mul(0.85).add(glassK.mul(1.4)) }));
  }

  const glassPass = o.pass === 'glass';
  const m = o.profile === 'full' ? new MeshPhysicalNodeMaterial({ roughness: 0.4, metalness: 0.1 }) : new MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.1 });
  m.colorNode = asNode(colour);
  m.roughnessNode = rough as never;
  m.metalnessNode = metal as never;
  m.emissiveNode = asNode(emissive);
  if (m instanceof MeshPhysicalNodeMaterial) {
    m.clearcoat = 1;
    m.clearcoatRoughness = 0.08;
    m.clearcoatNode = paintK as never;
  }
  if (glassPass) {
    m.transparent = true;
    m.opacity = 0.55;
    m.depthWrite = false;
  }
  return m;
}

/** The factory the object pool uses for the vehicles and props it draws per entity (no instance attributes). */
export function artMaterialFactory(profile: ArtProfile, sky: SkyNodes): ArtMaterialFactory & { kind: ArtMaterialKind } {
  return {
    kind: materialKindOf(profile),
    make(pass: 'opaque' | 'glass'): Material {
      return makeArtMaterial({ profile, sky, pass: profile === 'full' ? pass : 'opaque', instanced: false });
    },
  };
}
