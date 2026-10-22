/**
 * The `RunSpec`s of the missions suite (M05a2): one mission, one seed, the autoplayer under the `canonical` profile. `check:missions`
 * runs every (mission, seed) with instant beats; the det entry (`@determinism`) runs `m.dev.sample` seed 1 with the beats played, so
 * the clock rule that leaves a beat out of mission time is part of the trace. The Node golden is
 * `tests/golden/missions/m.dev.sample.1.json`; `det-suites.spec.ts` runs the same spec in Chromium and WebKit.
 */
import type { RunSpec } from '@dv/engine/qa';

export const MISSIONS_GOLDEN = { sample: 'm.dev.sample.1' } as const;
export const missionsTraceFile = (name: string): string => `tests/golden/missions/${name}.json`;

/** `maxTicks = expectedSec[1] x 60 x 1.5` (13-qa.md 3.1). */
export const missionsMaxTicks = (expectedSecMax: number): number => Math.ceil(expectedSecMax * 60 * 1.5);

export function missionSpec(o: { id: string; seed: number; expectedSecMax: number; flags?: RunSpec['flags']; checkpointEvery?: number; params?: Record<string, unknown> }): RunSpec {
  return {
    suite: 'missions',
    scenario: o.id,
    seed: o.seed,
    profile: 'canonical',
    maxTicks: missionsMaxTicks(o.expectedSecMax),
    checkpointEvery: o.checkpointEvery ?? 600,
    bot: { driver: 'story.autoplayer', ...(o.params ? { params: o.params } : {}) },
    flags: o.flags ?? { beats: 'instant', talk: 'scripted', hooks: 'bot' },
  };
}
