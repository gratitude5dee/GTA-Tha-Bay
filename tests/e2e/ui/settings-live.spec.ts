import { readFileSync } from 'node:fs';
import { expect as baseExpect, test, type Page } from '@playwright/test';
import { SMALL_VIEWPORT, waitForEngine } from '../engine-helpers.ts';
import { hideQaPanels } from './helpers.ts';

/**
 * M04b5: the Graphics rows do something (@ui-settings-live) and full screen (@ui-fullscreen). Neither needs the baked world, so they run
 * in the synth half of CI. To see it by hand: a QA build with `DV_WORLD=synth` (`pnpm dev`), open `/?play=sandbox`, press Escape, then
 * Settings (Graphics): the frame-cap row is greyed with its reason; pick 50 % and the picture softens at once, Auto sharpens it; turn on
 * "Show frame rate" and a number appears at the top right and stays after Resume; in desktop Chrome, Pause has a Full screen button.
 * In the console, `new BroadcastChannel('dv-shell').onmessage = (e) => console.log(e.data)` logs one `{kind:'fps'}` line a second.
 */
const expect = baseExpect.configure({ timeout: 30_000 });
const messages = JSON.parse(readFileSync(new URL('../../../content/ui/i18n/en.json', import.meta.url), 'utf8')) as Record<string, string>;
/** The small `walk-drop` scene: these specs look at pages and the drawing buffer, not at the city. */
const HOME = '/?world=walk-drop';

interface Resolution {
  cssW: number;
  cssH: number;
  dpr: number;
  pixelRatio: number;
  budgetRatio: number;
}
type Bridge = { __dvBridge: { platform: { resolution(): Resolution } } };

const resolution = (page: Page): Promise<Resolution> => page.evaluate(() => (window as unknown as Bridge).__dvBridge.platform.resolution());

async function boot(page: Page): Promise<void> {
  await hideQaPanels(page);
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto(HOME);
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as Partial<Bridge>).__dvBridge?.platform !== undefined, undefined, { timeout: 120_000 });
}

/** Escape pauses; Settings opens on Graphics. */
async function openGraphics(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('btn-pause-resume')).toBeVisible();
  await page.getByTestId('btn-pause-settings').click();
  await expect(page.getByTestId('settings')).toHaveAttribute('data-cat', 'graphics');
}

async function resume(page: Page): Promise<void> {
  await page.getByTestId('settings-back').click();
  await page.getByTestId('btn-pause-resume').click();
}

