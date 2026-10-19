import type { Lanes, Priority } from './lanes.ts';

/**
 * The shared fetch layer (11-platform-pwa.md section 5): `fetch(url, { cache: 'no-store', priority, mode: 'cors' })`, up to 8
 * attempts on 5xx, 429 or a network error before the body is read, a delay of `min(5000, 300 x 2^n) x (0.5 to 1.5)` ms after
 * failed attempt n, no retry on any other 4xx, an in-flight map so that a demand request joins a speculative prefetch, and
 * 1 MiB-aligned Range slices for objects over 4 MB. An error body is never returned.
 */
export const MAX_ATTEMPTS = 8;
export const BACKOFF_BASE_MS = 300;
export const BACKOFF_CAP_MS = 5000;
export const RANGE_THRESHOLD_BYTES = 4 * 1024 * 1024;
export const RANGE_SLICE_BYTES = 1024 * 1024;
const SLICE_CONCURRENCY = 4;

export type FetchFailureReason = 'offline' | 'http' | 'aborted';

export class FetchFailure extends Error {
  readonly reason: FetchFailureReason;
  readonly status: number | null;
  constructor(reason: FetchFailureReason, status: number | null = null) {
    super(status === null ? reason : `${reason} ${status}`);
    this.name = 'FetchFailure';
    this.reason = reason;
    this.status = status;
  }
}

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export interface FetchRetryOptions {
  fetch: FetchFn;
  lanes: Lanes;
  /** Uniform in [0, 1); the delay multiplier is `0.5 + random()`. */
  random?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Called with the delay of each scheduled retry (tests and counters). */
  onRetry?: (url: string, attempt: number, delayMs: number) => void;
}

export interface FetchStats {
  /** Requests that went to the network (a joined request counts once). */
  network: number;
  /** Retry attempts after a failed first attempt. */
  retries: number;
  /** Body bytes received from the network (M02b1: the cold-download figure of the boot-size check). */
  bytes: number;
}

export function backoffMs(n: number, u: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** n) * u;
}

