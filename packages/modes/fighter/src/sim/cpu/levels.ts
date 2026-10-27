/**
 * The four CPU levels (FC10.4): reaction scale, execution error, habit variety and the block-rate shift. The reaction range of the kit
 * (`AiProfile.reaction`, frames) is scaled by `reactionPct` per cent; `errorPct` is the chance that a macro drops or delays a step;
 * `habits` is how many of the best-scored actions the CPU picks among; `blockDelta` shifts the kit's block rate (points).
 * Sim code under the C02 lint.
 */
import type { CpuLevel } from '../../types.ts';

export interface CpuLevelParams {
  readonly name: 'easy' | 'normal' | 'hard' | 'brutal';
  readonly reactionPct: number;
  readonly errorPct: number;
  readonly habits: number;
  readonly blockDelta: number;
}

export const CPU_LEVELS: readonly [CpuLevelParams, CpuLevelParams, CpuLevelParams, CpuLevelParams] = [
  { name: 'easy', reactionPct: 160, errorPct: 20, habits: 3, blockDelta: -20 },
  { name: 'normal', reactionPct: 100, errorPct: 10, habits: 5, blockDelta: 0 },
  { name: 'hard', reactionPct: 70, errorPct: 4, habits: 8, blockDelta: 10 },
  { name: 'brutal', reactionPct: 45, errorPct: 0, habits: 12, blockDelta: 20 },
];

export const levelParams = (l: CpuLevel): CpuLevelParams => CPU_LEVELS[l];

/** Decisions fall on even ticks only (the C02 30 Hz AI rate, `AI_DIVISOR 2`) and every 4 to 8 frames. */
export const DECISION_MIN = 4;
export const DECISION_STEP = 2;
export const DECISION_SPREAD = 3;   // 4, 6 or 8 frames
export const AI_DIVISOR = 2;

/** The kit's reaction range scaled for a level, frames. */
export function reactionRange(kit: readonly [number, number], l: CpuLevelParams): [number, number] {
  return [Math.max(1, Math.trunc((kit[0] * l.reactionPct) / 100)), Math.max(1, Math.trunc((kit[1] * l.reactionPct) / 100))];
}
