import { expect, test } from '@playwright/test';
import { observe, SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

// IWER emulating a Quest 3 (?xr-emulate=quest3 installs it before the renderer, F-062). The project `xr-quest3` runs @xr specs only.
test.describe('XR smoke @xr @xr-smoke', () => {
  test('Enter VR (smoke) presents, renders XR frames, runs the sim, and exiting returns to the flat page @xr @xr-smoke', async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?xr-emulate=quest3&debug=1');
    await waitForEngine(page);
    await expect.poll(async () => (await observe(page)).world?.chunks, { timeout: 90_000 }).toBe(4);
    await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 60_000 }).toBe(true);

    const button = page.locator('[data-dv-xr-smoke]');
    await expect(button).toBeVisible({ timeout: 30_000 });
    expect((await observe(page)).xr).toMatchObject({ supported: true, presenting: false });
    const flat = await observe(page);

    await button.click();
    await expect.poll(async () => (await observe(page)).xr?.presenting, { timeout: 30_000 }).toBe(true);
    const entered = await observe(page);
    await expect.poll(async () => ((await observe(page)).xr?.frames ?? 0) - (entered.xr?.frames ?? 0), { timeout: 30_000 }).toBeGreaterThanOrEqual(10);
    const during = await observe(page);
    expect(during.camera?.mode).toBe('xr');
    expect(during.camera?.locked).toBe(true);
    expect(during.xr?.sessions).toBe(1);
    await expect.poll(async () => (await observe(page)).tick - entered.tick, { timeout: 30_000 }).toBeGreaterThanOrEqual(10);
    // The player is where it was: the headset does not move the sim.
    const p0 = flat.player!.pos;
    const p1 = (await observe(page)).player!.pos;
    expect(Math.hypot(p1[0] - p0[0], p1[2] - p0[2])).toBeLessThan(0.5);

    // End the session as the system menu would.
    await page.evaluate(() => (window as unknown as { __dvBridge: { engine: { endXr(): Promise<void> } } }).__dvBridge.engine.endXr());
    await expect.poll(async () => (await observe(page)).xr?.presenting, { timeout: 30_000 }).toBe(false);
    await expect.poll(async () => (await observe(page)).camera?.mode, { timeout: 10_000 }).toBe('tp');
    const back = await observe(page);
    await expect.poll(async () => (await observe(page)).frames - back.frames, { timeout: 15_000 }).toBeGreaterThanOrEqual(10);
    expect(errors.filter((e) => !/favicon|manifest/i.test(e))).toEqual([]);
  });
});
