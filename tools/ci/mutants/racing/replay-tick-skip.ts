/**
 * Mutant 3 of `racing` (M07a2): the frame source of a re-simulation drops one frame of the recorded inputs (the 3,000th), so every
 * later frame arrives one tick early and the replayed car ends elsewhere. The replay half of the suite must see it.
 */
import type { RacingDeps } from '../harness.ts';

export const description = 'a re-simulation skips one recorded input frame';

export function patch(deps: RacingDeps): RacingDeps {
  return { ...deps, replayTickSkip: (i) => i === 3000 };
}
