/**
 * Robotaxis of the fictional operator (02-world-living.md section 3; M03b1). The quirk numbers live in
 * `packages/shared/src/vehicle/quirks.ts` (A-S06-5) and are imported, not copied.
 *
 *  1. speed: 0.95 x the edge limit, never above it, no personality;
 *  2. autoYield: radius 14 m, brakes up to 0.7 g for a pedestrian, vehicle or prop closing at more than 4 m/s;
 *  3. pedestrians: stops for one within 3 m of the lane ahead inside 20 m, and at every occupied crosswalk;
 *  4. dark signal: stops (an all-way stop); with probability 0.35 per dark junction it stalls for a seeded 4 to 9 s, hazard lights on,
 *     blocking its lane;
 *  5. witness: see `witness.ts`.
 *
 * Pure; C02 lint applies.
 */
import { AUTO_YIELD_MAX_G, autoYieldBrakeDemand, darkSignalHoldTicks } from '@dv/shared';
import type { Agent } from './agent.ts';
import type { Intruder } from './reactions.ts';

/** The share of the limit a robotaxi drives at. */
export const ROBOTAXI_SPEED_FACTOR = 0.95;
/** Probability that a robotaxi stalls at a dark junction. */
export const STALL_PROBABILITY = 0.35;
/** The stall starts when the dark signal is this close ahead, metres (the quirk's 12 m). */
export const STALL_TRIGGER_M = 12;
/** A pedestrian within this distance of the lane ahead stops a robotaxi, and how far ahead it looks, metres. */
export const PED_LATERAL_M = 3;
export const PED_LOOKAHEAD_M = 20;
/** autoYield radius, metres. */
export const AUTO_YIELD_RADIUS_M = 14;
/** Gravity used by the autoYield demand, m/s^2. */
export const G = 9.81;

/** The speed cap of a robotaxi on an edge with limit `limit`. */
export const robotaxiSpeedCap = (limit: number): number => limit * ROBOTAXI_SPEED_FACTOR;

/**
 * The deceleration autoYield asks for an obstacle (a negative acceleration, m/s^2), or 0. Zero outside the radius or when the
 * gap closes at 4 m/s or less.
 */
export function autoYieldAccel(hit: Intruder): number {
  const demand = autoYieldBrakeDemand(AUTO_YIELD_RADIUS_M, hit.gap, hit.closing);
  return demand > 0 ? -demand * AUTO_YIELD_MAX_G * G : 0;
}

/**
 * The once-per-junction roll for a stall. Draws two numbers from the agent's stream the first time it is asked about this
 * junction and remembers the junction, so the answer does not change while it waits. Returns the hold in ticks, or 0 for no stall.
 */
export function rollStall(a: Agent, junction: number): number {
  if (a.rtJct === junction) return 0;
  a.rtJct = junction;
  const stalls = a.rng.nextFloat() < STALL_PROBABILITY;
  const u = a.rng.nextFloat();
  return stalls ? darkSignalHoldTicks(u) : 0;
}
