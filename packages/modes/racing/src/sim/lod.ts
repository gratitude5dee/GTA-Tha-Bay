/**
 * Vehicle model tiers of rivals (06-racing.md 2.2; M07a2). M1 is a body with four ray casts at 60 Hz, M2 the route-following point
 * mass at 30 Hz. A rival within `m1PromoteM` of the player is promoted when the tier's M1 budget has room, and demoted beyond
 * `m1DemoteM`. The gap between the two radii keeps a rival from flickering at the edge. Promotion and demotion carry position,
 * velocity, yaw and gear and read only sim state, so `local` and `canonical` agree. Sim code under the C02 lint.
 */
import type { QualityTierId } from '@dv/shared';
import type { RacingConfig } from '../config.ts';

export type VehicleTier = 'M1' | 'M2';

export interface TierDecision { tier: VehicleTier; changed: boolean }

/**
 * `m1Active` counts the rivals (and police) already on M1 this tick, this one excluded. `engineHasM1` is false when the host can
 * only draw rivals as point masses (the engine port of M07a2); then every vehicle stays M2.
 */
export function decideTier(cfg: RacingConfig['models'], tier: QualityTierId, current: VehicleTier, distM: number, m1Active: number, engineHasM1: boolean): TierDecision {
  if (!engineHasM1) return { tier: 'M2', changed: current !== 'M2' };
  const cap = cfg.m1MaxActive[tier];
  if (current === 'M2') {
    if (distM < cfg.m1PromoteM && m1Active < cap) return { tier: 'M1', changed: true };
    return { tier: 'M2', changed: false };
  }
  if (distM > cfg.m1DemoteM) return { tier: 'M2', changed: true };
  return { tier: 'M1', changed: false };
}

/** What a tier change carries. */
export interface CarriedState { pos: [number, number, number]; vel: [number, number, number]; yaw: number; gear: number }

export function carry(s: CarriedState): CarriedState {
  return { pos: [s.pos[0], s.pos[1], s.pos[2]], vel: [s.vel[0], s.vel[1], s.vel[2]], yaw: s.yaw, gear: s.gear };
}
