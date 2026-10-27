/**
 * Types of the Culture Wars mode (M08a2) that are not part of the fight core: stage and bout definitions (FX5, FX8), the enter
 * parameters (07-fighter.md section 3) and the roster rows of the two gray-box fighters. Pure; sim code under the C02 lint.
 */
import type { FighterSlotId, FightRules } from '@dv/shared/fight';

export type StageId =
  | 'powell_turntable' | 'ferry_plaza' | 'dolores_slope' | 'bayview_cranes' | 'alcatraz_yard' | 'mission_bay_court'
  | 'lombard_switchbacks' | 'coit_top' | 'ggpark_bandshell' | 'twin_peaks_night';

export type CpuLevel = 0 | 1 | 2 | 3;

/** FC8.4 camera coefficients. Distances are fight units (1/1000 m); `b` is per mille of the fighters' separation. */
export interface StageCameraDef {
  minD: number; maxD: number; a: number; b: number;
  fovDeg: number; height: number; damping: number;
}

export interface StageDef {
  id: StageId; nameKey: string; district: string;
  landmarkRefs: string[];
  scene: { day: string; night: string };
  halfWidth: number;
  camera: StageCameraDef;
  tags: string[];
  hazards: { id: string; defaultOn: false }[];
  music: string; ambience: string;
  crowd: 'none' | 'sparse' | 'dense';
}

export interface BoutDef {
  id: string;
  p1: 'player' | FighterSlotId;
  p2: FighterSlotId;
  stage: StageId;
  cpu: CpuLevel;
  rules: Partial<FightRules>;
  exhibition: true;
  reward: { cashCents: number; streetCred: number; xp: number };
}

export type EnterKind = 'arcade' | 'versus' | 'training' | 'story' | 'gallery' | 'replay';

/** `ModeEnterArgs.params` of the fighter (07-fighter.md section 3, plus the QA fields). Every field is optional: no params opens the hub. */
export interface FighterEnterParams {
  kind?: EnterKind;
  bout?: string;
  /** Fighter ids of the two sides (`player`, `standin_rap_new_wave`); default player vs the new-wave stand-in. */
  fighters?: [string, string];
  stage?: StageId;
  night?: boolean;
  cpu?: CpuLevel;
  scheme?: 'classic' | 'simple';
  /** `human` reads `ctx.input.frame(1)` for slot 1 (a second pad); default `cpu`. */
  p2?: 'cpu' | 'human';
  rounds?: 1 | 2 | 3;
  timerFrames?: number;
  /** The fighter.cpu bot plays slot 0 (the story runs with `hooks: 'bot'`). */
  bot?: boolean;
  /** 150 on 30 fps render tiers (FC5.3.6). */
  leniencyX100?: number;
  reducedMotion?: boolean;
  /** `replay` kind: the text of a `.dvfight` the sim plays back, checking every checkpoint. */
  replay?: string;
  /** QA: the page steps the match by hand (`__dvBridge.fighter.step`); the mode ignores devices and the CPU. */
  manual?: boolean;
}

export interface RosterEntry {
  id: string;
  slot: FighterSlotId;
  nameKey: string;
  /** Gray-box body colours, 0xRRGGBB (presentation only). */
  colors: { body: number; trim: number };
}
