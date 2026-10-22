// packages/shared/src/fight/types.ts — pure; C02 lint applies; FIGHT_DATA_VERSION bumps on any layout change.
// FC2 of spec/domains/07-fighter-core.md, verbatim except `FightTuning` (the constants table, named in FC2 but not typed there).
import type { RosterSlot } from '../contracts/c09-mission.ts';

export const FIGHT_DATA_VERSION = 1 as const;
export type U = number;                                         // i32 fight unit (1/1000 fm)
export interface Capsule2 { x1: U; y1: U; x2: U; y2: U; r: U }  // fighter-local, +x toward the opponent, mirrored by facing
export interface Aabb2 { x: U; y: U; w: U; h: U }
export type Guard = 'high' | 'mid' | 'low' | 'overhead' | 'unblockable' | 'throw';
export type SchemeId = 'classic' | 'simple' | 'pose';
export type MoveKind = 'normal' | 'command' | 'air' | 'special' | 'super' | 'throw' | 'auto' | 'shutdown' | 'taunt';
export type FighterSlotId = RosterSlot | 'PLAYER_FIGHTER';
export type FighterId = string;                                 // soul id = C07 asset slug; PLAYER_FIGHTER = 'player'

export interface HitDef {
  boxes: Capsule2[];                                            // active hit capsules, local space
  group: number;                                                // u8: one connect per group per move instance unless `multi`
  multi?: { every: number; max: number };                      // re-hit every N frames, at most `max` times
  damage: number; chipPermille: number;                         // chip = trunc(damage × chipPermille / 1000), 0 for normals unless Rattled
  hitstun: number; blockstun: number; hitstop: number;          // frames
  pushHit: U; pushBlock: U;                                     // total distance, applied over PUSH_FRAMES
  guard: Guard;
  launch?: { vx: U; vy: U; kd: 'soft' | 'hard' };               // u per frame; absent = grounded hit reaction
  juggle: { cost: number; limit: number };
  hype: { hit: number; block: number; whiff: number };         // gains in Hype points (1,000 = one stock)
  fx: { spark: 'light' | 'medium' | 'heavy' | 'special' | 'super'; cue: string };   // presentation only, not hashed
}
export interface BoxTrack {                                     // per-frame-range boxes; omitted ranges use the state default
  from: number; to: number;                                     // inclusive move frames
  hurt?: Capsule2[]; push?: Aabb2; throw?: Aabb2;
}
export interface MoveDef {
  id: string;                                                   // unique within the kit; clip name in anim/<slug>.moves = id
  nameKey: string; kind: MoveKind;                              // LocKey; shipped names are original (FX2)
  input: InputPattern; schemes: SchemeId[];
  startup: number; active: number; recovery: number;
  hits: { from: number; hit: HitDef }[];                        // `from` = first move frame this HitDef is live
  tracks: BoxTrack[];
  invuln: { from: number; to: number; kind: 'strike' | 'projectile' | 'throw' | 'all' }[];
  armor?: { from: number; to: number; hits: number };           // absorbs N strike hits without hitstun
  motion?: { frame: number; vx: U; vy: U }[];                   // data-driven root motion, u per frame from that frame on
  cancels: { into: 'chain' | 'special' | 'super' | 'jump' | 'dash'; on: ('hit' | 'block' | 'whiff')[]; from: number; to: number }[];
  hypeCost?: 0 | 1000 | 2000 | 3000;                            // EX 1,000; L2 super 2,000; Showstopper 3,000
  ex?: Partial<HitDef> & { startup?: number };                  // EX overrides (damage ×EX_DMG_PCT unless set)
  spawn?: ProjectileSpawn[];
  tags: string[];                                               // checked against config/fame-domains.json (FX4)
  cutscene?: { hook: 'special' | 'super' | 'shutdown'; template: string };
  gesture?: PoseGestureId;                                      // pose-mode trigger (FP3)
  lockFrames?: number;                                          // presentation: frames the clip is frame-locked
}
export interface ProjectileSpawn {
  frame: number; def: string; ox: U; oy: U;                     // spawn frame in the move, offset from the fighter
}
export interface ProjectileDef {
  id: string; behavior: 'linear' | 'sine' | 'arc' | 'trap' | 'orbit' | 'summon';
  speed: U; life: number; hits: number;                         // speed u/frame; life frames; max connects
  hit: HitDef; power: number;                                   // clash: higher power wins, equal destroys both
  sine?: { amp: U; period: number };                            // 'sine' path via SINE64
  arc?: { vy: U; gravity: U };
  summon?: { moveSet: string; hypeCost: number };               // 'summon' (crew assist): scripted move list
}
export interface FighterDef {                                   // a KIT: frame data bound to a slot, not to a person
  slot: FighterSlotId; kit: string; archetype: string;
  health: number;                                               // default 10,000
  walk: { f: U; b: U }; dash: { f: { frames: number; dist: U }; b: { frames: number; dist: U } };
  jump: { pre: number; v0: U; gravity: U; vxF: U; vxB: U; land: number };
  push: { stand: Aabb2; crouch: Aabb2; air: Aabb2 };
  hurtDefault: Record<'stand' | 'crouch' | 'air' | 'down', Capsule2[]>;
  moves: MoveDef[]; supers: MoveDef[]; shutdown: MoveDef; taunt: MoveDef;
  autoCombo: string[];                                          // Simple-scheme AS routine, move ids in order
  projectiles: ProjectileDef[];
  gimmick?: { id: string; params: Record<string, number> };     // FX2 table; state lives in gimmick words 0–3
  ai: AiProfile;                                                // FC10
}
export interface AiProfile {
  aggression: number; zoning: number; antiAir: number; throwRate: number; blockRate: number; shutdownRate: number;   // 0..100
  reaction: [number, number];                                   // frames, min and max before difficulty scaling
  habits: string[];                                             // named habit ids from content/fighter/ai/habits.json
}
export type PoseGestureId = 'jab' | 'cross' | 'hook' | 'uppercut' | 'frontKick' | 'lowKick' | 'guard' | 'crouch' | 'jump' | 'push';
export type InputPattern =                                      // parsed once at load into a transition table
  | { t: 'button'; buttons: number; dir?: 5 | 2 | 6 | 4 | 8 | 3 | 1 | 9 }
  | { t: 'motion'; seq: ('236' | '214' | '623' | '41236' | '63214' | '22' | '66' | '44' | '360'); buttons: number }
  | { t: 'charge'; hold: 4 | 2 | 1; release: 6 | 8 | 9; frames: number; buttons: number }
  | { t: 'chord'; buttons: number };

