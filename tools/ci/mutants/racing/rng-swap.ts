/** Mutant 1 of `racing` (M07a1): the `bot` RNG stream is swapped for the `world` stream. */
import { RngStreams } from '../../../../packages/shared/src/rng.ts';
import type { RacingDeps } from '../harness.ts';

export const description = 'bot RNG stream swapped for world';

export function patch(deps: RacingDeps): RacingDeps {
  return {
    ...deps,
    botRng(seed) {
      const r = new RngStreams(seed).get('world');
      return () => r.nextFloat();
    },
  };
}
