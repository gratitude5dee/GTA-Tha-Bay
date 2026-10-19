import { describe, expect, it } from 'vitest';
import { FetchFailure, FetchRetry, MAX_ATTEMPTS, backoffMs, type FetchFn } from '../../src/assets/store/fetch-retry.ts';
import { Lanes, laneLimits } from '../../src/assets/store/lanes.ts';
import { bytesOf } from './helpers.ts';

const MIB = 1024 * 1024;

interface Harness {
  fr: FetchRetry;
  lanes: Lanes;
  calls: Array<{ url: string; range: string | null }>;
  delays: number[];
}

function harness(fetchImpl: FetchFn, randoms: number[] = [0.5], limits = laneLimits(false)): Harness {
  const delays: number[] = [];
  const calls: Harness['calls'] = [];
  let i = 0;
  const lanes = new Lanes(limits);
  const fr = new FetchRetry({
    fetch: (url, init) => {
      const h = init.headers as Record<string, string> | undefined;
      calls.push({ url, range: h?.['Range'] ?? null });
      return fetchImpl(url, init);
    },
    lanes,
    random: () => randoms[i++ % randoms.length] ?? 0.5,
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  });
  return { fr, lanes, calls, delays };
}

const ok = (body: Uint8Array, status = 200): Response => new Response(body as BodyInit, { status });

