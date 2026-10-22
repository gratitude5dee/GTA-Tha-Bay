/**
 * The op interpreter (C09 section C6): a tree walker with an explicit frame stack, so a thread's state is data the debugger can show
 * and no op recurses on the JS stack. One `OpRunner` runs one op array (a stage's `onEnter`, a mission thread, a hook). `all` and
 * `race` fork child runners that are stepped in branch order; a `race` ends in the tick in which a branch finishes and the lowest
 * branch index wins a tie (every branch still ran that tick; the losers are cancelled at its end). Each op node costs 1 and each
 * predicate node costs 1; a runner stops when the thread's budget for the tick is spent. Time is the mission clock, which stands
 * still during a beat, so a beat leaves every `wait` unchanged. Sim code under the C02 lint.
 */
import type { Op, Pred } from '@dv/shared';
import type { Cost } from './predicates.ts';

/** What a leaf op may ask the runner to wait for. */
export type WaitSpec =
  | { k: 'clock'; until: number }
  | { k: 'pred'; pred: () => boolean }
  | { k: 'event'; name: string; base: number };

export interface OpHost {
  /** Mission clock in ticks. */
  readonly clock: number;
  /** True once `pass` or `fail` was requested: every runner stops. */
  ended(): boolean;
  pred(p: Pred, cost: Cost): boolean;
  /** Events of this name seen so far (mission events and sim events). */
  eventCount(name: string): number;
  /** Runs a leaf op for `owner` (a thread id); the answer is what the op waits for, if anything. */
  leaf(op: Op, ptr: string, owner: string): WaitSpec | void;
}

type Wait =
  | { k: 'clock'; until: number }
  | { k: 'pred'; cond: () => boolean }
  | { k: 'ucond'; cond: Pred; deadline: number; onTimeout: readonly Op[] | undefined; ptr: string }
  | { k: 'event'; name: string; base: number; deadline: number };

type Frame =
  | { k: 'seq'; ops: readonly Op[]; i: number; ptr: string }
  | { k: 'loop'; op: Extract<Op, { op: 'loop' }>; n: number; ptr: string }
  | { k: 'par'; mode: 'all' | 'race'; children: OpRunner[]; ptr: string };

export type StepResult = 'done' | 'wait' | 'budget';

export interface RunnerView {
  ptr: string;
  wait: string;
  depth: number;
}

const NO_DEADLINE = -1;

export class OpRunner {
  private readonly stack: Frame[] = [];
  private wait: Wait | null = null;
  private finished = false;
  private lastPtr: string;

  constructor(ops: readonly Op[], readonly basePtr: string) {
    this.stack.push({ k: 'seq', ops, i: 0, ptr: basePtr });
    this.lastPtr = basePtr;
  }

  get done(): boolean {
    return this.finished;
  }

  /** Ends the runner without running anything more (a lost race branch, a killed thread). */
  cancel(): void {
    this.finished = true;
    this.stack.length = 0;
    this.wait = null;
  }

  /** Where the runner is, for the debugger: the pointer of the op it ran last and what it waits for. */
  view(): RunnerView {
    const w = this.wait;
    const wait = !w ? '' : w.k === 'clock' ? `clock ${w.until}` : w.k === 'event' ? `event ${w.name}` : w.k === 'pred' || w.k === 'ucond' ? 'condition' : '';
    const top = this.stack[this.stack.length - 1];
    if (top?.k === 'par') {
      const child = top.children.find((c) => !c.done);
      if (child) {
        const v = child.view();
        return { ptr: v.ptr, wait: v.wait, depth: this.stack.length + v.depth };
      }
    }
    return { ptr: this.lastPtr, wait, depth: this.stack.length };
  }

  /** The earliest clock tick a pure clock wait ends at, when the whole runner is just waiting for the clock (else null). */
  clockWaitUntil(): number | null {
    const top = this.stack[this.stack.length - 1];
    if (top?.k === 'par' || this.wait === null) return null;
    return this.wait.k === 'clock' ? this.wait.until : null;
  }

