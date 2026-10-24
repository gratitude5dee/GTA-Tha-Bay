/** Mutant 1 of `missions` (M05a2): the mission RNG is seeded without the attempt, `hash32(storySeed, missionId)`. */
import { hash32 } from '../../../../packages/modes/story/src/vm/util.ts';
import type { MissionsDeps } from '../harness.ts';

export const description = 'mission RNG seeded without attempt';

export function patch(deps: MissionsDeps): MissionsDeps {
  return { ...deps, missionSeed: (storySeed, missionId) => hash32(storySeed, missionId) };
}
