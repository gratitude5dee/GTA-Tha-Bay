/**
 * `@dv/mode-fighter` (M08a1): the tools around the pure fight core in `@dv/shared/fight`: the frame-data lint, the replay
 * verifier and the QA input driver. The mode itself (descriptor, ECS mirror, camera, HUD, Training, stage) is M08a2.
 */
export { lintKit, lintTuning, lintReplay, kitTable, FX3_EXPECT } from './lint/index.ts';
export type { LintIssue, LintRule, KitRow } from './lint/index.ts';
export { createScriptDriver, scriptFrames, ScriptBuilder } from './qa/script-driver.ts';
export type { ScriptDriver, ScriptDriverOptions } from './qa/script-driver.ts';
