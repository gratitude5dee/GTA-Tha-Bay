import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { HOME, NO_BYPASS, passGates } from './helpers.ts';

/**
 * M04b1 AC-3, AC-4, AC-5 (@ui-menus). The flow title, main, settings, controls, back, modes, back by keyboard only, then by a simulated
 * standard-mapping gamepad (chromium-webgl2), and by taps in the iPhone-landscape design fixture (webkit-webgl2, every tapped target at
 * least 44 x 44 CSS px). Also the Terms card (toggles default on, decline returns to Title) and the Pause lock on the Controls page.
 */
test.use({ storageState: NO_BYPASS, locale: 'en-US' });
test.describe.configure({ timeout: 150_000 });

const fixture = JSON.parse(readFileSync(new URL('../../../packages/ui/test/fixtures/iphone-landscape.json', import.meta.url), 'utf8')) as {
  viewport: { width: number; height: number };
};

/** The element that has focus: its test id, and whether the browser draws a focus ring on it. */
async function focused(page: Page): Promise<{ id: string; ring: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { id: '', ring: false };
    const cs = getComputedStyle(el);
    return { id: el.dataset['testid'] ?? el.dataset['fid'] ?? el.tagName, ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 };
  });
}

interface Driver {
  down(): Promise<void>;
  up(): Promise<void>;
  accept(): Promise<void>;
  back(): Promise<void>;
}

const keyboard = (page: Page): Driver => ({
  down: () => page.keyboard.press('ArrowDown'),
  up: () => page.keyboard.press('ArrowUp'),
  accept: () => page.keyboard.press('Enter'),
  back: () => page.keyboard.press('Escape'),
});

/** A standard-mapping gamepad; the shell polls `navigator.getGamepads()`. A press lasts a fixed time on the page's own clock. */
async function installPad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const until = new Map<number, number>();
    const buttons = Array.from({ length: 17 }, (_, i) => ({
      get pressed() {
        return (until.get(i) ?? 0) > performance.now();
      },
      touched: false,
      value: 0,
    }));
    const pad = { connected: true, mapping: 'standard', id: 'e2e standard pad', index: 0, timestamp: 0, axes: [0, 0, 0, 0], buttons };
    (window as unknown as { __press: (b: number, ms: number) => void }).__press = (b, ms) => void until.set(b, performance.now() + ms);
    navigator.getGamepads = () => [pad as unknown as Gamepad, null, null, null];
  });
}

const pad = (page: Page): Driver => {
  // Press for 120 ms of page time (a tap, never a hold) and wait until the shell's poll has acted on it; try again if a slow frame missed it.
  const tap = async (button: number): Promise<void> => {
    const before = await page.evaluate(() => Number(document.documentElement.dataset['dvPadActs'] ?? '0'));
    for (let attempt = 0; attempt < 12; attempt++) {
      await page.evaluate((b) => (window as unknown as { __press: (b: number, ms: number) => void }).__press(b, 120), button);
      try {
        await page.waitForFunction((n) => Number(document.documentElement.dataset['dvPadActs'] ?? '0') > n, before, { timeout: 2500 });
        await page.waitForTimeout(150);
        return;
      } catch {
        // missed between two frames; press again
      }
    }
    throw new Error(`the shell never acted on pad button ${button}`);
  };
  return { down: () => tap(13), up: () => tap(12), accept: () => tap(0), back: () => tap(1) };
};

/** The focusable controls of the page in document order, by test id. */
async function focusOrder(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#app button, #app a[href], #app input, #app [role="tab"]')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => el.dataset['testid'] ?? el.dataset['fid'] ?? el.tagName),
  );
}

/** Moves focus until the element with `testId` has it (at most 40 steps), checking that a focus ring is drawn at each stop. */
async function focusByDown(page: Page, d: Driver, testId: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const f = await focused(page);
    if (f.id === testId) return;
    if (f.id !== '') expect(f.ring, `a focus ring is drawn on ${f.id}`).toBe(true);
    const order = await focusOrder(page);
    const here = order.indexOf(f.id);
    const there = order.indexOf(testId);
    if (here > there && there >= 0) await d.up();
    else await d.down();
    await page.waitForTimeout(40);
  }
  throw new Error(`focus never reached ${testId}; it is on ${(await focused(page)).id}`);
}

async function menuFlow(page: Page, d: Driver): Promise<void> {
  await focusByDown(page, d, 'nav-settings');
  await d.accept();
  await expect(page.getByTestId('settings')).toBeVisible();
  await focusByDown(page, d, 'settings-cat-controls');
  await d.accept();
  await expect(page.getByTestId('controls')).toBeVisible();
  await d.back();
  await expect(page.getByTestId('main')).toBeVisible();
  await focusByDown(page, d, 'nav-modes');
  await d.accept();
  await expect(page.locator('[data-screen="modes"]')).toBeVisible();
  await d.back();
  await expect(page.getByTestId('main')).toBeVisible();
}

/** Gates passed once, then a fresh load is a returning player who lands on the main menu one gesture later. */
async function toMainAsReturning(page: Page): Promise<void> {
  await page.goto(HOME);
  await passGates(page);
  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
}

