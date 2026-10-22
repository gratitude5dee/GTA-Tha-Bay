import { describe, expect, it } from 'vitest';
import type { DialogueEvent } from '@dv/shared/contracts/c10-npc';
import { sseStream, watchKill, type Scheduler } from '../src/npc/sse.ts';

// AC-5: the SSE transport under a mocked clock. The 4 s first-token rule, the event order, kill and client-gone endings.
class ManualClock implements Scheduler {
  t = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.timers.delete(h as number);
  }
  pending(): number {
    return this.timers.size;
  }
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => void this.setTimeout(resolve, ms));
  }
  /** Moves time forward in 100 ms steps, letting promise callbacks run between steps. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    while (this.t < end) {
      this.t = Math.min(this.t + 100, end);
      for (const [id, tm] of [...this.timers]) {
        if (tm.at <= this.t) {
          this.timers.delete(id);
          tm.fn();
        }
      }
      await flush();
    }
  }
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const meta: Extract<DialogueEvent, { event: 'meta' }> = {
  event: 'meta',
  data: {
    encounterId: 'enc-1', turnIndex: 0, npcId: 'npc_test', soulVersion: 1, model: 'haiku', voice: 't0', turnsLeft: 11,
    disclosure: { aiCharacter: true, disclaimer: 'none' as never }, gov: 0,
  } as never,
};
const delta = (seq: number, text?: string): DialogueEvent => ({ event: 'line.delta', data: { seq, ...(text === undefined ? {} : { text }) } });
const lineDone: DialogueEvent = { event: 'line.done', data: { text: 'Yo, what is good.', words: 4 } };
const effects: DialogueEvent = { event: 'effects', data: { mood: 'neutral' as never } };
const done: DialogueEvent = { event: 'done', data: { costMicros: 120, turnsLeft: 11, closed: false } };

interface Frame {
  at: number;
  event: string;
  data: Record<string, unknown>;
}

/** Reads the stream to its end, stamping each frame with the mocked time at which it arrived. */
function collect(stream: ReadableStream<Uint8Array>, clock: ManualClock): { frames: Frame[]; finished: Promise<void> } {
  const frames: Frame[] = [];
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const finished = (async () => {
    for (;;) {
      const r = await reader.read();
      if (r.done) return;
      buf += dec.decode(r.value, { stream: true });
      let at: number;
      while ((at = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, at);
        buf = buf.slice(at + 2);
        const m = /^event: (.+)\ndata: (.+)$/.exec(block);
        if (m) frames.push({ at: clock.t, event: m[1]!, data: JSON.parse(m[2]!) as Record<string, unknown> });
      }
    }
  })();
  return { frames, finished };
}

