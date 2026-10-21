/** Mutant 2 of `engine-lines` (M04d): one tick skipped in the runner loop (the bot's frame for tick 100 never reaches the sim). */
import type { RunnerDeps } from '../../../../packages/engine/src/qa/runner.ts';

export const description = 'one tick skipped in the runner loop';

export function patch(deps: RunnerDeps): RunnerDeps {
  return { ...deps, skipTick: (i) => i === 100 };
}
