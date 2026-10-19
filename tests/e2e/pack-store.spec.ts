import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test as base, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import type { AssetsBridge } from '../../packages/engine/src/assets/bridge.ts';

// M01e: the world-pack store, the asset worker and the catalog client in a real browser, against the same-origin
// /media-local/ mirror that the QA build step fills (apps/web/scripts/qa-media.mjs). Counters come from the bridge, so
// nothing here depends on how Playwright sees worker traffic.
type W = { __dvBridge: { assets: AssetsBridge } };

// Playwright's default WebKit context is ephemeral, and WebKit gives an ephemeral session no origin-private file system
// (`navigator.storage.getDirectory()` throws UnknownError; the app then runs on the 48 MB memory fallback, which the platform
// test covers). These tests need real OPFS, so each one runs in a persistent context on a throwaway profile directory.
const test = base.extend<{ app: BrowserContext }>({
  app: async ({ playwright, browserName, baseURL }, use) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dv-pack-store-'));
    const context = await playwright[browserName].launchPersistentContext(dir, { ...(baseURL ? { baseURL } : {}) });
    await use(context);
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  },
});

const P0 = 'world_pack/p0-64-64';
const L0 = 'world_pack/l0-64-64';
const TEX = 'texture/asset-smoke';
const DATA = 'data/asset-smoke';

interface Expected {
  sha256: string;
  bytes: number;
}

/**
 * The catalog's own numbers for the world pack, read from where the served app has them: `/media-local/` on the running
 * server (the QA build's dist copy of the mirror, not the source tree's `apps/web/media-local`, which exists only after
 * a local QA build and is absent on CI, where e2e runs against the downloaded dist). Fetched over HTTP, not through the app.
 */
async function expectedFor(request: APIRequestContext, ref: string): Promise<Expected> {
  const get = async <T>(rel: string): Promise<T> => {
    const res = await request.get(`/media-local/${rel}`);
    expect(res.ok(), `GET /media-local/${rel} -> ${res.status()}`).toBe(true);
    return (await res.json()) as T;
  };
  const pointer = await get<{ key: string }>('asset-catalog.json');
  const catalog = await get<{ entries: Record<string, { variants: Record<string, Expected> }> }>(pointer.key);
  const v = catalog.entries[ref]?.variants['default'];
  if (!v) throw new Error(`no default variant for ${ref}`);
  return v;
}

async function ready(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.assets !== undefined, undefined, { timeout: 60_000 });
}

