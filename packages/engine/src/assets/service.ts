import type { AssetRef } from '@dv/shared/assets';
import { CatalogClient, AssetNotFound } from './store/catalog-client.ts';
import { FetchRetry, type FetchFn } from './store/fetch-retry.ts';
import { Lanes, laneLimits } from './store/lanes.ts';
import { MemoryFileStore, MemoryIndexStore } from './store/memory-ports.ts';
import type { FileStore, IndexStore, QuotaEstimate } from './store/ports.ts';
import { MEMORY_FALLBACK_CAP_BYTES, PackStore, softCapBytes } from './store/store.ts';
import { TabLock, type ChannelLike } from './store/tab-lock.ts';
import { PackUnavailable, type PackRef } from './store/types.ts';
import {
  ERR_ASSET_MAX_PER_REASON,
  type CatalogStateName,
  type FromWorker,
  type InitParams,
  type InitResult,
  type OpName,
  type RpcOps,
  type RpcRequest,
  type StatsResult,
  type Target,
  type ToWorker,
  type WireError,
} from './rpc.ts';

/**
 * The worker-side service: owns the store, the fetch layer, the catalog client and the tab lock, and answers the RPC. It
 * has no worker globals of its own (everything arrives in `ServiceDeps`), so Node tests run it against the memory ports.
 */
export interface Ports {
  files: FileStore;
  index: IndexStore;
  kind: 'opfs' | 'memory-fallback';
}

export interface ServiceDeps {
  post: (msg: FromWorker, transfer?: Transferable[]) => void;
  /** Builds the OPFS and IDB ports; `force: 'memory'` and any failure give the memory ports. */
  makePorts: (force: 'memory' | undefined) => Promise<Ports>;
  fetch: FetchFn;
  channel: ChannelLike | null;
  tabId: string;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  estimate?: () => Promise<QuotaEstimate | null>;
  persisted?: () => Promise<boolean | null>;
  /** QA handler for the `qa` op (VITE_DV_QA builds only). */
  qa?: ((svc: AssetService, name: string, args: unknown) => Promise<unknown>) | null;
  probeMs?: number;
  /** Domain jobs by name, served by the `job` op (the composed worker of apps/web registers the world jobs; M02b1). */
  jobs?: Readonly<Record<string, AssetJob>> | undefined;
}

/** A job handler. `args` is whatever the caller sent (it may carry transferred ports); the result's `transfer` list is detached to the caller. */
export type AssetJob = (svc: AssetService, args: unknown, signal: AbortSignal) => Promise<{ result: unknown; transfer?: Transferable[] }>;

export function memoryPorts(): Ports {
  return { files: new MemoryFileStore(), index: new MemoryIndexStore(), kind: 'memory-fallback' };
}

const HEX64 = /^[0-9a-f]{64}$/;

function toWire(e: unknown): WireError {
  if (e instanceof PackUnavailable) return { name: 'PackUnavailable', message: e.message, reason: e.reason, ref: e.ref };
  const err = e as { name?: string; message?: string } | null;
  return { name: err?.name ?? 'Error', message: err?.message ?? String(e) };
}

export class AssetService {
  private readonly d: ServiceDeps;
  private params: InitParams | null = null;
  private lanesValue: Lanes | null = null;
  private fetcher: FetchRetry | null = null;
  private storeValue: PackStore | null = null;
  private catalogValue: CatalogClient | null = null;
  private lock: TabLock | null = null;
  private fetchHook: FetchFn;
  private readonly aborts = new Map<number, AbortController>();
  private readonly errCounts = new Map<string, number>();
  private readonly pinnedHashes = new Set<string>();
  private base = { hits: 0, evictions: 0 };
  private softCapOverride: number | null = null;

  constructor(deps: ServiceDeps) {
    this.d = deps;
    this.fetchHook = (u, i) => deps.fetch(u, i);
  }

  /**
   * Keeps the packs with these hashes out of eviction for the session, like the `pin` RPC (an asset job pins what it needs: the
   * landmark skyline of M02d2); re-applied when the store is rebuilt.
   */
  pinHashes(hashes: readonly string[]): void {
    for (const h of hashes) this.pinnedHashes.add(h);
    this.store.pin(hashes);
  }

  // ---- accessors for the QA handler and tests ----
  get store(): PackStore {
    if (!this.storeValue) throw new Error('asset service is not initialised');
    return this.storeValue;
  }
  get catalog(): CatalogClient {
    if (!this.catalogValue) throw new Error('asset service is not initialised');
    return this.catalogValue;
  }
  get lanes(): Lanes {
    if (!this.lanesValue) throw new Error('asset service is not initialised');
    return this.lanesValue;
  }
  get ports(): Ports | null {
    return this.currentPorts;
  }
  private currentPorts: Ports | null = null;

