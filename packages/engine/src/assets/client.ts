import type { QualityTierId } from '@dv/shared';
import { AssetNotFound } from './store/catalog-client.ts';
import type { Priority } from './store/lanes.ts';
import type { DownloadPlan } from './store/store.ts';
import type { TabMode } from './store/tab-lock.ts';
import { PackUnavailable, type PackRef, type StorageUsage } from './store/types.ts';
import type {
  CatalogInfo,
  CatalogStateName,
  FromWorker,
  InitParams,
  InitResult,
  OpName,
  RpcOps,
  StatsResult,
  Target,
  ToWorker,
  WireError,
} from './rpc.ts';

/** The part of a `Worker` the client uses; tests pass an in-process loopback. */
export interface WorkerPort {
  postMessage(msg: ToWorker, transfer?: Transferable[]): void;
  onmessage: ((e: { data: FromWorker }) => void) | null;
  onerror?: ((e: unknown) => void) | null;
  terminate?(): void;
}

export interface AssetClientOptions {
  /** The caller's current quality tier: `AssetRef`s resolve to this tier's variant. */
  tier: () => QualityTierId;
  onTelemetry?: (name: 'err.asset', props: { reason: string; kind: string }) => void;
}

interface Pending {
  resolve(v: unknown): void;
  reject(e: unknown): void;
  progress?: (done: number, total: number) => void;
}

function fromWire(e: WireError): Error {
  if (e.name === 'PackUnavailable' && e.reason && e.ref) return new PackUnavailable(e.reason, e.ref);
  if (e.name === 'AssetNotFound') {
    const err = new AssetNotFound('asset', e.message);
    err.message = e.message;
    return err;
  }
  const err = new Error(e.message);
  err.name = e.name;
  return err;
}

/**
 * Main-thread handle on `asset.worker` (M01e). `get` returns a transferred `ArrayBuffer`. The store, the fetch layer and the
 * catalog live in the worker (OPFS is reachable only there). Not a contract.
 */
