/**
 * Quirk data and pure helpers (06-racing-content.md C.3.3). `stepHandling` applies only `speedGovernor` in M03a1; the
 * ambient robotaxi brains of M03b1 import the other two helpers, so the numbers live in one place.
 */
import type { HandlingProfile, Quirk } from './handling.ts';

export const KPH_PER_MPS = 3.6;
/** Width of the speed band, kph below the limit, in which the governor fades the throttle out. */
export const GOVERNOR_FADE_KPH = 3;
/** autoYield brakes up to this many g. */
export const AUTO_YIELD_MAX_G = 0.7;
/** autoYield acts only when the gap closes faster than this, m/s. */
export const AUTO_YIELD_MIN_CLOSING_MPS = 4;
/** The dark-signal hold, seconds (inclusive lower, exclusive upper). */
export const DARK_SIGNAL_HOLD_SEC: readonly [number, number] = [4, 9];
/** The robotaxi's dark-signal override needs the Interact button held this long, seconds. */
export const DARK_SIGNAL_OVERRIDE_SEC = 2;

export function findQuirk<K extends Quirk['k']>(p: Pick<HandlingProfile, 'quirks'>, k: K): Extract<Quirk, { k: K }> | undefined {
  const list = p.quirks;
  if (!list) return undefined;
  for (let i = 0; i < list.length; i++) {
    const q = list[i] as Quirk;
    if (q.k === k) return q as Extract<Quirk, { k: K }>;
  }
  return undefined;
}

/** Throttle multiplier in 0..1: 1 below `limitKph - GOVERNOR_FADE_KPH`, falling linearly to 0 at the limit. */
export function governorThrottleScale(speedMps: number, limitKph: number): number {
  const kph = (speedMps < 0 ? -speedMps : speedMps) * KPH_PER_MPS;
  const lo = limitKph - GOVERNOR_FADE_KPH;
  if (kph <= lo) return 1;
  if (kph >= limitKph) return 0;
  return (limitKph - kph) / GOVERNOR_FADE_KPH;
}

/** A seeded hold time in ticks for a unit-interval draw `u` in [0, 1) (the caller draws it from `rng('racing.stall')`). */
export function darkSignalHoldTicks(u: number, tickHz = 60): number {
  const [lo, hi] = DARK_SIGNAL_HOLD_SEC;
  const clamped = u < 0 ? 0 : u >= 1 ? 0.999999 : u;
  return Math.floor((lo + clamped * (hi - lo)) * tickHz);
}

/**
 * Brake demand in 0..1 (1 = `AUTO_YIELD_MAX_G`) for an obstacle `gapM` ahead that the car closes on at `closingMps`.
 * Zero when the gap is outside `radiusM` or the closing speed is at or below `AUTO_YIELD_MIN_CLOSING_MPS`; otherwise the
 * deceleration that stops the car in the remaining gap, as a fraction of the maximum.
 */
export function autoYieldBrakeDemand(radiusM: number, gapM: number, closingMps: number): number {
  if (!(gapM < radiusM) || !(closingMps > AUTO_YIELD_MIN_CLOSING_MPS)) return 0;
  const gap = gapM < 0.5 ? 0.5 : gapM;
  const needG = (closingMps * closingMps) / (2 * gap * 9.81);
  const f = needG / AUTO_YIELD_MAX_G;
  return f > 1 ? 1 : f;
}
