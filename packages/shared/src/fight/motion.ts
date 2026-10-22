// packages/shared/src/fight/motion.ts — FC5.2 input ring and FC5.3 motion parser. Integers only, no allocation.
import type { FightTuning } from './types.ts';
import type { CMove } from './pack.ts';
import { Cls, Pat } from './pack.ts';
import { dir9 } from './input.ts';
import { RING } from './buffer.ts';

/** Parser windows after `leniencyX100` scaling (FC5.3 rule 6). */
export interface ParseParams {
  window: number; leeway: number; bufN: number; bufS: number; tap: number; chord: number;
  chargeFrames: number; chargeGap: number; dashImply: number;
}
export function makeParseParams(t: FightTuning, lx: number): ParseParams {
  const sc = (v: number): number => Math.trunc((v * lx) / 100);
  return {
    window: sc(t.MOTION_WINDOW), leeway: sc(t.BUTTON_LEEWAY), bufN: sc(t.BUFFER_NORMAL), bufS: sc(t.BUFFER_SPECIAL),
    tap: sc(t.DASH_TAP_WINDOW), chord: t.CHORD_WINDOW, chargeFrames: t.CHARGE_FRAMES, chargeGap: t.CHARGE_GAP, dashImply: t.DASH_IMPLY,
  };
}

// ---- ring ----------------------------------------------------------------------------------------------------------
// Entry: bits 0..15 FighterInput · 16..19 facing-relative dir9 · 20..31 tick (low 12 bits).
export function ringPush(buf: Int32Array, base: number, tick: number, input: number, facing: number): void {
  buf[base + (tick & (RING - 1))] = (input & 0xffff) | (dir9(input, facing) << 16) | ((tick & 0xfff) << 20);
}
export function ringEntry(buf: Int32Array, base: number, tick: number, age: number): number {
  return buf[base + ((tick - age) & (RING - 1))] as number;
}
export function ringInput(buf: Int32Array, base: number, tick: number, age: number): number {
  return ringEntry(buf, base, tick, age) & 0xffff;
}
export function ringDir(buf: Int32Array, base: number, tick: number, age: number): number {
  return (ringEntry(buf, base, tick, age) >>> 16) & 0xf;
}
/** Bits of `mask` that are held at `age` and were not held one entry earlier. */
export function risingAt(buf: Int32Array, base: number, tick: number, age: number, mask: number): number {
  const cur = ringInput(buf, base, tick, age);
  const prev = age < RING - 1 ? ringInput(buf, base, tick, age + 1) : 0;
  return cur & ~prev & mask;
}

/** True when numpad direction `d` (1..9, 0 = no entry) holds the component `x` (2 down, 4 back, 6 forward, 8 up; others exact). */
export function dirHas(d: number, x: number): boolean {
  switch (x) {
    case 2: return d >= 1 && d <= 3;
    case 8: return d >= 7 && d <= 9;
    case 4: return d === 1 || d === 4 || d === 7;
    case 6: return d === 3 || d === 6 || d === 9;
    default: return d === x;
  }
}

// ---- charge counters (FF.ChargeBack / ChargeDown: bits 0..7 held frames, 8..11 gap) ---------------------------------
export function updateCharge(word: number, held: boolean, gapMax: number): number {
  let count = word & 0xff;
  let gap = (word >> 8) & 0xf;
  if (held) { if (count < 255) count++; gap = 0; }
  else { if (gap < 15) gap++; if (gap > gapMax) count = 0; }
  return count | (gap << 8);
}
export function chargeValid(word: number, frames: number, gapMax: number): boolean {
  return (word & 0xff) >= frames && ((word >> 8) & 0xf) <= gapMax;
}

// ---- sequences ----------------------------------------------------------------------------------------------------
const CIRCLE = [6, 3, 2, 1, 4, 7, 8, 9];

function stepAt(seq: Int8Array, circ: boolean, start: number, sign: number, j: number): number {
  return circ ? (CIRCLE[(start + sign * j + 80) & 7] as number) : (seq[j] as number);
}

