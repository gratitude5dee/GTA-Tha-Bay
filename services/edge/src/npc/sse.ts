import { NPC_GUARDRAILS } from '@dv/shared';
import type { DialogueEvent, FallbackReason, InkKnot } from '@dv/shared/contracts/c10-npc';

/**
 * The SSE transport of the dialogue route (route 31; spec/05 section 4.8; M06a1). It writes C10 `DialogueEvent`s in order and enforces the
 * 4 s first-token rule: if no `line.delta` carrying text arrives within 4 s of the upstream starting, the upstream is aborted and the client gets
 * `fallback{timeout}` then `done`. A kill signal ends the stream with `fallback{killed}`. The upstream is an injected async iterator (M06a3
 * supplies the Anthropic one), and timers come from an injected scheduler, so a test drives time by hand.
 *
 * Order on the wire: `meta`, `line.delta`*, `line.done`, `effects`, `done` -- or `meta`, `fallback`, `done`. Nothing here reads, logs or
 * stores the text of a line.
 */
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

type MetaEvent = Extract<DialogueEvent, { event: 'meta' }>;

export interface SseOptions {
  /** The first event, known before the upstream starts. */
  meta: MetaEvent;
  /** Starts the upstream. It must stop when `signal` aborts. */
  upstream: (signal: AbortSignal) => AsyncIterable<DialogueEvent>;
  /** The ink knot a fallback names (C10). */
  knot: InkKnot;
  /** Aborts the turn in the encounter (EncounterDO.abort). Called once, for every ending but a normal one. */
  onAbort: (reason: 'timeout' | 'refusal' | 'upstream' | 'client_gone') => void | Promise<void>;
  /** Called once after a normal ending with every event sent (EncounterDO.complete is the caller's job). */
  onDone?: (events: readonly DialogueEvent[]) => void | Promise<void>;
  /** Aborts when the NPC is killed (see watchKill). */
  killed?: AbortSignal;
  scheduler?: Scheduler;
  /** Defaults to guardrails npc.encounter.firstTokenMs (4000). */
  firstTokenMs?: number;
}

const encoder = new TextEncoder();

export function formatEvent(e: DialogueEvent): Uint8Array {
  return encoder.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
}

const hasText = (e: DialogueEvent): boolean => e.event === 'line.delta' && typeof e.data.text === 'string' && e.data.text.length > 0;

/** The response body for `Content-Type: text/event-stream`. */
export function sseStream(opts: SseOptions): ReadableStream<Uint8Array> {
  const sched = opts.scheduler ?? realScheduler;
  const firstTokenMs = opts.firstTokenMs ?? NPC_GUARDRAILS.encounter.firstTokenMs;
  const ac = new AbortController();
  let closed = false;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const sent: DialogueEvent[] = [];
      const send = (e: DialogueEvent): void => {
        if (closed) return;
        sent.push(e);
        controller.enqueue(formatEvent(e));
      };
      const finish = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by a cancel
        }
      };
      const turnsLeft = opts.meta.data.turnsLeft;
      const fallbackEnding = async (reason: FallbackReason, abortReason: 'timeout' | 'refusal' | 'upstream' | 'client_gone'): Promise<void> => {
        ac.abort();
        send({ event: 'fallback', data: { reason, knot: opts.knot } });
        send({ event: 'done', data: { costMicros: 0, turnsLeft, closed: false } });
        finish();
        await opts.onAbort(abortReason);
      };

      const run = async (): Promise<void> => {
        send(opts.meta);
        let timer: unknown;
        let timeoutP: Promise<'timeout'> | null = new Promise<'timeout'>((resolve) => {
          timer = sched.setTimeout(() => resolve('timeout'), firstTokenMs);
        });
        const killedP = new Promise<'killed'>((resolve) => {
          const k = opts.killed;
          if (k === undefined) return;
          if (k.aborted) resolve('killed');
          else k.addEventListener('abort', () => resolve('killed'), { once: true });
        });
        const cancelP = new Promise<'cancel'>((resolve) => ac.signal.addEventListener('abort', () => cancelled && resolve('cancel'), { once: true }));
        let iterator: AsyncIterator<DialogueEvent>;
        try {
          iterator = opts.upstream(ac.signal)[Symbol.asyncIterator]();
        } catch {
          sched.clearTimeout(timer);
          await fallbackEnding('upstream', 'upstream');
          return;
        }
        const stop = (): void => {
          ac.abort();
          void Promise.resolve(iterator.return?.()).catch(() => undefined);
        };
        try {
          for (;;) {
            const nextP = iterator.next();
            nextP.catch(() => undefined);
            const racers: Promise<IteratorResult<DialogueEvent> | 'timeout' | 'killed' | 'cancel'>[] = [nextP, killedP, cancelP];
            if (timeoutP !== null) racers.push(timeoutP);
            const r = await Promise.race(racers);
            if (r === 'cancel') {
              sched.clearTimeout(timer);
              stop();
              await opts.onAbort('client_gone');
              return;
            }
            if (r === 'timeout') {
              stop();
              await fallbackEnding('timeout', 'timeout');
              return;
            }
            if (r === 'killed') {
              sched.clearTimeout(timer);
              stop();
              await fallbackEnding('killed', 'upstream');
              return;
            }
            if (r.done === true) {
              // The upstream ended without its own `done`: that is an upstream failure, not a finished turn.
              sched.clearTimeout(timer);
              if (sent.some((e) => e.event === 'done')) break;
              await fallbackEnding('upstream', 'upstream');
              return;
            }
            const e = r.value;
            if (timeoutP !== null && hasText(e)) {
              sched.clearTimeout(timer);
              timeoutP = null;
            }
            if (e.event === 'fallback') {
              sched.clearTimeout(timer);
              send(e);
              if (!sent.some((x) => x.event === 'done')) send({ event: 'done', data: { costMicros: 0, turnsLeft, closed: false } });
              finish();
              await opts.onAbort(e.data.reason === 'refusal' ? 'refusal' : 'upstream');
              return;
            }
            send(e);
            if (e.event === 'done') {
              sched.clearTimeout(timer);
              finish();
              await opts.onDone?.(sent);
              return;
            }
          }
        } catch {
          sched.clearTimeout(timer);
          if (!closed) await fallbackEnding('upstream', 'upstream');
          return;
        }
        finish();
        await opts.onDone?.(sent);
      };

      void run().catch(() => finish());
    },
    cancel() {
      cancelled = true;
      closed = true;
      ac.abort();
    },
  });
}

/**
 * An AbortSignal that aborts when the encounter reports itself killed. `poll` reads `EncounterDO.status()`; it runs every `intervalMs`
 * until the signal aborts or `stop()` is called. A kill therefore reaches an open stream within one interval (250 ms by default).
 */
export function watchKill(poll: () => Promise<{ killed: boolean }>, intervalMs = 250, scheduler: Scheduler = realScheduler): { signal: AbortSignal; stop: () => void } {
  const ac = new AbortController();
  let stopped = false;
  let handle: unknown;
  const tick = (): void => {
    if (stopped) return;
    poll().then(
      (s) => {
        if (stopped) return;
        if (s.killed) ac.abort();
        else handle = scheduler.setTimeout(tick, intervalMs);
      },
      () => {
        if (!stopped) handle = scheduler.setTimeout(tick, intervalMs);
      },
    );
  };
  handle = scheduler.setTimeout(tick, 0);
  return {
    signal: ac.signal,
    stop() {
      stopped = true;
      scheduler.clearTimeout(handle);
    },
  };
}
