import { expect, test, type Page } from '@playwright/test';

interface Obs {
  tick: number;
  transport: 'sab' | 'postMessage' | null;
  physicsBuild: string | null;
  records: number;
  restarts: number;
  snapshotReuse: number;
  frames: number;
  crashed: string | null;
  recovering: boolean;
  backend: string;
  hash: string | null;
}

async function waitForEngine(page: Page): Promise<void> {
  await page.waitForSelector('html[data-dv-engine="ready"]', { state: 'attached', timeout: 60_000 });
}

const observe = (page: Page): Promise<Obs> =>
  page.evaluate(() => {
    const engine = (window as unknown as { __dvBridge?: { engine?: { observe(): unknown } } }).__dvBridge?.engine;
    if (!engine) throw new Error('missing __dvBridge.engine');
    return engine.observe();
  }) as Promise<Obs>;

const act = (page: Page, cmd: object): Promise<boolean> =>
  page.evaluate((c) => {
    const engine = (window as unknown as { __dvBridge?: { engine?: { act(c: object): boolean } } }).__dvBridge?.engine;
    if (!engine) throw new Error('missing __dvBridge.engine');
    return engine.act(c);
  }, cmd);

test.describe('engine boot @boot', () => {
  test('boots the engine, draws the cubes, survives a stall and recovers from a crash @boot', async ({ page, browserName }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await waitForEngine(page);

    // Records and ticks: at least 64 records, tick advancing at least 50 per second.
    await expect.poll(async () => (await observe(page)).records, { timeout: 30_000 }).toBeGreaterThanOrEqual(64);
    const a = await observe(page);
    await page.waitForTimeout(1000);
    const b = await observe(page);
    console.log(`${testInfo.project.name}: transport=${String(b.transport)} build=${String(b.physicsBuild)} backend=${b.backend} ticks/s=${b.tick - a.tick} records=${b.records}`);
    expect(b.tick - a.tick).toBeGreaterThanOrEqual(50);
    expect(b.hash === null || /^[0-9a-f]{16}$/.test(b.hash)).toBe(true);
    if (browserName === 'chromium') {
      expect(b.transport).toBe('sab');
      expect(b.physicsBuild).toBe('simd-compat');
    } else {
      // WebKit isolation under Playwright on Linux is not in the ledger: either transport is accepted.
      expect(['sab', 'postMessage']).toContain(b.transport);
      expect(b.physicsBuild).toBe('simd-compat');
    }
    expect(b.restarts).toBe(0);

    // A 500 ms stall: the page keeps drawing frames and reuses the last snapshot.
    const before = await observe(page);
    expect(await act(page, { t: 'debug.stall', ms: 500 })).toBe(true);
    await page.waitForTimeout(450);
    const during = await observe(page);
    expect(during.frames - before.frames).toBeGreaterThanOrEqual(3);
    expect(during.snapshotReuse).toBeGreaterThan(before.snapshotReuse);
    await page.waitForTimeout(500);
    const afterStall = await observe(page);
    expect(afterStall.restarts).toBe(0);
    expect(afterStall.crashed).toBeNull();
    await expect.poll(async () => (await observe(page)).tick, { timeout: 10_000 }).toBeGreaterThan(afterStall.tick);

    // A crash: the banner shows, the worker restarts once within 5 s, and ticks advance again.
    expect(await act(page, { t: 'debug.crash' })).toBe(true);
    await expect.poll(async () => (await observe(page)).restarts, { timeout: 5_000, intervals: [100] }).toBe(1);
    await expect.poll(async () => (await observe(page)).recovering, { timeout: 15_000 }).toBe(false);
    const r1 = await observe(page);
    await page.waitForTimeout(500);
    const r2 = await observe(page);
    expect(r2.tick).toBeGreaterThan(r1.tick);
    expect(r2.restarts).toBe(1);
    expect(r2.crashed).toBeNull();
    expect(r2.records).toBeGreaterThanOrEqual(64);
    expect(errors.filter((m) => !/debug\.crash/.test(m))).toEqual([]);
  });

  test('shows the Recovering banner while the worker restarts @boot', async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      // Make the restart observable: record whether the banner was ever visible.
      (window as unknown as { __bannerSeen: boolean }).__bannerSeen = false;
      new MutationObserver(() => {
        const el = document.querySelector('.dv-engine-banner');
        if (el && !(el as HTMLElement).hidden) (window as unknown as { __bannerSeen: boolean }).__bannerSeen = true;
      }).observe(document, { subtree: true, attributes: true, childList: true });
    });
    await page.goto('/');
    await waitForEngine(page);
    await expect.poll(async () => (await observe(page)).records, { timeout: 30_000 }).toBeGreaterThanOrEqual(64);
    await act(page, { t: 'debug.crash' });
    await expect.poll(async () => (await observe(page)).restarts, { timeout: 5_000 }).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { __bannerSeen: boolean }).__bannerSeen)).toBe(true);
    await expect(page.locator('.dv-engine-banner')).toBeHidden({ timeout: 15_000 });
  });

  test('the postMessage fallback transport runs the same scene and recovers from a crash @boot', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/?transport=pm');
    await waitForEngine(page);
    await expect.poll(async () => (await observe(page)).records, { timeout: 30_000 }).toBeGreaterThanOrEqual(64);
    const a = await observe(page);
    expect(a.transport).toBe('postMessage');
    await page.waitForTimeout(1000);
    const b = await observe(page);
    expect(b.tick - a.tick).toBeGreaterThanOrEqual(50);
    expect(b.physicsBuild).toBe('simd-compat');
    await act(page, { t: 'debug.crash' });
    await expect.poll(async () => (await observe(page)).restarts, { timeout: 5_000 }).toBe(1);
    await expect.poll(async () => (await observe(page)).recovering, { timeout: 15_000 }).toBe(false);
    const r1 = await observe(page);
    await page.waitForTimeout(500);
    expect((await observe(page)).tick).toBeGreaterThan(r1.tick);
    expect((await observe(page)).transport).toBe('postMessage');
  });
});