export class AssetClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly modeListeners = new Set<(m: TabMode) => void>();
  private modeValue: TabMode = 'rw';
  private catalogStateValue: CatalogStateName = 'idle';
  private storeKindValue: 'opfs' | 'memory-fallback' = 'memory-fallback';
  private disposed = false;
  private bytesSeenValue = 0;
  private heardValue = 0;
  /** The `err.asset` events received from the worker (at most 50), for the QA bridge and tests. */
  readonly errLog: Array<{ reason: string; kind: string }> = [];
  private readonly port: WorkerPort;
  private readonly o: AssetClientOptions;

  constructor(port: WorkerPort, o: AssetClientOptions) {
    this.port = port;
    this.o = o;
    port.onmessage = (e) => this.receive(e.data);
    port.onerror = (e) => this.failAll(new Error(`asset worker failed: ${String((e as { message?: unknown } | null)?.message ?? e)}`));
  }

  /** Starts the client against `port` and waits for the store to open (the platform emits `app.start` after this). */
  static async start(port: WorkerPort, init: InitParams, o: AssetClientOptions): Promise<AssetClient> {
    const c = new AssetClient(port, o);
    c.applyInit(await c.call('init', init));
    return c;
  }

  /** Records the result of the `init` call (used by `start` and by `startAssets`). */
  applyInit(r: InitResult): void {
    this.storeKindValue = r.store;
    this.modeValue = r.mode;
  }

  /** `opfs`, or `memory-fallback` when OPFS is unavailable. */
  get storeKind(): 'opfs' | 'memory-fallback' {
    return this.storeKindValue;
  }
  get mode(): TabMode {
    return this.modeValue;
  }
  /**
   * Network bytes the worker had downloaded when it posted the latest reply this client has handled (`StatsResult.bytes` carried on
   * every reply). Synchronous: every byte it counts arrived before the caller's current task, so a caller that reads it the moment a
   * reply's result is used gets the bytes downloaded up to then, not a figure that a later `stats()` round trip would inflate.
   */
  get bytesSeen(): number {
    return this.bytesSeenValue;
  }
  /**
   * Messages from the worker handled on this thread so far (replies and events). A reader that finds it unchanged between two of its own
   * frames has heard nothing from the worker in between (BD-FIX-LANDMARK-PREPARE-01).
   */
  get heard(): number {
    return this.heardValue;
  }
  /** The last known state; `loadCatalog()` loads the catalog and refreshes it. */
  get catalogState(): CatalogStateName {
    return this.catalogStateValue;
  }

  onMode(fn: (m: TabMode) => void): () => void {
    this.modeListeners.add(fn);
    return () => this.modeListeners.delete(fn);
  }

  private receive(m: FromWorker): void {
    this.heardValue++;
    if (m.t === 'res') {
      if (m.bytes !== undefined && m.bytes > this.bytesSeenValue) this.bytesSeenValue = m.bytes;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(fromWire(m.error));
    } else if (m.name === 'mode') {
      this.modeValue = m.mode;
      for (const fn of this.modeListeners) fn(m.mode);
    } else if (m.name === 'progress') {
      this.pending.get(m.id)?.progress?.(m.done, m.total);
    } else {
      if (this.errLog.length < 50) this.errLog.push(m.props);
      this.o.onTelemetry?.(m.event, m.props);
    }
  }

  private failAll(e: Error): void {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }

  call<K extends OpName>(
    op: K,
    p: RpcOps[K][0],
    o: { signal?: AbortSignal; progress?: (done: number, total: number) => void; transfer?: Transferable[] } = {},
  ): Promise<RpcOps[K][1]> {
    return this.send(op, p, o).done;
  }

  /** `call` with the request id the worker knows it by (0 when the client is disposed and nothing was sent). */
  private send<K extends OpName>(
    op: K,
    p: RpcOps[K][0],
    o: { signal?: AbortSignal; progress?: (done: number, total: number) => void; transfer?: Transferable[] } = {},
  ): { id: number; done: Promise<RpcOps[K][1]> } {
    if (this.disposed) return { id: 0, done: Promise.reject(new Error('asset client is disposed')) };
    const id = this.nextId++;
    const done = new Promise<RpcOps[K][1]>((resolve, reject) => {
      const entry: Pending = { resolve: resolve as (v: unknown) => void, reject, ...(o.progress ? { progress: o.progress } : {}) };
      this.pending.set(id, entry);
      const signal = o.signal;
      if (signal) {
        const onAbort = (): void => this.port.postMessage({ t: 'abort', id });
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      this.port.postMessage({ t: 'req', id, op, p } as ToWorker, o.transfer);
    });
    return { id, done };
  }

  /** A domain job of the composed worker (M02b1: world meshing, the sim pack channel). Results come back transferred. */
  job(name: string, args: unknown, o: { signal?: AbortSignal; transfer?: Transferable[] } = {}): Promise<unknown> {
    return this.call('job', { name, args }, o);
  }

  /** `job` with its request id, which `held` asks the worker about (the landmark swap's prepares, BD-FIX-LANDMARK-PREPARE-01). */
  trackedJob(name: string, args: unknown, o: { signal?: AbortSignal; transfer?: Transferable[] } = {}): { id: number; done: Promise<unknown> } {
    return this.send('job', { name, args }, o);
  }

  /**
   * Asks the worker about requests sent before (ids from `trackedJob`): for each, the milliseconds it has held it unanswered on its own
   * clock since it took it up, or null when it does not hold it. One port carries requests and replies in order, so when this settles
   * the worker has taken up every request sent before it, and every reply it posted before its answer has been handled here: a request
   * reported as not held whose result has still not arrived has no reply coming. Rejects when the worker cannot answer: the client is
   * disposed, or the worker failed (`onerror`, which rejects every request in flight).
   */
  held(ids: readonly number[]): Promise<(number | null)[]> {
    return this.call('held', { ids: [...ids] });
  }

  /** Bytes of an `AssetRef` (resolved for the current tier) or of a `PackRef`. */
  get(target: Target, o: { priority?: Priority; signal?: AbortSignal } = {}): Promise<ArrayBuffer> {
    return this.call('get', { target, tier: this.o.tier(), ...(o.priority ? { priority: o.priority } : {}) }, o.signal ? { signal: o.signal } : {});
  }
  /** A decode failure upstream: purge and fetch once more. */
  reportDecodeFailure(target: Target): Promise<ArrayBuffer> {
    return this.call('reportDecodeFailure', { target, tier: this.o.tier() });
  }
  /** `target` may also be a 64-character SHA-256. */
  has(target: Target): Promise<boolean> {
    return this.call('has', { target, tier: this.o.tier() });
  }
  resolve(ref: string): Promise<PackRef> {
    return this.call('resolve', { ref, tier: this.o.tier() });
  }
  async prefetch(targets: Target[], priority: 'soon' | 'idle'): Promise<void> {
    await this.call('prefetch', { targets, tier: this.o.tier(), priority });
  }
  /** M02f2: raises the lane of the targets that still wait (a queued fetch, a prefetch not yet started); resolves with how many moved. */
  promote(targets: Target[], priority: 'now' | 'soon'): Promise<number> {
    return this.call('promote', { targets, tier: this.o.tier(), priority });
  }
  async pin(targets: Target[]): Promise<void> {
    await this.call('pin', { targets, tier: this.o.tier() });
  }
  async unpinAll(): Promise<void> {
    await this.call('unpinAll', {});
  }
  gc(): Promise<{ removed: number; freedMB: number }> {
    return this.call('gc', {});
  }
  usage(): Promise<StorageUsage> {
    return this.call('usage', {});
  }
  evictByTag(tag: string): Promise<{ removed: number }> {
    return this.call('evictByTag', { tag });
  }
  downloadPlan(): Promise<DownloadPlan> {
    return this.call('downloadPlan', { tier: this.o.tier() });
  }
  async downloadAll(onProgress: (done: number, total: number) => void, o: { signal?: AbortSignal } = {}): Promise<void> {
    await this.call('downloadAll', { tier: this.o.tier() }, { progress: onProgress, ...(o.signal ? { signal: o.signal } : {}) });
  }
  async clear(): Promise<void> {
    await this.call('clear', {});
  }
  async loadCatalog(): Promise<CatalogStateName> {
    this.catalogStateValue = await this.call('catalog', {});
    return this.catalogStateValue;
  }
  /** `loadCatalog()` plus, for an `unavailable` catalog, the request that failed and why. */
  async catalogInfo(): Promise<CatalogInfo> {
    const info = await this.call('catalogInfo', {});
    this.catalogStateValue = info.state;
    return info;
  }
  stats(o: { resetPeak?: boolean } = {}): Promise<StatsResult> {
    return this.call('stats', o);
  }
  qa(name: string, args?: unknown): Promise<unknown> {
    return this.call('qa', { name, args: args ?? null });
  }

  dispose(): void {
    this.disposed = true;
    this.failAll(new Error('asset client is disposed'));
    this.port.terminate?.();
  }
}

export type { InitResult };