test.describe('settings that do something @ui-settings-live', () => {
  test('render scale sizes the canvas inside the tier budget, the frame cap says why not, the FPS chip and the shell signals work @ui-settings-live', async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await boot(page);

    // A listener opened before anything changes: one `fps` signal a second, never more than two in any second.
    await page.evaluate(() => {
      const w = window as unknown as { __sig: Array<{ at: number; msg: { kind?: string; ref?: string; v?: number } }> };
      w.__sig = [];
      const ch = new BroadcastChannel('dv-shell');
      ch.onmessage = (e) => w.__sig.push({ at: performance.now(), msg: e.data });
    });

    // AC-8: the play view carries the hooks.
    await expect(page.getByTestId('hud-wallet-value')).toHaveAttribute('data-ui-skip', '');
    await expect(page.getByTestId('hud-wallet-value')).toHaveAttribute('translate', 'no');
    await expect(page.getByTestId('hud-clock')).toHaveAttribute('data-ui-skip', '');
    await expect(page.getByTestId('hud-clock')).toHaveAttribute('translate', 'no');
    await expect(page.locator('#dv-engine')).toHaveAttribute('data-ui-skip', '');
    await expect(page.locator('#dv-engine')).toHaveAttribute('translate', 'no');
    await expect(page.getByTestId('fps-chip')).toHaveCount(0);

    // AC-3 in the page: the frame-cap row is greyed and says why.
    await openGraphics(page);
    const fps30 = page.getByTestId('choice-fps-1');
    await expect(fps30).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('reason-fps')).toHaveText(messages['settings.graphics.fps.later'] as string);
    await fps30.click({ force: true });
    await expect(page.getByTestId('choice-fps-0')).toHaveAttribute('aria-checked', 'true');

    // AC-2: 50 % scales the drawing buffer inside the tier budget.
    const before = await resolution(page);
    expect(before.pixelRatio).toBeCloseTo(before.budgetRatio, 6);
    await page.getByTestId('choice-scale-1').click();
    await expect.poll(async () => (await resolution(page)).pixelRatio, { timeout: 30_000 }).toBeCloseTo(Math.max(0.25, before.budgetRatio * 0.5), 6);
    const half = await resolution(page);
    const canvasWidth = await page.evaluate(() => (document.querySelector('#dv-engine canvas') as HTMLCanvasElement).width);
    expect(Math.abs(canvasWidth - Math.floor(half.cssW * half.pixelRatio))).toBeLessThanOrEqual(1);
    expect(half.pixelRatio).toBeLessThanOrEqual(half.budgetRatio + 1e-9);

    // AC-4: the chip appears in the menu and stays after Resume.
    await page.getByTestId('toggle-fps-counter').click();
    await expect(page.getByTestId('fps-chip')).toHaveText(/^\d+ fps$/, { timeout: 30_000 });
    expect(await page.getByTestId('fps-chip').locator('*').count()).toBe(0);
    await expect(page.getByTestId('fps-chip')).toHaveAttribute('data-ui-skip', '');
    await expect(page.getByTestId('fps-chip')).toHaveAttribute('aria-hidden', 'true');

    // Auto, then Resume: the ratio is the tier's own again, and the chip is still there.
    await page.getByTestId('choice-scale-0').click();
    await resume(page);
    await expect.poll(async () => (await resolution(page)).pixelRatio, { timeout: 30_000 }).toBeCloseTo(before.budgetRatio, 6);
    await expect(page.getByTestId('fps-chip')).toHaveText(/^\d+ fps$/);

    // AC-8: over 5 s the channel carries fps signals, at most two in any second.
    await page.waitForTimeout(5_000);
    const sig = await page.evaluate(() => (window as unknown as { __sig: Array<{ at: number; msg: { kind?: string; ref?: string } }> }).__sig);
    const fps = sig.filter((s) => s.msg.kind === 'fps').map((s) => s.at);
    expect(fps.length).toBeGreaterThanOrEqual(1);
    for (const at of fps) expect(fps.filter((x) => x >= at && x < at + 1000).length).toBeLessThanOrEqual(2);
    // The writes above were signalled: the scale twice, the counter once, and each carries the version.
    const refs = sig.filter((s) => s.msg.kind === 'setting').map((s) => s.msg.ref);
    expect(refs.filter((r) => r === 'device:renderScale')).toHaveLength(2);
    expect(refs).toContain('ui:showFps');
    expect(sig.every((s) => s.msg.v === 1)).toBe(true);

    // The chip leaves when the switch goes off.
    await openGraphics(page);
    await page.getByTestId('toggle-fps-counter').click();
    await expect(page.getByTestId('fps-chip')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('full screen @ui-fullscreen', () => {
  test('without the Fullscreen API there is no button @ui-fullscreen', async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => {
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => false });
    });
    await boot(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('btn-pause-resume')).toBeVisible();
    await expect(page.getByTestId('btn-pause-fullscreen')).toHaveCount(0);
    await page.getByTestId('btn-pause-settings').click();
    await expect(page.getByTestId('settings')).toHaveAttribute('data-cat', 'graphics');
    await expect(page.getByTestId('btn-fullscreen')).toHaveCount(0);
  });

  test('with it, one click requests full screen once and the label follows the change @ui-fullscreen', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the stubbed Fullscreen API runs on chromium; webkit-webgl2 covers the absent case');
    test.setTimeout(240_000);
    await page.addInitScript(() => {
      const w = window as unknown as { __fs: { requests: number; exits: number } };
      w.__fs = { requests: 0, exits: 0 };
      let current: Element | null = null;
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => current });
      Element.prototype.requestFullscreen = function (this: Element) {
        w.__fs.requests += 1;
        current = this;
        document.dispatchEvent(new Event('fullscreenchange'));
        return Promise.resolve();
      };
      document.exitFullscreen = () => {
        w.__fs.exits += 1;
        current = null;
        document.dispatchEvent(new Event('fullscreenchange'));
        return Promise.resolve();
      };
    });
    await boot(page);
    await openGraphics(page);
    const button = page.getByTestId('btn-fullscreen');
    await expect(button).toContainText(messages['settings.fullscreen.enter'] as string);
    await button.click();
    await expect(button).toContainText(messages['settings.fullscreen.exit'] as string);
    expect(await page.evaluate(() => (window as unknown as { __fs: { requests: number; exits: number } }).__fs)).toEqual({ requests: 1, exits: 0 });
    await button.click();
    await expect(button).toContainText(messages['settings.fullscreen.enter'] as string);
    expect(await page.evaluate(() => (window as unknown as { __fs: { requests: number; exits: number } }).__fs)).toEqual({ requests: 1, exits: 1 });
    // Pause carries the same control.
    await page.getByTestId('settings-back').click();
    await expect(page.getByTestId('btn-pause-fullscreen')).toContainText(messages['settings.fullscreen.enter'] as string);
  });
});
