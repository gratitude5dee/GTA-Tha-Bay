/**
 * Light state of the instanced cars (02-world-living.md sections 2.6 and 4 rule "head and tail lights on cars when `uDark > 0.4`";
 * M03b1). The sim publishes bits in `Anim.state` (brake, hazard, robotaxi dome); the page adds the head and tail lamps from the
 * darkness. Every car has one instance attribute, `aLights`, a float holding the bits, and the material reads them in TSL: no
 * per-car uniform, no extra draw.
 *
 * `lampEmissive` is the TSL for the emissive colour of a gray-box car whose local frame is +X right, +Y up, forward -Z, in a box of
 * half width `hw` and half length `hl`, origin at the centre of the physics box (the sim's `Transform`): the lamps sit on the two end faces and the four corners.
 */
import { uniform as uniformNode } from 'three/tsl';
import { HEADLIGHTS_DARK, headlightsOn } from '../sky/night.ts';
import type { SkyNodes } from '../sky/nodes.ts';
import { asNode, attribute, clamp, float, floor, fract, mod, positionLocal, vec3, type L, type U } from '../sky/tsl.ts';

/** Bit values of `Anim.state` for traffic (the same as `LightBit` in the sim). */
export const LIGHT = { brake: 1, hazard: 2, dome: 4 } as const;

export { HEADLIGHTS_DARK, headlightsOn };

/** Whether a bit is set in the value the `aLights` attribute carries. */
export function hasBit(bits: number, bit: number): boolean {
  return (bits & bit) !== 0;
}

export interface LampNodes {
  /** Seconds, for the hazard flash; the renderer writes it every frame. */
  uTime: U<number>;
  emissive: ReturnType<typeof asNode>;
}

export function lampEmissive(sky: SkyNodes, halfWidth: number, halfLength: number): LampNodes {
  const uTime = uniformNode(0) as unknown as U<number>;
  const bits = attribute('aLights', 'float');
  const bit = (n: number): L => mod(floor(bits.div(n)), 2);
  const brake = bit(LIGHT.brake);
  const hazard = bit(LIGHT.hazard);
  const dome = bit(LIGHT.dome);
  const dark = (sky.uDark as unknown as L).sub(HEADLIGHTS_DARK).div(0.2).clamp(0, 1);
  const p = positionLocal;
  const front = p.z.lessThan(-halfLength + 0.18).toFloat();
  const rear = p.z.greaterThan(halfLength - 0.18).toFloat();
  const lampBand = p.y.greaterThan(-0.3).toFloat().mul(p.y.lessThan(0.06).toFloat());
  const wide = p.x.abs().greaterThan(halfWidth * 0.45).toFloat();
  const lamp = lampBand.mul(wide);
  // head lamps: warm white; tail lamps: dim red, bright red under braking
  const head = vec3(1, 0.93, 0.78).mul(front).mul(lamp).mul(dark).mul(2.2);
  const tailLevel = dark.mul(0.55).add(brake.mul(1.6)).min(1.8);
  const tail = vec3(1, 0.08, 0.05).mul(rear).mul(lamp).mul(tailLevel);
  // hazards: amber on all four corners, flashing at about 1.5 Hz
  const flash = fract(uTime.mul(1.5)).lessThan(0.5).toFloat();
  const corner = front.add(rear).min(1).mul(p.x.abs().greaterThan(halfWidth * 0.8).toFloat()).mul(lampBand);
  const amber = vec3(1, 0.55, 0.05).mul(corner).mul(hazard).mul(flash).mul(2);
  // robotaxi dome on the roof
  const roof = p.y.greaterThan(0.38).toFloat().mul(p.z.abs().lessThan(0.5).toFloat());
  const cyan = vec3(0.25, 0.9, 1).mul(roof).mul(dome).mul(1.4);
  void clamp;
  void float;
  return { uTime, emissive: asNode(head.add(tail).add(amber).add(cyan)) };
}
