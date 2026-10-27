import { expect, test, type Page } from '@playwright/test';
import { observe, waitForEngine } from '../engine-helpers.ts';
import { HOME, hideQaPanels, NO_BYPASS, pageNow, passGates, waitForEngineReady, waitForSave } from './helpers.ts';
import { waitTicks } from './sandbox-helpers.ts';

/**
 * M04b2 AC-4 (@ui-touch) and AC-8 (@ui-coach), on WebKit with the iPhone-landscape design fixture (844 x 390). The synthetic contacts go to
 * the touch layer the way tests/e2e/touch.spec.ts sends them (Pointer Events, or Touch Events when WebKit drops `pointerType`).
 */
type Kind = 'down' | 'move' | 'up' | 'cancel';

async function contact(page: Page, kind: Kind, id: number, x: number, y: number, selector = '.dv-touch'): Promise<void> {
  await page.evaluate(
    ({ kind, id, x, y, selector }) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) throw new Error(`no element ${selector}`);
      const type = kind === 'down' ? 'pointerdown' : kind === 'move' ? 'pointermove' : kind === 'up' ? 'pointerup' : 'pointercancel';
      const ev = new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true });
      el.dispatchEvent(ev);
      if (ev.pointerType !== 'touch') {
        // WebKit drops pointerType from a synthetic PointerEvent: send the Touch Event the binder falls back to.
        const tt = kind === 'down' ? 'touchstart' : kind === 'move' ? 'touchmove' : kind === 'up' ? 'touchend' : 'touchcancel';
        const t = new Touch({ identifier: id, target: el, clientX: x, clientY: y });
        el.dispatchEvent(new TouchEvent(tt, { touches: kind === 'up' || kind === 'cancel' ? [] : [t], targetTouches: [], changedTouches: [t], bubbles: true, cancelable: true }));
      }
    },
    { kind, id, x, y, selector },
  );
}

const contacts = async (page: Page): Promise<number> => (await observe(page)).touch?.contacts ?? -1;

/** `CONTROL_STATE.jump`: shown only while the feet rise, about 27 sim ticks for the 1.0 m apex (`config/physics.json`, g 9.81). */
const CONTROL_JUMP = 110;
/** Sim ticks the control log keeps running after the Jump press: the whole jump (about 54 ticks up and down) and more. */
const JUMP_WATCH_TICKS = 120;

type ControlLog = { ticks: number[]; states: number[]; stop: boolean };
type LogBridge = { __dvBridge: { engine: { observe(): { tick: number; player: { control: number } | null } } }; __dvControlLog?: ControlLog };

/**
 * Records the local player's control state from every snapshot the page reads, with that snapshot's sim tick, and returns the tick at the
 * start (BD-FIX-TOUCH-01). The page reads the newest snapshot once a frame and a frame pays the sim for at most 9 ticks, so the log is a
 * frame group or two apart however slow the page or the test runner is: a 27-tick jump cannot fall between two entries. Sampling from the
 * runner instead (one `observe` round trip per loop pass, about 500 ms on a loaded CI runner) skipped the whole rising phase.
 */
async function startControlLog(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as LogBridge;
    const engine = w.__dvBridge.engine;
    const log: ControlLog = { ticks: [], states: [], stop: false };
    w.__dvControlLog = log;
    const read = (): void => {
      if (log.stop) return;
      const o = engine.observe();
      if (o.player && o.tick !== log.ticks[log.ticks.length - 1]) {
        log.ticks.push(o.tick);
        log.states.push(o.player.control);
      }
      requestAnimationFrame(read);
    };
    read();
    return engine.observe().tick;
  });
}

async function stopControlLog(page: Page): Promise<{ ticks: number[]; states: number[] }> {
  return page.evaluate(() => {
    const log = (window as unknown as LogBridge).__dvControlLog!;
    log.stop = true;
    return { ticks: log.ticks, states: log.states };
  });
}

test.describe('touch play @ui-touch', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  test.describe.configure({ timeout: 300_000 });

  test('stick, look and a button register together and a pointercancel releases everything @ui-touch', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?touch=1&world=walk-drop');
    await waitForEngine(page);
    await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 90_000 }).toBe(true);
    await expect(page.locator('.dv-touch')).toBeVisible();
    await expect(page.getByTestId('hud')).toBeVisible();

    const start = (await observe(page)).player!;
    const logFrom = await startControlLog(page);
    await contact(page, 'down', 1, 160, 300); // the stick (left half)
    await contact(page, 'move', 1, 160, 240);
    await contact(page, 'down', 2, 600, 200); // the look zone (right half)
    await contact(page, 'down', 3, 780, 340, '[data-dv-btn="jump"]'); // Jump while both are held
    const pressTick = (await observe(page)).tick;
    for (let i = 0; i < 40; i++) {
      await contact(page, 'move', 2, 600 + i * 3, 200 + i);
      await page.waitForTimeout(40);
    }
    expect(await contacts(page)).toBe(3);
    const mid = (await observe(page)).player!;
    expect(Math.hypot(mid.pos[0] - start.pos[0], mid.pos[2] - start.pos[2])).toBeGreaterThan(1);
    // The jump is judged in sim ticks: the log holds every snapshot the page read from before the press to JUMP_WATCH_TICKS after it.
    await waitTicks(page, pressTick, JUMP_WATCH_TICKS);
    const log = await stopControlLog(page);
    const gaps = log.ticks.slice(1).map((t, i) => t - log.ticks[i]!);
    expect(log.states, `control states from tick ${logFrom} (press at ${pressTick}) to ${log.ticks.at(-1)}, ${log.ticks.length} snapshots, largest gap ${Math.max(0, ...gaps)} ticks: ${[...new Set(log.states)].join(', ')}`).toContain(CONTROL_JUMP);

    // A pointercancel drops every contact and the player stops.
    await contact(page, 'cancel', 1, 160, 240);
    await expect.poll(() => contacts(page), { timeout: 10_000 }).toBe(0);
    await page.waitForTimeout(700);
    const a = (await observe(page)).player!;
    await page.waitForTimeout(500);
    const b = (await observe(page)).player!;
    expect(Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2])).toBeLessThan(0.3);
    expect(errors).toEqual([]);
  });

  test('portrait during play shows the rotate overlay and pauses the sim; portrait in the menu does not @ui-touch', async ({ page }) => {
    await page.goto('/?touch=1&world=walk-drop');
    await waitForEngine(page);
    await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 90_000 }).toBe(true);
    await expect(page.getByTestId('rotate-overlay')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('rotate-overlay')).toBeVisible();
    await page.waitForTimeout(500); // the pause reaches the worker within a few ticks
    const t0 = (await observe(page)).stats.tick;
    await page.waitForTimeout(900);
    const t1 = (await observe(page)).stats.tick;
    expect(t1 - t0).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByTestId('rotate-overlay')).toHaveCount(0);
    await expect.poll(async () => (await observe(page)).stats.tick - t1, { timeout: 15_000 }).toBeGreaterThan(20);
  });
});

