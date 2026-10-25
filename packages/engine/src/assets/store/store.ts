import { FetchFailure } from './fetch-retry.ts';
import { IDLE_LANE, PRIORITY_RANK, type Priority } from './lanes.ts';
import type { FileStore, IndexStore, PackRow, QuotaEstimate } from './ports.ts';
import { PackUnavailable, type PackRef, type StorageUsage, type WorldPackStore } from './types.ts';

const MIB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
export const GC_UNUSED_DAYS = 14;
export const MEMORY_FALLBACK_CAP_BYTES = 48 * MIB;
/** `WORLD_CACHE_SOFT_CAP_MB` (11-platform-pwa.md section 5, rule 3). */
export const SOFT_CAP_MOBILE_MB = 600;
export const SOFT_CAP_DESKTOP_MB = 2048;
export const DOWNLOAD_ALL_QUOTA_FACTOR = 1.2;
/** How many pack gets a city download keeps in flight at once. */
export const DOWNLOAD_ALL_CONCURRENCY = 4;
/** How many `soon` (or `now`) prefetched packs the store keeps between start and end at once; the lanes cap them further. */
export const PREFETCH_SOON_WINDOW = 16;

/** What a city download would need and whether the device has room for it. Not a contract. */
export interface DownloadPlan {
  totalBytes: number;
  files: number;
  missingBytes: number;
  missingFiles: number;
  /** `quota - usage` from the store's estimate; null when the browser gives none. */
  freeBytes: number | null;
  fits: boolean;
  shortfallBytes: number;
}

/** The one rule for "is there room": free quota must cover 1.2 x the missing bytes. No estimate counts as room. */
export function quotaFits(freeBytes: number | null, missingBytes: number): boolean {
  return freeBytes === null || freeBytes >= DOWNLOAD_ALL_QUOTA_FACTOR * missingBytes;
}

export function softCapBytes(mobileOrXr: boolean): number {
  return (mobileOrXr ? SOFT_CAP_MOBILE_MB : SOFT_CAP_DESKTOP_MB) * MIB;
}

/** Only the part of `FetchRetry` the store needs, so tests can substitute a fake. */
export interface PackFetcher {
  fetchBytes(url: string, o: { priority?: Priority; signal?: AbortSignal; bytes?: number }): Promise<Uint8Array>;
  /** Raises the lane of a request that is still queued; true when it moved (M02f2). Absent: promotion is a no-op. */
  promote?(url: string, to: Priority): boolean;
}

export type StoreEvent =
  | { type: 'evict'; sha256: string; why: 'lru' | 'quota' | 'tag' | 'gc' | 'purge' }
  | { type: 'commit-failed'; sha256: string; reason: 'quota' | 'io' }
  | { type: 'orphan'; sha256: string };

export interface PackStoreOptions {
  files: FileStore;
  index: IndexStore;
  fetcher: PackFetcher;
  /** What `open()` reports. `memory-fallback` is used when OPFS is unavailable. */
  kind?: 'opfs' | 'memory-fallback';
  softCapBytes: number;
  /** Epoch ms. Made strictly increasing inside the store so that LRU order is total. */
  now?: () => number;
  hash?: (bytes: Uint8Array) => Promise<string>;
  /** `navigator.storage.estimate()`; null when unavailable. */
  estimate?: () => Promise<QuotaEstimate | null>;
  persisted?: () => Promise<boolean | null>;
  cutscenesBytes?: () => Promise<number>;
  /** False in a read-only second tab: the store then never writes, deletes or sweeps. Default true. */
  writable?: () => boolean;
  /** How many `idle` prefetched packs start at once (M02f2). Default `IDLE_LANE`, the number of idle lane slots. */
  prefetchWindow?: number;
  onEvent?: (e: StoreEvent) => void;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  let out = '';
  for (const b of new Uint8Array(digest)) out += b.toString(16).padStart(2, '0');
  return out;
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength && u8.buffer instanceof ArrayBuffer) return u8.buffer;
  return u8.slice().buffer as ArrayBuffer;
}

export interface PackStoreStats {
  /** Reads served from the store. */
  hits: number;
  evictions: number;
  /** Prefetch batches cut short by a quota failure (M02f2). */
  prefetchStops: number;
}

/** One pack a prefetch batch has not yet handed to `get` (queued, or between its `has` check and its `get`). */
interface PrefetchItem {
  ref: PackRef;
  priority: Priority;
  batch: { stopped: boolean };
}