  mode(): 'rw' | 'read-only' {
    return this.lock?.mode ?? 'rw';
  }

  /** Wraps the fetch used for packs (fault injection). Returns a function that restores the previous hook. */
  wrapFetch(wrap: (inner: FetchFn) => FetchFn): () => void {
    const prev = this.fetchHook;
    this.fetchHook = wrap(prev);
    return () => {
      this.fetchHook = prev;
    };
  }

  setSoftCap(bytes: number | null): void {
    this.softCapOverride = bytes;
    if (this.storeValue && bytes !== null) this.storeValue.softCapBytes = bytes;
  }

  async reopen(force: 'memory' | undefined): Promise<'opfs' | 'memory-fallback'> {
    if (this.storeValue) {
      this.base.hits += this.storeValue.stats.hits;
      this.base.evictions += this.storeValue.stats.evictions;
      await this.storeValue.settled();
    }
    return this.openStore(force);
  }

  // ---- startup ----
  private async openStore(force: 'memory' | undefined): Promise<'opfs' | 'memory-fallback'> {
    const p = this.params;
    if (!p) throw new Error('asset service is not initialised');
    let ports: Ports;
    try {
      ports = await this.d.makePorts(force);
    } catch {
      ports = memoryPorts();
    }
    const build = (pp: Ports): PackStore =>
      new PackStore({
        files: pp.files,
        index: pp.index,
        fetcher: this.fetcher as FetchRetry,
        kind: pp.kind,
        softCapBytes:
          this.softCapOverride ?? (pp.kind === 'memory-fallback' ? MEMORY_FALLBACK_CAP_BYTES : softCapBytes(p.mobileOrXr)),
        ...(this.d.now ? { now: this.d.now } : {}),
        ...(this.d.estimate ? { estimate: this.d.estimate } : {}),
        ...(this.d.persisted ? { persisted: this.d.persisted } : {}),
        writable: () => this.mode() === 'rw',
      });
    let store = build(ports);
    let kind: 'opfs' | 'memory-fallback';
    try {
      kind = await store.open();
    } catch {
      ports = memoryPorts();
      store = build(ports);
      kind = await store.open();
    }
    this.storeValue = store;
    this.currentPorts = ports;
    if (this.pinnedHashes.size > 0) store.pin([...this.pinnedHashes]);
    return kind;
  }

  private async init(p: InitParams): Promise<InitResult> {
    this.params = p;
    this.lanesValue = new Lanes(laneLimits(p.mobileOrXr));
    this.fetcher = new FetchRetry({
      fetch: (u, i) => this.fetchHook(u, i),
      lanes: this.lanesValue,
      ...(this.d.random ? { random: this.d.random } : {}),
      ...(this.d.sleep ? { sleep: this.d.sleep } : {}),
    });
    this.catalogValue = new CatalogClient({ fetch: (u, i) => this.d.fetch(u, i ?? {}), origin: p.origin, localMedia: p.localMedia });
    this.lock = new TabLock({
      channel: this.d.channel,
      id: this.d.tabId,
      startedAt: (this.d.now ?? Date.now)(),
      ...(this.d.probeMs !== undefined ? { probeMs: this.d.probeMs } : {}),
    });
    this.lock.onChange((mode) => this.d.post({ t: 'event', name: 'mode', mode }));
    await this.lock.start();
    const store = await this.openStore(undefined);
    return { store, mode: this.lock.mode };
  }

  // ---- RPC ----
  async handle(msg: ToWorker): Promise<void> {
    if (msg.t === 'abort') {
      this.aborts.get(msg.id)?.abort();
      return;
    }
    const ac = new AbortController();
    this.aborts.set(msg.id, ac);
    try {
      const out = await this.dispatch(msg, ac.signal);
      this.d.post({ t: 'res', id: msg.id, ok: true, result: out.result, bytes: this.stats().bytes }, out.transfer);
    } catch (e) {
      this.d.post({ t: 'res', id: msg.id, ok: false, error: toWire(e), bytes: this.stats().bytes });
    } finally {
      this.aborts.delete(msg.id);
    }
  }

  private async refOf(target: Target, tier: RpcOps['get'][0]['tier']): Promise<PackRef> {
    if (typeof target !== 'string') return target;
    const state = await this.catalog.load();
    if (state !== 'ready') throw new AssetNotFound(target, `catalog ${state}`);
    return this.catalog.resolve(target as AssetRef, tier);
  }

  /** Counts and reports (`err.asset`, at most five per reason) a failed pack read; the job handlers of the composed worker call it too. */
  noteError(e: unknown, ref: PackRef): void {
    if (!(e instanceof PackUnavailable) || e.reason === 'aborted') return;
    const n = (this.errCounts.get(e.reason) ?? 0) + 1;
    this.errCounts.set(e.reason, n);
    if (n <= ERR_ASSET_MAX_PER_REASON) this.d.post({ t: 'event', name: 'telemetry', event: 'err.asset', props: { reason: e.reason, kind: ref.kind } });
  }

