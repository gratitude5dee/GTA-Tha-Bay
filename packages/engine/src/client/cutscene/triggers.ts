/**
 * The eleven fallback triggers of the CutscenePlayer (spec/domains/03-story-cutscenes.md section D7, R-CUT-03): thresholds from
 * `config/cutscene.json`, the action each trigger takes, timers behind an injectable clock, the stall watches, and the
 * `cutscene.play` telemetry (C16 1.1: the trigger goes in `trigger`, never in `reason`; DL-193).
 */
import type { CutsceneOutcome, FallbackTrigger } from '@dv/shared/contracts/c09-cutscene';
import cfgJson from '../../../../../config/cutscene.json';

export interface CutsceneConfig {
  answerDeadlineMs: number;
  answerDeadlinePrefetchedMs: number;
  startStallMs: number;
  startStallPrefetchedMs: number;
  midStallMs: number;
  midStallFrozenXrMs: number;
  tapToPlayMs: number;
  budgetFraction: number;
  dataSaverMbps: number;
  v1080MinScreenHeightPx: number;
  prefetchAheadMobile: number;
  prefetchAheadDesktop: number;
  audioNudgeMs: number;
  audioNudgeConstantOffsetMs: number;
  mobileMediaBudgetMB: number;
  manifestTimeoutMs: number;
}

export const CUTSCENE_CONFIG = cfgJson as unknown as CutsceneConfig;

/** The action of each trigger (the table of section D7). `fallback` ends in the in-engine DirectorScript. */
export type TriggerAction = 'fallback' | 'retry-then-tap-then-fallback' | 'next-host-then-fallback' | 'hold-last-finish-in-engine' | 'v540-then-fallback' | 'ping-pong-or-fallback';

export const TRIGGER_ACTIONS: Readonly<Record<FallbackTrigger, TriggerAction>> = {
  not_ready: 'fallback',
  policy: 'fallback',
  setting_off: 'fallback',
  offline: 'fallback',
  not_permitted: 'retry-then-tap-then-fallback',
  media_error: 'next-host-then-fallback',
  codec: 'next-host-then-fallback',
  start_stall: 'fallback',
  mid_stall: 'hold-last-finish-in-engine',
  budget: 'v540-then-fallback',
  degraded_sequence: 'ping-pong-or-fallback',
};

/** Clock and timers, injectable so that the unit tests run on a fake one. */
export interface Timers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realTimers: Timers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * One decision per play: `decide` runs its action at most once. The first caller wins; the deadline timer of the request, a failed
 * preroll and a play rejection all go through the same gate.
 */
export class Decision<T> {
  private value: T | undefined;
  private done = false;
  /** True once a decision was made. */
  get decided(): boolean {
    return this.done;
  }
  get result(): T | undefined {
    return this.value;
  }
  decide(v: T): boolean {
    if (this.done) return false;
    this.done = true;
    this.value = v;
    return true;
  }
}

/** A timer that can be cleared and restarted; `fire` runs once per arming. */
export class Watch {
  private handle: unknown = null;
  constructor(private readonly timers: Timers) {}
  arm(ms: number, fire: () => void): void {
    this.clear();
    this.handle = this.timers.setTimeout(() => {
      this.handle = null;
      fire();
    }, ms);
  }
  clear(): void {
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.handle = null;
  }
  get armed(): boolean {
    return this.handle !== null;
  }
}

export type Telemetry = (name: 'cutscene.play', props: { key8: string; cached: boolean; fallback: boolean; path: CutsceneOutcome['path']; trigger?: FallbackTrigger }) => void;

/** Emits `cutscene.play` once for a finished play: `path`, the trigger when it fell back, never a `reason`. */
export function emitPlay(emit: Telemetry | undefined, key: string | null, cached: boolean, outcome: CutsceneOutcome): void {
  if (!emit) return;
  emit('cutscene.play', {
    key8: (key ?? '--------').slice(0, 8),
    cached,
    fallback: outcome.path === 'fallback',
    path: outcome.path,
    ...(outcome.trigger !== undefined ? { trigger: outcome.trigger } : {}),
  });
}

/** The first of `candidates` for which `ok` holds. */
export function firstOf<T>(candidates: readonly T[], ok: (c: T) => boolean): T | null {
  for (const c of candidates) if (ok(c)) return c;
  return null;
}