/**
 * The C13 `WorldPackStore` over two ports (11-platform-pwa.md section 5): one file per pack keyed by SHA-256 and one index row
 * per pack as its commit record. A plain class with an injected clock, so Node tests run it on the memory ports.
 */
export class PackStore implements WorldPackStore {
  readonly stats: PackStoreStats = { hits: 0, evictions: 0, prefetchStops: 0 };
  softCapBytes: number;
  private readonly files: FileStore;
  private readonly index: IndexStore;
  private readonly fetcher: PackFetcher;
  private readonly kind: 'opfs' | 'memory-fallback';
  private readonly nowFn: () => number;
  private readonly hashFn: (bytes: Uint8Array) => Promise<string>;
  private readonly estimateFn: () => Promise<QuotaEstimate | null>;
  private readonly persistedFn: () => Promise<boolean | null>;
  private readonly cutscenesFn: () => Promise<number>;
  private readonly writableFn: () => boolean;
  private readonly onEvent: ((e: StoreEvent) => void) | undefined;
  private readonly pinned = new Set<string>();
  private readonly pending = new Map<string, Promise<Uint8Array>>();
  private readonly prefetchWindow: number;
  /** Prefetched packs that have not reached `get`, by hash: the deferred-priority map of `promote`. */
  private readonly deferred = new Map<string, PrefetchItem>();
  private prefetchQueue: PrefetchItem[] = [];
  private prefetchActive = 0;
  /** Hashes whose commit failed for quota, until the prefetch item that fetched them has looked. */
  private readonly quotaFailed = new Set<string>();
  private lastTick = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(o: PackStoreOptions) {
    this.files = o.files;
    this.index = o.index;
    this.fetcher = o.fetcher;
    this.kind = o.kind ?? 'opfs';
    this.softCapBytes = o.softCapBytes;
    this.nowFn = o.now ?? Date.now;
    this.hashFn = o.hash ?? sha256Hex;
    this.estimateFn = o.estimate ?? (() => Promise.resolve(null));
    this.persistedFn = o.persisted ?? (() => Promise.resolve(null));
    this.cutscenesFn = o.cutscenesBytes ?? (() => Promise.resolve(0));
    this.writableFn = o.writable ?? ((): boolean => true);
    this.onEvent = o.onEvent;
    this.prefetchWindow = Math.max(1, o.prefetchWindow ?? IDLE_LANE);
  }

  get writable(): boolean {
    return this.writableFn();
  }

  private tick(): number {
    this.lastTick = Math.max(this.nowFn(), this.lastTick + 1);
    return this.lastTick;
  }

