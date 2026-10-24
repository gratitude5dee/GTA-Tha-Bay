import type { TycoonDeps } from '../harness.ts';

export const description = 'A bot counters outside the envelope (B11)';

export function patch(deps: TycoonDeps): TycoonDeps {
  return { ...deps, botModule: 'tools/ci/tycoon-sim/fixtures/offer-out-of-band.bot.ts' };
}
