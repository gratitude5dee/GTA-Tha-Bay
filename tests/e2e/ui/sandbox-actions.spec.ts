import { expect as baseExpect, test, type Page } from '@playwright/test';
import type { WorldBridge } from '../../../packages/world/src/client/world-bridge.ts';
import { observe, SMALL_VIEWPORT, waitForEngine } from '../engine-helpers.ts';
import { hideQaPanels } from './helpers.ts';

/**
 * M04e4 AC-9 (@sandbox-actions): the Sandbox app's Player tab and the car actions of the Cars tab on the synth world (the QA play
 * bypass starts the sandbox; this tag runs in the `DV_WORLD=synth` half, so it is not in GRAYBOX_GREP). To see it by hand: a QA build
 * with `DV_WORLD=synth` (`pnpm dev`), open `/?tier=mobile-low`, press Escape, then Phone, then Sandbox. On the "Player" tab press
 * "Big jumps: off" (it reads "on"), close the phone and press Space: the jump is four metres high. "Can't get hurt" and "Patch me up"
 * sit under it. On the "Cars" tab, "Put one here and drive" under any car, then "Fix it up", "Back on its wheels" (at rest) and, after
 * stepping out, "Send this one away". Quitting the sandbox and starting it again turns all three toggles off.
 */
/** Web assertions get 30 s instead of 5 s: a loaded CI runner answers one page query in about a second (BD-M04e2-08). */
const expect = baseExpect.configure({ timeout: 30_000 });

type Bridge = {
  world: WorldBridge;
  engine: {
    modes: { send(c: object): boolean; quit(): boolean; vm(k: string): unknown };
    vehicleOp(op: string, target?: number): Promise<VehicleReply | null>;
  };
};
type W = { __dvBridge: Bridge; __dvPeak?: { y: number; stop(): void } };
interface VehicleReply {
  ok: boolean;
  player?: { driving: boolean };
  vehicle: { handle: number; speed: number; body: number; handling: string | null; pos: [number, number, number] } | null;
}
interface PlayerVm {
  godMode: boolean;
  superJump: boolean;
  carNoDamage: boolean;
  car: string;
  online: boolean;
}

async function bootSynth(page: Page): Promise<void> {
  await hideQaPanels(page);
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto('/?tier=mobile-low');
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 180_000 });
  await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 120_000 }).toBe(true);
}

async function openTab(page: Page, tab: 'player' | 'vehicles'): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('btn-pause-resume')).toBeVisible();
  await expect(async () => {
    if (!(await page.getByTestId('phone').isVisible())) await page.getByTestId('btn-pause-phone').click({ timeout: 20_000 });
    await page.getByTestId('row-phone-apps-sandbox').click({ timeout: 20_000 });
  }).toPass({ timeout: 180_000 });
  await page.getByTestId(`tab-sandbox-tabs-${tab}`).click();
}

async function closePhone(page: Page): Promise<void> {
  await page.getByTestId('btn-phone-home').click();
  await page.getByTestId('btn-phone-close').click();
  await page.getByTestId('btn-pause-resume').click();
}

const state = (page: Page, target?: number): Promise<VehicleReply | null> =>
  page.evaluate((t) => (window as unknown as W).__dvBridge.engine.vehicleOp('state', t), target);
const playerVm = (page: Page): Promise<PlayerVm | null> =>
  page.evaluate(() => (window as unknown as W).__dvBridge.engine.modes.vm('mode.sandbox.player') as PlayerVm | null);

/** Presses Space once and returns how far above `y0` the feet got within 2 s (sampled in the page, every 16 ms). */
async function jumpPeak(page: Page, y0: number): Promise<number> {
  await page.evaluate((base) => {
    const w = window as unknown as W & { __dvBridge: { engine: { observe(): { player?: { pos: number[] } } } } };
    const peak = { y: 0, stop: () => clearInterval(id) };
    const id = setInterval(() => {
      const p = w.__dvBridge.engine.observe().player;
      if (p) peak.y = Math.max(peak.y, p.pos[1]! - base);
    }, 16);
    w.__dvPeak = peak;
  }, y0);
  await page.keyboard.press('Space');
  await page.waitForTimeout(2_000);
  return page.evaluate(() => {
    const peak = (window as unknown as W).__dvPeak!;
    peak.stop();
    return peak.y;
  });
}

