import { expect, test, type Page } from '@playwright/test';
import { observe, waitForEngine } from './engine-helpers.ts';

/**
 * M07a1 AC-11: the racing touch layout on a phone-sized touch viewport. The bridge starts the QA demo sprint with the supercar
 * (`qa.demo.straight`, 180 m north along the gray-box street at x = 96); the
 * right pedal is held 3 s, the steer arc is dragged, nitro is tapped and reset is held 1 s.
 *
 * To see it by hand: open `/?racing=demo&touch=1&debug=1` on a QA build (a phone, or a desktop browser in device mode).
 */
test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

type Kind = 'down' | 'move' | 'up';
interface RaceState {
  ok: boolean;
  state?: { tick: number; phase: string; gate: number; s: number; speedMps: number; nitroOn: boolean; nitro: number; car: { yaw: number; speedMps: number } | null };
  log?: { t: string; tick: number; n?: number }[];
}

/** One contact event on the element at `selector`, as the binder reads it (Pointer Events of type touch). */
async function touch(page: Page, kind: Kind, id: number, x: number, y: number, selector: string): Promise<void> {
  await page.evaluate(
    ({ kind, id, x, y, selector }) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) throw new Error(`no element ${selector}`);
      const type = kind === 'down' ? 'pointerdown' : kind === 'move' ? 'pointermove' : 'pointerup';
      el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true }));
    },
    { kind, id, x, y, selector },
  );
}

/** The TouchEvent fallback for engines whose synthetic PointerEvents lose their pointerType. */
async function touchEvent(page: Page, kind: Kind, id: number, x: number, y: number, selector: string): Promise<void> {
  await page.evaluate(
    ({ kind, id, x, y, selector }) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) throw new Error(`no element ${selector}`);
      const type = kind === 'down' ? 'touchstart' : kind === 'move' ? 'touchmove' : 'touchend';
      const t = new Touch({ identifier: id, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent(type, { touches: kind === 'up' ? [] : [t], targetTouches: kind === 'up' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
    },
    { kind, id, x, y, selector },
  );
}

const racing = <T>(page: Page, expr: string): Promise<T> => page.evaluate(`(async () => { const r = window.__dvBridge.racing; return ${expr}; })()`) as Promise<T>;
const state = (page: Page): Promise<RaceState> => racing<RaceState>(page, 'r.state()');

test.describe('racing touch layout @racing-touch', () => {
  test('pedal, steer arc, nitro and reset drive the car @racing-touch', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?racing=1&touch=1&debug=1');
    await waitForEngine(page);
    await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 90_000 }).toBe(true);
    await page.waitForFunction(() => Boolean((window as unknown as { __dvBridge?: { racing?: unknown } }).__dvBridge?.racing), undefined, { timeout: 30_000 });

    // The bridge starts the sprint; the mode loads, the car is seated and the grid is held until the countdown.
    const started = await racing<{ ok: boolean }>(page, "r.start('qa.demo.straight', { vehicle: 'vehicle.aurelian-sorrel' })");
    expect(started?.ok).toBe(true);
    await expect.poll(async () => (await state(page)).state?.car != null, { timeout: 90_000 }).toBe(true);
    await racing(page, "r.cmd('ready')");
    await expect.poll(async () => (await state(page)).state?.phase, { timeout: 30_000 }).toBe('Running');

    // The racing layout replaced the walking one.
    await expect(page.locator('.dv-touch')).toBeVisible();
    await expect(page.locator('.dv-touch')).toHaveAttribute('data-layout', 'vehicle-racing');
    await expect(page.locator('[data-dv-btn="gas"]')).toBeVisible();
    await expect(page.locator('[data-dv-btn="jump"]')).toHaveCount(0);

    // Does this engine give synthetic PointerEvents their pointerType? If not, use TouchEvents for the rest.
    const pointerOk = await page.evaluate(() => new PointerEvent('pointerdown', { pointerType: 'touch' }).pointerType === 'touch');
    const send = pointerOk ? touch : touchEvent;

    // 1. the right pedal for 3 s
    const yaw0 = (await state(page)).state?.car?.yaw ?? 0;
    await send(page, 'down', 1, 760, 320, '[data-dv-btn="gas"]');
    // 2. the steer arc: a contact in the left half dragged right for a moment (a short, gentle turn keeps the car on the street)
    await page.waitForTimeout(800);
    await send(page, 'down', 2, 120, 250, '.dv-touch');
    await send(page, 'move', 2, 140, 250, '.dv-touch');
    await page.waitForTimeout(400);
    const turning = (await state(page)).state?.car?.yaw ?? 0;
    await send(page, 'move', 2, 120, 250, '.dv-touch');
    await send(page, 'up', 2, 120, 250, '.dv-touch');
    await page.waitForTimeout(1800);
    const run = (await state(page)).state;
    expect(run?.speedMps ?? 0, 'speed after 3 s of throttle').toBeGreaterThan(30 / 3.6);
    const dyaw = Math.abs(Math.atan2(Math.sin(turning - yaw0), Math.cos(turning - yaw0)));
    expect(dyaw, 'yaw changed by the steer arc').toBeGreaterThan(0.01);

    // 3. nitro: fill the tank (QA shortcut for a drift or a perfect start) and tap the button
    await racing(page, 'r.fillNitro(60)');
    await send(page, 'down', 3, 700, 220, '[data-dv-btn="nitro"]');
    await expect.poll(async () => (await state(page)).state?.nitroOn, { timeout: 5000 }).toBe(true);
    await send(page, 'up', 3, 700, 220, '[data-dv-btn="nitro"]');
    await send(page, 'up', 1, 760, 320, '[data-dv-btn="gas"]');

    // 4. reset held for 1 s puts the car back on the last gate
    const before = (await state(page)).log?.filter((e) => e.t === 'race.respawn').length ?? 0;
    await send(page, 'down', 4, 800, 100, '[data-dv-btn="reset"]');
    await page.waitForTimeout(1300);
    await send(page, 'up', 4, 800, 100, '[data-dv-btn="reset"]');
    await expect.poll(async () => (await state(page)).log?.filter((e) => e.t === 'race.respawn').length ?? 0, { timeout: 10_000 }).toBeGreaterThan(before);
    await expect.poll(async () => ((await state(page)).state?.car?.speedMps ?? 99) * 3.6, { timeout: 10_000 }).toBeLessThan(10);

    await page.screenshot({ path: testInfo.outputPath('racing-touch.png') });
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
