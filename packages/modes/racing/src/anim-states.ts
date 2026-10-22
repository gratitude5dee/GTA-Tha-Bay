/**
 * `AnimStateId` block 128 to 159, reserved for racing by ADR-0016 (06-racing-data.md 4.5). Vehicle entities carry these in the
 * snapshot `anim` byte, so remote cars show nitro, drift and wreck state.
 */
import type { AnimStateId } from '@dv/shared';

export const RACING_ANIM = {
  vehicleIdle: 128,
  driving: 129,
  braking: 130,
  drifting: 131,
  nitro: 132,
  airborne: 133,
  hop: 134,
  wrecked: 135,
  stalled: 136,
  sirensOn: 137,
  driverCelebrate: 144,
  driverDejected: 145,
  driverResetWave: 146,
  repairKneel: 147,
  photoPose: 148,
} as const satisfies Record<string, AnimStateId>;

export const RACING_ANIM_MIN = 128;
export const RACING_ANIM_MAX = 159;

/** The vehicle anim id for a car's state this tick; the highest-priority state wins. */
export function vehicleAnim(s: { totaled: boolean; stalled: boolean; hop: boolean; airborne: boolean; nitro: boolean; drifting: boolean; braking: boolean; moving: boolean }): AnimStateId {
  if (s.totaled) return RACING_ANIM.wrecked;
  if (s.stalled) return RACING_ANIM.stalled;
  if (s.hop) return RACING_ANIM.hop;
  if (s.airborne) return RACING_ANIM.airborne;
  if (s.nitro) return RACING_ANIM.nitro;
  if (s.drifting) return RACING_ANIM.drifting;
  if (s.braking) return RACING_ANIM.braking;
  return s.moving ? RACING_ANIM.driving : RACING_ANIM.vehicleIdle;
}
