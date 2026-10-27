import { expect, test, type Page } from '@playwright/test';
import type { WorldBridge } from '../../../packages/world/src/client/world-bridge.ts';
import { bootSandbox } from './sandbox-helpers.ts';

/**
 * M04e1 AC-12 (@sandbox-world): the Sandbox app's Weather, Time and World tabs on the synth world (the QA play bypass starts the
 * sandbox; this tag runs in the `DV_WORLD=synth` half, so it is not in GRAYBOX_GREP). To see it by hand: a QA build with
 * `DV_WORLD=synth` (`pnpm dev`), open `/?tier=mobile-low`, press Escape, then Phone, then Sandbox, and use the Weather, Time and World tabs.
 */
type W = { __dvBridge: { world: WorldBridge; engine: { modes: { send(c: object): boolean } } } };

const sky = (page: Page): Promise<{ hour: number; weather: string; next: string; windowFactor: number } | null> =>
  page.evaluate(() => {
    const s = (window as unknown as W).__dvBridge.world.sky();
    return s ? { hour: s.hour, weather: s.weather, next: s.next, windowFactor: s.windowFactor } : null;
  });

/** Pause, the phone, the Sandbox app, one of its tabs. */
async function openTab(page: Page, tab: 'weather' | 'time' | 'world'): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('btn-pause-resume')).toBeVisible();
  await page.getByTestId('btn-pause-phone').click();
  await page.getByTestId('row-phone-apps-sandbox').click();
  await page.getByTestId(`tab-sandbox-tabs-${tab}`).click();
}

/** From an app back to the game: the phone's home, its close button, then Resume. */
async function closePhone(page: Page): Promise<void> {
  await page.getByTestId('btn-phone-home').click();
  await page.getByTestId('btn-phone-close').click();
  await page.getByTestId('btn-pause-resume').click();
  await expect(page.getByTestId('hud')).toBeVisible();
}

test.describe('sandbox world controls @sandbox-world', () => {
  test.describe.configure({ timeout: 600_000 });

  test('Rain holds, Golden hour sets the hour, Blackout dims the windows and quitting puts it back @sandbox-world', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await bootSandbox(page);
    await expect(page.getByTestId('hud')).toBeVisible();

    // Weather: Rain stays Rain.
    await openTab(page, 'weather');
    await page.getByTestId('btn-weather-rain').click();
    await expect(page.getByTestId('btn-weather-rain')).toHaveClass(/primary/);
    await page.screenshot({ path: testInfo.outputPath('sandbox-weather.png') });
    await closePhone(page);
    await expect.poll(async () => (await sky(page))?.weather, { timeout: 5_000 }).toBe('rain');
    expect((await sky(page))?.next).toBe('rain');
    await page.waitForTimeout(20_000);
    const later = await sky(page);
    expect(later?.weather).toBe('rain');
    expect(later?.next).toBe('rain');

    // Time: the Golden hour shortcut sets 18:30 and holds the golden preset.
    await openTab(page, 'time');
    await page.getByTestId('btn-shortcut-golden-hour').click();
    await page.screenshot({ path: testInfo.outputPath('sandbox-time.png') });
    await closePhone(page);
    await expect
      .poll(async () => {
        const s = await sky(page);
        return s !== null && Math.abs(s.hour - 18.5) < 0.1 && s.weather === 'golden' && s.next === 'golden';
      }, { timeout: 10_000 })
      .toBe(true);

    // World: Blackout darkens the windows; leaving the sandbox brings them back.
    await openTab(page, 'world');
    await page.getByTestId('btn-blackout').click();
    await expect(page.getByTestId('btn-blackout')).toHaveClass(/primary/);
    await page.screenshot({ path: testInfo.outputPath('sandbox-world.png') });
    await closePhone(page);
    await expect.poll(async () => (await sky(page))?.windowFactor ?? 1, { timeout: 30_000 }).toBeLessThan(0.5);
    await page.evaluate(() => (window as unknown as W).__dvBridge.engine.modes.send({ t: 'mode.quit' }));
    await expect.poll(async () => (await sky(page))?.windowFactor, { timeout: 30_000 }).toBe(1);

    // Clean run: no page error, no refusal toast.
    await expect(page.locator('[data-toast-id="sandbox.refuse.online"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
