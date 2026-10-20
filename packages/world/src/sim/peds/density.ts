/**
 * Pedestrian density (living parts 4.4, 4.5 and 7; M03b2): slots 256 to 511 of a chunk, the active prefix from `activeSlots` (tier,
 * hour and weather factors, the `TrafficControl` override), the per-tier crowd caps of C13 and the near-LOD caps.
 *
 * Prefix rule: the agent at `(cell, slot)` is a pure function of `(worldSeed, cell, slot, epoch)`, and a lower tier runs a prefix of
 * the slots a higher tier runs, so the lower tier's agents are a subset of the higher tier's. Pure; C02 lint applies.
 */
import { SLOT, type QualityTierId, type SimChunk } from '@dv/shared';
import budgets from '../../../../../config/tier-budgets.json';
import { AMBIENT_RADIUS_M, activeFor } from '../traffic/density.ts';

/** First ped slot of a chunk. */
export const PED_SLOT0 = SLOT.ped[0];
export const PED_SLOT_COUNT = SLOT.ped[1] - SLOT.ped[0] + 1;

/** Near level (the skinned mannequin) is within this of the focus, metres; far level is the instanced figure. */
export const NEAR_PED_M = 25;

/** Skinned near-LOD pedestrians per tier (living 4.5). */
export const NEAR_PED_CAP: Readonly<Record<QualityTierId, number>> = {
  'desktop-ultra': 24,
  desktop: 24,
  'xr-visionpro': 16,
  mobile: 12,
  'xr-quest': 8,
  'mobile-low': 6,
};

/** Share of the traffic ambient radius the pedestrians spawn and despawn by (BD-M03b2-01): they are small and slow. */
export const PED_RADIUS_SHARE = 0.6;

export function pedRadius(tier: QualityTierId): number {
  return AMBIENT_RADIUS_M[tier] * PED_RADIUS_SHARE;
}

/** The C13 pedestrian instance cap of a tier. */
export function pedCap(tier: QualityTierId): number {
  return (budgets as unknown as { tiers: Record<QualityTierId, { crowd: { maxPedInstances: number } }> }).tiers[tier].crowd.maxPedInstances;
}

export interface PedBudgetArgs {
  tier: QualityTierId;
  hour: number;
  weather: Parameters<typeof activeFor>[0]['weather'];
  /** `TrafficControl.densityOf('ped')`. */
  override: number;
}

/** How many of a chunk's ped slots (a prefix of 256 ...) are live now. */
export function pedBudget(c: Readonly<SimChunk>, a: PedBudgetArgs): number {
  const n = activeFor({
    capacity: Math.min(c.spawn.pedSlots, PED_SLOT_COUNT), kind: 'ped', tier: a.tier, profile: c.spawn.densityProfile,
    hour: a.hour, weather: a.weather, override: a.override,
  });
  return n;
}
