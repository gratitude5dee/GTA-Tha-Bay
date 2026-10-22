/**
 * The sim side of the cutscene protocol (spec/domains/03-story-cutscenes.md section D7, DL-160, DL-081; M05b2). A `beat` op with a
 * cutscene ref emits the sim event `{t: 'cut.request', s: <refIds comma-joined>, n: <u32 play counter>}` and ARMS the in-engine
 * DirectorScript: the actors go to their start marks, the first shot is published, the input context is `cutscene`, the player
 * toggle is locked, and the mission clock stands still (a beat stops it). The main thread answers with
 * `UiCommand cutscene.state {playId: String(n), state}`; the sim never waits on that answer longer than `CUT_ANSWER_TICKS`:
 *
 *   armed --video-->    video      the host pauses the sim; the script stands still
 *   armed --fallback--> fallback   the script runs for its duration, then the beat ends
 *   video --fallback--> fallback   a mid-play failure: the script runs from its start (the command carries no clip position)
 *   any   --done-->     ended      end marks applied, camera and input restored, the clock runs again
 *
 * Both paths leave the same mission state. Pure helpers; the runtime holds the state.
 */
import type { JsonObject, SimEvent } from '@dv/shared';
import type { CutsceneOutcome, FallbackTrigger } from '@dv/shared/contracts/c09-cutscene';

/** The sim answers `fallback` itself after this many ticks without an answer (3 s; the player's own deadline is 2.5 s). */
export const CUT_ANSWER_TICKS = 180;

export type CutState = 'armed' | 'video' | 'fallback';
export type CutAnswer = 'video' | 'fallback' | 'done';

export interface CutBeat {
  /** The u32 play counter; `playId` is `String(playNo)`. */
  playNo: number;
  playId: string;
  refId: string;
  state: CutState;
  /** Ticks spent armed, waiting for the answer. */
  waited: number;
}

export const playIdOf = (n: number): string => String(n);

/** The `cut.request` event for refs played in order; a null item is an empty field. */
export function requestEvent(tick: number, refIds: readonly (string | null)[], n: number): SimEvent {
  return { t: 'cut.request', tick, s: refIds.map((r) => r ?? '').join(','), n };
}

/** The refs of a `cut.request` event, in play order (an empty field is null). */
export function refsOfRequest(e: Pick<SimEvent, 's'>): (string | null)[] {
  return (e.s ?? '').split(',').map((r) => (r === '' ? null : r));
}

/** The `cut.done` event the sim emits when the in-engine beat of a play (and item) ends; the main thread waits on it. */
export function doneEvent(tick: number, n: number, item?: number): SimEvent {
  return { t: 'cut.done', tick, n, ...(item !== undefined ? { s: String(item) } : {}) };
}

export interface CutStateMsg {
  playId: string;
  item?: number;
  state: CutAnswer;
  trigger?: FallbackTrigger;
  outcome?: CutsceneOutcome;
}

/** The payload of the sim event `cutscene.state` that the engine's command handler emits for `UiCommand cutscene.state`. */
export function parseStateEvent(e: Pick<SimEvent, 't' | 's'>): CutStateMsg | null {
  if (e.t !== 'cutscene.state' || e.s === undefined) return null;
  try {
    const m = JSON.parse(e.s) as Partial<CutStateMsg> & JsonObject;
    if (typeof m.playId !== 'string' || (m.state !== 'video' && m.state !== 'fallback' && m.state !== 'done')) return null;
    return {
      playId: m.playId,
      state: m.state,
      ...(typeof m.item === 'number' ? { item: m.item } : {}),
      ...(typeof m.trigger === 'string' ? { trigger: m.trigger as FallbackTrigger } : {}),
      ...(m.outcome && typeof m.outcome === 'object' ? { outcome: m.outcome as CutsceneOutcome } : {}),
    };
  } catch {
    return null;
  }
}

/** The next state for an answer, or `ended` for `done`; null when the answer does not apply (stale, repeated or out of order). */
export function transition(cur: CutState, answer: CutAnswer): CutState | 'ended' | null {
  if (answer === 'done') return 'ended';
  if (answer === 'video') return cur === 'armed' ? 'video' : null;
  return cur === 'fallback' ? null : 'fallback';
}

/** True once an armed beat has waited long enough that the sim answers for the main thread. */
export const answerOverdue = (b: Pick<CutBeat, 'state' | 'waited'>): boolean => b.state === 'armed' && b.waited >= CUT_ANSWER_TICKS;