/** The constants table of FC2 (`config/fighter.tuning.json`). Flat, UPPER_SNAKE names as the spec writes them. */
export interface FightTuning {
  v: 1;
  // Input
  RING: number; MOTION_WINDOW: number; BUTTON_LEEWAY: number; BUFFER_NORMAL: number; BUFFER_SPECIAL: number;
  DASH_TAP_WINDOW: number; CHARGE_FRAMES: number; CHARGE_GAP: number; THROW_TECH: number; SIMPLE_DMG_PCT: number;
  CHORD_WINDOW: number;
  // Movement
  PUSH_FRAMES: number; GRAVITY: number; JUMP_V0: number; PREJUMP: number; LAND: number; WAKEUP: number;
  QUICKRISE: number; WAKE_THROW_INVULN: number; KNOCKDOWN: number; DASH_IMPLY: number;
  // Stage
  STAGE_HALF_WIDTH: U; MAX_SEPARATION: U; START_X: U;
  // Combo
  COMBO_SCALE: number[]; SCALE_FLOOR: number; L2_MIN: number; L3_MIN: number; HITSTUN_DECAY: number;
  MAX_COMBO_HITS: number; COUNTER_HITSTUN: number; COUNTER_DMG_PCT: number;
  // Meters
  HEALTH: number; HYPE_MAX: number; STOCK: number; COMPOSURE_MAX: number; COMP_REGEN: number; COMP_IDLE: number;
  CHECK_COST: number; CHECK_REFUND: number; CLEAR_COST: number; RATTLED_EXIT: number; HYPE_ON_DAMAGE_PCT: number;
  TAUNT_HYPE: number; EX_DMG_PCT: number; CHIP_KILLS: boolean;
  // Check / Clear
  CHECK_STARTUP: number; CHECK_ACTIVE: number; CHECK_WHIFF_RECOVERY: number; CHECK_SUCCESS_RECOVERY: number;
  CHECK_ATTACKER_STUN: number; CLEAR_STARTUP: number; CLEAR_INVULN: number; CLEAR_TOTAL: number;
  // Rounds
  TIMER: number; READY: number; KO_SLOW: number; KO_DIV: number; TIME_UP: number; ROUND_END: number; MATCH_END: number;
  SHUTDOWN_WINDOW: number; CINEMATIC_HOLD: number; SUDDEN: number; SUDDEN_HEALTH: number; INTRO_INGAME: number;
  // Hitstop
  HITSTOP_L: number; HITSTOP_M: number; HITSTOP_H: number; HITSTOP_SPECIAL: number; SUPER_FREEZE: number;
}

/** Content-compiled, immutable per build: its SHA-256 (canonicalize + sha256Hex, C09 helpers) is `frameDataHash`. */
export interface FrameDataPack { v: typeof FIGHT_DATA_VERSION; kits: Record<FighterSlotId, FighterDef>; tuning: FightTuning; hash: string }
