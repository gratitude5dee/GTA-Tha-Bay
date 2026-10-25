import { describe, expect, it } from 'vitest';
import { DOWNLOAD_ALL_CONCURRENCY, quotaFits, type PackFetcher } from '../../src/assets/store/store.ts';
import { FetchFailure } from '../../src/assets/store/fetch-retry.ts';
import { makePack, rig, KB, type TestPack } from './helpers.ts';

/** A fetcher whose requests wait until the test lets each one through. */
class OnDemandFetcher implements PackFetcher {
  readonly calls: string[] = [];
  inflight = 0;
  peak = 0;
  private readonly waiting: Array<{ url: string; go: () => void }> = [];
  constructor(private readonly packs: Map<string, TestPack>) {}
  fetchBytes(url: string): Promise<Uint8Array> {
    this.calls.push(url);
    this.inflight++;
    this.peak = Math.max(this.peak, this.inflight);
    return new Promise<Uint8Array>((resolve, reject) => {
      this.waiting.push({
        url,
        go: () => {
          this.inflight--;
          const p = this.packs.get(url);
          if (p) resolve(p.bytes.slice());
          else reject(new FetchFailure('http', 404));
        },
      });
    });
  }
  /** Lets the oldest waiting request through, then lets its continuations run. */
  async release(n = 1): Promise<void> {
    for (let i = 0; i < n; i++) {
      for (let w = 0; w < 50 && this.waiting.length === 0; w++) await new Promise((r) => setTimeout(r, 0));
      this.waiting.shift()?.go();
      for (let k = 0; k < 20; k++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  get waitingCount(): number {
    return this.waiting.length;
  }
}

async function fixture(count: number, size = 10 * KB, over: Parameters<typeof rig>[0] = {}) {
  const packs = await Promise.all(Array.from({ length: count }, (_, i) => makePack(200 + i, size)));
  const fetcher = new OnDemandFetcher(new Map(packs.map((p) => [p.ref.url, p])));
  const r = rig({ fetcher, ...over });
  await r.store.open();
  return { r, packs, refs: packs.map((p) => p.ref), fetcher };
}

describe('PackStore city download (M04b4)', () => {
  it('downloadPlan reports totals, what is missing and whether it fits', async () => {
    const f = await fixture(5, 10 * KB, { estimate: () => Promise.resolve({ usage: 0, quota: 10 * 1024 * KB }) });
    // Two packs are already stored.
    for (const p of f.packs.slice(0, 2)) {
      const got = f.r.store.get(p.ref);
      await f.fetcher.release();
      await got;
    }
    expect(await f.r.store.has(f.packs[0]!.ref.sha256)).toBe(true);
    const plan = await f.r.store.downloadPlan(f.refs);
    expect(plan).toEqual({
      totalBytes: 50 * KB,
      files: 5,
      missingBytes: 30 * KB,
      missingFiles: 3,
      freeBytes: 10 * 1024 * KB,
      fits: true,
      shortfallBytes: 0,
    });
  });

  it('quotaFits: no estimate fits; 1.2 x the missing bytes is the line', () => {
    expect(quotaFits(null, 1e12)).toBe(true);
    expect(quotaFits(120, 100)).toBe(true);
    expect(quotaFits(119, 100)).toBe(false);
  });

  it('with free quota of 1.2 x missing - 1 byte it does not fit, the shortfall is 1, and downloadAll rejects before any fetch', async () => {
    const missing = 3 * 10 * KB;
    const f = await fixture(3, 10 * KB, { estimate: () => Promise.resolve({ usage: 0, quota: Math.ceil(1.2 * missing) - 1 }) });
    const plan = await f.r.store.downloadPlan(f.refs);
    expect(plan.fits).toBe(false);
    expect(plan.shortfallBytes).toBe(1);
    await expect(f.r.store.downloadAll(f.refs, () => undefined)).rejects.toMatchObject({ name: 'PackUnavailable', reason: 'quota' });
    expect(f.fetcher.calls).toHaveLength(0);
  });

  it('on the memory fallback, missing bytes above the soft cap do not fit', async () => {
    const f = await fixture(3, 10 * KB, { kind: 'memory-fallback', softCapBytes: 20 * KB });
    expect((await f.r.store.downloadPlan(f.refs)).fits).toBe(false);
  });

  it('keeps at most DOWNLOAD_ALL_CONCURRENCY fetches in flight', async () => {
    const f = await fixture(9);
    const progress: Array<[number, number]> = [];
    const run = f.r.store.downloadAll(f.refs, (d, t) => progress.push([d, t]));
    for (let k = 0; k < 20; k++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(f.fetcher.peak).toBe(DOWNLOAD_ALL_CONCURRENCY);
    while (f.fetcher.waitingCount > 0) await f.fetcher.release();
    await run;
    expect(f.fetcher.peak).toBeLessThanOrEqual(DOWNLOAD_ALL_CONCURRENCY);
    expect(progress.at(-1)).toEqual([9, 9]);
  });

  it('aborting after two commits rejects as aborted, starts no further fetch and keeps the committed packs', async () => {
    const f = await fixture(10);
    const ac = new AbortController();
    const run = f.r.store.downloadAll(f.refs, () => undefined, ac.signal);
    const settled = run.catch((e: unknown) => e);
    for (let k = 0; k < 20; k++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    await f.fetcher.release(2);
    const startedBefore = f.fetcher.calls.length;
    ac.abort();
    const err = await settled;
    expect(err).toMatchObject({ name: 'PackUnavailable', reason: 'aborted' });
    // Let any request that was already in flight finish; none may be added.
    while (f.fetcher.waitingCount > 0) await f.fetcher.release();
    expect(f.fetcher.calls.length).toBe(startedBefore);
    await f.r.store.settled();
    const have = await Promise.all(f.refs.map((r) => f.r.store.has(r.sha256)));
    expect(have.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    expect(have.filter((x) => !x).length).toBeGreaterThan(0);
  });

  it('a second downloadAll fetches only what is still missing, and clear() empties the store', async () => {
    const f = await fixture(6);
    const ac = new AbortController();
    const first = f.r.store.downloadAll(f.refs, () => undefined, ac.signal).catch((e: unknown) => e);
    for (let k = 0; k < 20; k++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    await f.fetcher.release(3);
    ac.abort();
    await first;
    while (f.fetcher.waitingCount > 0) await f.fetcher.release();
    await f.r.store.settled();
    const before = f.fetcher.calls.length;
    const stored = (await Promise.all(f.refs.map((r) => f.r.store.has(r.sha256)))).filter(Boolean).length;
    expect(stored).toBeGreaterThanOrEqual(3);

    const second = f.r.store.downloadAll(f.refs, () => undefined);
    for (let k = 0; k < 20; k++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    while (f.fetcher.waitingCount > 0) await f.fetcher.release();
    await second;
    expect(f.fetcher.calls.length - before).toBe(f.refs.length - stored);
    expect((await f.r.store.usage()).packs).toBe(6);

    await f.r.store.clear();
    expect((await f.r.store.usage()).packs).toBe(0);
  });
});
