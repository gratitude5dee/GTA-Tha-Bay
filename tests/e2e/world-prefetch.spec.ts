import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { AssetsBridge } from '../../packages/engine/src/assets/bridge.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { observe, SMALL_VIEWPORT } from './engine-helpers.ts';
import { NO_BYPASS, passGates, waitForEngineReady } from './ui/helpers.ts';

/**
 * M02f2 boot prefetch in a real browser, on a `DV_WORLD=synth` QA build. The rest of the boot set (the rings beyond the critical set,
 * then l1, l2 and far) downloads at idle priority behind the main menu once the world is revealed, the part still queued is promoted
 * when New Game starts, and the gate skips it for a Save-Data hint or too little storage.
 *
 *  - @world-prefetch       AC-6  menu run: nothing before the reveal, idle lane used, report fields, each planned pack fetched at most once
 *  - @world-prefetch-skip  AC-7  Save-Data hint, no room, and the QA play bypass
 *
 * The spec reads requests with `context.route` (it sees the asset worker's fetches on every engine; service workers stay blocked) and
 * the reveal instant with a MutationObserver on `data-dv-world`, installed before the page's scripts. The tag matches none of the
 * gray-box substrings of tests/e2e/graybox-grep.txt, so it runs in the world leg.
 *
 * What the request log cannot show: the world streamer itself demands the same rings, l1 and l2 packs as soon as the sim starts, while
 * the Title and the menu are up (the world is the backdrop), so a planned URL may well be requested before the reveal, and with the
 * prefetch skipped, by the streamer. The boot prefetch is therefore proved from its own report (`state`, `sent`, `startedMs` against the
 * reveal instant) and the log is used for what it can prove: a pack is requested once however many callers want it.
 */
type B = { __dvBridge: { world: WorldBridge; assets: AssetsBridge } };

interface Hit {
  url: string;
  at: number;
}

/** Logs every `/media-local/` request, worker requests included, and lets it through. */
async function watchMedia(context: BrowserContext): Promise<Hit[]> {
  const log: Hit[] = [];
  await context.route('**/media-local/**', (route) => {
    log.push({ url: route.request().url(), at: Date.now() });
    return route.continue();
  });
  return log;
}

/** Stores the instant the world was revealed (the attribute `reveal()` sets) as `window.__revealPerf` (`performance.now()`). */
async function markReveal(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __revealPerf?: number };
    new MutationObserver(() => {
      if (w.__revealPerf === undefined && document.documentElement.dataset['dvWorld'] === 'revealed') w.__revealPerf = performance.now();
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-dv-world'] });
  });
}

const revealPerf = (page: Page): Promise<number | undefined> => page.evaluate(() => (window as unknown as { __revealPerf?: number }).__revealPerf);

const waitRevealed = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => (window as unknown as Partial<B>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 240_000 });

const prefetchState = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => (window as unknown as B).__dvBridge.world.prefetch()?.state);

/** Absolute URLs of the planned packs, resolved by the page's own catalog. */
async function plannedUrls(page: Page): Promise<{ now: string[]; soon: string[] }> {
  return page.evaluate(async () => {
    const b = (window as unknown as B).__dvBridge;
    const plan = b.world.prefetchPlan();
    if (!plan) throw new Error('no prefetch plan');
    const urls = async (refs: string[]): Promise<string[]> => Promise.all(refs.map(async (r) => new URL((await b.assets.resolve(r)).url, location.href).href));
    return { now: await urls(plan.now), soon: await urls(plan.soon) };
  });
}

