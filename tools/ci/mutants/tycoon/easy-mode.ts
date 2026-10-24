import type { TycoonDeps } from '../harness.ts';

export const description = 'A unicorn needs a 6 million dollar round (B3)';

export function patch(deps: TycoonDeps): TycoonDeps {
  return { ...deps, balanceFile: 'tools/ci/tycoon-sim/fixtures/easy-mode.balance.json' };
}
