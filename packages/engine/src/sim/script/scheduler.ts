import type { Rng, RngStreams, SimEvent, SimEventBus, SimScheduler, ThreadCtx, ThreadYield } from '@dv/shared';
import type { ByteReader, ByteWriter } from '../bytes.ts';
import type { SimResource } from '../services.ts';

/** What a thread waits for, for the debugger and the hash. */
export type ThreadWait = 'ready' | 'ticks' | 'until' | 'event' | 'budget';

export interface ThreadInfo {
  id: string;
  wait: ThreadWait;
  /** Tick at which a `waitTicks` or a `waitUntil` timeout ends; 0 when there is none. */
  wakeTick: number;
  /** The event type a `waitEvent` waits for; empty otherwise. */
  event: string;
  /** Ops the thread spent in its latest step (what the step wrote into `ThreadCtx.ops`). */
  opsLastStep: number;
  /** Steps run so far. */
  steps: number;
}

interface Thread {
  id: string;
  step: (t: ThreadCtx) => ThreadYield;
  ctx: ThreadCtx;
  wait: ThreadWait;
  wakeTick: number;
  pred: (() => boolean) | null;
  event: string;
  signalled: boolean;
  opsLastStep: number;
  steps: number;
  dead: boolean;
}

export interface SchedulerOptions {
  /** Named RNG streams; every thread gets the stream `script:<threadId>`. */
  rng: RngStreams;
  /** Events end a `waitEvent` (the scheduler listens to all of them). */
  events: SimEventBus;
  /** A step threw: the thread is gone. Without a handler the error is rethrown from `run`. */
  onError?(threadId: string, error: unknown): void;
  /** Called when the first thread is spawned, so the owner registers the hashed resource only for sessions that run scripts. */
  onFirstUse?(): void;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `SimScheduler` (C06): cooperative threads, run once per tick in `threadId` order (`run`, called by the engine in `SimStage.Script`).
 *
 * A step runs until it yields. `ThreadCtx.ops` starts at 0 for each step; the step adds what it spends and must stop and return
 * `{k: 'continue'}` once `ops` reaches `opsBudgetPerTick` (2,000), which resumes it on the next tick. `waitTicks n` resumes the
 * thread n ticks later (n at least 1); `waitUntil` re-checks `pred` at the start of every tick (and resumes after `timeoutTicks`);
 * `waitEvent` resumes on the next tick after an event of that type was emitted; `done` removes the thread. A thread spawned while
 * `run` is in progress first runs on the next tick. `kill` takes effect at once: a killed thread does not run again, even later in
 * the same tick. Sim code under the C02 lint.
 */
export class SimSchedulerImpl implements SimScheduler {
  readonly opsBudgetPerTick = 2000 as const;
  private readonly threads = new Map<string, Thread>();
  private order: string[] = [];
  private used = false;
  private lastTick = 0;

  constructor(private readonly o: SchedulerOptions) {
    o.events.on('*', (e: SimEvent) => this.onEvent(e));
  }

  spawn(threadId: string, step: (t: ThreadCtx) => ThreadYield): void {
    if (this.threads.has(threadId)) throw new Error(`thread ${threadId} already exists`);
    if (!this.used) {
      this.used = true;
      this.o.onFirstUse?.();
    }
    const rng: Rng = this.o.rng.get(`script:${threadId}`);
    this.threads.set(threadId, {
      id: threadId, step, ctx: { tick: this.lastTick, ops: 0, rng }, wait: 'ready', wakeTick: 0, pred: null, event: '', signalled: false,
      opsLastStep: 0, steps: 0, dead: false,
    });
    let lo = 0;
    let hi = this.order.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (byId(this.order[mid] as string, threadId) < 0) lo = mid + 1;
      else hi = mid;
    }
    this.order.splice(lo, 0, threadId);
  }

  kill(threadId: string): void {
    const t = this.threads.get(threadId);
    if (!t) return;
    t.dead = true;
    this.threads.delete(threadId);
    const i = this.order.indexOf(threadId);
    if (i >= 0) this.order.splice(i, 1);
  }

  has(threadId: string): boolean {
    return this.threads.has(threadId);
  }

  get size(): number {
    return this.threads.size;
  }

  /** Thread ids in run order. */
  ids(): readonly string[] {
    return this.order;
  }

  info(threadId: string): ThreadInfo | null {
    const t = this.threads.get(threadId);
    return t ? { id: t.id, wait: t.wait, wakeTick: t.wakeTick, event: t.event, opsLastStep: t.opsLastStep, steps: t.steps } : null;
  }

  /** Runs every thread that is due, in `threadId` order. */
  run(tick: number): void {
    this.lastTick = tick;
    if (this.order.length === 0) return;
    const snapshot = [...this.order];
    for (const id of snapshot) {
      const t = this.threads.get(id);
      if (!t || t.dead) continue;
      if (!this.due(t, tick)) continue;
      t.wait = 'ready';
      t.pred = null;
      t.signalled = false;
      t.ctx.tick = tick;
      t.ctx.ops = 0;
      let y: ThreadYield;
      try {
        y = t.step(t.ctx);
      } catch (e) {
        this.kill(id);
        if (this.o.onError) this.o.onError(id, e);
        else throw e;
        continue;
      }
      t.steps++;
      t.opsLastStep = t.ctx.ops;
      if (t.dead) continue;
      switch (y.k) {
        case 'continue':
          t.wait = t.ctx.ops >= this.opsBudgetPerTick ? 'budget' : 'ready';
          t.wakeTick = tick + 1;
          break;
        case 'waitTicks':
          t.wait = 'ticks';
          t.wakeTick = tick + Math.max(1, Math.floor(y.n));
          break;
        case 'waitUntil':
          t.wait = 'until';
          t.pred = y.pred;
          t.wakeTick = y.timeoutTicks !== undefined ? tick + Math.max(1, Math.floor(y.timeoutTicks)) : 0;
          break;
        case 'waitEvent':
          t.wait = 'event';
          t.event = y.t;
          t.wakeTick = 0;
          break;
        case 'done':
          this.kill(id);
          break;
      }
    }
  }

  private due(t: Thread, tick: number): boolean {
    switch (t.wait) {
      case 'ready':
      case 'budget':
        return tick >= t.wakeTick;
      case 'ticks':
        return tick >= t.wakeTick;
      case 'until':
        if (t.wakeTick !== 0 && tick >= t.wakeTick) return true;
        return t.pred !== null && t.pred();
      case 'event':
        return t.signalled;
    }
  }

  private onEvent(e: SimEvent): void {
    for (const t of this.threads.values()) {
      if (t.wait === 'event' && t.event === e.t) t.signalled = true;
    }
  }

  /** The hashed state: thread ids with what each waits for. Closures are not state; a restore leaves no threads (a mission restores from its own checkpoint). */
  resource(): SimResource {
    return {
      name: 'script',
      hash: (h) => {
        h.u32(this.order.length);
        for (const id of this.order) {
          const t = this.threads.get(id) as Thread;
          h.str(id).u8(['ready', 'ticks', 'until', 'event', 'budget'].indexOf(t.wait)).u32(t.wakeTick).str(t.event).u32(t.steps);
        }
      },
      save: (w: ByteWriter) => {
        w.u32(this.order.length);
      },
      load: (r: ByteReader) => {
        r.u32();
        for (const id of [...this.order]) this.kill(id);
      },
    };
  }
}
