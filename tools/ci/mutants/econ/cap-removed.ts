/** Mutant 2 of `econ` (M04d): the weekly dividend cap is removed. */
import type { ModelDeps } from '../../econ-sim/model.ts';

export const description = 'weekly dividend cap removed';

export function patch(deps: ModelDeps): ModelDeps {
  return { ...deps, weeklyDividendCapCents: Number.MAX_SAFE_INTEGER };
}
