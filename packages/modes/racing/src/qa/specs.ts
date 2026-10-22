/**
 * The `RunSpec`s of the racing det suite (M07a1): one car, seed 0xC0FFEE, the sprint, driver `racing.line`. The Node golden is
 * `tests/golden/racing/line.ferry-ocean-beach.json`; `@racing-det` runs the same spec in WebKit (Chromium nightly).
 */
import type { RunSpec } from '@dv/engine/qa';
import { DEFAULT_RACE } from '../race-ids.ts';

export const RACING_SEED = 0xc0ffee;
export const RACING_GOLDEN = { line: 'line.ferry-ocean-beach', noise: 'line.ferry-ocean-beach.noise' } as const;
export const racingTraceFile = (name: string): string => `tests/golden/racing/${name}.json`;

/** The full sprint with the supercar. `maxTicks` is 1.5 x the expected 480 s (13-qa.md 3.1). */
export function racingSpec(o: { maxTicks?: number; checkpointEvery?: number; noise?: number; vehicle?: string; raceId?: string } = {}): RunSpec {
  const raceId = o.raceId ?? DEFAULT_RACE;
  return {
    suite: 'racing',
    scenario: raceId,
    seed: RACING_SEED,
    profile: 'canonical',
    maxTicks: o.maxTicks ?? 43_200,
    checkpointEvery: o.checkpointEvery ?? 600,
    bot: { driver: 'racing.line', params: { raceId, vehicle: o.vehicle ?? 'vehicle.aurelian-sorrel', ...(o.noise ? { noise: o.noise } : {}) } },
  };
}