  step(host: OpHost, t: { ops: number }, limit: number): StepResult {
    for (;;) {
      if (this.finished) return 'done';
      if (host.ended()) {
        this.cancel();
        return 'done';
      }
      if (this.wait) {
        if (!this.resolveWait(host, t)) return 'wait';
      }
      if (t.ops >= limit) return 'budget';
      const top = this.stack[this.stack.length - 1];
      if (!top) {
        this.finished = true;
        return 'done';
      }
      switch (top.k) {
        case 'seq': {
          if (top.i >= top.ops.length) {
            this.stack.pop();
            break;
          }
          const op = top.ops[top.i] as Op;
          const ptr = `${top.ptr}/${top.i}`;
          top.i++;
          t.ops++;
          this.lastPtr = ptr;
          this.execute(op, ptr, host, t);
          break;
        }
        case 'loop': {
          t.ops++;
          if (top.n >= top.op.max) {
            this.stack.pop();
            break;
          }
          if (top.op.until && host.pred(top.op.until, costOf(t))) {
            this.stack.pop();
            break;
          }
          top.n++;
          this.stack.push({ k: 'seq', ops: top.op.body, i: 0, ptr: `${top.ptr}/body` });
          break;
        }
        case 'par': {
          const r = this.stepPar(top, host, t, limit);
          if (r === 'done') {
            this.stack.pop();
            break;
          }
          return r;
        }
      }
    }
  }

  private stepPar(f: Extract<Frame, { k: 'par' }>, host: OpHost, t: { ops: number }, limit: number): StepResult {
    let budget = false;
    for (const c of f.children) {
      if (c.done) continue;
      if (c.step(host, t, limit) === 'budget') budget = true;
    }
    if (f.mode === 'race') {
      if (f.children.some((c) => c.done)) {
        for (const c of f.children) c.cancel();
        return 'done';
      }
    } else if (f.children.every((c) => c.done)) {
      return 'done';
    }
    return budget ? 'budget' : 'wait';
  }

  /** True when the wait is over (it is cleared); false while it holds. */
  private resolveWait(host: OpHost, t: { ops: number }): boolean {
    const w = this.wait as Wait;
    switch (w.k) {
      case 'clock':
        if (host.clock < w.until) return false;
        break;
      case 'pred':
        if (!w.cond()) return false;
        break;
      case 'ucond': {
        const ok = host.pred(w.cond, costOf(t));
        const timedOut = !ok && w.deadline !== NO_DEADLINE && host.clock >= w.deadline;
        if (!ok && !timedOut) return false;
        this.wait = null;
        if (timedOut && w.onTimeout && w.onTimeout.length > 0) this.stack.push({ k: 'seq', ops: w.onTimeout, i: 0, ptr: `${w.ptr}/onTimeout` });
        return true;
      }
      case 'event':
        if (host.eventCount(w.name) <= w.base && !(w.deadline !== NO_DEADLINE && host.clock >= w.deadline)) return false;
        break;
    }
    this.wait = null;
    return true;
  }

  private execute(op: Op, ptr: string, host: OpHost, t: { ops: number }): void {
    switch (op.op) {
      case 'seq':
        this.stack.push({ k: 'seq', ops: op.body, i: 0, ptr: `${ptr}/body` });
        return;
      case 'all':
      case 'race':
        this.stack.push({ k: 'par', mode: op.op, children: op.branches.map((b, i) => new OpRunner(b, `${ptr}/branches/${i}`)), ptr });
        return;
      case 'if': {
        const yes = host.pred(op.cond, costOf(t));
        const branch = yes ? op.then : op.else;
        if (branch && branch.length > 0) this.stack.push({ k: 'seq', ops: branch, i: 0, ptr: `${ptr}/${yes ? 'then' : 'else'}` });
        return;
      }
      case 'loop':
        this.stack.push({ k: 'loop', op, n: 0, ptr });
        return;
      case 'wait':
        this.wait = { k: 'clock', until: host.clock + Math.max(1, Math.ceil(op.sec * 60)) };
        return;
      case 'waitUntil':
        this.wait = {
          k: 'ucond', cond: op.cond, deadline: op.timeoutSec === undefined ? NO_DEADLINE : host.clock + Math.max(1, Math.ceil(op.timeoutSec * 60)),
          onTimeout: op.onTimeout, ptr,
        };
        return;
      case 'waitEvent':
        this.wait = {
          k: 'event', name: op.event, base: host.eventCount(op.event),
          deadline: op.timeoutSec === undefined ? NO_DEADLINE : host.clock + Math.max(1, Math.ceil(op.timeoutSec * 60)),
        };
        return;
      case 'pass':
      case 'fail':
        host.leaf(op, ptr, this.basePtr);
        this.cancel();
        return;
      default: {
        const w = host.leaf(op, ptr, this.basePtr);
        if (w) this.wait = w.k === 'pred' ? { k: 'pred', cond: w.pred } : w.k === 'event' ? { ...w, deadline: NO_DEADLINE } : w;
      }
    }
  }
}

/** The cost counter of a step: predicate nodes add to the same `ops` the op nodes do. */
function costOf(t: { ops: number }): Cost {
  return {
    get n(): number {
      return t.ops;
    },
    set n(v: number) {
      t.ops = v;
    },
  };
}
