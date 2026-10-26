import { describe, expect, it } from 'vitest';
import type { Priority } from '../../src/assets/store/lanes.ts';
import { PackStore, type PackFetcher } from '../../src/assets/store/store.ts';
import { MemoryFileStore, MemoryIndexStore } from '../../src/assets/store/memory-ports.ts';
import { FetchFailure } from '../../src/assets/store/fetch-retry.ts';
import type { PackRef } from '../../src/assets/store/types.ts';
import { KB, makePack, type TestPack } from './helpers.ts';

/** A fetcher that can hold every request until `release()`, records the priority each one started with, and records `promote` calls. */
class RecordingFetcher implements PackFetcher {
  readonly served = new Map<string, Uint8Array>();
  readonly started: Array<{ url: string; priority: Priority | undefined }> = [];
  readonly promotes: Array<{ url: string; to: Priority }> = [];
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;
  hold(): void {
    this.gate = new Promise<void>((r) => (this.open = r));
  }
  release(): void {
    this.open?.();
    this.gate = null;
  }
  async fetchBytes(url: string, o: { priority?: Priority }): Promise<Uint8Array> {
    this.started.push({ url, priority: o.priority });
    if (this.gate) await this.gate;
    const b = this.served.get(url);
    if (!b) throw new FetchFailure('http', 404);
    return b.slice();
  }
  promote(url: string, to: Priority): boolean {
    this.promotes.push({ url, to });
    return true;
  }
  count(url: string): number {
    return this.started.filter((s) => s.url === url).length;
  }
}

async function setup(opts: { held?: boolean; window?: number } = {}) {
  const files = new MemoryFileStore();
  const index = new MemoryIndexStore();
  const fetcher = new RecordingFetcher();
  if (opts.held ?? true) fetcher.hold();
  const events: string[] = [];
  const store = new PackStore({
    files,
    index,
    fetcher,
    softCapBytes: 1 << 30,
    prefetchWindow: opts.window ?? 3,
    onEvent: (e) => events.push(e.type === 'commit-failed' ? `commit-failed:${e.reason}` : e.type),
  });
  await store.open();
  const packs: TestPack[] = [await makePack(11, 4 * KB), await makePack(12, 4 * KB), await makePack(13, 4 * KB)];
  for (const p of packs) fetcher.served.set(p.ref.url, p.bytes);
  const [a, b, c] = packs.map((p) => p.ref) as [PackRef, PackRef, PackRef];
  return { files, index, fetcher, store, packs, a, b, c, events };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('PackStore prefetch promotion (M02f2)', () => {
  it('join: a now get of a started idle prefetch makes one fetch and promotes the fetcher request', async () => {
    const { fetcher, store, packs, a, b, c } = await setup();
    store.prefetch([a, b, c], 'idle');
    await tick();
    expect(fetcher.started.map((s) => s.priority)).toEqual(['idle', 'idle', 'idle']);
    const demand = store.get(c, { priority: 'now' });
    await tick();
    expect(fetcher.count(c.url)).toBe(1);
    expect(fetcher.promotes).toEqual([{ url: c.url, to: 'now' }]);
    fetcher.release();
    expect(new Uint8Array(await demand)).toEqual(packs[2]?.bytes);
    await store.settled();
    expect(fetcher.count(c.url)).toBe(1);
    expect(fetcher.count(a.url)).toBe(1);
  });

  it('promote before start: a prefetch that has not started starts at the new priority', async () => {
    const { fetcher, store, a, b, c } = await setup({ window: 1 });
    store.prefetch([a, b, c], 'idle');
    await tick();
    // window 1: only `a` has started; `b` and `c` wait in the store
    expect(fetcher.started.map((s) => s.url)).toEqual([a.url]);
    expect(store.promote([b], 'soon')).toBe(1);
    expect(store.promote([b], 'soon')).toBe(0); // already there
    expect(store.promote([a], 'now')).toBe(1); // `a` is pending: the fetcher is asked
    expect(fetcher.promotes).toEqual([{ url: a.url, to: 'now' }]);
    await tick();
    // the soon item starts at once (the idle window does not hold it), and with its own priority
    expect(fetcher.started).toEqual([
      { url: a.url, priority: 'idle' },
      { url: b.url, priority: 'soon' },
    ]);
    fetcher.release();
    await tick();
    await store.settled();
    expect(fetcher.started.map((s) => s.url).sort()).toEqual([a.url, b.url, c.url].sort());
    expect(fetcher.started.find((s) => s.url === c.url)?.priority).toBe('idle');
  });

  it('quota stop: once the first pack cannot be committed and nothing can be evicted, the rest of the batch is never fetched', async () => {
    const { fetcher, store, packs, files, a, b, c, events } = await setup({ held: false, window: 1 });
    files.limitBytes = 0; // every write throws QuotaExceededError; no row exists to evict
    store.prefetch([a, b, c], 'idle');
    await tick();
    await tick();
    expect(fetcher.started.map((s) => s.url)).toEqual([a.url]);
    expect(events).toContain('commit-failed:quota');
    expect(store.stats.prefetchStops).toBe(1);
    // a later demand get still works (served from the network, not cached)
    expect(new Uint8Array(await store.get(b))).toEqual(packs[1]?.bytes);
    expect(store.stats.prefetchStops).toBe(1);
    expect(fetcher.count(c.url)).toBe(0);
  });

  it('a prefetch of a pack that is already stored makes no request', async () => {
    const { fetcher, store, a } = await setup({ held: false });
    await store.get(a);
    store.prefetch([a], 'idle');
    await tick();
    expect(fetcher.count(a.url)).toBe(1);
  });
});
