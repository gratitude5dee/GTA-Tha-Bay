/** QA-only entry points of the fighter (M08a1, M08a2): the input script driver, the CPU bot, the QA commands. Never in a production chunk. */
export { createScriptDriver, scriptFrames, ScriptBuilder } from './script-driver.ts';
export type { ScriptDriver, ScriptDriverOptions } from './script-driver.ts';
export { createFighterCpuDriver, createFighterScriptDriver, ensureFighterBots, FIGHTER_CPU_DRIVER_ID, FIGHTER_SCRIPT_DRIVER_ID } from './cpu-driver.ts';
export { runFighterQa, stateOf } from './debug.ts';

import { ensureFighterBots } from './cpu-driver.ts';

/** Registers the `fighter.script` and `fighter.cpu` bots. Idempotent. */
export function registerFighterQa(): void {
  ensureFighterBots();
}