test.describe('sandbox player and car actions @sandbox-actions', () => {
  test.describe.configure({ timeout: 900_000 });

  test('big jumps, car actions, dismiss and the reset on quit @sandbox-actions', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await bootSynth(page);
    await expect(page.getByTestId('hud')).toBeVisible();
    const y0 = (await observe(page)).player!.pos[1];

    // big jumps on: the apex is 4 m (at least 3 m is asserted)
    await openTab(page, 'player');
    await expect(page.getByTestId('btn-sandbox-godmode')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('sandbox-player-tab.png') });
    await page.getByTestId('btn-sandbox-superjump').click();
    await expect.poll(async () => (await playerVm(page))?.superJump, { timeout: 30_000 }).toBe(true);
    await closePhone(page);
    const big = await jumpPeak(page, y0);
    expect(big).toBeGreaterThanOrEqual(3.0);
    await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 30_000 }).toBe(true);

    // big jumps off: back to the usual jump
    await openTab(page, 'player');
    await page.getByTestId('btn-sandbox-superjump').click();
    await expect.poll(async () => (await playerVm(page))?.superJump, { timeout: 30_000 }).toBe(false);
    await closePhone(page);
    const ground = (await observe(page)).player!.pos[1];
    const small = await jumpPeak(page, ground);
    expect(small).toBeLessThan(1.5);
    await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 30_000 }).toBe(true);

    // a car: place and drive, then fix it and set it upright at rest
    await openTab(page, 'vehicles');
    await page.getByTestId('btn-car-kestrel-quill-drive').click();
    await closePhone(page);
    await expect
      .poll(async () => ((await state(page))?.player?.driving === true ? (await state(page))?.vehicle?.handling : null), { timeout: 30_000, intervals: [250, 500] })
      .toBe('hp.kestrel-quill');
    const handle = (await state(page))!.vehicle!.handle;
    await expect.poll(async () => (await playerVm(page))?.car, { timeout: 30_000 }).toBe('driving');
    await openTab(page, 'vehicles');
    await expect(page.getByTestId('btn-car-repair')).toBeEnabled();
    await page.getByTestId('btn-car-repair').click();
    await page.getByTestId('btn-car-upright').click();
    await page.screenshot({ path: testInfo.outputPath('sandbox-car-actions.png') });
    await closePhone(page);
    await page.waitForTimeout(1_000);
    await expect(page.locator('[data-toast-id^="sandbox.refuse."]')).toHaveCount(0);
    expect((await state(page, handle))?.vehicle?.body).toBe(1);

    // dismiss: step out, then send it away
    await page.evaluate(() => (window as unknown as W).__dvBridge.engine.vehicleOp('exit'));
    await expect.poll(async () => (await playerVm(page))?.car, { timeout: 30_000 }).toBe('near');
    await openTab(page, 'vehicles');
    await expect(page.getByTestId('btn-car-dismiss')).toBeEnabled();
    await page.getByTestId('btn-car-dismiss').click();
    await closePhone(page);
    await expect.poll(async () => (await state(page, handle))?.vehicle ?? null, { timeout: 2_000 + 30_000, intervals: [250, 500] }).toBeNull();

    // reset: every toggle on, quit, start again, all three read off
    for (const path of ['sandbox.player.godMode', 'sandbox.player.superJump', 'sandbox.vehicle.noDamage']) {
      await page.evaluate((p) => (window as unknown as W).__dvBridge.engine.modes.send({ t: 'sandbox.set', path: p, v: true }), path);
    }
    await expect.poll(async () => await playerVm(page), { timeout: 30_000 }).toMatchObject({ godMode: true, superJump: true, carNoDamage: true });
    await page.evaluate(() => (window as unknown as W).__dvBridge.engine.modes.quit());
    await page.evaluate(() => (window as unknown as W).__dvBridge.engine.modes.send({ t: 'mode.start', id: 'sandbox' }));
    await expect.poll(async () => await playerVm(page), { timeout: 60_000 }).toMatchObject({ godMode: false, superJump: false, carNoDamage: false });
    expect(errors).toEqual([]);
  });
});
