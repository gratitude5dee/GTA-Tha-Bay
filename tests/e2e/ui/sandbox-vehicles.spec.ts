import { expect as baseExpect, test, type Page } from '@playwright/test';
import type { WorldBridge } from '../../../packages/world/src/client/world-bridge.ts';
import { observe } from '../engine-helpers.ts';
import { bootSandbox, closeSandboxPhone as closePhone, openSandboxTab, waitTicks } from './sandbox-helpers.ts';

/**
 * M04e3 AC-10 (@sandbox-vehicles): the Sandbox app's Cars tab on the synth world (the QA play bypass starts the sandbox; this tag runs in
 * the `DV_WORLD=synth` half, so it is not in GRAYBOX_GREP). To see it by hand: a QA build with `DV_WORLD=synth` (`pnpm dev`), open
 * `/?tier=mobile-low`, face a street, press Escape, then Phone, then Sandbox, then the "Cars" tab. Pick "Put one here and drive" under
 * any car (try "Kestrel Quill" in "Lively"): the car appears 6 to 12 m ahead on the road and you are at its wheel. "Put one here" parks
 * it and leaves you on foot. "Send my cars away" removes them all (the car you drive leaves once you are out).
 */
/** Web assertions get 30 s instead of 5 s: a loaded CI runner answers one page query in about a second (BD-M04e2-08). */
const expect = baseExpect.configure({ timeout: 30_000 });

type Bridge = {
  world: WorldBridge;
  engine: {
    modes: { send(c: object): boolean; quit(): boolean };
    vehicleOp(op: string, target?: number): Promise<VehicleReply | null>;
  };
};
type W = { __dvBridge: Bridge };
interface VehicleReply {
  ok: boolean;
  player?: { driving: boolean };
  vehicle: { handle: number; speed: number; handling: string | null; pos: [number, number, number] } | null;
}

const state = (page: Page, target?: number): Promise<VehicleReply | null> =>
  page.evaluate((t) => (window as unknown as W).__dvBridge.engine.vehicleOp('state', t), target);

test.describe('sandbox cars @sandbox-vehicles', () => {
  test.describe.configure({ timeout: 600_000 });

  test('Put one here and drive places a car ahead, seats the player, drives, and quitting takes it away @sandbox-vehicles', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await bootSandbox(page);
    await expect(page.getByTestId('hud')).toBeVisible();
    const before = (await observe(page)).player!.pos;

    await openSandboxTab(page, 'vehicles');
    // the six class headings and the twelve cars are on the tab
    await expect(page.getByTestId('btn-car-kestrel-quill-drive')).toBeVisible();
    await expect(page.getByTestId('btn-car-clear')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('sandbox-cars-tab.png') });
    await page.getByTestId('btn-car-kestrel-quill-drive').click();
    await closePhone(page);

    await expect
      .poll(async () => {
        const s = await state(page);
        return s?.player?.driving === true ? s.vehicle?.handling : null;
      }, { timeout: 5_000 + 25_000, intervals: [250, 500] })
      .toBe('hp.kestrel-quill');
    const placed = (await state(page))!;
    const at = placed.vehicle!.pos;
    expect(Math.hypot(at[0] - before[0], at[2] - before[2])).toBeLessThanOrEqual(13);
    const handle = placed.vehicle!.handle;
    await page.screenshot({ path: testInfo.outputPath('sandbox-cars-placed.png') });

    // drive: W held for 3 s of game time (180 ticks; on a busy runner the sim runs slower than the clock, BD-FIX-SBXWGPU-01)
    const t0 = (await observe(page)).tick;
    await page.keyboard.down('KeyW');
    await waitTicks(page, t0, 180);
    const moving = (await state(page))!;
    await page.keyboard.up('KeyW');
    expect(moving.vehicle?.speed ?? 0).toBeGreaterThan(2);

    // quitting the sandbox takes the car away
    await page.evaluate(() => (window as unknown as W).__dvBridge.engine.modes.quit());
    await expect.poll(async () => (await state(page, handle))?.vehicle ?? null, { timeout: 60_000, intervals: [500, 1000] }).toBeNull();
    expect(errors).toEqual([]);
  });
});
