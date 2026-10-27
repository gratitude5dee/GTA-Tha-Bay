/**
 * The content of the mode as the browser and the sim worker load it: the tuning table, the two kits, the stage and the bout, bundled
 * as JSON (the fs loader `pack-files.ts` is for Node tools and builds the same pack: a test compares the two hashes). Sim code under
 * the C02 lint.
 */
import { buildPack } from '@dv/shared/fight';
import type { FighterDef, FightTuning, FrameDataPack } from '@dv/shared/fight';
import tuningJson from '../../../../../config/fighter.tuning.json';
import playerKit from '../../../../../content/fighter/kits/player.json';
import rapNewWaveKit from '../../../../../content/fighter/kits/rap_new_wave.json';
import powellTurntable from '../../../../../content/fighter/stages/powell_turntable.json';
import boutA5 from '../../../../../content/fighter/bouts/bout.a5.json';
import type { BoutDef, RosterEntry, StageDef, StageId } from '../types.ts';

/** The two gray-box fighters of VS-Fighter. The ids are the unlock grants (`config/unlocks.json`); the second is the stand-in of the roster slot. */
export const ROSTER: readonly RosterEntry[] = [
  { id: 'player', slot: 'PLAYER_FIGHTER', nameKey: 'fighter.name.player', colors: { body: 0x2f6fdd, trim: 0xf2c14e } },
  { id: 'standin_rap_new_wave', slot: 'RAP_NEW_WAVE', nameKey: 'fighter.name.standin_rap_new_wave', colors: { body: 0xd2467a, trim: 0x3ad6c2 } },
];

export const rosterEntry = (id: string): RosterEntry | undefined => ROSTER.find((r) => r.id === id);
export const rosterBySlot = (slot: string): RosterEntry | undefined => ROSTER.find((r) => r.slot === slot);

export const STAGES: Readonly<Partial<Record<StageId, StageDef>>> = {
  powell_turntable: powellTurntable as unknown as StageDef,
};
export const DEFAULT_STAGE: StageId = 'powell_turntable';

export const BOUTS: Readonly<Record<string, BoutDef>> = {
  'bout.a5': boutA5 as unknown as BoutDef,
};

export const stageDef = (id: StageId | string | undefined): StageDef => STAGES[(id ?? DEFAULT_STAGE) as StageId] ?? (STAGES[DEFAULT_STAGE] as StageDef);

let cached: FrameDataPack | null = null;

/** The frame-data pack of the two kits; built once (hash = canonical sha256, FC2). */
export function fighterPack(): FrameDataPack {
  if (cached) return cached;
  const kits: Record<string, FighterDef> = {};
  for (const k of [playerKit, rapNewWaveKit] as unknown as FighterDef[]) kits[k.slot] = k;
  cached = buildPack(kits, tuningJson as unknown as FightTuning);
  return cached;
}

/** QA: rebuilds the pack from a changed tuning table (`__dvBridge.fighter.reloadTuning`). */
export function reloadTuning(tuning: FightTuning): FrameDataPack {
  const kits = fighterPack().kits;
  cached = buildPack(kits as unknown as Record<string, FighterDef>, tuning);
  return cached;
}