const PRIORITY_HINT: Record<Priority, 'high' | 'auto' | 'low'> = { now: 'high', soon: 'auto', idle: 'low' };

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new FetchFailure('aborted'));
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(new FetchFailure('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

interface InFlight {
  promise: Promise<Uint8Array>;
  promote(to: Priority): void;
  controller: AbortController;
  waiters: number;
}

export class FetchRetry {
  readonly stats: FetchStats = { network: 0, retries: 0, bytes: 0 };
  private readonly inflight = new Map<string, InFlight>();
  private readonly fetchFn: FetchFn;
  private readonly lanes: Lanes;
  private readonly random: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly onRetry: ((url: string, attempt: number, delayMs: number) => void) | undefined;

  constructor(o: FetchRetryOptions) {
    this.fetchFn = o.fetch;
    this.lanes = o.lanes;
    this.random = o.random ?? Math.random;
    this.sleep = o.sleep ?? defaultSleep;
    this.onRetry = o.onRetry;
  }

  /** True while a request for this URL is queued or running. */
  isInFlight(url: string): boolean {
    return this.inflight.has(url);
  }

  /**
   * Fetches `url` as bytes. `bytes` (the expected size) selects Range slices above 4 MB. Callers for the same URL share one
   * request; a higher priority promotes a request that is still queued.
   */
  fetchBytes(url: string, o: { priority?: Priority; signal?: AbortSignal; bytes?: number } = {}): Promise<Uint8Array> {
    const priority = o.priority ?? 'soon';
    const signal = o.signal;
    if (signal?.aborted) return Promise.reject(new FetchFailure('aborted'));

    let entry = this.inflight.get(url);
    if (entry) entry.promote(priority);
    else entry = this.start(url, priority, o.bytes);
    const shared = entry;
    shared.waiters++;

    return new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      const release = (): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        shared.waiters--;
      };
      const onAbort = (): void => {
        if (settled) return;
        release();
        if (shared.waiters <= 0) shared.controller.abort();
        reject(new FetchFailure('aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      shared.promise.then(
        (v) => {
          if (settled) return;
          release();
          resolve(v);
        },
        (e: unknown) => {
          if (settled) return;
          release();
          reject(e);
        },
      );
    });
  }

  private start(url: string, priority: Priority, bytes: number | undefined): InFlight {
    const controller = new AbortController();
    const handle = this.lanes.schedule(priority, () => {
      this.stats.network++;
      return bytes !== undefined && bytes > RANGE_THRESHOLD_BYTES
        ? this.fetchSlices(url, bytes, priority, controller.signal)
        : this.fetchWhole(url, priority, controller.signal);
    });
    const entry: InFlight = {
      promise: handle.promise,
      promote: (to) => handle.promote(to),
      controller,
      waiters: 0,
    };
    this.inflight.set(url, entry);
    const clear = (): void => {
      if (this.inflight.get(url) === entry) this.inflight.delete(url);
    };
    handle.promise.then(clear, clear);
    return entry;
  }

  private async fetchWhole(url: string, priority: Priority, signal: AbortSignal): Promise<Uint8Array> {
    const res = await this.attempts(url, priority, signal, undefined);
    return this.readBody(res, signal);
  }

  private async fetchSlices(url: string, total: number, priority: Priority, signal: AbortSignal): Promise<Uint8Array> {
    const out = new Uint8Array(total);
    const count = Math.ceil(total / RANGE_SLICE_BYTES);
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= count) return;
        const start = i * RANGE_SLICE_BYTES;
        const end = Math.min(total, start + RANGE_SLICE_BYTES) - 1;
        const res = await this.attempts(url, priority, signal, `bytes=${start}-${end}`);
        const part = await this.readBody(res, signal);
        if (res.status === 200) {
          // The server ignored Range and sent the whole object: use it once.
          if (part.byteLength !== total) throw new FetchFailure('http', 200);
          out.set(part, 0);
          next = count;
          return;
        }
        if (part.byteLength !== end - start + 1) throw new FetchFailure('http', res.status);
        out.set(part, start);
      }
    };
    await Promise.all(Array.from({ length: Math.min(SLICE_CONCURRENCY, count) }, () => worker()));
    return out;
  }

  private async readBody(res: Response, signal: AbortSignal): Promise<Uint8Array> {
    try {
      const body = new Uint8Array(await res.arrayBuffer());
      this.stats.bytes += body.byteLength;
      return body;
    } catch {
      if (signal.aborted) throw new FetchFailure('aborted');
      throw new FetchFailure('offline');
    }
  }

  private async attempts(url: string, priority: Priority, signal: AbortSignal, range: string | undefined): Promise<Response> {
    let reason: 'http' | 'offline' = 'offline';
    let status: number | null = null;
    for (let n = 0; n < MAX_ATTEMPTS; n++) {
      if (signal.aborted) throw new FetchFailure('aborted');
      if (n > 0) this.stats.retries++;
      try {
        const init: RequestInit & { priority?: string } = {
          cache: 'no-store',
          mode: 'cors',
          signal,
          priority: PRIORITY_HINT[priority],
        };
        if (range) init.headers = { Range: range };
        const res = await this.fetchFn(url, init);
        if (res.ok) return res;
        if (res.status >= 500 || res.status === 429) {
          reason = 'http';
          status = res.status;
          void res.body?.cancel().catch(() => undefined);
        } else {
          void res.body?.cancel().catch(() => undefined);
          throw new FetchFailure('http', res.status);
        }
      } catch (e) {
        if (e instanceof FetchFailure) throw e;
        if (signal.aborted) throw new FetchFailure('aborted');
        reason = 'offline';
        status = null;
      }
      if (n < MAX_ATTEMPTS - 1) {
        const delay = backoffMs(n, 0.5 + this.random());
        this.onRetry?.(url, n + 1, delay);
        await this.sleep(delay, signal);
      }
    }
    throw new FetchFailure(reason, status);
  }
}
