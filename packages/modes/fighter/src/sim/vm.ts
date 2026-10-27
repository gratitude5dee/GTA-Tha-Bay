/**
 * The view-model keys of the mode and the JSON shapes behind them. The sim publishes; the UI half (HUD, menus, presenter) only reads.
 * One tick of `view` is a few hundred bytes (the bridge allows 4 KiB per tick for all keys together).
 */
import type { VmKey } from '@dv/shared';

export const VM_VIEW = 'mode.fighter.view' as VmKey;
export const VM_MENU = 'mode.fighter.menu' as VmKey;
export const VM_TRAIN = 'mode.fighter.train' as VmKey;
export const VM_REPLAY = 'mode.fighter.replay' as VmKey;

/** `view.f[slot]`: x, y, facing, state, move, moveFrame, hitstop, hp, hype, composure, rattled, combo taken, hitstun, blockstun, invuln. */
export type FighterRow = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

export interface FightView {
  v: 1;
  /** Sim tick of the match. */
  t: number;
  /** Phase (`Phase` enum), frames in the phase, round, rounds won, timer frames (0 = none). */
  ph: number; pf: number; rd: number; rw: [number, number]; tm: number;
  f: [FighterRow, FighterRow];
  /** Projectiles: owner (0 or 1), def index, x, y, frame, ex, dir. */
  p: number[][];
  /** Events of this tick: kind index (`EVENT_KINDS`), slot, x, y, a, b. */
  e: number[][];
  /** Camera plan: centre x, distance, dolly frames, shake (1/1000 m), height, fov. */
  cam: [number, number, number, number, number, number];
  /** Stage id, night 0/1. */
  st: string; nt: number;
  /** Super freeze frames left (drives the 3-frame dim under reduced motion and the flash otherwise). */
  fz: number;
  /** Scheme per slot (0 classic, 1 simple), CPU level per slot (-1 human), and the fighters' ids. */
  sc: [number, number]; cpu: [number, number]; id: [string, string];
  /** Reduced motion is in force. */
  rm: number;
  /** Paused. */
  pa: number;
  /** Rounds to win, timer length in frames (0 = none), the match winner slot (-1 until decided). */
  rtw: number; tmx: number; wn: number;
  /** Input display (optional): slot 0's last inputs as `[FighterInput word, frames held]`, newest last. */
  ih?: number[][];
}

export interface MenuVm {
  v: 1;
  /** `hub` | `select` | `match` | `results` */
  screen: 'hub' | 'select' | 'match' | 'results';
  kind: 'versus' | 'training' | 'story' | 'arcade' | 'replay';
  paused: boolean;
  fighters: { id: string; nameKey: string; locked: boolean }[];
  stages: { id: string; nameKey: string }[];
  p1: string; p2: string; stage: string; night: boolean; cpu: number; scheme: 'classic' | 'simple'; rounds: number;
  inputDisplay: boolean;
  /** The pause screen's move list for the player's scheme, once per open. */
  moveList: { id: string; nameKey: string; input: string; S: number; A: number; R: number; advHit: number | null; advBlock: number | null }[];
  results: null | { outcome: 'win' | 'lose'; rounds: [number, number]; durationSec: number; xp: number };
  /** Unlocked fighters, for the select screen. */
  origin: 'menu' | 'story';
}

/** Training overlay model (FC11): the frame meter of the last move, the dummy, and the counters. */
export interface TrainVm {
  v: 1;
  overlay: { boxes: boolean; meter: boolean; input: boolean; damage: boolean };
  dummy: 'stand' | 'crouch' | 'blockAll' | 'blockFirst' | 'jump' | 'cpu' | 'playback';
  recording: boolean;
  recLen: number;
  /** The last move that connected or whiffed on slot 0: its frame data, the result, and the advantage (derived and measured). */
  meter: null | { move: string; S: number; A: number; R: number; result: 'hit' | 'block' | 'whiff'; adv: number | null; measured: number | null };
  /** Last hit: damage, combo count, scaling per cent. */
  last: { damage: number; combo: number; scale: number };
  /** Input display: the last 12 inputs of slot 0 as `[word, age frames held]`. */
  inputs: number[][];
  /** Buffer age (frames) of the oldest buffered command. */
  bufAge: number;
  invuln: [number, number];
}

export interface ReplayVm {
  v: 1;
  ticks: number;
  checkpoints: number;
  ok: boolean;
  done: boolean;
  badAt: number | null;
  winner: number;
  rounds: [number, number];
  /** Hex of the last checkpoint compared. */
  last: string;
}
