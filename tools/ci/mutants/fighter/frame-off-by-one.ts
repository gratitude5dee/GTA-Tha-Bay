/** Mutant 1 of `fighter` (M08a2): every input reaches the core one frame late (a frame-off-by-one in the input path). */
import type { FighterDeps } from '../harness.ts';

export const description = 'inputs delayed by one frame';

export function patch(deps: FighterDeps): FighterDeps {
  return { ...deps, inputDelay: 1 };
}
