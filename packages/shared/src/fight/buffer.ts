// packages/shared/src/fight/buffer.ts — authoritative match state; Int32Array, no per-tick allocation (FC2).
import type { FighterDef, FighterId, FighterSlotId, FrameDataPack, SchemeId, U } from './types.ts';
import type { FighterInput } from './input.ts';

export const FIGHTER_WORDS = 64, PROJ_WORDS = 16, PROJ_MAX = 16, RING = 32;
export const HEADER_WORDS = 16;
/** Word offsets of the blocks (layout: header · fighter0 · fighter1 · projectiles · rng fight · rng cpu · ring0 · ring1 · aiPerception). */
export const FIGHTER_BASE = [16, 80] as const;
export const PROJ_BASE = 144;                       // 16 × 16 words
export const RNG_FIGHT = 400, RNG_CPU = 404;        // 4 words each
export const RING_BASE = [408, 440] as const;       // 32 words each
export const AI_RING_BASE = 472;                    // 2 × 16 words
export const BUFFER_WORDS = 504;

export const enum FF {                       // per-fighter word index (offset = FighterBase[slot] + FF.x); 0..47 defined, 48..63 reserved
  X, Y, VX, VY, Facing, State, StateFrame, Move, MoveFrame, Hp, Hype, Composure, Rattled, Hitstun, Blockstun, Hitstop,
  ComboHits, JuggleLeft, Knockdown, Invuln, ArmorLeft, CancelMask, MoveResult, GroupsDone, ViaSimple, Ex, ChargeBack, ChargeDown,
  DashFrames, WakeFrames, TechTimer, BufMove, BufAge, ProjActive, Gimmick0, Gimmick1, Gimmick2, Gimmick3, CheckTimer,
  ClearUsed, TauntTimer, ComboDamage, LastHitBy, CounterFlag, AiGoal, AiTimer, AiMacro, AiMacroStep,
  // 48..63: M08a1 uses these reserved words (BD-M08a1-03); the rest stay reserved.
  PushLeft = 48, PushTimer, Stun, AirKind, MoveHype, InvulnKind, ThrowTech, RiseQuick,
}
export const enum FM {                       // match header words
  Tick, Phase, PhaseFrame, Round, RoundsWon0, RoundsWon1, Timer, Winner, SlowDiv, CinematicLeft, ShutdownWho,
  Seed, FrameDataHashLo, FrameDataHashHi, RulesFlags, Reserved,
}
/** FM.Reserved is the presentation counter (events emitted); it is the one word `hash` skips. */
export const HASH_SKIP_WORD = 15;

/** Projectile word indices (16 words per entry). */
export const enum PW { Owner, Def, X, Y, VX, VY, Life, Hits, Frame, Dir, Ex, Cool, Hitstop, OriginY }

export const enum Phase { Load, Intro, Ready, Fight, Ko, TimeUp, Shutdown, Cinematic, RoundEnd, MatchEnd }
/** RulesFlags bits. */
export const enum RF { Training = 1, Shutdowns = 2, CineFirst = 4, CineAlways = 8, Sudden = 1 << 16, SuddenNext = 1 << 17, KoEnd = 1 << 18 }

export interface FightSim {
  init(pack: FrameDataPack, rules: FightRules, seed: number, lineup: [FighterLoadout, FighterLoadout]): Int32Array;
  step(buf: Int32Array, in0: FighterInput, in1: FighterInput, ev: FightEventSink): void;   // one tick; pure given inputs
  hash(buf: Int32Array): [number, number];                      // FNV-1a-64 lanes over every word except presentation counters
  snapshot(buf: Int32Array): Int32Array; restore(buf: Int32Array, snap: Int32Array): void;
}
export interface FighterLoadout { slot: FighterSlotId; fighterId: FighterId; scheme: SchemeId; autoBlock?: boolean; costume: number }
export interface FightRules {
  roundsToWin: 1 | 2 | 3; timerFrames: number | 0;             // 0 = infinite (Versus, Training)
  simpleDmgPct: number;                                         // 80 default
  leniencyX100: number;                                         // 100 default; 150 on 30 fps render tiers; 200 pose (FP5); 100 forced online
  cpuLevel: [0 | 1 | 2 | 3 | null, 0 | 1 | 2 | 3 | null];         // per slot; null = human
  training: boolean; shutdowns: boolean; cinematics: 'off' | 'first' | 'always';
}
export interface FightEvent { tick: number; kind: 'hit' | 'block' | 'check' | 'whiff' | 'ko' | 'super' | 'round' | 'cue'; slot: 0 | 1; x: U; y: U; a: number; b: number }
/**
 * Presentation events: derived each tick, never hashed, de-duplicated by (tick, kind, slot) so rollback can re-emit.
 * The core reuses one event object (no allocation per tick): a sink that keeps events must copy the fields.
 */
export interface FightEventSink { push(e: FightEvent): void }

export const NULL_SINK: FightEventSink = { push(): void { /* discard */ } };

export type { FighterDef };
