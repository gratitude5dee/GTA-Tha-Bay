import { expect, test, type Page } from '@playwright/test';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { SMALL_VIEWPORT } from './engine-helpers.ts';

/**
 * M02f1 boot figures in a real browser, on a `DV_WORLD=synth` QA build.
 *
 *  - @world-boot-figures AC-5  `world.boot()` and `data-dv-boot` carry the same requests, bytes, reveal time, waves and peak in flight
 *  - @net-shaper         AC-5  `?net=lag` delays the pack fetches, so a second cold boot reveals later (chromium-webgl2 only)
 *
 * Every test context is fresh, so each boot starts from an empty pack store.
 */
type W = { __dvBridge: { world: WorldBridge } };

/** The desktop lane sum (8 now + 16 soon + 2 idle). CI browsers classify as `desktop` whatever `?tier=` forces. */
const DESKTOP_LANES = 26;

interface DvBoot {
  tier: string;
  requests: number;
  bytes: number;
  revealMs: number;
  waves: number;
  inflightPeak: number;
}

async function bootAndRead(page: Page, query: string): Promise<{ boot: Awaited<ReturnType<WorldBridge['boot']>>; attr: DvBoot }> {
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto(`/?tier=mobile${query}`);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 240_000 });
  // The request counts arrive one worker round trip after the reveal.
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().requests !== null, undefined, { timeout: 30_000 });
  const boot = (await page.evaluate(() => (window as unknown as W).__dvBridge.world.boot())) as Awaited<ReturnType<WorldBridge['boot']>>;
  const raw = await page.evaluate(() => document.documentElement.dataset['dvBoot'] ?? null);
  expect(raw, 'data-dv-boot is written once the figures are known').not.toBeNull();
  return { boot, attr: JSON.parse(raw as string) as DvBoot };
}

test.describe('world boot figures @world', () => {
  test.describe.configure({ timeout: 480_000 });

  test('the boot reports its requests, bytes, reveal time, waves and peak in flight, and data-dv-boot says the same @world-boot-figures', async ({ page }) => {
    const { boot, attr } = await bootAndRead(page, '');
    console.log(`world-boot-figures: ${JSON.stringify(attr)}`);
    expect(boot.requests).toBeGreaterThanOrEqual(2);
    expect(boot.bytesBeforeReveal).not.toBeNull();
    expect(boot.bytes).toBe(boot.bytesBeforeReveal);
    expect(boot.bootRevealMs).toBeGreaterThan(0);
    expect(boot.waves).toBeGreaterThanOrEqual(1);
    expect(boot.inflightPeak).toBeGreaterThanOrEqual(1);
    expect(boot.inflightPeak).toBeLessThanOrEqual(DESKTOP_LANES);
    // The reveal that `@world-route` and M02b1 measure from `attach` is unchanged and never later than the boot-start figure.
    expect(boot.revealMs).not.toBeNull();
    expect(boot.bootRevealMs as number).toBeGreaterThanOrEqual(boot.revealMs as number);

    expect(attr).toEqual({
      tier: 'mobile',
      requests: boot.requests,
      bytes: boot.bytes,
      revealMs: boot.bootRevealMs,
      waves: boot.waves,
      inflightPeak: boot.inflightPeak,
    });
    // The attribute holds figures only: no ids, no positions.
    expect(Object.keys(attr).sort()).toEqual(['bytes', 'inflightPeak', 'requests', 'revealMs', 'tier', 'waves']);
  });

  test('?net=lag delays the world index and the spawn tile by 400 ms each, so a second cold boot reveals later @net-shaper', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the shaper test runs on chromium-webgl2');
    const run = async (query: string): Promise<number> => {
      const ctx = await browser.newContext();
      try {
        const page = await ctx.newPage();
        const { boot } = await bootAndRead(page, query);
        return boot.bootRevealMs as number;
      } finally {
        await ctx.close();
      }
    };
    const plain = await run('');
    const lagged = await run('&net=lag');
    console.log(`net-shaper: unshaped ${plain} ms, lag ${lagged} ms`);
    // The world index and the spawn tile are fetched one after the other, 400 ms of latency each.
    expect(lagged).toBeGreaterThanOrEqual(800);
    expect(lagged).toBeGreaterThan(plain);
  });
});
