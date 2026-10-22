/**
 * The two rules a mutant of the `missions` suite turns the wrong way (M05a2; `tools/ci/mutants/missions/`): how the mission RNG is
 * seeded and whether the mission clock counts the ticks of a beat. Production code never sets them; the mutant harness replaces them
 * for one run with `setMissionDeps` and puts the defaults back.
 */
import { hash32 } from './util.ts';

export interface MissionDeps {
  /** The seed of the mission RNG: `hash32(storySeed, missionId, attempt)` (C09 section C6). */
  missionSeed(storySeed: number, missionId: string, attempt: number): number;
  /** True counts the ticks of a cutscene or in-engine beat as mission time. The rule is: it does not. */
  clockCountsBeats: boolean;
}

export const DEFAULT_MISSION_DEPS: MissionDeps = {
  missionSeed: (storySeed, missionId, attempt) => hash32(storySeed, missionId, attempt),
  clockCountsBeats: false,
};

let current: MissionDeps = DEFAULT_MISSION_DEPS;

export const missionDeps = (): MissionDeps => current;

/** Tests and the mutant harness only. `null` restores the defaults. */
export function setMissionDeps(d: Partial<MissionDeps> | null): void {
  current = d ? { ...DEFAULT_MISSION_DEPS, ...d } : DEFAULT_MISSION_DEPS;
}
