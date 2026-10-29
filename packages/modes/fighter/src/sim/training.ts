/**
 * Training mode (FC11): the dummy on slot 1, the record and playback of its inputs, the reset and the meter refill, and the model
 * of the frame meter (startup, active and recovery of the move, the result of its last contact, the advantage derived from the data
 * and the advantage measured in frames), the damage readout and the input display. The sim of a Training match runs with
 * `training: true` (health never drops below 1). Resets edit the buffer, so such a match has no replay. Sim code under the C02 lint.
 */
import {
  FB, FF, FIGHTER_BASE, PROJ_BASE, PROJ_MAX, PROJ_WORDS, St, isActionable, isAirborne,
} from '@dv/shared/fight';
import type { FightTuning } from '@dv/shared/fight';
import { blockWord } from './cpu/macro.ts';
import type { KitInfo } from './cpu/moves.ts';
import type { FighterMatch } from './match.ts';
import type { TrainVm } from './vm.ts';

export type DummyMode = TrainVm['dummy'];
export const DUMMY_MODES: readonly DummyMode[] = ['stand', 'crouch', 'blockAll', 'blockFirst', 'jump', 'cpu', 'playback'];
export const MAX_RECORD = 900;
const HISTORY = 12;

interface Pending { attacker: 0 | 1; move: number; result: 'hit' | 'block'; tick: number; tA: number; tD: number }

export class TrainingState {
  overlay = { boxes: true, meter: true, input: true, damage: true };
  dummy: DummyMode = 'stand';
  recording = false;
  readonly rec: number[] = [];
  private playAt = 0;
  private hitSeenAt = -1000;
  meter: TrainVm['meter'] = null;
  last = { damage: 0, combo: 0, scale: 100 };
  private pending: Pending | null = null;
  private readonly hist: number[][] = [];   // [word, tick it began]
  private lastMove: number[] = [-1, -1];

  constructor(private readonly kits: [KitInfo, KitInfo], private readonly tuning: FightTuning) {}

  setDummy(d: DummyMode): void {
    this.dummy = d;
    if (d === 'playback') this.playAt = 0;
  }

  startRecording(): void { this.recording = true; this.rec.length = 0; }
  stopRecording(): void { this.recording = false; }

  /** The word of the dummy (slot 1) for this tick. `cpuWord` is the CPU's word when the dummy mode is `cpu`. */
  dummyWord(m: FighterMatch, cpuWord: number): number {
    const f1 = m.w(1, FF.Facing);
    switch (this.dummy) {
      case 'stand': return 0;
      case 'crouch': return FB.Down;
      case 'jump': return m.tick % 90 === 0 ? FB.Up : 0;
      case 'cpu': return cpuWord;
      case 'playback': {
        if (this.rec.length === 0) return 0;
        const w = this.rec[this.playAt % this.rec.length] as number;
        this.playAt++;
        return w;
      }
      case 'blockAll': return this.blockNow(m, f1);
      case 'blockFirst': return m.tick - this.hitSeenAt < 90 ? this.blockNow(m, f1) : 0;
    }
  }

  private blockNow(m: FighterMatch, facing: number): number {
    // Crouch when the attacker's move on the way is low, stand otherwise (FC6.4).
    const mv = m.w(0, FF.Move);
    const info = mv >= 0 ? this.kits[0].moves[mv] : undefined;
    return blockWord(facing, info?.low === true && !isAirborne(m.w(0, FF.State)));
  }

