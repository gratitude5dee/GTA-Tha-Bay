/** QA-only entry points of racing (M07a1, M07a2): the bots, the headless scenario, the pursuit rig, the corridor codec, the det specs. Never in a production chunk. */
export { createRacingLineDriver, ensureRacingBot, RACING_LINE_DRIVER_ID, speedPlan, planAt } from './line-driver.ts';
export { ensureRacingLoader, RACING_SUITE, DEFAULT_CAR, corridorChunks, type RacingObservation } from './scenario.ts';
export { createRacingPursuitDriver, ensureRacingPursuitBot, PursuitBrain, RACING_PURSUIT_DRIVER_ID, PURSUIT_EVENT, standStillFrame, routeMetreOf } from './pursuit-bot.ts';
export { runPursuitRig, runPursuitPar, RigHost, RigWorld, RoutePort, FOG_SIGHT_M, CORNER_RAD, type PursuitRigOptions, type PursuitRigResult } from './pursuit-rig.ts';
export { createRacingChildBot, ensureRacingChildBot, observeRaceState } from './child-bot.ts';
export { decodeCorridor, decodeCorridorRaw, encodeCorridorRaw, type Corridor } from './corridor.ts';
export { racingSpec, race3Spec, RACE3_ID, RACE3_REPLAY, RACING_GOLDEN, RACING_SEED, racingTraceFile } from './specs.ts';

import { ensureRacingChildBot } from './child-bot.ts';
import { ensureRacingBot } from './line-driver.ts';
import { ensureRacingPursuitBot } from './pursuit-bot.ts';
import { ensureRacingLoader } from './scenario.ts';

/** Registers the racing loader and bot. Idempotent. */
export function registerRacingQa(): void {
  ensureRacingLoader();
  ensureRacingBot();
  ensureRacingPursuitBot();
  ensureRacingChildBot();
}
export { runHeadless, replayFrames, frameFromWord, type HeadlessRun, type HeadlessOptions } from './headless.ts';
