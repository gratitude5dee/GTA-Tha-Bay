import { describe, expect, it } from 'vitest';
import { eachLimited, installPrecache, PRECACHE_CONCURRENCY, precacheRequest, type PrecacheControllerLike } from '../src/sw-precache.ts';

// BD-FIX-CI6-C02: the precache install runs a few entries at a time with Workbox's per-entry strategy, and still fails as a whole.

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1));

function fakeController(entries: Array<[string, string]>, fail: (url: string) => boolean = () => false) {
  let inFlight = 0;
  let peak = 0;
  const seen: Array<{ url: string; cache: RequestCache; cacheKey: string; integrity: string }> = [];
  const controller: PrecacheControllerLike = {
    getURLsToCacheKeys: () => new Map(entries),
    getIntegrityForCacheKey: (key) => (key.endsWith('sri.js') ? 'sha384-abc' : undefined),
    strategy: {
      handleAll: ({ request, params }) => {
        seen.push({ url: request.url, cache: request.cache, cacheKey: params.cacheKey, integrity: request.integrity });
        inFlight++;
        peak = Math.max(peak, inFlight);
        const done = tick().then(() => {
          inFlight--;
          if (fail(request.url)) throw new Error(`bad-precaching-response ${request.url}`);
          return new Response('ok');
        });
        return [done, done.then(() => undefined)];
      },
    },
  };
  return { controller, seen, peak: () => peak };
}

const event = {} as ExtendableEvent;
const hashed = (n: number): Array<[string, string]> =>
  Array.from({ length: n }, (_, i) => [`https://x.test/assets/c${i}-abcd1234.js`, `https://x.test/assets/c${i}-abcd1234.js`]);

describe('precache install (sw-precache.ts)', () => {
  it('stores every entry, at most PRECACHE_CONCURRENCY at a time', async () => {
    const { controller, seen, peak } = fakeController(hashed(40));
    await installPrecache(controller, event);
    expect(seen.map((s) => s.url).sort()).toEqual(hashed(40).map(([u]) => u).sort());
    expect(peak()).toBe(PRECACHE_CONCURRENCY);
    expect(PRECACHE_CONCURRENCY).toBeGreaterThan(1);
  });

  it('builds the request Workbox would: reload for revisioned entries, default for hashed ones, SRI when the manifest has it', async () => {
    const { controller, seen } = fakeController([
      ['https://x.test/index.html', 'https://x.test/index.html?__WB_REVISION__=c63a'],
      ['https://x.test/assets/main-abcd1234.js', 'https://x.test/assets/main-abcd1234.js'],
      ['https://x.test/assets/sri.js', 'https://x.test/assets/sri.js'],
    ]);
    await installPrecache(controller, event);
    const by = new Map(seen.map((s) => [s.url, s]));
    expect(by.get('https://x.test/index.html')).toMatchObject({ cache: 'reload', cacheKey: 'https://x.test/index.html?__WB_REVISION__=c63a', integrity: '' });
    expect(by.get('https://x.test/assets/main-abcd1234.js')).toMatchObject({ cache: 'default', integrity: '' });
    expect(by.get('https://x.test/assets/sri.js')).toMatchObject({ integrity: 'sha384-abc' });
    expect(precacheRequest('https://x.test/a.js', 'https://x.test/a.js', undefined).credentials).toBe('same-origin');
  });

  it('fails the install when any entry fails, and starts no entry after the failure', async () => {
    const { controller, seen } = fakeController(hashed(60), (url) => url.includes('/c3-'));
    await expect(installPrecache(controller, event)).rejects.toThrow(/bad-precaching-response .*c3-/);
    await tick();
    expect(seen.length).toBeLessThan(60);
  });

  it('eachLimited handles an empty list and a limit above the item count', async () => {
    await expect(eachLimited([], 6, () => Promise.reject(new Error('never')))).resolves.toBeUndefined();
    const order: number[] = [];
    await eachLimited([1, 2], 10, async (n) => void order.push(n));
    expect(order).toEqual([1, 2]);
  });
});