  /** After each step: record slot 0's input, follow the move on slot 0, and settle the contact the events of the tick tell of. */
  observe(m: FighterMatch, i0: number): void {
    if (this.recording && this.rec.length < MAX_RECORD) this.rec.push(i0 & 0xffff);
    const last = this.hist[this.hist.length - 1];
    if (!last || last[0] !== i0) { this.hist.push([i0, m.tick]); if (this.hist.length > HISTORY) this.hist.shift(); }
    const s0 = m.w(0, FF.State);
    const mv0 = m.w(0, FF.Move);
    if (mv0 !== this.lastMove[0] && mv0 >= 0 && (s0 === St.Attack || s0 === St.Special || s0 === St.Super || s0 === St.Throw || s0 === St.Auto || s0 === St.AirAttack)) {
      const info = this.kits[0].moves[mv0];
      if (info) this.meter = { move: info.id, S: info.S, A: info.A, R: info.R, result: 'whiff', adv: null, measured: null };
    }
    this.lastMove[0] = mv0;
    this.lastMove[1] = m.w(1, FF.Move);
    const ev = m.events;
    for (let i = 0; i < ev.n; i++) {
      const kind = ev.kind[i] as number;   // 0 hit, 1 block
      if (kind !== 0 && kind !== 1) continue;
      const slot = ev.slot[i] as 0 | 1;
      const attacker: 0 | 1 = kind === 0 ? slot : (slot === 0 ? 1 : 0);
      if (kind === 0 && attacker === 0) this.hitSeenAt = m.tick;
      if (attacker !== 0) continue;
      const result: 'hit' | 'block' = kind === 0 ? 'hit' : 'block';
      const info = this.kits[0].moves[mv0];
      if (!info) continue;
      const derived = this.derivedAdv(info.idx, result);
      if (!this.meter || this.meter.move !== info.id) this.meter = { move: info.id, S: info.S, A: info.A, R: info.R, result, adv: derived, measured: null };
      else { this.meter.result = result; this.meter.adv = derived; this.meter.measured = null; }
      this.pending = { attacker: 0, move: info.idx, result, tick: m.tick, tA: -1, tD: -1 };
      if (kind === 0) this.last = { damage: ev.a[i] as number, combo: m.w(1, FF.ComboHits), scale: this.scaleOf(m.w(1, FF.ComboHits)) };
    }
    // Measured advantage: the frame each side can act again, after the hitstop ends.
    const p = this.pending;
    if (p) {
      const free = (slot: 0 | 1): boolean => isActionable(m.w(slot, FF.State)) && m.w(slot, FF.Hitstop) === 0;
      const t = m.tick;
      if (p.tA < 0 && t > p.tick && free(p.attacker)) p.tA = t;
      const d: 0 | 1 = p.attacker === 0 ? 1 : 0;
      if (p.tD < 0 && t > p.tick && free(d)) p.tD = t;
      if ((p.tA >= 0 && p.tD >= 0) || t - p.tick > 240) {
        if (this.meter && p.tA >= 0 && p.tD >= 0) this.meter.measured = p.tD - p.tA;
        this.pending = null;
      }
    }
  }

  private derivedAdv(idx: number, result: 'hit' | 'block'): number | null {
    const info = this.kits[0].moves[idx];
    if (!info) return null;
    return result === 'block' ? info.advBlock : info.advHit;
  }

  private scaleOf(combo: number): number {
    const t = this.tuning.COMBO_SCALE;
    if (combo <= 0) return 100;
    return Math.max(this.tuning.SCALE_FLOOR, t[Math.min(t.length, combo) - 1] as number);
  }

  /** Puts both fighters back at their starts with full health and clears projectiles (Training's reset; the match has no replay after it). */
  reset(m: FighterMatch): void {
    const t = this.tuning;
    for (let i = 0; i < 2; i++) {
      const o = FIGHTER_BASE[i] as number;
      const hype = m.buf[o + FF.Hype] as number;
      const health = this.kits[i as 0 | 1].def.health;
      m.buf.fill(0, o, o + 64);
      m.buf[o + FF.X] = i === 0 ? -t.START_X : t.START_X;
      m.buf[o + FF.Facing] = i === 0 ? 1 : -1;
      m.buf[o + FF.State] = St.Idle;
      m.buf[o + FF.Move] = -1;
      m.buf[o + FF.Hp] = health;
      m.buf[o + FF.Hype] = hype;
      m.buf[o + FF.Composure] = t.COMPOSURE_MAX;
      m.buf[o + FF.BufAge] = -1;
      m.buf[o + FF.CheckTimer] = t.COMP_IDLE;
    }
    m.buf.fill(0, PROJ_BASE, PROJ_BASE + PROJ_MAX * PROJ_WORDS);
    m.taint();
    this.pending = null;
  }

  /** Meter refill (FC11): Hype to the maximum, Composure to the maximum, Rattled off. */
  refill(m: FighterMatch): void {
    for (let i = 0; i < 2; i++) {
      const o = FIGHTER_BASE[i] as number;
      m.buf[o + FF.Hype] = this.tuning.HYPE_MAX;
      m.buf[o + FF.Composure] = this.tuning.COMPOSURE_MAX;
      m.buf[o + FF.Rattled] = 0;
      m.buf[o + FF.Hp] = this.kits[i as 0 | 1].def.health;
    }
    m.taint();
  }

  model(m: FighterMatch): TrainVm {
    const tick = m.tick;
    return {
      v: 1,
      overlay: { ...this.overlay },
      dummy: this.dummy,
      recording: this.recording,
      recLen: this.rec.length,
      meter: this.meter ? { ...this.meter } : null,
      last: { ...this.last },
      inputs: this.hist.map((h) => [h[0] as number, tick - (h[1] as number)]),
      bufAge: Math.max(0, tick - m.w(0, FF.BufAge) - 1),
      invuln: [m.w(0, FF.Invuln), m.w(1, FF.Invuln)],
    };
  }
}