describe('FetchRetry', () => {
  it('waits min(5000, 300 x 2^n) x u after failed attempt n and stops after 8 attempts with http', async () => {
    const us = [0.5, 0.75, 1, 1.25, 1.5, 0.6, 0.9]; // u = 0.5 + random(); random values below are u - 0.5
    const h = harness(() => Promise.resolve(new Response(null, { status: 503 })), us.map((u) => u - 0.5));
    await expect(h.fr.fetchBytes('https://m.test/a')).rejects.toMatchObject({ name: 'FetchFailure', reason: 'http', status: 503 });
    expect(h.calls).toHaveLength(MAX_ATTEMPTS);
    expect(h.delays).toHaveLength(MAX_ATTEMPTS - 1);
    us.forEach((u, n) => expect(h.delays[n]).toBeCloseTo(Math.min(5000, 300 * 2 ** n) * u, 9));
    expect(h.delays.map((d, n) => d / backoffMs(n, 1))).toEqual(us.map((u) => expect.closeTo(u, 9)));
    expect(h.fr.stats).toEqual({ network: 1, retries: 7 });
  });

  it('the cap is 5000 ms before jitter: attempts 6 and 7 wait 5000 x u', async () => {
    const h = harness(() => Promise.resolve(new Response(null, { status: 500 })), [0.5]); // u = 1
    await expect(h.fr.fetchBytes('https://m.test/a')).rejects.toBeInstanceOf(FetchFailure);
    expect(h.delays).toEqual([300, 600, 1200, 2400, 4800, 5000, 5000]);
  });

  it('a 404 fails after one attempt as http and an error body is never returned', async () => {
    const h = harness(() => Promise.resolve(new Response('not found', { status: 404 })));
    await expect(h.fr.fetchBytes('https://m.test/a')).rejects.toMatchObject({ reason: 'http', status: 404 });
    expect(h.calls).toHaveLength(1);
    expect(h.delays).toHaveLength(0);
  });

  it('retries 429 and network errors, then succeeds with the retry count recorded', async () => {
    let n = 0;
    const body = bytesOf(1, 100);
    const h = harness(() => {
      n++;
      if (n === 1) return Promise.resolve(new Response(null, { status: 429 }));
      if (n === 2) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(ok(body));
    });
    expect(await h.fr.fetchBytes('https://m.test/a')).toEqual(body);
    expect(h.fr.stats).toEqual({ network: 1, retries: 2 });
  });

  it('network errors on every attempt end as offline', async () => {
    const h = harness(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(h.fr.fetchBytes('https://m.test/a')).rejects.toMatchObject({ reason: 'offline' });
    expect(h.calls).toHaveLength(MAX_ATTEMPTS);
  });

  it('five concurrent gets of one URL make one request; a now request joins a queued prefetch and promotes it', async () => {
    let calls = 0;
    const body = bytesOf(2, 64);
    const h = harness(() => {
      calls++;
      return Promise.resolve(ok(body));
    });
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => h.fr.fetchBytes('https://m.test/a', { priority: 'soon' })));
    expect(calls).toBe(1);
    for (const b of all) expect(b).toEqual(body);
    expect(h.fr.stats.network).toBe(1);

    // Saturate soon (8 on mobile), queue a prefetch for X, then ask for X as now: it jumps the queue.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const done: string[] = [];
    const h2 = harness(async (url) => {
      await gate;
      done.push(url);
      return ok(body);
    }, [0.5], laneLimits(true));
    const fillers = Array.from({ length: 8 }, (_, i) => h2.fr.fetchBytes(`https://m.test/f${i}`, { priority: 'soon' }));
    const prefetch = h2.fr.fetchBytes('https://m.test/x', { priority: 'soon' });
    expect(h2.lanes.queued().soon).toBe(1);
    const demand = h2.fr.fetchBytes('https://m.test/x', { priority: 'now' });
    expect(h2.lanes.queued().soon).toBe(0);
    release();
    await Promise.all([...fillers, prefetch, demand]);
    expect(done.filter((u) => u.endsWith('/x'))).toHaveLength(1);
  });

  it('lane occupancy never exceeds 8, LANES and 2', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const body = bytesOf(3, 8);
    const h = harness(async () => {
      await gate;
      return ok(body);
    });
    const jobs: Array<Promise<Uint8Array>> = [];
    for (const [lane, n] of [['now', 20], ['soon', 40], ['idle', 6]] as const) {
      for (let i = 0; i < n; i++) jobs.push(h.fr.fetchBytes(`https://m.test/${lane}${i}`, { priority: lane }));
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(h.lanes.occupancy()).toEqual({ now: 8, soon: 16, idle: 2 });
    release();
    await Promise.all(jobs);
    expect(h.lanes.peak).toEqual({ now: 8, soon: 16, idle: 2 });
    expect(h.fr.stats.network).toBe(66);
  });

  it('a 9 MiB object arrives as 9 Range slices of 1 MiB and is reassembled byte-exactly', async () => {
    const whole = bytesOf(4, 9 * MIB);
    const h = harness((_url, init) => {
      const r = (init.headers as Record<string, string>)['Range'] ?? '';
      const m = /^bytes=(\d+)-(\d+)$/.exec(r);
      if (!m) return Promise.resolve(ok(whole));
      const a = Number(m[1]);
      const b = Number(m[2]);
      return Promise.resolve(ok(whole.slice(a, b + 1), 206));
    });
    const got = await h.fr.fetchBytes('https://m.test/big', { bytes: 9 * MIB });
    expect(h.calls).toHaveLength(9);
    const ranges = h.calls.map((c) => c.range).sort();
    expect(ranges).toEqual(Array.from({ length: 9 }, (_, i) => `bytes=${i * MIB}-${(i + 1) * MIB - 1}`).sort());
    expect(got.byteLength).toBe(9 * MIB);
    expect(Buffer.compare(Buffer.from(got), Buffer.from(whole))).toBe(0);
  });

  it('an object of exactly 4 MB uses one plain request; a server that ignores Range still works', async () => {
    const four = bytesOf(5, 4 * MIB);
    const h = harness(() => Promise.resolve(ok(four)));
    expect((await h.fr.fetchBytes('https://m.test/four', { bytes: 4 * MIB })).byteLength).toBe(4 * MIB);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.range).toBeNull();

    const five = bytesOf(6, 5 * MIB);
    const h2 = harness(() => Promise.resolve(ok(five)));
    const got = await h2.fr.fetchBytes('https://m.test/five', { bytes: 5 * MIB });
    expect(Buffer.compare(Buffer.from(got), Buffer.from(five))).toBe(0);
  });

  it('abort rejects with aborted and cancels the request when no waiter is left', async () => {
    let seen: AbortSignal | undefined;
    const h = harness(
      (_u, init) =>
        new Promise<Response>((_res, rej) => {
          seen = init.signal ?? undefined;
          init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        }),
    );
    const ac = new AbortController();
    const p = h.fr.fetchBytes('https://m.test/a', { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 0));
    ac.abort();
    await expect(p).rejects.toMatchObject({ reason: 'aborted' });
    expect(seen?.aborted).toBe(true);
  });

  it('requests use cache no-store, CORS mode and a priority hint', async () => {
    let init: RequestInit & { priority?: string } = {};
    const h = harness((_u, i) => {
      init = i;
      return Promise.resolve(ok(bytesOf(7, 4)));
    });
    await h.fr.fetchBytes('https://m.test/a', { priority: 'now' });
    expect(init.cache).toBe('no-store');
    expect(init.mode).toBe('cors');
    expect(init.priority).toBe('high');
  });
});