describe('SSE transport (AC-5)', () => {
  it('an upstream whose first text comes after 5 s ends at 4.0 s with meta, fallback{timeout}, done, and is aborted', async () => {
    const clock = new ManualClock();
    let upstreamSignal: AbortSignal | undefined;
    const aborts: string[] = [];
    const stream = sseStream({
      meta,
      knot: 'busy',
      scheduler: clock,
      upstream: async function* (signal) {
        upstreamSignal = signal;
        await clock.sleep(5000);
        yield delta(0, 'too late');
        yield lineDone;
        yield done;
      },
      onAbort: (r) => void aborts.push(r),
    });
    const { frames, finished } = collect(stream, clock);
    await clock.advance(3900);
    expect(frames.map((f) => f.event)).toEqual(['meta']);
    await clock.advance(200);
    await finished;
    expect(frames.map((f) => f.event)).toEqual(['meta', 'fallback', 'done']);
    expect(frames[1]!.data).toEqual({ reason: 'timeout', knot: 'busy' });
    expect(frames[1]!.at).toBeGreaterThanOrEqual(3800);
    expect(frames[1]!.at).toBeLessThanOrEqual(4200);
    expect(frames[2]!.data).toEqual({ costMicros: 0, turnsLeft: 11, closed: false });
    expect(upstreamSignal?.aborted).toBe(true);
    expect(aborts).toEqual(['timeout']);
    await clock.advance(2000); // the late line never reaches the client
    expect(frames).toHaveLength(3);
  });

  it('an upstream that speaks at 1 s gives meta, line.delta..., line.done, effects, done in that order', async () => {
    const clock = new ManualClock();
    const finishedWith: DialogueEvent[][] = [];
    const aborts: string[] = [];
    const stream = sseStream({
      meta,
      knot: 'busy',
      scheduler: clock,
      upstream: async function* () {
        await clock.sleep(1000);
        yield delta(0, 'Yo,');
        yield delta(1, ' what is good.');
        yield lineDone;
        yield effects;
        yield done;
      },
      onAbort: (r) => void aborts.push(r),
      onDone: (events) => void finishedWith.push([...events]),
    });
    const { frames, finished } = collect(stream, clock);
    await clock.advance(1200);
    await finished;
    expect(frames.map((f) => f.event)).toEqual(['meta', 'line.delta', 'line.delta', 'line.done', 'effects', 'done']);
    expect(frames[1]!.at).toBeGreaterThanOrEqual(1000);
    expect(frames[1]!.data).toEqual({ seq: 0, text: 'Yo,' });
    expect(aborts).toEqual([]);
    expect(finishedWith).toHaveLength(1);
    expect(finishedWith[0]!.map((e) => e.event)).toEqual(['meta', 'line.delta', 'line.delta', 'line.done', 'effects', 'done']);
    expect(clock.pending()).toBe(0); // the first-token timer was cleared
    await clock.advance(10_000);
    expect(frames).toHaveLength(6);
  });

  it('audio or an empty delta is not a first token: only text clears the 4 s timer', async () => {
    const clock = new ManualClock();
    const stream = sseStream({
      meta,
      knot: 'deflect',
      scheduler: clock,
      upstream: async function* () {
        yield { event: 'line.delta', data: { seq: 0, audio: { sentence: 0, codec: 'mp3', b64: '', last: false } } } as DialogueEvent;
        yield delta(1, '');
        await clock.sleep(6000);
        yield delta(2, 'finally');
      },
      onAbort: () => undefined,
    });
    const { frames, finished } = collect(stream, clock);
    await clock.advance(4200);
    await finished;
    expect(frames.map((f) => f.event)).toEqual(['meta', 'line.delta', 'line.delta', 'fallback', 'done']);
    expect(frames[3]!.data).toMatchObject({ reason: 'timeout', knot: 'deflect' });
  });

  it('an upstream that throws, or ends without done, gives fallback{upstream}', async () => {
    for (const mode of ['throws', 'ends'] as const) {
      const clock = new ManualClock();
      const aborts: string[] = [];
      const stream = sseStream({
        meta,
        knot: 'busy',
        scheduler: clock,
        upstream: async function* () {
          yield delta(0, 'half a line');
          if (mode === 'throws') throw new Error('boom');
        },
        onAbort: (r) => void aborts.push(r),
      });
      const { frames, finished } = collect(stream, clock);
      await clock.advance(500);
      await finished;
      expect(frames.map((f) => f.event), mode).toEqual(['meta', 'line.delta', 'fallback', 'done']);
      expect(frames[2]!.data, mode).toMatchObject({ reason: 'upstream' });
      expect(aborts, mode).toEqual(['upstream']);
      expect(clock.pending()).toBe(0);
    }
  });

  it('a fallback from the upstream itself (refusal) is passed on and ends the turn', async () => {
    const clock = new ManualClock();
    const aborts: string[] = [];
    const stream = sseStream({
      meta,
      knot: 'busy',
      scheduler: clock,
      upstream: async function* () {
        yield { event: 'fallback', data: { reason: 'refusal', knot: 'deflect' } } as DialogueEvent;
      },
      onAbort: (r) => void aborts.push(r),
    });
    const { frames, finished } = collect(stream, clock);
    await clock.advance(200);
    await finished;
    expect(frames.map((f) => f.event)).toEqual(['meta', 'fallback', 'done']);
    expect(frames[1]!.data).toEqual({ reason: 'refusal', knot: 'deflect' });
    expect(aborts).toEqual(['refusal']);
  });

  it('a kill signal ends an open stream with fallback{killed} and done, and aborts the upstream', async () => {
    const clock = new ManualClock();
    const killed = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    const aborts: string[] = [];
    const stream = sseStream({
      meta,
      knot: 'busy',
      scheduler: clock,
      killed: killed.signal,
      upstream: async function* (signal) {
        upstreamSignal = signal;
        yield delta(0, 'Yo,');
        await clock.sleep(60_000);
        yield delta(1, 'never');
      },
      onAbort: (r) => void aborts.push(r),
    });
    const { frames, finished } = collect(stream, clock);
    await clock.advance(500);
    expect(frames.map((f) => f.event)).toEqual(['meta', 'line.delta']);
    killed.abort();
    await clock.advance(100);
    await finished;
    expect(frames.map((f) => f.event)).toEqual(['meta', 'line.delta', 'fallback', 'done']);
    expect(frames[2]!.data).toMatchObject({ reason: 'killed' });
    expect(upstreamSignal?.aborted).toBe(true);
    expect(aborts).toEqual(['upstream']);
  });

  it('a client that goes away aborts the upstream and the turn', async () => {
    const clock = new ManualClock();
    let upstreamSignal: AbortSignal | undefined;
    const aborts: string[] = [];
    const stream = sseStream({
      meta,
      knot: 'busy',
      scheduler: clock,
      upstream: async function* (signal) {
        upstreamSignal = signal;
        yield delta(0, 'Yo,');
        await clock.sleep(60_000);
      },
      onAbort: (r) => void aborts.push(r),
    });
    const reader = stream.getReader();
    await reader.read(); // meta
    await clock.advance(200);
    await reader.cancel();
    await clock.advance(200);
    expect(upstreamSignal?.aborted).toBe(true);
    expect(aborts).toEqual(['client_gone']);
  });

  it('watchKill aborts its signal once the poll reports killed, and stops polling', async () => {
    const clock = new ManualClock();
    let polls = 0;
    let killedNow = false;
    const w = watchKill(() => (polls++, Promise.resolve({ killed: killedNow })), 250, clock);
    await clock.advance(1000);
    expect(w.signal.aborted).toBe(false);
    expect(polls).toBeGreaterThanOrEqual(3);
    killedNow = true;
    await clock.advance(300);
    expect(w.signal.aborted).toBe(true);
    const after = polls;
    await clock.advance(2000);
    expect(polls).toBe(after);
    w.stop();
  });
});
