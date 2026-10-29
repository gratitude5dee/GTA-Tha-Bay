/**
 * Mutant 4 of `racing` (M07a2): the replay header check ignores `handlingRev`, so a replay recorded on another tuning of the car
 * passes for exact. The viewer half of the suite must see it.
 */
import { replayMismatch } from '../../../../packages/shared/src/index.ts';
import type { RacingDeps } from '../harness.ts';

export const description = 'the replay header check ignores handlingRev';

export function patch(deps: RacingDeps): RacingDeps {
  return { ...deps, replayMismatch: (h, cur) => replayMismatch(h, { ...cur, handlingRev: h.handlingRev }) };
}