async function startNewGame(page: Page, name: string): Promise<void> {
  await page.getByTestId('nav-new').click();
  await page.getByTestId('new-name').fill(name);
  await page.getByTestId('new-continue').click();
  await expect(page.getByTestId('creator')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('btn-creator-done').click();
  await expect(page.getByTestId('new-creator')).toBeVisible();
  await page.getByTestId('btn-new-start').click();
}

const count = (log: Hit[], url: string): number => log.filter((h) => h.url === url).length;

test.describe('boot prefetch @world-prefetch', () => {
  test.use({ storageState: NO_BYPASS });
  test.describe.configure({ timeout: 420_000 });

  test('behind the main menu the rest of the boot set downloads at idle priority after the reveal, and New Game promotes it @world-prefetch', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const log = await watchMedia(context);
    await markReveal(page);
    // The default viewport: the QA panels of a small one cover the New Game buttons (the menu pages are driven as a player does).
    await page.goto('/?tier=mobile');
    await passGates(page);
    await waitForEngineReady(page);
    await waitRevealed(page);
    await expect.poll(() => prefetchState(page), { timeout: 120_000 }).toBe('running');

    const plan = await plannedUrls(page);
    const planned = [...plan.now, ...plan.soon];
    expect(planned.length).toBeGreaterThan(0);
    // Nothing speculative before the reveal: the controller queued its download after the instant the view revealed.
    const at = await revealPerf(page);
    expect(at).toBeDefined();
    const started = await page.evaluate(() => (window as unknown as B).__dvBridge.world.prefetch());
    expect(started?.startedMs).not.toBeNull();
    expect(started?.startedMs as number).toBeGreaterThanOrEqual(Math.floor(at as number));
    expect(started?.sent).toBe(started?.missingAtStart);
    expect(started?.sent).toBeGreaterThan(0);

    // The idle lane carries the download while the menu stays open.
    await expect
      .poll(async () => (await page.evaluate(() => (window as unknown as B).__dvBridge.assets.lanes())).peak['idle'] ?? 0, { timeout: 120_000 })
      .toBeGreaterThanOrEqual(1);
    const lanes = await page.evaluate(() => (window as unknown as B).__dvBridge.assets.lanes());
    console.log(`world-prefetch menu: peak=${JSON.stringify(lanes.peak)} planned=${planned.length} requested=${new Set(log.filter((h) => planned.includes(h.url)).map((h) => h.url)).size}`);

    await startNewGame(page, 'Prefetch');
    await expect(page.getByTestId('hud')).toBeVisible({ timeout: 120_000 });
    await expect
      .poll(async () => (await page.evaluate(() => (window as unknown as B).__dvBridge.world.prefetch()))?.startToPlayMs, { timeout: 60_000 })
      .not.toBeNull();
    await page.waitForTimeout(10_000);

    const report = await page.evaluate(() => (window as unknown as B).__dvBridge.world.prefetch());
    console.log(`world-prefetch report: ${JSON.stringify(report)}`);
    expect(report?.state).toBe('running');
    expect(report?.planned).toBe(planned.length);
    expect(report?.planned).toBeGreaterThan(0);
    expect(report?.promoted).toBeGreaterThanOrEqual(0);
    expect(typeof report?.startToPlayMs).toBe('number');
    // Each planned pack is fetched once: the prefetch, the streamer and the promotion share one request.
    const dupes = planned.filter((u) => count(log, u) > 1);
    expect(dupes).toEqual([]);
    expect((await observe(page)).tick).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});

test.describe('boot prefetch gate @world-prefetch-skip', () => {
  test.describe.configure({ timeout: 420_000 });

  test.describe('menu runs', () => {
    test.use({ storageState: NO_BYPASS });

    for (const c of [
      {
        why: 'save-data' as const,
        stub: (): void => {
          Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: true }) });
        },
      },
      {
        why: 'quota' as const,
        stub: (): void => {
          Object.defineProperty(navigator.storage, 'estimate', { configurable: true, value: () => Promise.resolve({ usage: 0, quota: 1 }) });
        },
      },
    ]) {
      test(`a ${c.why} device skips the speculative download @world-prefetch-skip`, async ({ page, context }) => {
        const log = await watchMedia(context);
        await markReveal(page);
        await page.addInitScript(c.stub);
        await page.setViewportSize(SMALL_VIEWPORT);
        await page.goto('/?tier=mobile');
        await passGates(page);
        await waitForEngineReady(page);
        await waitRevealed(page);
        await expect.poll(() => prefetchState(page), { timeout: 120_000 }).toBe('skipped');
        const report = await page.evaluate(() => (window as unknown as B).__dvBridge.world.prefetch());
        expect(report?.skipped).toBe(c.why);
        expect(report?.needBytes).toBeGreaterThan(0);

        // Nothing was handed to the asset worker, and the idle download never started. (The streamer's own demand for the rings is not the
        // prefetch: it may have requested planned packs already, so the request log is not asked.)
        expect(report?.sent).toBe(0);
        expect(report?.startedMs).toBeNull();
        await page.waitForTimeout(2_000);
        const again = await page.evaluate(() => (window as unknown as B).__dvBridge.world.prefetch());
        expect(again).toMatchObject({ state: 'skipped', skipped: c.why, sent: 0, promoted: 0 });
        expect(log.length).toBeGreaterThan(0);
      });
    }
  });

  test('the QA play bypass reports direct and requests the rings, l1, l2 and far after the reveal @world-prefetch-skip', async ({ page, context }) => {
    const log = await watchMedia(context);
    await markReveal(page);
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?tier=mobile&play=sandbox');
    await page.waitForFunction(() => (window as unknown as Partial<B>).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
    await waitRevealed(page);
    await expect.poll(() => prefetchState(page), { timeout: 120_000 }).toBe('direct');
    const plan = await plannedUrls(page);
    const planned = [...plan.now, ...plan.soon];
    // Every planned pack is requested (by the prefetch at `soon`, or earlier by the streamer, which shares the request).
    await expect
      .poll(() => planned.filter((u) => log.some((h) => h.url === u)).length, { timeout: 180_000, intervals: [1000, 2000] })
      .toBe(planned.length);
    expect(planned.filter((u) => count(log, u) > 1)).toEqual([]);
    const at = (await revealPerf(page)) as number;
    const report = await page.evaluate(() => (window as unknown as B).__dvBridge.world.prefetch());
    expect(report?.state).toBe('direct');
    expect(report?.skipped).toBeNull();
    // The whole plan went out after the reveal, in one batch.
    expect(report?.sent).toBe(planned.length);
    expect(report?.startedMs as number).toBeGreaterThanOrEqual(Math.floor(at));
    console.log(`world-prefetch direct: ${JSON.stringify(report)}`);
  });
});
