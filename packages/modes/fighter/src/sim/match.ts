/**
 * `FighterMatch`: one match on the pure fight core (`FightCore`, FC2), with what the mode needs around it: the two input streams
 * as they were played (for the `.dvfight` replay), the 60-tick checkpoint hashes, the presentation events of the last tick, and
 * snapshot and restore. The buffer is the truth; nothing here feeds back into it except Training's explicit edits (`taint`).
 * Sim code under the C02 lint.
 */
import {
  FIGHTER_BASE, FM, FightCore, Phase, RF, encodeInputs, hashBuffer,
} from '@dv/shared/fight';
import type { DvFightReplay, FightEvent, FightEventSink, FightRules, FighterLoadout, FrameDataPack } from '@dv/shared/fight';

export const EVENT_KINDS = ['hit', 'block', 'check', 'whiff', 'ko', 'super', 'round', 'cue'] as const;
export type EventKindName = (typeof EVENT_KINDS)[number];

const MAX_EVENTS = 16;

/** Copies the events of one tick (the core reuses one event object, so a sink must copy; FC2 `FightEventSink`). */
export class EventBuf implements FightEventSink {
  n = 0;
  readonly kind = new Int32Array(MAX_EVENTS);
  readonly slot = new Int32Array(MAX_EVENTS);
  readonly x = new Int32Array(MAX_EVENTS);
  readonly y = new Int32Array(MAX_EVENTS);
  readonly a = new Int32Array(MAX_EVENTS);
  readonly b = new Int32Array(MAX_EVENTS);
  readonly tick = new Int32Array(MAX_EVENTS);

  push(e: FightEvent): void {
    if (this.n >= MAX_EVENTS) return;
    const i = this.n++;
    this.kind[i] = EVENT_KINDS.indexOf(e.kind);
    this.slot[i] = e.slot; this.x[i] = e.x; this.y[i] = e.y; this.a[i] = e.a; this.b[i] = e.b; this.tick[i] = e.tick;
  }

  clear(): void { this.n = 0; }

  /** `[kind, slot, x, y, a, b]` rows for the view model. */
  rows(): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < this.n; i++) out.push([this.kind[i] as number, this.slot[i] as number, this.x[i] as number, this.y[i] as number, this.a[i] as number, this.b[i] as number]);
    return out;
  }
}

export interface MatchSetup {
  pack: FrameDataPack;
  rules: FightRules;
  seed: number;
  lineup: [FighterLoadout, FighterLoadout];
  stage: string;
}

export class FighterMatch {
  readonly core = new FightCore();
  readonly buf: Int32Array;
  readonly events = new EventBuf();
  /** The inputs played so far, both slots. */
  readonly in0: number[] = [];
  readonly in1: number[] = [];
  private readonly hashes: [number, number][] = [];
  /** Set when something other than `step` changed the buffer (Training's reset and refill); such a match has no replay. */
  tainted = false;

  constructor(readonly setup: MatchSetup) {
    this.buf = this.core.init(setup.pack, setup.rules, setup.seed, setup.lineup);
  }

  get tick(): number { return this.buf[FM.Tick] as number; }
  get phase(): number { return this.buf[FM.Phase] as number; }
  get phaseFrame(): number { return this.buf[FM.PhaseFrame] as number; }
  get round(): number { return this.buf[FM.Round] as number; }
  get winner(): number { return this.buf[FM.Winner] as number; }
  get rounds(): [number, number] { return [this.buf[FM.RoundsWon0] as number, this.buf[FM.RoundsWon1] as number]; }
  get ended(): boolean { return this.phase === Phase.MatchEnd; }
  get training(): boolean { return ((this.buf[FM.RulesFlags] as number) & RF.Training) !== 0; }

  /** Word `FF.x` of fighter `slot`. */
  w(slot: 0 | 1, word: number): number { return this.buf[(FIGHTER_BASE[slot] as number) + word] as number; }

  /** One tick with both inputs. The events of the tick are in `events`. */
  step(i0: number, i1: number): void {
    this.events.clear();
    const t = this.in0.length;
    this.in0.push(i0 & 0xffff);
    this.in1.push(i1 & 0xffff);
    this.core.step(this.buf, i0, i1, this.events);
    if ((t + 1) % 60 === 0) this.hashes.push(hashBuffer(this.buf));
  }

  hash(): [number, number] { return hashBuffer(this.buf); }
  snapshot(): Int32Array { return this.core.snapshot(this.buf); }
  restore(snap: Int32Array): void { this.core.restore(this.buf, snap); this.tainted = true; }

  /** Marks the match as edited from outside the input streams (no replay can reproduce it). */
  taint(): void { this.tainted = true; }

  /** The `.dvfight` of the match so far; null when Training edited the buffer. */
  exportReplay(build: string): DvFightReplay | null {
    if (this.tainted) return null;
    return {
      v: 1, build, frameDataHash: this.setup.pack.hash, fightDataVersion: 1, seed: this.setup.seed, rules: this.setup.rules,
      lineup: this.setup.lineup, stage: this.setup.stage,
      inputs: [encodeInputs(this.in0), encodeInputs(this.in1)],
      checkpoints: { every: 60, hashes: this.hashes.map((h) => [h[0], h[1]] as [number, number]) },
      final: { winner: this.winner, rounds: this.rounds },
    };
  }
}

