import type { TycoonDeps } from '../harness.ts';

export const description = 'A root event with a lethal follow-up (B5)';

export function patch(deps: TycoonDeps): TycoonDeps {
  return { ...deps, eventFiles: ['tools/ci/tycoon-sim/fixtures/chain-death.events.json'] };
}