  /** Runs `fn` after every earlier exclusive operation; failures do not break the chain. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Resolves when every queued store mutation (pin, commit, eviction) has finished. */
  settled(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  async open(): Promise<'opfs' | 'memory-fallback'> {
    await this.files.open();
    await this.index.open();
    if (!this.writable) return this.kind;
    await this.exclusive(async () => {
      const rows = await this.index.all();
      const known = new Set(rows.map((r) => r.sha256));
      // A file without a row is an orphan (a write that never committed): delete it.
      for (const name of await this.files.list()) {
        if (!known.has(name)) {
          await this.files.remove(name);
          this.onEvent?.({ type: 'orphan', sha256: name });
        }
      }
      for (const r of rows) {
        // A row without its file cannot be served; pins are declared again by the loader on every boot.
        if ((await this.files.size(r.sha256)) === null) await this.index.delete(r.sha256);
        else if (r.pinned) await this.index.put({ ...r, pinned: false });
      }
    });
    return this.kind;
  }

  async has(hash: string): Promise<boolean> {
    const row = await this.index.get(hash);
    if (!row) return false;
    return (await this.files.size(hash)) === row.bytes;
  }

  async get(ref: PackRef, o: { priority?: Priority; signal?: AbortSignal } = {}): Promise<ArrayBuffer> {
    const cached = await this.readCached(ref.sha256);
    if (cached) {
      this.stats.hits++;
      return toArrayBuffer(cached);
    }
    return this.fetchAndStore(ref, o);
  }

  /** A caller that failed to decode `ref` purges it and fetches once more (rule 2). */
  async reportDecodeFailure(ref: PackRef, o: { priority?: Priority; signal?: AbortSignal } = {}): Promise<ArrayBuffer> {
    await this.purge(ref.sha256);
    return this.fetchAndStore(ref, o);
  }

  private async readCached(sha256: string): Promise<Uint8Array | null> {
    const row = await this.index.get(sha256);
    if (!row) return null;
    const size = await this.files.size(sha256);
    const bytes = size === row.bytes ? await this.files.read(sha256) : null;
    if (!bytes || bytes.byteLength !== row.bytes) {
      // The OS (or a crash) took the file: a normal miss.
      if (this.writable) await this.purge(sha256);
      return null;
    }
    if (this.writable) await this.exclusive(() => this.index.put({ ...row, lastUsedAt: this.tick() }).catch(() => undefined));
    return bytes;
  }

  private fetchAndStore(ref: PackRef, o: { priority?: Priority; signal?: AbortSignal }): Promise<ArrayBuffer> {
    const key = ref.sha256;
    let shared = this.pending.get(key);
    // A demand that joins a queued prefetch raises its lane (M02f2); an `idle` joiner has nothing to raise.
    if (shared && o.priority && o.priority !== 'idle') this.fetcher.promote?.(ref.url, o.priority);
    if (!shared) {
      // The shared fetch ignores any one caller's signal: a caller that aborts stops waiting, and the fetch still caches the pack.
      shared = this.fetchVerified(ref, o.priority).finally(() => this.pending.delete(key));
      this.pending.set(key, shared);
    }
    // Every caller gets its own copy: the worker transfers (detaches) what it returns.
    const copy = shared.then((u8) => u8.slice().buffer as ArrayBuffer);
    return o.signal ? raceAbort(copy, o.signal, ref) : copy;
  }

  private async fetchVerified(ref: PackRef, priority: Priority | undefined): Promise<Uint8Array> {
    let bytes: Uint8Array;
    try {
      bytes = await this.fetcher.fetchBytes(ref.url, { ...(priority ? { priority } : {}), bytes: ref.bytes });
    } catch (e) {
      if (e instanceof FetchFailure) throw new PackUnavailable(e.reason, ref);
      throw e;
    }
    if (bytes.byteLength !== ref.bytes || (await this.hashFn(bytes)) !== ref.sha256) throw new PackUnavailable('hash-mismatch', ref);
    if (this.writable) {
      try {
        await this.exclusive(() => this.commit(ref, bytes));
      } catch (e) {
        // A cache that cannot be written is not a failed read: serve the verified bytes without caching them.
        const reason = e instanceof PackUnavailable && e.reason === 'quota' ? 'quota' : 'io';
        if (reason === 'quota') this.quotaFailed.add(ref.sha256);
        this.onEvent?.({ type: 'commit-failed', sha256: ref.sha256, reason });
      }
    }
    return bytes;
  }

  /** Rule 1: make room, write and flush the file, then write the row. The row is the commit. */
  private async commit(ref: PackRef, bytes: Uint8Array): Promise<void> {
    if (await this.has(ref.sha256)) return;
    await this.makeRoom(bytes.byteLength, ref.sha256);
    for (;;) {
      try {
        await this.files.write(ref.sha256, bytes);
        break;
      } catch (e) {
        if ((e as { name?: string }).name !== 'QuotaExceededError') throw e;
        if (!(await this.evictOne('quota', ref.sha256))) throw new PackUnavailable('quota', ref);
      }
    }
    const now = this.tick();
    await this.index.put({
      sha256: ref.sha256,
      bytes: bytes.byteLength,
      kind: ref.kind,
      tags: [...(ref.tags ?? [])],
      createdAt: now,
      lastUsedAt: now,
      pinned: this.pinned.has(ref.sha256),
    });
  }

  private isPinned(r: PackRow): boolean {
    return r.pinned || this.pinned.has(r.sha256);
  }

  private async makeRoom(incoming: number, keep: string): Promise<void> {
    let rows = await this.index.all();
    let total = rows.reduce((n, r) => n + r.bytes, 0);
    if (total + incoming <= this.softCapBytes) return;
    rows = rows.filter((r) => !this.isPinned(r) && r.sha256 !== keep).sort(lruOrder);
    for (const r of rows) {
      if (total + incoming <= this.softCapBytes) break;
      await this.remove(r.sha256, 'lru');
      total -= r.bytes;
    }
  }

  private async evictOne(why: 'quota', keep: string): Promise<boolean> {
    const rows = (await this.index.all()).filter((r) => !this.isPinned(r) && r.sha256 !== keep).sort(lruOrder);
    const victim = rows[0];
    if (!victim) return false;
    await this.remove(victim.sha256, why);
    return true;
  }

  private async remove(sha256: string, why: 'lru' | 'quota' | 'tag' | 'gc' | 'purge'): Promise<void> {
    await this.files.remove(sha256);
    await this.index.delete(sha256);
    if (why !== 'purge') this.stats.evictions++;
    this.onEvent?.({ type: 'evict', sha256, why });
  }

  private purge(sha256: string): Promise<void> {
    return this.exclusive(() => this.remove(sha256, 'purge'));
  }

  /**
   * Fetches the missing packs of `refs` in the background as one batch (M02f2). At most `windowFor(priority)` start at once, most urgent
   * first, so a later `promote` still reaches a pack that has not started. A quota failure while the batch runs drops its packs that
   * have not started and counts one `prefetchStops`.
   */
  prefetch(refs: readonly PackRef[], priority: 'soon' | 'idle'): void {
    const batch = { stopped: false };
    for (const ref of refs) {
      const known = this.deferred.get(ref.sha256);
      if (known) {
        if (PRIORITY_RANK[priority] < PRIORITY_RANK[known.priority]) known.priority = priority;
        continue;
      }
      if (this.pending.has(ref.sha256)) continue;
      const item: PrefetchItem = { ref, priority, batch };
      this.deferred.set(ref.sha256, item);
      this.prefetchQueue.push(item);
    }
    this.pumpPrefetch();
  }

  private windowFor(p: Priority): number {
    return p === 'idle' ? this.prefetchWindow : Math.max(this.prefetchWindow, PREFETCH_SOON_WINDOW);
  }

  private pumpPrefetch(): void {
    for (;;) {
      let best = -1;
      for (let i = 0; i < this.prefetchQueue.length; i++) {
        const it = this.prefetchQueue[i] as PrefetchItem;
        if (best < 0 || PRIORITY_RANK[it.priority] < PRIORITY_RANK[(this.prefetchQueue[best] as PrefetchItem).priority]) best = i;
      }
      if (best < 0) return;
      const item = this.prefetchQueue[best] as PrefetchItem;
      if (this.prefetchActive >= this.windowFor(item.priority)) return;
      this.prefetchQueue.splice(best, 1);
      this.prefetchActive++;
      void this.runPrefetch(item).finally(() => {
        this.prefetchActive--;
        this.pumpPrefetch();
      });
    }
  }

  private async runPrefetch(item: PrefetchItem): Promise<void> {
    const sha = item.ref.sha256;
    try {
      if (item.batch.stopped) return;
      if (await this.has(sha)) return;
      if (item.batch.stopped) return;
      // The priority is read now, after the `has` check: a `promote` that arrived meanwhile has raised it.
      this.quotaFailed.delete(sha);
      const done = this.fetchAndStore(item.ref, { priority: item.priority });
      this.deferred.delete(sha);
      await done;
    } catch {
      /* a failed prefetch is a miss; the demand request reports it */
    } finally {
      this.deferred.delete(sha);
    }
    if (this.quotaFailed.delete(sha) && !item.batch.stopped) {
      item.batch.stopped = true;
      this.stats.prefetchStops++;
      this.prefetchQueue = this.prefetchQueue.filter((q) => {
        if (q.batch !== item.batch) return true;
        this.deferred.delete(q.ref.sha256);
        return false;
      });
    }
  }

  /**
   * Raises the lane of the packs in `refs` that are still waiting: a fetch that is queued in the fetch layer moves up, and a prefetch
   * that has not started will start at `to` or higher. A fetch that already runs keeps its priority hint. Returns how many moved.
   */
  promote(refs: readonly PackRef[], to: 'now' | 'soon'): number {
    let moved = 0;
    let deferredMoved = false;
    for (const ref of refs) {
      const item = this.deferred.get(ref.sha256);
      let hit = false;
      if (item && PRIORITY_RANK[to] < PRIORITY_RANK[item.priority]) {
        item.priority = to;
        deferredMoved = true;
        hit = true;
      }
      if (this.pending.has(ref.sha256) && this.fetcher.promote?.(ref.url, to)) hit = true;
      if (hit) moved++;
    }
    if (deferredMoved) this.pumpPrefetch();
    return moved;
  }

  pin(hashes: readonly string[]): void {
    for (const h of hashes) this.pinned.add(h);
    if (!this.writable) return;
    void this.exclusive(async () => {
      for (const h of hashes) {
        const row = await this.index.get(h);
        if (row && !row.pinned) await this.index.put({ ...row, pinned: true });
      }
    });
  }

  /** Drops every pin (the loader declares the boot set again each session). */
  unpinAll(): void {
    this.pinned.clear();
    if (!this.writable) return;
    void this.exclusive(async () => {
      for (const r of await this.index.all()) if (r.pinned) await this.index.put({ ...r, pinned: false });
    });
  }

  async gc(current: ReadonlySet<string>): Promise<{ removed: number; freedMB: number }> {
    if (!this.writable) return { removed: 0, freedMB: 0 };
    return this.exclusive(async () => {
      const cutoff = this.nowFn() - GC_UNUSED_DAYS * DAY_MS;
      let removed = 0;
      let freed = 0;
      for (const r of await this.index.all()) {
        if (current.has(r.sha256) || this.isPinned(r) || r.lastUsedAt >= cutoff) continue;
        await this.remove(r.sha256, 'gc');
        removed++;
        freed += r.bytes;
      }
      return { removed, freedMB: freed / MIB };
    });
  }

  async usage(): Promise<StorageUsage> {
    const [est, persisted, cutscenes, rows] = await Promise.all([this.estimateFn(), this.persistedFn(), this.cutscenesFn(), this.index.all()]);
    const packBytes = rows.reduce((n, r) => n + r.bytes, 0);
    return {
      usageMB: (est?.usage ?? packBytes + cutscenes) / MIB,
      quotaMB: (est?.quota ?? 0) / MIB,
      persisted,
      packsMB: packBytes / MIB,
      packs: rows.length,
      cutscenesMB: cutscenes / MIB,
    };
  }

  /** Totals, what is still missing and whether it fits, from the same predicate `downloadAll` uses. */
  async downloadPlan(refs: readonly PackRef[]): Promise<DownloadPlan> {
    const present = await Promise.all(refs.map((r) => this.has(r.sha256)));
    const missing = refs.filter((_, i) => !present[i]);
    const missingBytes = missing.reduce((n, r) => n + r.bytes, 0);
    const est = await this.estimateFn();
    const freeBytes = est ? est.quota - est.usage : null;
    let fits = quotaFits(freeBytes, missingBytes);
    if (this.kind === 'memory-fallback' && missingBytes > this.softCapBytes) fits = false;
    const shortfallBytes = freeBytes === null ? 0 : Math.max(0, Math.ceil(DOWNLOAD_ALL_QUOTA_FACTOR * missingBytes) - freeBytes);
    return {
      totalBytes: refs.reduce((n, r) => n + r.bytes, 0),
      files: refs.length,
      missingBytes,
      missingFiles: missing.length,
      freeBytes,
      fits,
      shortfallBytes,
    };
  }

  /**
   * Fetches every missing pack through a pool of `DOWNLOAD_ALL_CONCURRENCY` gets. After `signal` aborts no new get starts and the call
   * rejects with `PackUnavailable('aborted')`; packs already committed stay. The optional third parameter exists on the class only.
   */
  async downloadAll(refs: readonly PackRef[], onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
    const present = await Promise.all(refs.map((r) => this.has(r.sha256)));
    const missing = refs.filter((_, i) => !present[i]);
    const first = missing[0];
    if (first) {
      const plan = await this.downloadPlan(refs);
      if (!plan.fits) throw new PackUnavailable('quota', first);
    }
    let done = refs.length - missing.length;
    onProgress(done, refs.length);
    let next = 0;
    let failure: unknown = null;
    const worker = async (): Promise<void> => {
      while (failure === null && next < missing.length) {
        const ref = missing[next++] as PackRef;
        if (signal?.aborted) {
          failure = new PackUnavailable('aborted', ref);
          return;
        }
        try {
          await this.get(ref, { priority: 'soon', ...(signal ? { signal } : {}) });
        } catch (e) {
          failure ??= e;
          return;
        }
        done++;
        onProgress(done, refs.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(DOWNLOAD_ALL_CONCURRENCY, missing.length) }, worker));
    if (failure !== null) throw failure;
    if (signal?.aborted && done < refs.length && first) throw new PackUnavailable('aborted', first);
  }

  async evictByTag(tag: string): Promise<{ removed: number }> {
    if (!this.writable) return { removed: 0 };
    return this.exclusive(async () => {
      let removed = 0;
      for (const r of await this.index.all()) {
        if (!r.tags.includes(tag)) continue;
        await this.remove(r.sha256, 'tag');
        removed++;
      }
      return { removed };
    });
  }

  async clear(): Promise<void> {
    if (!this.writable) return;
    await this.exclusive(async () => {
      await this.files.clear();
      await this.index.clear();
    });
  }
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal, ref: PackRef): Promise<T> {
  if (signal.aborted) return Promise.reject(new PackUnavailable('aborted', ref));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new PackUnavailable('aborted', ref));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

function lruOrder(a: PackRow, b: PackRow): number {
  return a.lastUsedAt - b.lastUsedAt || a.createdAt - b.createdAt || (a.sha256 < b.sha256 ? -1 : 1);
}