/** Greedy reverse match of steps [from, n) of `seq` ending exactly at age `mAge`, spanning at most `window` frames. */
function completes(buf: Int32Array, base: number, tick: number, mAge: number, window: number,
  seq: Int8Array, from: number, circ: boolean, start: number, sign: number): boolean {
  const n = circ ? 8 : seq.length;
  if (ringDir(buf, base, tick, mAge) !== stepAt(seq, circ, start, sign, n - 1)) return false;
  let cur = mAge;
  for (let j = n - 2; j >= from; j--) {
    const want = stepAt(seq, circ, start, sign, j);
    let found = -1;
    const limit = Math.min(mAge + window, RING - 1);
    for (let a = cur + 1; a <= limit; a++) if (ringDir(buf, base, tick, a) === want) { found = a; break; }
    if (found < 0) return false;
    cur = found;
  }
  return true;
}

function circleCompletes(buf: Int32Array, base: number, tick: number, mAge: number, window: number): boolean {
  const empty = EMPTY_SEQ;
  for (let s = -1; s <= 1; s += 2) for (let start = 0; start < 8; start++) {
    if (completes(buf, base, tick, mAge, window, empty, 0, true, start, s)) return true;
  }
  return false;
}
const EMPTY_SEQ = new Int8Array(0);

/** Second rising edge of a double tap of component `x` at age `mAge` (22, 66, 44), the first within `window`. */
export function tapCompletes(buf: Int32Array, base: number, tick: number, mAge: number, x: number, window: number): boolean {
  if (mAge >= RING - 1) return false;
  if (!dirHas(ringDir(buf, base, tick, mAge), x) || dirHas(ringDir(buf, base, tick, mAge + 1), x)) return false;
  let released = false;
  const limit = Math.min(mAge + window, RING - 1);
  for (let a = mAge + 1; a <= limit; a++) {
    const has = dirHas(ringDir(buf, base, tick, a), x);
    if (!has) released = true;
    else if (released) return true;
  }
  return false;
}

/** Chord: every bit of `mask` is held at `age`, one of them rises there, and the others rose within `win` earlier frames. */
export function chordAt(buf: Int32Array, base: number, tick: number, age: number, mask: number, win: number): boolean {
  if ((ringInput(buf, base, tick, age) & mask) !== mask) return false;
  if (risingAt(buf, base, tick, age, mask) === 0) return false;
  for (let b = 0; b < 16; b++) {
    const bit = 1 << b;
    if ((mask & bit) === 0) continue;
    let run = age;
    while (run + 1 < RING && (ringInput(buf, base, tick, run + 1) & bit) !== 0) run++;
    if (run - age > win) return false;
  }
  return true;
}

function popcount(v: number): number {
  let c = 0;
  for (let x = v; x !== 0; x &= x - 1) c++;
  return c;
}

/** Result bits: 1 matched, 2 EX request, bits 8..15 recency (255 - age of the later of press and completion; higher = fresher). */
export const MATCH = 1, MATCH_EX = 2;

export interface ParseState {
  chargeBack: number; chargeDown: number;
  dashImplied: boolean;            // forward dash within the last DASH_IMPLY frames (623 implied first 6)
  lastConsumed: number;            // tick of the last press consumed by a move start (BD-M08a1-04)
  canEx: boolean;                  // Hype >= one stock
}

/**
 * Does `m` trigger now? Evaluated every tick the fighter may start a move; a press stays valid for the buffer
 * (BUFFER_NORMAL for normals, BUFFER_SPECIAL for the rest). Pure: reads the ring and `ps` only.
 */
