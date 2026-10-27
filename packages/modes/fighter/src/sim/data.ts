/**
 * The content of the mode as the browser and the sim worker load it: the tuning table, the two kits, the stage and the bout, bundled
 * as JSON (the fs loader `pack-files.ts` is for Node tools and builds the same pack: a test compares the two hashes). Sim code under
 * the C02 lint.
 */
import { buildPack } from '@dv/shared/fight';
import type { FameConfig, FighterDef, FightTuning, FrameDataPack, RosterEntry as RosterRow } from '@dv/shared/fight';
import tuningJson from '../../../../../config/fighter.tuning.json';
import playerKit from '../../../../../content/fighter/kits/player.json';
import rapNewWaveKit from '../../../../../content/fighter/kits/rap_new_wave.json';
import rapHyphyElderKit from '../../../../../content/fighter/kits/rap_hyphy_elder.json';
import rapLyricistKit from '../../../../../content/fighter/kits/rap_lyricist.json';
import techVisionaryKit from '../../../../../content/fighter/kits/tech_visionary.json';
import techHackerKit from '../../../../../content/fighter/kits/tech_hacker.json';
import athShooterKit from '../../../../../content/fighter/kits/ath_shooter.json';
import athPowerBackKit from '../../../../../content/fighter/kits/ath_power_back.json';
import influencerKit from '../../../../../content/fighter/kits/influencer.json';
import powellTurntable from '../../../../../content/fighter/stages/powell_turntable.json';
import boutA5 from '../../../../../content/fighter/bouts/bout.a5.json';
import rosterJson from '../../../../../content/fighter/roster.json';
import devSoulBundle from '../../../../../content/npcs/fighters-dev/bundle.json';
import fameJson from '../../../../../config/fame-domains.json';
import type { BoutDef, RosterEntry, StageDef, StageId } from '../types.ts';
import { loadRoster } from './roster.ts';
import type { LoadedFighter, RosterIssue, SoulLite } from './roster.ts';

/** The two gray-box fighters of VS-Fighter. The ids are the unlock grants (`config/unlocks.json`); the second is the stand-in of the roster slot. */
export const ROSTER: readonly RosterEntry[] = [
  { id: 'player', slot: 'PLAYER_FIGHTER', nameKey: 'fighter.name.player', colors: { body: 0x2f6fdd, trim: 0xf2c14e } },
  { id: 'standin_rap_new_wave', slot: 'RAP_NEW_WAVE', nameKey: 'fighter.name.standin_rap_new_wave', colors: { body: 0xd2467a, trim: 0x3ad6c2 } },
  // The other six slots of the v1 roster (M08b1): ids are the development souls' ids; the colours match the gray-box assets.
  { id: 'dev_hyphy_elder', slot: 'RAP_HYPHY_ELDER', nameKey: 'fighter.name.dev_hyphy_elder', colors: { body: 0xe8873a, trim: 0xf6d86b } },
  { id: 'dev_lyricist', slot: 'RAP_LYRICIST', nameKey: 'fighter.name.dev_lyricist', colors: { body: 0x3f8f6b, trim: 0xd9e6df } },
  { id: 'dev_visionary', slot: 'TECH_VISIONARY', nameKey: 'fighter.name.dev_visionary', colors: { body: 0x2b4a7a, trim: 0xc9d6ea } },
  { id: 'dev_hacker', slot: 'TECH_HACKER', nameKey: 'fighter.name.dev_hacker', colors: { body: 0xe0c53a, trim: 0x2fb7b0 } },
  { id: 'dev_shooter', slot: 'ATH_SHOOTER', nameKey: 'fighter.name.dev_shooter', colors: { body: 0x5fd0a5, trim: 0xffffff } },
  { id: 'dev_power_back', slot: 'ATH_POWER_BACK', nameKey: 'fighter.name.dev_power_back', colors: { body: 0xa45a36, trim: 0xd8c8ae } },
  { id: 'dev_influencer', slot: 'INFLUENCER', nameKey: 'fighter.name.dev_influencer', colors: { body: 0xee7766, trim: 0xffd6c9 } },
];

/** `content/fighter/roster.json` bound to the compiled public souls of the development bundle; the tier of each fighter is the soul's (FX4.1). */
export const FAME: FameConfig = fameJson as unknown as FameConfig;
export const ROSTER_ENTRIES: readonly RosterRow[] = rosterJson as unknown as RosterRow[];
let loaded: { fighters: LoadedFighter[]; issues: RosterIssue[] } | null = null;
export function fighterRoster(): { fighters: LoadedFighter[]; issues: RosterIssue[] } {
  if (loaded) return loaded;
  const souls = new Map<string, SoulLite>();
  for (const s of (devSoulBundle as unknown as { souls: SoulLite[] }).souls) souls.set(s.id, s);
  loaded = loadRoster(ROSTER_ENTRIES, souls, FAME);
  return loaded;
}
/** The loaded fighter of a UI roster id (`player` has none: it is the player's own avatar). */
export const loadedFighterOf = (id: string): LoadedFighter | undefined => {
  const slot = ROSTER.find((r) => r.id === id)?.slot;
  return slot === undefined ? undefined : fighterRoster().fighters.find((f) => f.slot === slot);
};

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

/** The frame-data pack of the nine kits (the eight roster fighters and the player); built once (hash = canonical sha256, FC2). */
export function fighterPack(): FrameDataPack {
  if (cached) return cached;
  const kits: Record<string, FighterDef> = {};
  for (const k of [playerKit, rapNewWaveKit, rapHyphyElderKit, rapLyricistKit, techVisionaryKit, techHackerKit, athShooterKit, athPowerBackKit, influencerKit] as unknown as FighterDef[]) kits[k.slot] = k;
  cached = buildPack(kits, tuningJson as unknown as FightTuning);
  return cached;
}

/** QA: rebuilds the pack from a changed tuning table (`__dvBridge.fighter.reloadTuning`). */
export function reloadTuning(tuning: FightTuning): FrameDataPack {
  const kits = fighterPack().kits;
  cached = buildPack(kits as unknown as Record<string, FighterDef>, tuning);
  return cached;
}
