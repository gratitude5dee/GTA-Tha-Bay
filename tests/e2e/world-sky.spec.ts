import { expect, test, type Page } from '@playwright/test';
import type { QualityTierId } from '../../packages/shared/src/index.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { SMALL_VIEWPORT } from './engine-helpers.ts';

/**
 * M02b2 day, night and weather in a real browser, on a `DV_WORLD=synth` QA build (the world half of the e2e legs). The bridge sets
 * the hour, the preset and the blackout through the sim (`debug.hour`, `debug.weather`, `debug.blackout`), waits until the sky the
 * page draws reports them, and reads back 128 x 72 targets rendered from the player's camera position.
 *
 *  - @world-sky AC-6: clear-noon sky luminance 0.45 to 0.85, night sky below 0.12, Karl fog lowers the city's luminance variance by
 *    at least 25 % against clear at the same hour, and the blackout reports `uBlackout` 1 with the window factor 0.15;
 *  - @world-sky tiers: each flat tier mounts the sky its matrix row names, the lamps and decals are capped, rain shows its look and
 *    the wet look follows the rain where the tier has one.
 */
type W = { __dvBridge: { world: WorldBridge } };

async function bootWorld(page: Page, tier: QualityTierId, query = ''): Promise<void> {
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto(`/?tier=${tier}&debug=1${query}`);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 180_000 });
  await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(60_000));
}

const world = <T>(page: Page, fn: (w: WorldBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.world)`) as Promise<T>;

/** Sets the sky through the sim and waits until the page's sky shows it. The clock is frozen at the hour. */
async function setSky(page: Page, hour: number, weather: string, blackout = false): Promise<void> {
  await page.evaluate(
    ([h, w, b]) => {
      const world = (window as unknown as W).__dvBridge.world;
      world.setHour(h as number, true);
      world.setWeather(w as never, 0);
      world.blackout(b as boolean);
    },
    [hour, weather, blackout] as const,
  );
  await page.waitForFunction(
    ([h, w, b]) => {
      const s = (window as unknown as W).__dvBridge.world.sky();
      return !!s && Math.abs(s.hour - (h as number)) < 0.05 && s.weather === w && (s.uniforms.uBlackout === 1) === b && s.next === w;
    },
    [hour, weather, blackout] as const,
    { timeout: 90_000 },
  );
}

test.describe('world sky @world-sky', () => {
  test.describe.configure({ timeout: 600_000 });

  test('clear noon, night, Karl fog and the blackout read as the gates say @world-sky', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await bootWorld(page, 'desktop');

    // Sky luminance: the backdrop pass alone (the dome and the far ring), looking up and away from the sun; the city: both passes.
    const sky = (): Promise<{ mean: number }> => world(page, (w) => w.luma(40, 90, { passes: 'sky' }));
    const city = (): Promise<{ mean: number; variance: number }> => world(page, (w) => w.luma(-6, 0));

    await setSky(page, 13, 'clear');
    const noon = await sky();
    const cityClear = await city();
    console.log(`world-sky noon clear: sky ${noon.mean.toFixed(3)} city mean ${cityClear.mean.toFixed(3)} variance ${cityClear.variance.toFixed(4)}`);
    expect(noon.mean).toBeGreaterThanOrEqual(0.45);
    expect(noon.mean).toBeLessThanOrEqual(0.85);
    expect((await world(page, (w) => w.sky()))?.uniforms.uNight).toBe(0);

    await setSky(page, 1, 'clear');
    const night = await sky();
    console.log(`world-sky night clear: sky ${night.mean.toFixed(3)}`);
    expect(night.mean).toBeLessThan(0.12);
    expect((await world(page, (w) => w.sky()))?.uniforms.uNight).toBe(1);

    await setSky(page, 13, 'karl-fog');
    const cityKarl = await city();
    console.log(`world-sky noon karl-fog: city mean ${cityKarl.mean.toFixed(3)} variance ${cityKarl.variance.toFixed(4)} (clear ${cityClear.variance.toFixed(4)})`);
    expect(cityClear.variance).toBeGreaterThan(0);
    expect(cityKarl.variance).toBeLessThanOrEqual(cityClear.variance * 0.75);
    const karl = await world(page, (w) => w.sky());
    expect(karl?.uniforms.uBank).toBe(1);

    await setSky(page, 22, 'clear', true);
    const dark = await world(page, (w) => w.sky());
    expect(dark?.uniforms.uBlackout).toBe(1);
    expect(dark?.windowFactor).toBeCloseTo(0.15, 6);
    await setSky(page, 22, 'clear', false);
    expect((await world(page, (w) => w.sky()))?.windowFactor).toBe(1);
    expect(errors).toEqual([]);
  });

  for (const tier of ['mobile-low', 'mobile'] as const) {
    test(`the sky of ${tier}: its matrix row, lamps and decals within the cap, rain, wetness @world-sky`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await bootWorld(page, tier);
      await setSky(page, 21.5, 'clear');
      const info = await world(page, (w) => w.sky());
      if (!info) throw new Error('no sky');
      expect(info.enabled).toBe(true);
      expect(info.tier).toBe(tier);
      expect(info.config.fog).toBe('linear');
      expect(info.config.clouds).toBe(tier === 'mobile' ? 'painted' : 'gradient');
      expect(info.config.decalCap).toBe(tier === 'mobile' ? 16 : 0);
      expect(info.headlights).toBe(true); // 21:30 is dark: uDark above 0.4
      // The street lamps of the baked world are on the page and the decals stay within the tier's cap.
      await expect.poll(async () => (await world(page, (w) => w.sky()))?.lamps ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);
      const lit = await world(page, (w) => w.sky());
      expect(lit?.decals ?? 0).toBeLessThanOrEqual(info.config.decalCap);
      expect(lit?.uniforms.uStars).toBeGreaterThan(0.5);

      // Rain: the overlay shows on both mobile tiers; the streaks only on `mobile`; the wet look follows the rain only where the tier has it.
      await setSky(page, 21.5, 'rain');
      await expect.poll(async () => (await world(page, (w) => w.sky()))?.uniforms.uRain ?? 0, { timeout: 30_000 }).toBeGreaterThan(0.5);
      const rainy = await world(page, (w) => w.sky());
      expect(rainy?.overlay).toBe(true);
      expect(rainy?.streaksDrawn ?? 0).toBeGreaterThan(0);
      if (tier === 'mobile-low') expect(rainy?.streaksDrawn).toBe(0);
      else expect(rainy?.streaksDrawn).toBeLessThanOrEqual(800);
      await expect.poll(async () => (await world(page, (w) => w.sky()))?.wet ?? 0, { timeout: 60_000 }).toBeGreaterThan(0.2);
      // The rain override forces rain whatever the preset: Karl fog with rain on top (the device checklist's look).
      await setSky(page, 21.5, 'karl-fog');
      await page.evaluate(() => (window as unknown as W).__dvBridge.world.rain(200));
      await expect.poll(async () => (await world(page, (w) => w.sky()))?.uniforms.uRain ?? 0, { timeout: 30_000 }).toBeGreaterThan(0.7);
      expect((await world(page, (w) => w.sky()))?.uniforms.uBank).toBe(1);
      expect(errors).toEqual([]);
    });
  }
});
