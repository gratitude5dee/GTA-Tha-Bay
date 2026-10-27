/**
 * The `RunSpec`s of the racing det suite (M07a1): one car, seed 0xC0FFEE, the sprint, driver `racing.line`. The Node golden is
 * `tests/golden/racing/line.ferry-ocean-beach.json`; `@racing-det` runs the same spec in WebKit (Chromium nightly).
 */
import type { RunSpec } from '@dv/engine/qa';
import { DEFAULT_RACE } from '../race-ids.ts';

export const RACING_SEED = 0xc0ffee;
export const RACING_GOLDEN = { line: 'line.ferry-ocean-beach', noise: 'line.ferry-ocean-beach.noise', race3: 'race3.vs-circuit' } as const;
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

/** The 3-car race of M07a2: the line bot against the two AI rivals on the Embarcadero circuit (three laps), seed 0xC0FFEE. */
export const RACE3_ID = 'sf.circuit.embarcadero-vanness';
export const race3Spec = (): RunSpec => racingSpec({ raceId: RACE3_ID, maxTicks: 30_000 });
/** The replay the 3-car run records, byte for byte (M12e reuses it). */
export const RACE3_REPLAY = 'tests/golden/racing/vs-circuit.dvreplay';
