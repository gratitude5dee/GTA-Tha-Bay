import { expect, test, type Page } from '@playwright/test';
import { observe, SMALL_VIEWPORT, waitForEngine } from '../engine-helpers.ts';

/**
 * M04b2 AC-11 (@xr): a test `ScreenDef` panel made through `UiSurface` under IWER emulating a Quest 3 (`?xr-emulate=quest3`). It opens at
 * the default 1.2 m in front of the head with a `world` anchor, a simulated ray press activates its button, its text is at least 1.5
 * degrees of visual angle, and it redraws only after a view-model change.
 */
interface PanelState {
  open: boolean;
  anchor: string;
  distanceM: number;
  openDistanceM: number;
  minTextDeg: number;
  redraws: number;
  uploads: number;
  presses: number;
  counter: number;
  sizeM: { w: number; h: number };
  pixels: { w: number; h: number };
}
type UiBridge = { open(): PanelState; press(): boolean; bump(): number; state(): PanelState | null; close(): void };
const ui = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`window.__dvBridge.ui.${fn}`) as Promise<T>;

test.describe('XR UI panel skeleton @xr @xr-panel', () => {
  test('a ScreenDef panel opens 1.2 m away on a world anchor, a ray press works, text is 1.5 degrees, it redraws only after a view-model change @xr @xr-panel', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?xr-emulate=quest3&debug=1');
    await waitForEngine(page);
    await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 90_000 }).toBe(true);
    await page.waitForFunction(() => Boolean((window as unknown as { __dvBridge?: { ui?: UiBridge } }).__dvBridge?.ui), undefined, { timeout: 60_000 });

    // Into the immersive session, as the smoke button does.
    const button = page.locator('[data-dv-xr-smoke]');
    await expect(button).toBeVisible({ timeout: 30_000 });
    await button.click();
    await expect.poll(async () => (await observe(page)).xr?.presenting, { timeout: 30_000 }).toBe(true);

    const opened = await ui<PanelState>(page, 'open()');
    expect(opened.open).toBe(true);
    expect(opened.anchor).toBe('world');
    // At the default 1.2 m in front of the head (the head has not moved since the panel opened).
    expect(opened.openDistanceM).toBeCloseTo(1.2, 2);
    expect(opened.distanceM).toBeGreaterThan(1.1);
    expect(opened.distanceM).toBeLessThan(1.3);
    // The text: at least 1.5 degrees at 1.2 m with 1,024 px per metre.
    expect(opened.minTextDeg).toBeGreaterThanOrEqual(1.5);
    expect(opened.pixels.w).toBe(1024);
    expect(opened.sizeM.w).toBeCloseTo(1, 2);

    // No redraw while nothing changes.
    await page.waitForTimeout(500);
    const idle = (await ui<PanelState | null>(page, 'state()'))!;
    await page.waitForTimeout(1500);
    const idle2 = (await ui<PanelState | null>(page, 'state()'))!;
    expect(idle2.redraws).toBe(idle.redraws);
    expect(idle2.uploads).toBe(idle.uploads);

    // A simulated ray press activates the button once.
    expect(await ui<boolean>(page, 'press()')).toBe(true);
    await expect.poll(async () => (await ui<PanelState | null>(page, 'state()'))!.presses, { timeout: 10_000 }).toBe(1);
    await expect.poll(async () => (await ui<PanelState | null>(page, 'state()'))!.redraws, { timeout: 10_000 }).toBeGreaterThan(idle2.redraws);
    await page.waitForTimeout(800);
    const afterPress = (await ui<PanelState | null>(page, 'state()'))!;
    await page.waitForTimeout(800);
    expect((await ui<PanelState | null>(page, 'state()'))!.redraws).toBe(afterPress.redraws);

    // A view-model change redraws it, once.
    expect(await ui<number>(page, 'bump()')).toBe(1);
    await expect.poll(async () => (await ui<PanelState | null>(page, 'state()'))!.redraws, { timeout: 10_000 }).toBeGreaterThan(afterPress.redraws);
    await page.waitForTimeout(800);
    const afterBump = (await ui<PanelState | null>(page, 'state()'))!;
    await page.waitForTimeout(800);
    expect((await ui<PanelState | null>(page, 'state()'))!.redraws).toBe(afterBump.redraws);
    expect(afterBump.counter).toBe(1);

    await ui<void>(page, 'close()');
    await page.evaluate(() => (window as unknown as { __dvBridge: { engine: { endXr(): Promise<void> } } }).__dvBridge.engine.endXr());
    await expect.poll(async () => (await observe(page)).xr?.presenting, { timeout: 30_000 }).toBe(false);
    expect(errors.filter((e) => !/favicon|manifest/i.test(e))).toEqual([]);
  });
});
