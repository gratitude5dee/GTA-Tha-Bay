import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect as baseExpect, test as base, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import type { AssetsBridge } from '../../packages/engine/src/assets/bridge.ts';
import { waitForEngine } from './engine-helpers.ts';
import { hideQaPanels } from './ui/helpers.ts';

/**
 * M04b4 (@offline-download): Settings > Install and storage downloads the whole city for this quality level, inside the running
 * session, and keeps working with the network failing. Needs the baked world's catalog, so it runs in the DV_WORLD=synth half of CI
 * (not in graybox-grep.txt). To see it by hand: a QA build with `DV_WORLD=synth` (`pnpm dev`), open `/?world=walk-drop`, press
 * Escape, Settings, Install and storage: the size row shows the city's size, "Download the city for offline play" fills a progress bar
 * and ends with "Download finished."; "Clear downloaded data" asks first.
 */
type W = { __dvBridge: { assets: AssetsBridge } };
const expect = baseExpect.configure({ timeout: 60_000 });
const messages = JSON.parse(readFileSync(new URL('../../content/ui/i18n/en.json', import.meta.url), 'utf8')) as Record<string, string>;
const HOME = '/?world=walk-drop';

// WebKit gives an ephemeral context no OPFS (see pack-store.spec.ts), so each test runs in a persistent context on a throwaway profile.
const test = base.extend<{ app: BrowserContext }>({
  app: async ({ playwright, browserName, baseURL }, use) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dv-offline-'));
    const context = await playwright[browserName].launchPersistentContext(dir, { ...(baseURL ? { baseURL } : {}) });
    // A persistent context does not take the config's storageState, so the QA play bypass (DL-650) is set here.
    await context.addInitScript(() => {
      try {
        localStorage.setItem('dv-qa-play', 'sandbox');
      } catch {
        // storage blocked
      }
    });
    await use(context);
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  },
});

interface Variant {
  sha256: string;
  bytes: number;
}
type Entries = Record<string, { kind: string; variants: Record<string, Variant> }>;

async function catalogEntries(request: APIRequestContext): Promise<Entries> {
  const get = async <T>(rel: string): Promise<T> => {
    const res = await request.get(`/media-local/${rel}`);
    expect(res.ok(), `GET /media-local/${rel} -> ${res.status()}`).toBe(true);
    return (await res.json()) as T;
  };
  const pointer = await get<{ key: string }>('asset-catalog.json');
  return (await get<{ entries: Entries }>(pointer.key)).entries;
}

async function openInstall(page: Page): Promise<void> {
  await hideQaPanels(page);
  await page.goto(HOME);
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.assets !== undefined, undefined, { timeout: 120_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('btn-pause-resume')).toBeVisible();
  await page.getByTestId('btn-pause-settings').click();
  await page.getByTestId('settings-cat-install').click();
  await expect(page.getByTestId('settings')).toHaveAttribute('data-cat', 'install');
}

test.describe('offline download', () => {
  test.describe.configure({ timeout: 300_000 });

  test('downloads the catalog, then serves it with the network failing, and Clear empties the store @offline-download', async ({ app, request }) => {
    const page = await app.newPage();
    await openInstall(page);
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.assets.storeKind())).toBe('opfs');
    await page.evaluate(() => (window as unknown as W).__dvBridge.assets.catalogState());

    // Every entry that resolves for this tier, with the catalog's own numbers.
    const entries = await catalogEntries(request);
    // One page.evaluate per phase, never one per ref: on the software-GL projects the engine keeps the page's main thread busy, so
    // every round trip costs about 0.3 s and 440 refs times three loops alone would outlast the test timeout.
    const refs = Object.keys(entries);
    const resolved = await page.evaluate(async (list) => {
      const out: Array<{ ref: string; bytes: number; sha256: string } | null> = [];
      for (const ref of list) {
        try {
          const p = await (window as unknown as W).__dvBridge.assets.resolve(ref);
          out.push({ ref, bytes: p.bytes, sha256: p.sha256 });
        } catch {
          out.push(null);
        }
      }
      return out;
    }, refs);
    const resolvable: Array<{ ref: string; bytes: number; sha256: string; worldPack: boolean }> = [];
    for (const r of resolved) {
      const e = r ? entries[r.ref] : undefined;
      if (r && e) resolvable.push({ ...r, worldPack: e.kind === 'world_pack' });
    }
    expect(resolvable.filter((r) => r.worldPack).length, 'the plan must hold at least one world-pack ref').toBeGreaterThan(0);
    const sum = resolvable.reduce((n, r) => n + r.bytes, 0);

    const plan = await page.evaluate(() => (window as unknown as W).__dvBridge.assets.downloadPlan());
    expect(plan.totalBytes).toBe(sum);
    expect(plan.files).toBe(resolvable.length);
    expect(plan.fits).toBe(true);
    await expect(page.getByText(/in all, .* still to download/)).toBeVisible();

    const download = page.getByTestId('btn-offline');
    await expect(download).not.toHaveAttribute('aria-disabled', 'true');
    await download.click();
    await expect(page.getByText(messages['settings.storage.offline.done'] as string)).toBeVisible();

    const missing = await page.evaluate(async (list) => {
      const out: string[] = [];
      for (let i = 0; i < list.length; i += 32) {
        const chunk = list.slice(i, i + 32);
        const held = await Promise.all(chunk.map((ref) => (window as unknown as W).__dvBridge.assets.has(ref)));
        chunk.forEach((ref, k) => void (held[k] || out.push(ref)));
      }
      return out;
    }, resolvable.map((r) => r.ref));
    expect(missing, 'refs the store does not hold after the download').toEqual([]);

    // The network now fails for good, in the same session: every world pack still reads from the store.
    const before = (await page.evaluate(() => (window as unknown as W).__dvBridge.assets.stats())).network;
    await page.evaluate(() => (window as unknown as W).__dvBridge.assets.injectFaults({ status: 'network', times: 100000 }));
    const wrong = await page.evaluate(async (list) => {
      const out: string[] = [];
      for (let i = 0; i < list.length; i += 32) {
        const chunk = list.slice(i, i + 32);
        const got = await Promise.all(chunk.map(({ ref }) => (window as unknown as W).__dvBridge.assets.get(ref)));
        chunk.forEach(({ ref, sha256 }, k) => void (got[k]?.sha256 === sha256 || out.push(`${ref}: ${got[k]?.sha256}`)));
      }
      return out;
    }, resolvable.filter((x) => x.worldPack).map((x) => ({ ref: x.ref, sha256: x.sha256 })));
    expect(wrong, 'world packs whose bytes differ from the catalog while the network fails').toEqual([]);
    expect((await page.evaluate(() => (window as unknown as W).__dvBridge.assets.stats())).network).toBe(before);
    await page.evaluate(() => (window as unknown as W).__dvBridge.assets.clearFaults());

    // Clear: the confirm dialog opens, and confirming empties the store.
    await page.getByTestId('btn-clear').click();
    await expect(page.getByTestId('confirm-ok')).toBeVisible();
    await page.getByTestId('confirm-ok').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as W).__dvBridge.assets.usage().then((u) => u.packs))).toBe(0);
    await expect(page.getByText('Downloaded: 0.0 MB in 0 files.')).toBeVisible();
  });
});
