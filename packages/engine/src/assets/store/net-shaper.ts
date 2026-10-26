import type { FetchFn } from './fetch-retry.ts';

/**
 * The QA network shaper (M02f1): `?net=<profile>` slows pack fetches on purpose so that a test can show what latency and throughput do
 * to a world boot. Reached only through a dynamic `import()` behind `import.meta.env.VITE_DV_QA === '1'` (`AssetService.init`), so a
 * production bundle never holds it (`check-dist` looks for the marker `dv-net-shaper`).
 *
 * Every request first waits `latencyMs`. With `bytesPerSec`, an ok response is read in full and then released when a byte budget shared
 * by all requests of the shaper has paid for it: `start = max(now, cursor)`, `cursor = start + ceil(bytes * 1000 / bytesPerSec)`.
 * Non-ok responses and profiles without `bytesPerSec` return after the latency only.
 */
export interface NetProfile {
  latencyMs: number;
  bytesPerSec: number | null;
}

export interface ShaperClock {
  /** Milliseconds on any monotonic clock. */
  now(): number;
  /** Resolves after `ms`; rejects when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal | null): Promise<void>;
}

export interface NetShaper {
  wrap(inner: FetchFn): FetchFn;
}

/** Every error message this module throws contains this marker; `check-dist` looks for it in the bundle. */
export const NET_SHAPER_MARKER = 'dv-net-shaper';

function abortError(): Error {
  const e = new Error(`${NET_SHAPER_MARKER}: aborted`);
  e.name = 'AbortError';
  return e;
}

export function realClock(): ShaperClock {
  return {
    now: () => performance.now(),
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        const onAbort = (): void => {
          clearTimeout(t);
          reject(abortError());
        };
        const t = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, Math.max(0, ms));
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
  };
}

export function createNetShaper(profile: NetProfile, clock: ShaperClock = realClock()): NetShaper {
  if (!(profile.latencyMs >= 0) || (profile.bytesPerSec !== null && !(profile.bytesPerSec > 0))) {
    throw new Error(`${NET_SHAPER_MARKER}: invalid profile`);
  }
  const { latencyMs, bytesPerSec } = profile;
  let cursor = 0;
  return {
    wrap(inner) {
      return async (input, init) => {
        const signal = init.signal ?? null;
        await clock.sleep(latencyMs, signal);
        const res = await inner(input, init);
        if (bytesPerSec === null || !res.ok) return res;
        const body = await res.arrayBuffer();
        const start = Math.max(clock.now(), cursor);
        cursor = start + Math.ceil((body.byteLength * 1000) / bytesPerSec);
        await clock.sleep(cursor - clock.now(), signal);
        return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
      };
    },
  };
}
