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
    expect(h.fr.stats).toMatchObject({ network: 1, retries: 7, bytes: 0 });
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
    expect(h.fr.stats).toMatchObject({ network: 1, retries: 2, bytes: 100 });
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

  it('promote(url, to) moves a queued idle request ahead; a running or unknown URL returns false and changes nothing (M02f2)', async () => {
    const body = bytesOf(5, 16);
    const gates = new Map<string, () => void>();
    const started: string[] = [];
    const h = harness((url) => {
      started.push(url);
      return new Promise<Response>((resolve) => gates.set(url, () => resolve(ok(body))));
    });
    // The idle lane holds two running fillers; url1 and url2 wait behind them.
    const fillers = ['f1', 'f2'].map((n) => h.fr.fetchBytes(`https://m.test/${n}`, { priority: 'idle' }));
    const first = h.fr.fetchBytes('https://m.test/url1', { priority: 'idle' });
    const second = h.fr.fetchBytes('https://m.test/url2', { priority: 'idle' });
    await Promise.resolve();
    expect(started).toEqual(['https://m.test/f1', 'https://m.test/f2']);
    expect(h.lanes.queued().idle).toBe(2);

    expect(h.fr.promote('https://m.test/f1', 'now')).toBe(false); // running
    expect(h.fr.promote('https://m.test/nobody', 'now')).toBe(false); // unknown
    expect(h.lanes.queued().idle).toBe(2);
    expect(h.fr.promote('https://m.test/url2', 'now')).toBe(true);
    expect(h.fr.promote('https://m.test/url2', 'now')).toBe(false); // already running
    await Promise.resolve();
    expect(started).toEqual(['https://m.test/f1', 'https://m.test/f2', 'https://m.test/url2']);
    expect(h.lanes.queued()).toEqual({ now: 0, soon: 0, idle: 1 });

    for (const g of [...gates.values()]) g();
    await new Promise((r) => setTimeout(r, 0));
    gates.get('https://m.test/url1')?.();
    await Promise.all([...fillers, first, second]);
    expect(started.indexOf('https://m.test/url2')).toBeLessThan(started.indexOf('https://m.test/url1'));
    expect(h.fr.promote('https://m.test/url1', 'now')).toBe(false); // finished
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

describe('FetchRetry in-flight figures (M02f1)', () => {
  /** A fetch whose answers are released by hand, per URL. */
  function gated(): { fn: FetchFn; release: (url: string, body?: Uint8Array) => void; fail: (url: string, status: number) => void } {
    const waiting = new Map<string, Array<(r: Response) => void>>();
    const fn: FetchFn = (url, init) =>
      new Promise<Response>((res, rej) => {
        const list = waiting.get(url) ?? [];
        list.push(res);
        waiting.set(url, list);
        init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      });
    return {
      fn,
      release: (url, body = bytesOf(1, 8)) => waiting.get(url)?.shift()?.(ok(body)),
      fail: (url, status) => waiting.get(url)?.shift()?.(new Response(null, { status })),
    };
  }
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  it('two concurrent URLs give inflightPeak 2 and waves 1', async () => {
    const g = gated();
    const h = harness(g.fn);
    const a = h.fr.fetchBytes('https://m.test/a');
    const b = h.fr.fetchBytes('https://m.test/b');
    await tick();
    expect(h.fr.stats.inflight).toBe(2);
    g.release('https://m.test/a');
    g.release('https://m.test/b');
    await Promise.all([a, b]);
    expect(h.fr.stats).toMatchObject({ inflight: 0, inflightPeak: 2, waves: 1 });
  });

  it('two sequential URLs give waves 2 and inflightPeak 1', async () => {
    const g = gated();
    const h = harness(g.fn);
    const a = h.fr.fetchBytes('https://m.test/a');
    await tick();
    g.release('https://m.test/a');
    await a;
    const b = h.fr.fetchBytes('https://m.test/b');
    await tick();
    g.release('https://m.test/b');
    await b;
    expect(h.fr.stats).toMatchObject({ inflight: 0, inflightPeak: 1, waves: 2 });
  });

  it('a joined request counts once', async () => {
    const g = gated();
    const h = harness(g.fn);
    const a1 = h.fr.fetchBytes('https://m.test/a');
    const a2 = h.fr.fetchBytes('https://m.test/a', { priority: 'now' });
    await tick();
    expect(h.fr.stats.inflight).toBe(1);
    g.release('https://m.test/a');
    await Promise.all([a1, a2]);
    expect(h.fr.stats).toMatchObject({ inflight: 0, inflightPeak: 1, waves: 1, network: 1 });
  });

  it('a retried request counts once, also during its backoff', async () => {
    const g = gated();
    let wake!: () => void;
    const lanes = new Lanes(laneLimits(false));
    const fr = new FetchRetry({
      fetch: g.fn,
      lanes,
      random: () => 0.5,
      sleep: () =>
        new Promise<void>((r) => {
          wake = r;
        }),
    });
    const p = fr.fetchBytes('https://m.test/a');
    await tick();
    g.fail('https://m.test/a', 503);
    await tick();
    expect(fr.stats.inflight).toBe(1); // waiting out the backoff
    wake();
    await tick();
    expect(fr.stats.inflight).toBe(1);
    g.release('https://m.test/a');
    await p;
    expect(fr.stats).toMatchObject({ inflight: 0, inflightPeak: 1, waves: 1, retries: 1 });
  });

  it('a 4-slice Range object counts as one in flight', async () => {
    const total = 4 * MIB + 1; // above the threshold: 5 slices, 4 at a time
    const whole = bytesOf(3, total);
    const h = harness((_u, init) => {
      const r = (init.headers as Record<string, string>)['Range'] ?? '';
      const m = /bytes=(\d+)-(\d+)/.exec(r);
      const part = m ? whole.slice(Number(m[1]), Number(m[2]) + 1) : whole;
      return new Promise<Response>((res) => setTimeout(() => res(ok(part, 206)), 1));
    });
    const got = await h.fr.fetchBytes('https://m.test/big', { bytes: total });
    expect(got.byteLength).toBe(total);
    expect(h.calls.length).toBe(5);
    expect(h.fr.stats).toMatchObject({ inflight: 0, inflightPeak: 1, waves: 1, network: 1 });
  });

  it('resetPeak() with one request running sets the peak to 1', async () => {
    const g = gated();
    const h = harness(g.fn);
    const a = h.fr.fetchBytes('https://m.test/a');
    const b = h.fr.fetchBytes('https://m.test/b');
    await tick();
    g.release('https://m.test/b');
    await b;
    expect(h.fr.stats.inflightPeak).toBe(2);
    h.fr.resetPeak();
    expect(h.fr.stats.inflightPeak).toBe(1);
    g.release('https://m.test/a');
    await a;
    h.fr.resetPeak();
    expect(h.fr.stats.inflightPeak).toBe(0);
  });

  it('inflight returns to 0 after success, failure and abort', async () => {
    const g = gated();
    const h = harness(g.fn);
    const ok1 = h.fr.fetchBytes('https://m.test/ok');
    const bad = h.fr.fetchBytes('https://m.test/bad');
    const ac = new AbortController();
    const gone = h.fr.fetchBytes('https://m.test/gone', { signal: ac.signal });
    await tick();
    expect(h.fr.stats.inflight).toBe(3);
    g.release('https://m.test/ok');
    g.fail('https://m.test/bad', 404);
    ac.abort();
    await ok1;
    await expect(bad).rejects.toMatchObject({ reason: 'http' });
    await expect(gone).rejects.toMatchObject({ reason: 'aborted' });
    await tick();
    expect(h.fr.stats.inflight).toBe(0);
  });
});
