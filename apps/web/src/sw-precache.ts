/**
 * The precache install, a few entries at a time (BD-FIX-CI6-C02).
 *
 * Workbox's own install (`precache()`, `precacheAndRoute()`) fetches and stores the precache one entry at a time, so a precache of
 * many small hashed chunks costs one network round trip per entry: 175 entries in a QA build and 71 in a production build since the
 * M04b1 page chunks, which kept a remote Preview's first install past 30 s. This runs the same per-entry work through the same
 * public `PrecacheController` API (its strategy fetches, rejects an unsafe response and stores under the cache key) with at most
 * `limit` entries in flight, and still fails the install when any entry fails. Routing, activation and cleanup stay Workbox's.
 */

/** The slice of workbox-precaching's `PrecacheController` the install uses (public API), so tests can pass a fake. */
export interface PrecacheControllerLike {
  getURLsToCacheKeys(): Map<string, string>;
  getIntegrityForCacheKey(cacheKey: string): string | undefined;
  readonly strategy: {
    handleAll(options: { request: Request; event: ExtendableEvent; params: { cacheKey: string } }): [Promise<Response | undefined>, Promise<void>];
  };
}

/** Entries in flight: the HTTP/1.1 per-host connection limit (Workbox moved to one at a time after running all at once). */
export const PRECACHE_CONCURRENCY = 6;

/** Runs `fn` over `items` with at most `limit` calls in flight. Rejects with the first failure; no new item starts after one. */
export async function eachLimited<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  let failed = false;
  const lane = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const item = items[next++] as T;
      try {
        await fn(item);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
}

/**
 * The request Workbox's install would make for one entry: a revisioned entry (its cache key carries `__WB_REVISION__`) bypasses
 * the HTTP cache with `cache: 'reload'`; a hashed entry (`revision: null`, cache key equal to the URL) uses the default mode.
 */
export function precacheRequest(url: string, cacheKey: string, integrity: string | undefined): Request {
  const init: RequestInit = { cache: cacheKey === url ? 'default' : 'reload', credentials: 'same-origin' };
  if (integrity !== undefined) init.integrity = integrity;
  return new Request(url, init);
}

/** Fetches and stores every precache entry, `limit` at a time; rejects (failing the install) when any entry fails. */
export function installPrecache(controller: PrecacheControllerLike, event: ExtendableEvent, limit = PRECACHE_CONCURRENCY): Promise<void> {
  return eachLimited([...controller.getURLsToCacheKeys()], limit, async ([url, cacheKey]) => {
    const request = precacheRequest(url, cacheKey, controller.getIntegrityForCacheKey(cacheKey));
    await Promise.all(controller.strategy.handleAll({ params: { cacheKey }, request, event }));
  });
}