export function matchMove(buf: Int32Array, base: number, tick: number, m: CMove, pp: ParseParams, ps: ParseState): number {
  const buffer = m.cls <= Cls.Normal ? pp.bufN : pp.bufS;
  switch (m.pat) {
    case Pat.Button: {
      for (let a = 0; a <= buffer; a++) {
        if (tick - a <= ps.lastConsumed) break;
        if (risingAt(buf, base, tick, a, m.mask) === 0) continue;
        if (m.dirReq === 0 || dirHas(ringDir(buf, base, tick, a), m.dirReq)) return MATCH | ((255 - a) << 8);
      }
      return 0;
    }
    case Pat.Chord: {
      for (let a = 0; a <= buffer; a++) {
        if (tick - a <= ps.lastConsumed) break;
        if (chordAt(buf, base, tick, a, m.mask, pp.chord)) return MATCH | ((255 - a) << 8);
      }
      return 0;
    }
    default:
      return releaseAndButton(buf, base, tick, m, pp, ps, buffer);
  }
}

/** Is the direction part of `m` complete at age `mAge`? (Charge: the release direction; taps; motions.) */
function dirOk(buf: Int32Array, base: number, tick: number, m: CMove, pp: ParseParams, ps: ParseState, mAge: number): boolean {
  if (m.pat === Pat.Charge) {
    const word = m.chargeHold === 2 ? ps.chargeDown : ps.chargeBack;
    const need = m.chargeFrames > 0 ? m.chargeFrames : pp.chargeFrames;
    return chargeValid(word, need, pp.chargeGap) && dirHas(ringDir(buf, base, tick, mAge), m.chargeRelease);
  }
  if (m.tapDir !== 0) return tapCompletes(buf, base, tick, mAge, m.tapDir, pp.tap);
  const win = m.isSuper || m.seq.length === 8 ? pp.window * 2 : pp.window;
  if (m.seq.length === 8) return circleCompletes(buf, base, tick, mAge, win);
  if (completes(buf, base, tick, mAge, win, m.seq, 0, false, 0, 1)) return true;
  return ps.dashImplied && m.seq.length === 3 && m.seq[0] === 6 && completes(buf, base, tick, mAge, win, m.seq, 1, false, 0, 1);
}

function releaseAndButton(buf: Int32Array, base: number, tick: number, m: CMove, pp: ParseParams, ps: ParseState, buffer: number): number {
  const lim = Math.min(buffer + pp.leeway, RING - 2);
  for (let p = 0; p <= lim; p++) {
    if (tick - p <= ps.lastConsumed) break;
    if (risingAt(buf, base, tick, p, m.mask) === 0) continue;
    const lo = Math.max(0, p - pp.leeway);
    for (let mAge = lo; mAge <= p + pp.leeway && mAge < RING - 1; mAge++) {
      if (Math.min(p, mAge) > buffer) continue;
      if (!dirOk(buf, base, tick, m, pp, ps, mAge)) continue;
      // EX: a second button of the mask pressed within the chord window of the first (FC5.3 rule 5).
      let bits = 0;
      for (let k = 0; k <= pp.chord; k++) {
        bits |= risingAt(buf, base, tick, p + k, m.mask);
        if (k <= p) bits |= risingAt(buf, base, tick, p - k, m.mask);
      }
      return MATCH | (popcount(bits) >= 2 && ps.canEx && m.hasEx ? MATCH_EX : 0) | ((255 - Math.min(p, mAge)) << 8);
    }
  }
  return 0;
}

/**
 * Dash input on the current frame: a pure forward (or back) tap, then a return that never touches up or down, then the tap
 * again inside `window`. Motions such as 236236 contain two forward frames but go through down, so they never dash.
 */
export function doubleTapNow(buf: Int32Array, base: number, tick: number, x: number, window: number): boolean {
  if (ringDir(buf, base, tick, 0) !== x || ringDir(buf, base, tick, 1) === x) return false;
  const limit = Math.min(window, RING - 1);
  for (let a = 1; a <= limit; a++) {
    const d = ringDir(buf, base, tick, a);
    if (dirHas(d, 2) || dirHas(d, 8)) return false;
    if (d === x && a >= 2) return true;
  }
  return false;
}
