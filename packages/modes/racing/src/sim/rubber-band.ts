/**
 * Rubber-banding and player catch-up (06-racing.md 2.9; M07a2). Rival multiplier m = 1 + maxPct * rb * clamp(gap / gapScale, -1, 1)
 * on the target speed and the power, where gap = player progress - rival progress (metres) and rb = event strength * difficulty
 * factor. The band never moves anything by more than `maxPct` (8 %), is frozen once the rival is in the last `freezeLastPct` of the
 * route, and is off (m = 1) in time trials, ghosts, speedtraps, drift and multiplayer. Sim code under the C02 lint.
 */
import type { Difficulty, RaceKind } from '@dv/shared';
import type { RacingConfig } from '../config.ts';

export type BandCfg = RacingConfig['rubberBand'];

/** Kinds that run without a band. */
export const NO_BAND_KINDS: readonly RaceKind[] = ['speedtrap', 'drift', 'sideshow'];

export function bandStrength(cfg: BandCfg, eventRb: number, difficulty: Difficulty, kind: RaceKind, timeTrial: boolean): number {
  if (timeTrial || NO_BAND_KINDS.includes(kind)) return 0;
  const rb = eventRb * cfg.difficulty[difficulty];
  return rb < 0 ? 0 : rb > 1 ? 1 : rb;
}

export interface BandState { frozen: boolean; held: number }
export const newBand = (): BandState => ({ frozen: false, held: 1 });

/** The multiplier for this think; `progress01` is the rival's share of the full race distance. */
export function rubberMult(cfg: BandCfg, st: BandState, gapM: number, rb: number, progress01: number): number {
  if (rb <= 0) return 1;
  if (st.frozen) return st.held;
  if (progress01 >= 1 - cfg.freezeLastPct) {
    st.frozen = true;
    return st.held;
  }
  const g = gapM / cfg.gapScaleM;
  const c = g < -1 ? -1 : g > 1 ? 1 : g;
  const m = 1 + cfg.maxPct * rb * c;
  st.held = m;
  return m;
}

export interface CatchUpState { behindTicks: number; granted: boolean }
export const newCatchUp = (): CatchUpState => ({ behindTicks: 0, granted: false });

/**
 * Player catch-up (easy and normal, single player): more than 200 m behind the leader for 15 s grants one nitro refill of
 * `underdogNitro` times the normal amount. Returns the multiplier for the refill (1 when none is granted this tick).
 */
export function stepCatchUp(cfg: BandCfg, st: CatchUpState, behindM: number, difficulty: Difficulty, tickHz: number): number {
  if (difficulty === 'hard') return 1;
  if (behindM > 200) st.behindTicks++;
  else {
    st.behindTicks = 0;
    st.granted = false;
  }
  if (!st.granted && st.behindTicks >= 15 * tickHz) {
    st.granted = true;
    return cfg.underdogNitro;
  }
  return 1;
}
