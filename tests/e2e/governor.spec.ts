import { expect, test, type Page } from '@playwright/test';

/**
 * M11a1 (@governor): the runtime quality governor, the memory budget and the frame pacer through the QA bridge
 * (`__dvBridge.platform.governor`, `.memory.pressure()`, `.memory.injectMB()`). SwiftShader frame times are never asserted; the series
 * the governor sees are the ones `inject` feeds it.
 */
const ready = (page: Page): Promise<unknown> => page.waitForFunction(() => window.__dvBridge?.platform?.governor !== undefined, undefined, { timeout: 90_000 });
const state = (page: Page) => page.evaluate(() => window.__dvBridge!.platform!.governor.state());

test.describe('governor @governor', () => {
  // On the DV_WORLD=synth build the page boots the streamed world beside the bridge; a software renderer takes most of the default 30 s.
  test.setTimeout(180_000);

  test('?governor=on: 25 ms frames for 3 s take renderScale below its ceiling, and it reaches the drawing buffer', async ({ page }) => {
    await page.goto('/?tier=desktop&perf=1&governor=on');
    await ready(page);
    // The page's own SwiftShader frames feed the governor too (they are slow), so it may have stepped down already; the series below
    // is what the criterion is about: 120 frames of 25 ms against the 16.7 ms budget of `desktop` are 3 s of governor time.
    const before = await state(page);
    expect(before.enabled).toBe(true);
    expect(before.dynamic.renderScale).toBeLessThanOrEqual(1);
    await page.evaluate(() => window.__dvBridge!.platform!.governor.inject(Array(120).fill(25)));
    const after = await state(page);
    expect(after.dynamic.renderScale).toBeLessThan(1);
    expect(after.changes).toBeGreaterThan(0);
    expect(after.lastChange?.dir).toBe('down');
    // the host resized the drawing buffer under the new scale (a 1x display: the pixel ratio is the scale)
    await expect.poll(() => page.evaluate(() => window.__dvBridge!.platform!.resolution().pixelRatio), { timeout: 15_000 }).toBeLessThan(1);
  });

  test('?governor=off: the same injection changes nothing', async ({ page }) => {
    await page.goto('/?tier=desktop&perf=1&governor=off');
    await ready(page);
    await page.evaluate(() => window.__dvBridge!.platform!.governor.inject(Array(180).fill(25)));
    const after = await state(page);
    expect(after.enabled).toBe(false);
    expect(after.dynamic.renderScale).toBe(1);
    expect(after.changes).toBe(0);
  });

  test('a page opened by the shared fixture without a governor flag has the governor off (AC-12, DL-756)', async ({ page }) => {
    await page.goto('/?tier=desktop&perf=1');
    await ready(page);
    expect((await state(page)).enabled).toBe(false);
  });

  test('the memory budget answers injected megabytes: soft at 85 %, hard at 95 % of the mobile heap cap', async ({ page }) => {
    await page.goto('/?tier=mobile&perf=1');
    await ready(page);
    const cap = await page.evaluate(() => window.__dvBridge!.platform!.memory.pressure().reading.heapMB);
    expect(cap).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => window.__dvBridge!.platform!.memory.pressure().level)).toBe('none');
    // `mobile`: 600 MB accounted heap. 520 MB is 87 %, 590 MB is 98 %, on top of what the page already holds.
    const soft = await page.evaluate(() => window.__dvBridge!.platform!.memory.injectMB(520));
    expect(['soft', 'hard']).toContain(soft);
    const hard = await page.evaluate(() => window.__dvBridge!.platform!.memory.injectMB(590));
    expect(hard).toBe('hard');
    const p = await page.evaluate(() => window.__dvBridge!.platform!.memory.pressure());
    expect(p.softEvents).toBe(1);
    expect(p.hardEvents).toBe(1);
    expect(p.injectedMB).toBe(590);
    expect(p.worst).toBe('heap');
  });

  test('the frame pacer holds the tier target: 30 on mobile-low', async ({ page }) => {
    await page.goto('/?tier=mobile-low&perf=1');
    await ready(page);
    const low = await page.evaluate(() => window.__dvBridge!.platform!.governor.pacer());
    expect(low.targetFps).toBe(30);
    expect(low.rendered).toBeLessThanOrEqual(low.seen);
    expect(low.bypassed).toBe(false);
  });

  test('the frame pacer holds the tier target: 60 on desktop', async ({ page }) => {
    await page.goto('/?tier=desktop&perf=1');
    await ready(page);
    expect((await page.evaluate(() => window.__dvBridge!.platform!.governor.pacer())).targetFps).toBe(60);
  });
});