  private stats(): StatsResult {
    const f = this.fetcher?.stats ?? { network: 0, retries: 0, bytes: 0 };
    const s = this.storeValue?.stats ?? { hits: 0, evictions: 0 };
    return { network: f.network, retries: f.retries, bytes: f.bytes, hits: this.base.hits + s.hits, evictions: this.base.evictions + s.evictions };
  }

  private async dispatch(msg: RpcRequest, signal: AbortSignal): Promise<{ result: unknown; transfer?: Transferable[] }> {
    const op = msg.op as OpName;
    switch (op) {
      case 'init':
        return { result: await this.init(msg.p as RpcOps['init'][0]) };
      case 'get':
      case 'reportDecodeFailure': {
        const p = msg.p as RpcOps['get'][0];
        if (typeof p.target === 'string') {
          const src = this.catalogValue?.sourceFor(p.target as AssetRef);
          const hit = src ? await src.open(p.target as AssetRef) : null;
          if (hit) return { result: hit.bytes, transfer: [hit.bytes] };
        }
        const ref = await this.refOf(p.target, p.tier);
        try {
          const buf =
            op === 'get'
              ? await this.store.get(ref, { ...(p.priority ? { priority: p.priority } : {}), signal })
              : await this.store.reportDecodeFailure(ref, { signal });
          return { result: buf, transfer: [buf] };
        } catch (e) {
          this.noteError(e, ref);
          throw e;
        }
      }
      case 'has': {
        const p = msg.p as RpcOps['has'][0];
        if (typeof p.target === 'string' && HEX64.test(p.target)) return { result: await this.store.has(p.target) };
        if (typeof p.target !== 'string') return { result: await this.store.has(p.target.sha256) };
        const state = await this.catalog.load();
        if (state !== 'ready') return { result: false };
        return { result: await this.store.has(this.catalog.resolve(p.target as AssetRef, p.tier).sha256) };
      }
      case 'resolve': {
        const p = msg.p as RpcOps['resolve'][0];
        return { result: await this.refOf(p.ref, p.tier) };
      }
      case 'prefetch': {
        const p = msg.p as RpcOps['prefetch'][0];
        const refs = await Promise.all(p.targets.map((t) => this.refOf(t, p.tier)));
        this.store.prefetch(refs, p.priority);
        return { result: null };
      }
      case 'pin': {
        const p = msg.p as RpcOps['pin'][0];
        const refs = await Promise.all(p.targets.map((t) => this.refOf(t, p.tier)));
        const hashes = refs.map((r) => r.sha256);
        for (const h of hashes) this.pinnedHashes.add(h);
        this.store.pin(hashes);
        return { result: null };
      }
      case 'unpinAll':
        this.pinnedHashes.clear();
        this.store.unpinAll();
        return { result: null };
      case 'gc': {
        const state = await this.catalog.load();
        if (state !== 'ready') return { result: { removed: 0, freedMB: 0 } };
        return { result: await this.store.gc(this.catalog.allHashes()) };
      }
      case 'usage':
        return { result: await this.store.usage() };
      case 'evictByTag':
        return { result: await this.store.evictByTag((msg.p as RpcOps['evictByTag'][0]).tag) };
      case 'downloadAll': {
        const p = msg.p as RpcOps['downloadAll'][0];
        const state = await this.catalog.load();
        if (state !== 'ready') throw new AssetNotFound('catalog', `catalog ${state}`);
        await this.store.downloadAll(this.catalog.resolveAll(p.tier), (done, total) =>
          this.d.post({ t: 'event', name: 'progress', id: msg.id, done, total }),
        );
        return { result: null };
      }
      case 'clear':
        await this.store.clear();
        return { result: null };
      case 'mode':
        return { result: this.mode() };
      case 'catalog':
        return { result: (await this.catalog.load()) satisfies CatalogStateName };
      case 'stats':
        return { result: this.stats() };
      case 'qa': {
        const p = msg.p as RpcOps['qa'][0];
        if (!this.d.qa) throw new Error('not-supported');
        return { result: await this.d.qa(this, p.name, p.args) };
      }
      case 'job': {
        const p = msg.p as RpcOps['job'][0];
        const job = this.d.jobs?.[p.name];
        if (!job) throw new Error(`unknown asset job: ${p.name}`);
        return job(this, p.args, signal);
      }
      default:
        throw new Error(`unknown asset op: ${String(op)}`);
    }
  }

  close(): void {
    this.lock?.close();
  }
}
