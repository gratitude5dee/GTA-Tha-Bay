/** Mutant 1 of `engine-lines` (M04d): the `bot` RNG stream is swapped for the `world` stream. */
import { RngStreams } from '../../../../packages/shared/src/rng.ts';
import type { RunnerDeps } from '../../../../packages/engine/src/qa/runner.ts';

export const description = 'bot RNG stream swapped for world';

export function patch(deps: RunnerDeps): RunnerDeps {
  return {
    ...deps,
    botRng(seed) {
      const r = new RngStreams(seed).get('world');
      return () => r.nextFloat();
    },
  };
}
