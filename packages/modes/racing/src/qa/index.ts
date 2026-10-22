/** QA-only entry points of racing (M07a1): the bot, the headless scenario, the corridor codec, the det specs. Never in a production chunk. */
export { createRacingLineDriver, ensureRacingBot, RACING_LINE_DRIVER_ID, speedPlan, planAt } from './line-driver.ts';
export { ensureRacingLoader, RACING_SUITE, DEFAULT_CAR, corridorChunks, type RacingObservation } from './scenario.ts';
export { decodeCorridor, decodeCorridorRaw, encodeCorridorRaw, type Corridor } from './corridor.ts';
export { racingSpec, RACING_GOLDEN, RACING_SEED, racingTraceFile } from './specs.ts';

import { ensureRacingBot } from './line-driver.ts';
import { ensureRacingLoader } from './scenario.ts';

/** Registers the racing loader and bot. Idempotent. */
export function registerRacingQa(): void {
  ensureRacingLoader();
  ensureRacingBot();
}
