import { expect, test, type TestInfo } from '@playwright/test';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';
import { FLAT_TIERS, bootWorld, frames, read, setSky, world, type W } from './markings-helpers.ts';

/**
 * M02h1 street markings in a real browser, on a `DV_WORLD=synth` QA build (the world half of the e2e legs).
 *
 *  - @world-markings  AC-4  per flat tier (desktop, mobile, mobile-low; both browsers): `look().markings.mode` is `worn`, `worn`, `flat`; the counts
 *                     (road vertices, patches, crosswalks, stop bars) are above 0 at `markings-near`; the layer switch and `setLook(false)`
 *                     report `off`, the second with `layers: []`; no page error (a shader that does not compile shows as one)
 *  - @xr @world-markings  AC-8  the Quest tier on `xr-quest3` reports `flat`, and the layer switch works without a look view
 *
 * The goldens, the shot pair and the ledger are `markings-golden.spec.ts`, `markings-flicker-*.spec.ts` and `markings-ledger.spec.ts`.
 */
const LOOK = read<{ tierProfile: Record<string, string>; layers: Record<string, string[]> }>('config/world/look.json');
const MODE: Record<(typeof FLAT_TIERS)[number], 'worn' | 'flat'> = { desktop: 'worn', mobile: 'worn', 'mobile-low': 'flat' };

test.describe('world markings @world-markings', () => {
  test.describe.configure({ timeout: 1_800_000 });

  for (const tier of FLAT_TIERS) {
    test(`${tier}: the paint is ${MODE[tier]}, the counts are above 0 at markings-near, and the layer and the look switch it off @world-markings`, async ({ page }, testInfo: TestInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text());
      });
      await bootWorld(page, tier, '', SMALL_VIEWPORT);
      const first = await world(page, (w) => w.look());
      expect(first?.markings.mode, `${tier} on ${testInfo.project.name}`).toBe(MODE[tier]);
      expect(first?.layers, 'the layers of the tier include markings').toContain('markings');
      expect(first?.layers).toEqual(LOOK.layers[LOOK.tierProfile[tier] as string]);

      await setSky(page, 13, 'clear');
      await world(page, (w) => w.shot('markings-near'));
      await frames(page, 3);
      const near = (await world(page, (w) => w.look()))?.markings;
      expect(near?.mode).toBe(MODE[tier]);
      expect(near?.roadVerts ?? 0).toBeGreaterThan(0);
      expect(near?.patches ?? 0).toBeGreaterThan(0);
      expect(near?.crosswalks ?? 0).toBeGreaterThan(0);
      expect(near?.stopBars ?? 0).toBeGreaterThan(0);
      expect(near?.aa).toBe(true);

      // the layer: off reports `off` and drops the layer from `layers`; the geometry stays
      expect(await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('markings', false))).toBe(true);
      const off = await world(page, (w) => w.look());
      expect(off?.markings.mode).toBe('off');
      expect(off?.layers).not.toContain('markings');
      expect(off?.markings.patches).toBe(near?.patches);
      await frames(page, 2);
      expect(await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('markings', true))).toBe(true);
      expect((await world(page, (w) => w.look()))?.markings.mode).toBe(MODE[tier]);

      // the debug toggle of the antialiasing
      expect(await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('markings.aa', false))).toBe(true);
      expect((await world(page, (w) => w.look()))?.markings.aa).toBe(false);
      expect(await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('markings.aa', true))).toBe(true);
      expect((await world(page, (w) => w.look()))?.markings.aa).toBe(true);

      // the look off: no layers, the legacy roads material, `off`
      expect(await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLook(false))).toBe(true);
      await frames(page, 2);
      const legacy = await world(page, (w) => w.look());
      expect(legacy?.markings.mode).toBe('off');
      expect(legacy?.layers).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLook(true))).toBe(true);
      await frames(page, 2);
      expect((await world(page, (w) => w.look()))?.markings.mode).toBe(MODE[tier]);
      expect(errors, 'no page error or console error').toEqual([]);
    });
  }
});

test.describe('xr markings @xr @world-markings', () => {
  test('the Quest tier draws the flat paint on its legacy roads, and the layer switches it @xr @world-markings', async ({ page }) => {
    test.setTimeout(480_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
    const look = await world(page, (w) => w.look());
    // the look pass is not running (profile legacy), the flat paint is
    expect(look).toMatchObject({ profile: 'legacy', on: false, layers: [] });
    expect(look?.markings.mode).toBe('flat');
    await frames(page, 4);
    const m = (await world(page, (w) => w.look()))?.markings;
    expect(m?.roadVerts ?? 0).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('markings', false))).toBe(true);
    expect((await world(page, (w) => w.look()))?.markings.mode).toBe('off');
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('markings', true))).toBe(true);
    expect((await world(page, (w) => w.look()))?.markings.mode).toBe('flat');
    expect(errors).toEqual([]);
  });
});