test.describe('touch menus and the layout editor @ui-touch', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, storageState: NO_BYPASS, locale: 'en-US' });
  test.describe.configure({ timeout: 300_000 });

  test('portrait in the menu shows no rotate overlay @ui-touch', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(HOME);
    await passGates(page);
    await expect(page.getByTestId('main')).toBeVisible();
    await expect(page.getByTestId('rotate-overlay')).toHaveCount(0);
  });

  test('an edited layout saved as custom:1 survives a reload @ui-touch', async ({ page }) => {
    await hideQaPanels(page);
    await page.goto(HOME);
    await passGates(page);
    await waitForEngineReady(page);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __dvBridge: { engine: { modes: { vm(k: string): unknown } } } }).__dvBridge.engine.modes.vm('sys.controls') != null), { timeout: 90_000 }).toBe(true);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-cat-controls').click();
    await page.getByTestId('tab-controls-device-touch').click();
    await expect(page.getByTestId('touch-section')).toBeVisible();
    await page.getByTestId('touch-edit').click();
    await expect(page.getByTestId('touch-editor')).toBeVisible();
    // Move Jump with the steppers (keyboard operable) and drag Attack.
    await page.getByTestId('touch-edit-w-jump').click();
    const before = Number(await page.getByTestId('touch-val-x').innerText());
    await page.getByTestId('btn-touch-x-plus').click();
    await page.getByTestId('btn-touch-x-plus').click();
    expect(Number(await page.getByTestId('touch-val-x').innerText())).toBe(before + 16);
    const since = await pageNow(page);
    await page.getByTestId('btn-touch-edit-save').click();
    await expect(page.getByTestId('touch-layout-custom:1')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => page.evaluate(() => document.querySelector('.dv-touch')?.getAttribute('data-layout')), { timeout: 30_000 }).toBe('custom:1');
    // The layout id rides the debounced `save.settings`; reload only once the settings write is confirmed (BD-FIX-CI7-F01).
    await waitForSave(page, 'settings', since);

    await page.reload();
    await waitForEngineReady(page);
    await expect.poll(() => page.evaluate(() => document.querySelector('.dv-touch')?.getAttribute('data-layout')), { timeout: 90_000 }).toBe('custom:1');
    const jump = await page.evaluate(() => {
      const b = document.querySelector('.dv-touch [data-dv-btn="jump"]') as HTMLElement;
      return { right: Number.parseFloat(b.style.right.replace(/[^\d.]+/g, ' ').trim().split(' ').pop() ?? '0') };
    });
    expect(jump.right).toBeGreaterThan(0);
  });
});

test.describe('Safari tab coach mark @ui-coach', () => {
  const SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  test.use({ storageState: NO_BYPASS, locale: 'en-US', userAgent: SAFARI_UA, viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  test.describe.configure({ timeout: 300_000 });

  test('the card shows once, stays dismissed after a reload, never shows when standalone, and a throwing localStorage does not break the page @ui-coach', async ({ page }) => {
    await page.addInitScript(() => {
      // A store that throws on every call: the page must not depend on it.
      const boom = (): never => {
        throw new Error('storage disabled');
      };
      try {
        Object.defineProperty(window, 'localStorage', { get: boom, configurable: true });
      } catch {
        // not configurable in this engine: the other checks still run
      }
    });
    await hideQaPanels(page);
    await page.goto(HOME);
    await passGates(page);
    await expect(page.getByTestId('coach-mark')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('coach-close').click();
    await expect(page.getByTestId('coach-mark')).toHaveCount(0);
    // Open the menu a second time: not shown again.
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings')).toBeVisible();
    await page.getByTestId('settings-back').click();
    await expect(page.getByTestId('main')).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('coach-mark')).toHaveCount(0);
    // After a reload it stays dismissed.
    await page.waitForTimeout(1500);
    await page.reload();
    await page.getByTestId('title-start').click();
    await expect(page.getByTestId('main')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    await expect(page.getByTestId('coach-mark')).toHaveCount(0);
  });

  test('a standalone Home Screen app never shows it @ui-coach', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    });
    await page.goto(HOME);
    await passGates(page);
    await expect(page.getByTestId('main')).toBeVisible();
    await page.waitForTimeout(4000);
    await expect(page.getByTestId('coach-mark')).toHaveCount(0);
  });
});
