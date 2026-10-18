import { PHYSICS_CONFIG } from './config.ts';

/** One bit per collision group, from config/physics.json. */
export const GROUP_BIT = PHYSICS_CONFIG.groups;

/** Rapier interaction groups: membership in the high 16 bits, filter in the low 16 bits. */
export function interactionGroups(membership: number, filter: number): number {
  return (((membership & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
}

const ALL = 0xffff;
const SENSOR = GROUP_BIT.sensor;

/** Presets used by the engine. Sensors collide with nothing physically; they are queried only. */
export const GROUPS = Object.freeze({
  static: interactionGroups(GROUP_BIT.static, ALL & ~SENSOR),
  dynamic: interactionGroups(GROUP_BIT.dynamic, ALL & ~SENSOR),
  character: interactionGroups(GROUP_BIT.character, ALL & ~SENSOR),
  vehicle: interactionGroups(GROUP_BIT.vehicle, ALL & ~SENSOR),
  kinematic: interactionGroups(GROUP_BIT.kinematic, ALL & ~SENSOR),
  sensor: interactionGroups(SENSOR, 0),
});
