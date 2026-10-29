// packages/shared/src/fight/gimmicks.ts — FX2 gimmick hooks. The state of a gimmick lives in the fighter's gimmick words G0..G3
// (`FF.Gimmick0..3`), so snapshot and restore cover it. Every function is a small pure reader or writer of the buffer; the step
// loop calls them at fixed points (round start, move start, walking, the per-tick upkeep, a hit received). Words per gimmick:
//   frenzy  G0 frames left, G1 used this round        string  G0 specials cancelled into since the last neutral move
//   pulse   (the trap cap lives in projectiles.ts)    agents  (the drone cap lives in projectiles.ts)
//   charge  G0 frames the button was held (0..max)    patch   (armor window + `counter` tag, see hit.ts)
//   armor   (data: MoveDef.armor)                     poll    G0 current buff slot (0..2), G1 frames in the slot, G2 packed order, G3 armor tick ready
//   swap / teleport moves (tag `once`): FF.OnceMask bit 0 = used this round
import { FF, FIGHTER_BASE, RNG_FIGHT } from './buffer.ts';
import type { Ctx } from './ctx.ts';
import { kitOf } from './ctx.ts';
import { rngNext } from './hash.ts';
import type { CMove } from './pack.ts';

export const enum Gim { None, Frenzy, String, Pulse, Agents, Patch, Charge, Armor, Poll }
const IDS: Record<string, number> = {
  frenzy: Gim.Frenzy, string: Gim.String, pulse: Gim.Pulse, agents: Gim.Agents, patch: Gim.Patch, charge: Gim.Charge, armor: Gim.Armor, poll: Gim.Poll,
};
export const gimmickCode = (id: string | undefined): number => (id === undefined ? Gim.None : (IDS[id] ?? Gim.None));

/** Frenzy: 360 frames, once per round (FX2). Walk and dash +25 %, normals start 2 frames sooner (never below 3). */
export const FRENZY_FRAMES = 360;
export const FRENZY_WALK_PCT = 125;
export const FRENZY_STARTUP_CUT = 2;
export const NORMAL_STARTUP_MIN = 3;
/** String: at most two specials cancelled into one another per touch. */
export const STRING_MAX = 2;
/** Charge: the button is held up to 40 frames; the level steps at 14 and 27 frames (600 / 900 / 1,300 damage). */
export const CHARGE_MAX = 40;
export const CHARGE_L2 = 14;
export const CHARGE_L3 = 27;
/** Poll: three buffs in an order drawn from the `fight` stream at round start, a new one every 600 frames. */
export const POLL_FRAMES = 600;
export const POLL_HYPE_PCT = 150;
export const POLL_WALK_PCT = 115;
export const BUFF_HYPE = 0, BUFF_WALK = 1, BUFF_ARMOR = 2;

const g = (b: Int32Array, i: number): number => b[i] as number;
const gimOf = (c: Ctx, o: number): number => kitOf(c, o === (FIGHTER_BASE[0] as number) ? 0 : 1).gim;
const param = (c: Ctx, i: number, key: string, dflt: number): number => {
  const p = kitOf(c, i).def.gimmick?.params[key];
  return p === undefined ? dflt : p;
};

/** Round start (after the fighter words are zeroed): the poll order is drawn from the `fight` stream. */
export function gimmickRoundStart(c: Ctx, buf: Int32Array, i: number): void {
  const o = FIGHTER_BASE[i] as number;
  if (kitOf(c, i).gim !== Gim.Poll) return;
  // Fisher-Yates over (0, 1, 2) in three locals, two draws, always consumed so the stream position does not depend on the result.
  const j1 = (rngNext(buf, RNG_FIGHT) >>> 0) % 3, j2 = (rngNext(buf, RNG_FIGHT) >>> 0) % 2;
  let a0 = 0, a1 = 1, a2 = 2;
  const pick = (j: number): number => (j === 0 ? a0 : j === 1 ? a1 : a2);
  const put = (j: number, v: number): void => { if (j === 0) a0 = v; else if (j === 1) a1 = v; else a2 = v; };
  let t = a2; a2 = pick(j1); put(j1, t);
  t = a1; a1 = pick(j2); put(j2, t);
  buf[o + FF.Gimmick2] = a0 | (a1 << 2) | (a2 << 4);
  buf[o + FF.Gimmick0] = 0; buf[o + FF.Gimmick1] = 0;
  buf[o + FF.Gimmick3] = a0 === BUFF_ARMOR ? 1 : 0;
}

/** The poll buff in force for fighter `i` (0 hype, 1 walk, 2 armor tick), or -1 when the kit has no poll. */
export function pollBuff(c: Ctx, buf: Int32Array, i: number): number {
  if (kitOf(c, i).gim !== Gim.Poll) return -1;
  const o = FIGHTER_BASE[i] as number;
  return (g(buf, o + FF.Gimmick2) >> (2 * g(buf, o + FF.Gimmick0))) & 3;
}