test.describe('menus @ui-menus', () => {
  test('the Terms card: both toggles default on, decline returns to Title, accept opens the menu and a reload lands on Title then the menu', async ({ page }) => {
    await page.goto(HOME);
    await page.getByTestId('title-start').click();
    await page.getByTestId('age-month').fill('1');
    await page.getByTestId('age-day').fill('1');
    await page.getByTestId('age-year').fill('1990');
    await page.getByTestId('age-continue').click();
    await expect(page.getByTestId('terms')).toBeVisible();
    await expect(page.getByTestId('consent-diagnostics')).toBeChecked();
    await expect(page.getByTestId('consent-analytics')).toBeChecked();
    await expect(page.getByTestId('terms-disclaimer')).toContainText('Not affiliated');
    // Declining goes back to Title and nothing is recorded as accepted.
    await page.getByTestId('terms-decline').click();
    await expect(page.getByTestId('title')).toBeVisible();
    await page.getByTestId('title-start').click();
    await expect(page.getByTestId('terms')).toBeVisible();
    // Turn analytics off, accept; the choice lands in the device settings.
    await page.getByTestId('consent-analytics').uncheck();
    await page.getByTestId('terms-accept').click();
    await expect(page.getByTestId('main')).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              new Promise<unknown>((res) => {
                const r = indexedDB.open('dv-platform');
                r.onsuccess = () => {
                  try {
                    const g = r.result.transaction('settings', 'readonly').objectStore('settings').get('current');
                    g.onsuccess = () => res((g.result as { telemetryConsent?: unknown } | undefined)?.telemetryConsent ?? null);
                    g.onerror = () => res(null);
                  } catch {
                    res(null);
                  }
                };
                r.onerror = () => res(null);
              }),
          ),
        { timeout: 60_000 },
      )
      .toEqual({ diagnostics: true, analytics: false });

    await page.reload();
    await expect(page.getByTestId('title')).toBeVisible();
    await page.getByTestId('title-start').click();
    await expect(page.getByTestId('main')).toBeVisible();
  });

  test('keyboard only: title, main, settings, controls, back, modes, back; every step shows a focus ring and Escape pops the page @ui-menus', async ({ page }) => {
    await toMainAsReturning(page);
    const d = keyboard(page);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('main')).toBeVisible();
    await menuFlow(page, d);
  });

  test('gamepad: the same flow with a simulated standard-mapping pad @ui-menus', async ({ page }) => {
    await installPad(page);
    await toMainAsReturning(page);
    // The first gesture on Title is the pad's A button.
    const d = pad(page);
    await page.getByTestId('title-start').focus();
    await d.accept();
    await expect(page.getByTestId('main')).toBeVisible();
    await menuFlow(page, d);
  });

  test('Pause cannot be rebound: the row is locked, and a rebound Jump shows its new key @ui-menus', async ({ page }) => {
    await toMainAsReturning(page);
    await page.keyboard.press('Enter');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-cat-controls').click();
    await expect(page.getByTestId('lock-client.Pause').first()).toBeVisible();
    await expect(page.getByTestId('bind-onFoot-client.Pause-0')).toHaveCount(0);
    await expect(page.getByTestId('bind-onFoot-client.Pause-1')).toHaveCount(0);
    // Rebind Jump to H.
    await page.getByTestId('bind-onFoot-sim.Jump-0').click();
    await expect(page.getByTestId('bind-onFoot-sim.Jump-0')).toContainText('Press a key');
    await page.keyboard.press('KeyH');
    await expect(page.getByTestId('bind-onFoot-sim.Jump-0')).toHaveText(/: H$/);
    // Escape during a capture cancels it and leaves the binding alone.
    await page.getByTestId('bind-onFoot-sim.Sprint-0').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('bind-onFoot-sim.Sprint-0')).toHaveText(/: Shift Left$/);
  });
});

test.describe('touch @ui-menus', () => {
  test.use({ hasTouch: true, viewport: fixture.viewport, isMobile: false });

  test('the same flow by taps in the iPhone-landscape design fixture; every tapped target is at least 44 x 44 CSS px @ui-menus', async ({ page }) => {
    const taps: { id: string; w: number; h: number }[] = [];
    const tap = async (testId: string): Promise<void> => {
      const loc = page.getByTestId(testId).first();
      await expect(loc).toBeVisible();
      await loc.scrollIntoViewIfNeeded();
      const box = (await loc.boundingBox())!;
      taps.push({ id: testId, w: box.width, h: box.height });
      await loc.tap();
    };
    await page.goto(HOME);
    await tap('title-start');
    await page.getByTestId('age-month').fill('1');
    await page.getByTestId('age-day').fill('1');
    await page.getByTestId('age-year').fill('1990');
    await tap('age-continue');
    await tap('terms-accept');
    await expect(page.getByTestId('main')).toBeVisible();
    await tap('nav-settings');
    await expect(page.getByTestId('settings')).toBeVisible();
    await tap('settings-cat-controls');
    await expect(page.getByTestId('controls')).toBeVisible();
    await tap('settings-back');
    await expect(page.getByTestId('main')).toBeVisible();
    await tap('nav-modes');
    await expect(page.locator('[data-screen="modes"]')).toBeVisible();
    await tap('btn-back');
    await expect(page.getByTestId('main')).toBeVisible();
    for (const t of taps) {
      expect(t.w, `${t.id} width`).toBeGreaterThanOrEqual(44);
      expect(t.h, `${t.id} height`).toBeGreaterThanOrEqual(44);
    }
  });
});