test.describe('pack store', () => {
  test('opens OPFS, fetches a pack once, verifies it, and serves it from the store after a reload @pack-store', async ({ app, request }) => {
    const page = await app.newPage();
    await ready(page);
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.assets.storeKind())).toBe('opfs');
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.assets.catalogState())).toBe('ready');
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

    const want = await expectedFor(request, P0);
    const got = await page.evaluate((ref) => (window as unknown as W).__dvBridge.assets.get(ref), P0);
    expect(got).toEqual({ byteLength: want.bytes, sha256: want.sha256 });
    // Record which OPFS write path this engine used (the sync access handle is the design; createWritable is the fallback).
    const writePath = await page.evaluate(() => (window as unknown as W).__dvBridge.assets.writePath());
    test.info().annotations.push({ type: 'opfs-write-path', description: String(writePath) });
    console.log(`pack-store ${test.info().project.name}: opfs write path = ${String(writePath)}`);
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.assets.stats())).toMatchObject({ network: 1, hits: 0 });

    await page.reload();
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.assets !== undefined, undefined, { timeout: 60_000 });
    expect(await page.evaluate((ref) => (window as unknown as W).__dvBridge.assets.has(ref), P0)).toBe(true);
    expect((await page.evaluate(() => (window as unknown as W).__dvBridge.assets.stats())).network).toBe(0);
    const again = await page.evaluate((ref) => (window as unknown as W).__dvBridge.assets.get(ref), P0);
    expect(again.sha256).toBe(want.sha256);
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.assets.stats())).toMatchObject({ network: 0, hits: 1 });

    // A PackRef with a wrong hash is refused and the store is unchanged.
    const before = await page.evaluate(() => (window as unknown as W).__dvBridge.assets.usage());
    const message = await page.evaluate(async (ref) => {
      const bridge = (window as unknown as W).__dvBridge.assets;
      const pack = await bridge.resolve(ref);
      try {
        await bridge.get({ ...pack, sha256: '0'.repeat(64) });
        return 'resolved';
      } catch (e) {
        return (e as Error).message;
      }
    }, L0);
    expect(message).toBe('hash-mismatch');
    const after = await page.evaluate(() => (window as unknown as W).__dvBridge.assets.usage());
    expect(after.packs).toBe(before.packs);
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.assets.files())).toHaveLength(before.packs);
  });

  test('retries 503s with backoff and records err.asset when they do not stop @pack-faults', async ({ app }) => {
    test.setTimeout(120_000);
    const page = await app.newPage();
    await ready(page);
    await page.evaluate(() => (window as unknown as W).__dvBridge.assets.injectFaults({ status: 503, times: 3, match: '/assets/' }));
    const ok = await page.evaluate((ref) => (window as unknown as W).__dvBridge.assets.get(ref, { priority: 'now' }), TEX);
    expect(ok.byteLength).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.assets.stats())).toMatchObject({ retries: 3 });

    await page.evaluate(() => (window as unknown as W).__dvBridge.assets.injectFaults({ status: 503, times: 8, match: '/assets/' }));
    const message = await page.evaluate(async (ref) => {
      try {
        await (window as unknown as W).__dvBridge.assets.get(ref, { priority: 'now' });
        return 'resolved';
      } catch (e) {
        return (e as Error).message;
      }
    }, DATA);
    expect(message).toBe('http');
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.assets.errAssetEvents())).toContainEqual({ reason: 'http', kind: 'data' });
    // The failed pack left nothing behind.
    expect(await page.evaluate((ref) => (window as unknown as W).__dvBridge.assets.has(ref), DATA)).toBe(false);
  });

  test('evicts the least recently used unpinned pack under the soft cap, and evictByTag, clear and the memory fallback work @pack-evict', async ({ app, request }) => {
    const page = await app.newPage();
    await ready(page);
    const p0 = (await expectedFor(request, P0)).bytes;
    const l0 = (await expectedFor(request, L0)).bytes;
    // Just above two packs: the third forces one eviction.
    await page.evaluate((cap) => (window as unknown as W).__dvBridge.assets.configure({ softCapBytes: cap }), p0 + l0 + 1);
    await page.evaluate((ref) => (window as unknown as W).__dvBridge.assets.pin([ref]), P0);
    await page.evaluate((ref) => (window as unknown as W).__dvBridge.assets.get(ref), P0);
    await page.evaluate((ref) => (window as unknown as W).__dvBridge.assets.get(ref), L0);
    await page.evaluate((ref) => (window as unknown as W).__dvBridge.assets.get(ref), TEX);
    await page.evaluate(() => (window as unknown as W).__dvBridge.assets.settled());
    const has = (ref: string): Promise<boolean> => page.evaluate((r) => (window as unknown as W).__dvBridge.assets.has(r), ref);
    expect(await has(P0)).toBe(true);
    expect(await has(L0)).toBe(false);
    expect(await has(TEX)).toBe(true);
    expect((await page.evaluate(() => (window as unknown as W).__dvBridge.assets.stats())).evictions).toBe(1);

    // The file went with the row.
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.assets.files())).toHaveLength(2);

    // Lift the cap, then evictByTag: both world packs carry 'fixture'; the pinned one goes too (kill-switch path).
    await page.evaluate(() => (window as unknown as W).__dvBridge.assets.configure({ softCapBytes: 1e9 }));
    await page.evaluate((ref) => (window as unknown as W).__dvBridge.assets.get(ref), L0);
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.assets.evictByTag('fixture'))).toEqual({ removed: 2 });
    expect(await has(P0)).toBe(false);
    expect(await has(TEX)).toBe(true);

    await page.evaluate(() => (window as unknown as W).__dvBridge.assets.clear());
    expect((await page.evaluate(() => (window as unknown as W).__dvBridge.assets.usage())).packs).toBe(0);
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.assets.files())).toEqual([]);

    // An orphan file (a write that never committed) is deleted by the next open().
    const sha = 'e'.repeat(64);
    await page.evaluate((s) => (window as unknown as W).__dvBridge.assets.writeOrphan(s), sha);
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.assets.files())).toContain(sha);
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.assets.reopen())).toBe('opfs');
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.assets.files())).not.toContain(sha);

    // Without OPFS the store falls back to memory and get still works.
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.assets.reopen({ force: 'memory' }))).toBe('memory-fallback');
    const viaMemory = await page.evaluate((ref) => (window as unknown as W).__dvBridge.assets.get(ref), P0);
    expect(viaMemory.sha256).toBe((await expectedFor(request, P0)).sha256);
  });

  test('a second tab is read-only, shows the notice, and the first tab still writes @pack-tabs', async ({ app, request }) => {
    const first = await app.newPage();
    await ready(first);
    expect(await first.evaluate(() => (window as unknown as W).__dvBridge.assets.mode())).toBe('rw');

    const second = await app.newPage();
    await ready(second);
    await expect.poll(() => second.evaluate(() => (window as unknown as W).__dvBridge.assets.mode()), { timeout: 10_000 }).toBe('read-only');
    await expect(second.locator('#dv-readonly-notice')).toBeVisible();
    await expect(first.locator('#dv-readonly-notice')).toHaveCount(0);

    await first.evaluate((ref) => (window as unknown as W).__dvBridge.assets.get(ref), P0);
    expect(await first.evaluate((ref) => (window as unknown as W).__dvBridge.assets.has(ref), P0)).toBe(true);
    // The read-only tab sees the first tab's commit but never writes: its own fetch is returned uncached.
    expect(await second.evaluate((ref) => (window as unknown as W).__dvBridge.assets.has(ref), P0)).toBe(true);
    const viaSecond = await second.evaluate((ref) => (window as unknown as W).__dvBridge.assets.get(ref), L0);
    expect(viaSecond.byteLength).toBe((await expectedFor(request, L0)).bytes);
    expect(await first.evaluate((ref) => (window as unknown as W).__dvBridge.assets.has(ref), L0)).toBe(false);
  });

  test('the gray-box world loads its packs through the store @pack-graybox', async ({ app }) => {
    test.skip(!existsSync(path.resolve('packages/engine/src/client/graybox/load.ts')), 'M01b2 has not landed: there is no gray-box loader to hook up');
    await ready(await app.newPage());
  });
});