/** Per-tick upkeep of a live fighter: the frenzy timer and the poll cycle. */
export function gimmickTick(c: Ctx, buf: Int32Array, i: number): void {
  const o = FIGHTER_BASE[i] as number;
  const k = kitOf(c, i).gim;
  if (k === Gim.Frenzy) {
    if (g(buf, o + FF.Gimmick0) > 0) buf[o + FF.Gimmick0] = g(buf, o + FF.Gimmick0) - 1;
  } else if (k === Gim.Poll) {
    const n = g(buf, o + FF.Gimmick1) + 1;
    if (n >= POLL_FRAMES) {
      const slot = (g(buf, o + FF.Gimmick0) + 1) % 3;
      buf[o + FF.Gimmick0] = slot; buf[o + FF.Gimmick1] = 0;
      buf[o + FF.Gimmick3] = ((g(buf, o + FF.Gimmick2) >> (2 * slot)) & 3) === BUFF_ARMOR ? 1 : 0;
    } else buf[o + FF.Gimmick1] = n;
  }
}

/** May this move start? (Frenzy cannot be started twice in a round.) */
export function moveAllowed(c: Ctx, buf: Int32Array, i: number, m: CMove): boolean {
  if (kitOf(c, i).gim === Gim.Frenzy && m.def.id === 'frenzy') return g(buf, (FIGHTER_BASE[i] as number) + FF.Gimmick1) === 0;
  if (m.def.tags.includes('once') && (g(buf, (FIGHTER_BASE[i] as number) + FF.OnceMask) & 1) !== 0) return false;
  return true;
}

/** A move starts. `cancel` = it was cancelled out of another move; `prevSpecial` = that move was a special. */
export function gimmickMoveStart(c: Ctx, buf: Int32Array, i: number, m: CMove, cancel: boolean, prevSpecial: boolean): void {
  const o = FIGHTER_BASE[i] as number;
  switch (kitOf(c, i).gim) {
    case Gim.Frenzy:
      // The start tick itself runs the upkeep once, so 360 frames are left after it.
      if (m.def.id === 'frenzy') { buf[o + FF.Gimmick0] = FRENZY_FRAMES + 1; buf[o + FF.Gimmick1] = 1; }
      break;
    case Gim.String:
      if (!cancel) buf[o + FF.Gimmick0] = 0;
      else if (prevSpecial && m.cls === 3) buf[o + FF.Gimmick0] = g(buf, o + FF.Gimmick0) + 1;
      break;
    case Gim.Charge:
      buf[o + FF.Gimmick0] = 0;
      break;
    default: break;
  }
}

/** May a special be cancelled into another one now? (string) */
export function specialCancelOk(c: Ctx, buf: Int32Array, i: number, fromSpecial: boolean): boolean {
  if (!fromSpecial || kitOf(c, i).gim !== Gim.String) return true;
  return g(buf, (FIGHTER_BASE[i] as number) + FF.Gimmick0) < STRING_MAX;
}

/** Frames of startup a normal skips under Frenzy (never below NORMAL_STARTUP_MIN). */
export function startupSkip(c: Ctx, buf: Int32Array, i: number, m: CMove): number {
  if (kitOf(c, i).gim !== Gim.Frenzy || g(buf, (FIGHTER_BASE[i] as number) + FF.Gimmick0) <= 0) return 0;
  if (m.def.kind !== 'normal' && m.def.kind !== 'air') return 0;
  return Math.max(0, Math.min(FRENZY_STARTUP_CUT, m.S - NORMAL_STARTUP_MIN));
}

/** Walk or dash distance for fighter `i` this tick (frenzy +25 %, poll walk buff +15 %). */
export function scaledSpeed(c: Ctx, buf: Int32Array, i: number, base: number): number {
  const k = kitOf(c, i).gim;
  const o = FIGHTER_BASE[i] as number;
  if (k === Gim.Frenzy && g(buf, o + FF.Gimmick0) > 0) return Math.trunc((base * FRENZY_WALK_PCT) / 100);
  if (k === Gim.Poll && pollBuff(c, buf, i) === BUFF_WALK) return Math.trunc((base * POLL_WALK_PCT) / 100);
  return base;
}

/** Hype gained by fighter at offset `o`: poll buff 0 adds 50 %. */
export function scaledHype(c: Ctx, buf: Int32Array, o: number, n: number): number {
  if (n <= 0 || gimOf(c, o) !== Gim.Poll) return n;
  const i = o === (FIGHTER_BASE[0] as number) ? 0 : 1;
  return pollBuff(c, buf, i) === BUFF_HYPE ? Math.trunc((n * POLL_HYPE_PCT) / 100) : n;
}

/** The poll armor tick: absorbs the next strike once per armor slot. Returns true and spends the tick when it applies. */
export function takeArmorTick(c: Ctx, buf: Int32Array, i: number): boolean {
  if (kitOf(c, i).gim !== Gim.Poll) return false;
  const o = FIGHTER_BASE[i] as number;
  if (g(buf, o + FF.Gimmick3) === 0 || pollBuff(c, buf, i) !== BUFF_ARMOR) return false;
  buf[o + FF.Gimmick3] = 0;
  return true;
}

/** Charge: the move frame at which the button is held, and the hold limit, for a charge move; -1 when `m` does not charge. */
export function chargeHoldFrame(c: Ctx, i: number, m: CMove): number {
  if (kitOf(c, i).gim !== Gim.Charge || !m.def.tags.includes('charge')) return -1;
  return param(c, i, 'holdFrame', 3);
}
export function chargeLevel(buf: Int32Array, o: number): number {
  const h = g(buf, o + FF.Gimmick0);
  return h >= CHARGE_L3 ? 3 : h >= CHARGE_L2 ? 2 : 1;
}
