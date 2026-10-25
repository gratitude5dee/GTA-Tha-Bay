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
    const resolvable: Array<{ ref: string; bytes: number; sha256: string; worldPack: boolean }> = [];
    for (const [ref, e] of Object.entries(entries)) {
      const r = await page.evaluate(async (ref) => {
        try {
          const p = await (window as unknown as W).__dvBridge.assets.resolve(ref);
          return { bytes: p.bytes, sha256: p.sha256 };
        } catch {
          return null;
        }
      }, ref);
      if (r) resolvable.push({ ref, ...r, worldPack: e.kind === 'world_pack' });
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

    for (const r of resolvable) {
      expect(await page.evaluate((ref) => (window as unknown as W).__dvBridge.assets.has(ref), r.ref), `has(${r.ref})`).toBe(true);
    }

    // The network now fails for good, in the same session: every world pack still reads from the store.
    const before = (await page.evaluate(() => (window as unknown as W).__dvBridge.assets.stats())).network;
    await page.evaluate(() => (window as unknown as W).__dvBridge.assets.injectFaults({ status: 'network', times: 100000 }));
    for (const r of resolvable.filter((x) => x.worldPack)) {
      const got = await page.evaluate((ref) => (window as unknown as W).__dvBridge.assets.get(ref), r.ref);
      expect(got.sha256, `get(${r.ref})`).toBe(r.sha256);
    }
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
