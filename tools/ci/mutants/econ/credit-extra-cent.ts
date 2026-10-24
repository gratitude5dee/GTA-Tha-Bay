/** Mutant 1 of `econ` (M04d): the ledger model's `credit` adds one extra cent. */
import type { ModelDeps } from '../../econ-sim/model.ts';

export const description = 'credit adds one extra cent';

export function patch(deps: ModelDeps): ModelDeps {
  return { ...deps, creditBias: deps.creditBias + 1 };
}
