import type { TycoonDeps } from '../harness.ts';

export const description = 'Frugal customers cost a tenth (B4)';

export function patch(deps: TycoonDeps): TycoonDeps {
  return { ...deps, balanceFile: 'tools/ci/tycoon-sim/fixtures/dominant-strategy.balance.json' };
}
