import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createNetShaper, NET_SHAPER_MARKER, type NetProfile, type ShaperClock } from '../../src/assets/store/net-shaper.ts';
import type { FetchFn } from '../../src/assets/store/fetch-retry.ts';
import { NET_PROFILE_IDS, NO_QA_FLAGS, parseQaFlags } from '../../src/platform/qa-flags.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** A virtual clock: `sleep` registers a wake time, `runAll` moves time from timer to timer and lets promises settle between them. */
function fakeClock(): ShaperClock & { time: number; runAll(): Promise<void> } {
  const timers: Array<{ at: number; wake: () => void; reject: (e: Error) => void; signal: AbortSignal | null; off: () => void }> = [];
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  const clock = {
    time: 0,
    now: () => clock.time,
    sleep(ms: number, signal?: AbortSignal | null) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new Error(`${NET_SHAPER_MARKER}: aborted`));
        const onAbort = (): void => {
          const i = timers.findIndex((t) => t.wake === resolve);
          if (i >= 0) timers.splice(i, 1);
          reject(new Error(`${NET_SHAPER_MARKER}: aborted`));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        timers.push({ at: clock.time + Math.max(0, ms), wake: resolve, reject, signal: signal ?? null, off: () => signal?.removeEventListener('abort', onAbort) });
      });
    },
    async runAll() {
      await settle();
      while (timers.length > 0) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers.shift() as (typeof timers)[number];
        clock.time = Math.max(clock.time, t.at);
        t.off();
        t.wake();
        await settle();
      }
    },
  };
  return clock;
}

const body = (n: number): Uint8Array => new Uint8Array(n).fill(7);
const okFetch = (n: number): FetchFn => () => Promise.resolve(new Response(body(n) as BodyInit, { status: 200, statusText: 'OK', headers: { 'x-t': '1' } }));

function track<T>(p: Promise<T>, clock: { time: number }): { at: number | null; value: Promise<T> } {
  const out: { at: number | null; value: Promise<T> } = { at: null, value: p };
  out.value = p.then((v) => {
    out.at = clock.time;
    return v;
  });
  return out;
}

describe('createNetShaper', () => {
  const profile: NetProfile = { latencyMs: 100, bytesPerSec: 1_000_000 };

  it('one 100,000-byte response resolves at t = 200 and keeps status and headers', async () => {
    const clock = fakeClock();
    const f = createNetShaper(profile, clock).wrap(okFetch(100_000));
    const r = track(f('https://m.test/a', {}), clock);
    await clock.runAll();
    const res = await r.value;
    expect(r.at).toBe(200);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-t')).toBe('1');
    expect((await res.arrayBuffer()).byteLength).toBe(100_000);
  });

  it('two concurrent responses share one byte budget: they resolve at 200 and 300', async () => {
    const clock = fakeClock();
    const f = createNetShaper(profile, clock).wrap(okFetch(100_000));
    const a = track(f('https://m.test/a', {}), clock);
    const b = track(f('https://m.test/b', {}), clock);
    await clock.runAll();
    await Promise.all([a.value, b.value]);
    expect([a.at, b.at].sort()).toEqual([200, 300]);
  });

  it('a 404 resolves at 100 and leaves the cursor unchanged', async () => {
    const clock = fakeClock();
    let n = 0;
    const inner: FetchFn = () => (n++ === 0 ? Promise.resolve(new Response('no', { status: 404 })) : Promise.resolve(new Response(body(100_000) as BodyInit, { status: 200 })));
    const f = createNetShaper(profile, clock).wrap(inner);
    const miss = track(f('https://m.test/missing', {}), clock);
    await clock.runAll();
    expect((await miss.value).status).toBe(404);
    expect(miss.at).toBe(100);
    // the next ok response starts from the clock, not from a cursor the 404 moved
    const hit = track(f('https://m.test/a', {}), clock);
    await clock.runAll();
    await hit.value;
    expect(hit.at).toBe(100 + 100 + 100);
  });

  it('an abort during the latency wait rejects with the marker and never calls the inner fetch', async () => {
    const clock = fakeClock();
    let calls = 0;
    const f = createNetShaper(profile, clock).wrap(() => {
      calls++;
      return Promise.resolve(new Response(body(1) as BodyInit));
    });
    const ac = new AbortController();
    const p = f('https://m.test/a', { signal: ac.signal });
    const caught = p.then(
      () => null,
      (e: Error) => e,
    );
    await Promise.resolve();
    ac.abort();
    await clock.runAll();
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain(NET_SHAPER_MARKER);
    expect(calls).toBe(0);
  });

  it('a profile without bytesPerSec (lag) returns the inner Response object itself, after the latency', async () => {
    const clock = fakeClock();
    const res = new Response(body(10) as BodyInit);
    const f = createNetShaper({ latencyMs: 400, bytesPerSec: null }, clock).wrap(() => Promise.resolve(res));
    const r = track(f('https://m.test/a', {}), clock);
    await clock.runAll();
    expect(await r.value).toBe(res);
    expect(r.at).toBe(400);
  });

  it('rejects an invalid profile with the marker', () => {
    expect(() => createNetShaper({ latencyMs: -1, bytesPerSec: null })).toThrow(NET_SHAPER_MARKER);
    expect(() => createNetShaper({ latencyMs: 0, bytesPerSec: 0 })).toThrow(NET_SHAPER_MARKER);
  });
});

describe('config/perf/net-profiles.json', () => {
  const file = JSON.parse(readFileSync(path.join(root, 'config/perf/net-profiles.json'), 'utf8')) as { schema: string; profiles: Record<string, NetProfile> };

  it('has the schema tag and the four profiles, each with latencyMs >= 0 and bytesPerSec > 0 or null', () => {
    expect(file.schema).toBe('net-profiles/1');
    expect(Object.keys(file.profiles).sort()).toEqual(['cell', 'home', 'lag', 'poor']);
    for (const p of Object.values(file.profiles)) {
      expect(p.latencyMs).toBeGreaterThanOrEqual(0);
      expect(p.bytesPerSec === null || p.bytesPerSec > 0).toBe(true);
    }
    expect(file.profiles['lag']).toEqual({ latencyMs: 400, bytesPerSec: null });
  });
});

describe('?net= flag', () => {
  it('parseQaFlags accepts a profile id, reads anything else as null, and parses nothing outside a QA build', () => {
    expect(parseQaFlags('?net=cell', true).net).toBe('cell');
    expect(parseQaFlags('?net=nope', true).net).toBeNull();
    expect(parseQaFlags('?tier=mobile', true).net).toBeNull();
    expect(parseQaFlags('?net=cell', false)).toBe(NO_QA_FLAGS);
    expect(NO_QA_FLAGS.net).toBeNull();
    expect([...NET_PROFILE_IDS].sort()).toEqual(['cell', 'home', 'lag', 'poor']);
  });
});
