/** Mutant 2 of `fighter` (M08a2): the match RNG is seeded from another stream (the seed is changed before `init`). */
import type { FighterDeps } from '../harness.ts';

export const description = 'match RNG seeded from a different stream';

export function patch(deps: FighterDeps): FighterDeps {
  return { ...deps, matchSeed: (seed) => (seed ^ 0x5bd1e995) >>> 0 };
}
