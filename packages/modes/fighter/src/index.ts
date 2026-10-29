/**
 * `@dv/mode-fighter`: Culture Wars. The descriptor and the data the shell needs without loading the sim half (the sim half and the
 * UI half are lazy imports, as C06 asks), plus the tools around the pure fight core of M08a1 (`fighter:lint`, `fighter:replay`,
 * the QA input drivers). The core is `@dv/shared/fight`.
 *
 * M08a2: the descriptor is `available` (tile order 3, `simProfile: 'any'`, `world: 'stage'`, no physics). The fighters and the
 * stage are gray-box; the mode unlocks with `unlock.fighter` (the first story bout, `m.a1.05`).
 */
import type { GameModeDescriptor, UnlockDef } from '@dv/shared';
import unlocksJson from '../../../../config/unlocks.json';

export { lintKit, lintTuning, lintReplay, kitTable, FX3_EXPECT } from './lint/index.ts';
export type { LintIssue, LintRule, KitRow } from './lint/index.ts';
export { createScriptDriver, scriptFrames, ScriptBuilder } from './qa/script-driver.ts';
export type { ScriptDriver, ScriptDriverOptions } from './qa/script-driver.ts';
export { FIGHTER_ANIM, animOfState } from './anim-states.ts';
export type { StageDef, BoutDef, StageId, FighterEnterParams, CpuLevel } from './types.ts';

/** The tile `art` is the C07 ref `ui/mode-fighter`. */
export function fighterDescriptor(): GameModeDescriptor {
  return {
    id: 'fighter',
    version: 1,
    titleKey: 'mode.fighter.title',
    tile: { art: 'ui/mode-fighter', order: 3 },
    status: 'available',
    unlock: 'unlock.fighter',
    standalone: true,
    embeddable: true,
    requires: { simProfile: 'any', world: 'stage', physics: false, xr: 'seated', inputContexts: ['fighter', 'menu', 'cutscene'], network: 'optional' },
    saveSlot: 'mode:fighter',
    sliceSchema: 1,
    sim: () => import('./sim/mode.ts').then((m) => ({ default: m.fighterSim })),
    ui: () => import('./ui/index.ts').then((m) => ({ default: m.fighterUi })),
  };
}

/** The unlock rows of the fighter: the tile with the starter fighters (FX8.2) and the first roster unlock. Story registers the same rows from `config/unlocks.json`. */
export function fighterUnlockDefs(): UnlockDef[] {
  return (unlocksJson as { unlocks: UnlockDef[] }).unlocks.filter((u) => u.id === 'unlock.fighter' || u.id.startsWith('unlock.fighter.')).map((u) => ({ ...u }));
}
