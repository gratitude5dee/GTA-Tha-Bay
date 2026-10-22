/**
 * QA-only entry points of the story mode (M05a2): the autoplayer, the headless `missions` scenario and the det specs. Never in a
 * production chunk: the identifiers `registerBot` and `registerScenarioLoader` are on the `check:bundle` deny list.
 */
export { createStoryAutoplayer, STORY_AUTOPLAYER_ID, describeGoal } from './autoplay/driver.ts';
export { observeMission } from './autoplay/observe.ts';
export type { MissionObs, ObjView } from './autoplay/observe.ts';
export { ensureMissionsLoader, MISSIONS_SUITE, encodeBundle, decodeBundle, missionFlags } from './scenario.ts';
export type { MissionBundle, MissionsHandle } from './scenario.ts';
export { missionSpec, MISSIONS_GOLDEN, missionsTraceFile, missionsMaxTicks } from './specs.ts';
export { setMissionDeps, DEFAULT_MISSION_DEPS } from './vm/deps.ts';
export type { MissionDeps } from './vm/deps.ts';

import { registerBot, registeredBots } from '@dv/engine/qa';
import { createStoryAutoplayer, STORY_AUTOPLAYER_ID } from './autoplay/driver.ts';
import { ensureMissionsLoader } from './scenario.ts';

/** Registers the `missions` loader and the `story.autoplayer` bot. Idempotent. */
export function registerStoryQa(): void {
  ensureMissionsLoader();
  if (!registeredBots().includes(STORY_AUTOPLAYER_ID)) registerBot(STORY_AUTOPLAYER_ID, createStoryAutoplayer);
}
