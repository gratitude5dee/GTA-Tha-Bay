import { expect as baseExpect, test } from '@playwright/test';
import { observe } from '../engine-helpers.ts';
import {
  bootSandbox, closeSandboxPhone, CONTROL_TELEPORT_PENDING, CONTROL_TELEPORT_WAITING, fadeIns, jumpEnded, jumpPeak, openSandboxTab, SANDBOX_VMS,
  sandboxVm, slowFrameLoop,
} from './sandbox-helpers.ts';

/**
 * BD-FIX-SBXWGPU-01 regression (@sandbox-slow): the Sandbox app on a slow frame loop. Every animation frame of the page runs one second
 * late, so the sim pays for at most 9 ticks a second and every step of a move spans several page queries: the page runs ahead of the
 * sim, as it did on chromium-webgpu in CI, where `sandbox-actions`, `sandbox-teleport` and `sandbox-vehicles` failed. The steps those
 * specs share must wait for what they act on: the boot helper for the placed player and the running sandbox (a Jump pressed while the
 * boot move still waits for its colliders is dropped; a phone opened before the sandbox entered shows an empty Cars tab while Pause
 * holds the sim), the jump peak for 2 s of game time (2 s of wall time hold 18 ticks here, and the feet were 1.2 m up and rising), and
 * a jump for its fade-in (the pose is written before the move settles, and Back asked for in that window is refused as busy). With the
 * old boot wait this spec fails 3 of 3 (BD-FIX-SBXWGPU-01). Runs on the synth world (the `DV_WORLD=synth` half, not GRAYBOX_GREP).
 */
const expect = baseExpect.configure({ timeout: 30_000 });
const dist = (a: number[], b: number[]): number => Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!);

test.describe('sandbox on a slow frame loop @sandbox-slow', () => {
  test.describe.configure({ timeout: 900_000 });

  test('at one frame a second the boot waits for the placed player and the running sandbox, Big jump jumps, and Back after a spot lands @sandbox-slow', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await slowFrameLoop(page, 1_000);
    await bootSandbox(page);

    // Ready: out of the boot move, and every tab of the Sandbox app has its view model.
    const placed = (await observe(page)).player!;
    expect(placed.grounded).toBe(true);
    expect([CONTROL_TELEPORT_PENDING, CONTROL_TELEPORT_WAITING]).not.toContain(placed.control);
    for (const k of SANDBOX_VMS) expect(await sandboxVm(page, k), k).not.toBeNull();

    // Big jumps on: the Player tab shows the toggle on, and one press of Space jumps at least 3 m (the apex is 4 m).
    await openSandboxTab(page, 'player');
    await page.getByTestId('btn-sandbox-superjump').click();
    await expect.poll(async () => (await sandboxVm<{ superJump: boolean }>(page, 'mode.sandbox.player'))?.superJump).toBe(true);
    // The Cars tab lists the cars (it draws the sandbox's catalog).
    await page.getByTestId('tab-sandbox-tabs-vehicles').click();
    await expect(page.getByTestId('btn-car-kestrel-quill-drive')).toBeVisible();
    await closeSandboxPhone(page);
    expect(await jumpPeak(page, placed.pos[1])).toBeGreaterThanOrEqual(3.0);
    await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 60_000 }).toBe(true);

    // Remember this spot, go to a landmark, come back to the spot, then Back: the player stands where the landmark jump landed.
    await openSandboxTab(page, 'teleport');
    await page.getByTestId('btn-sandbox-spot-save').click();
    await expect(page.getByTestId('row-sandbox-spots-pos-1')).toContainText('Spot 1');
    const spot = (await observe(page)).player!.pos;
    let fades = await fadeIns(page);
    await page.getByTestId('row-sandbox-landmarks-lm.coit-tower').click();
    await jumpEnded(page, fades);
    const away = (await observe(page)).player!.pos;
    expect(dist(away, spot)).toBeGreaterThan(5);

    fades = await fadeIns(page);
    await openSandboxTab(page, 'teleport');
    await page.getByTestId('row-sandbox-spots-pos-1').click();
    await jumpEnded(page, fades);
    expect(dist((await observe(page)).player!.pos, spot)).toBeLessThanOrEqual(3);

    fades = await fadeIns(page);
    await openSandboxTab(page, 'teleport');
    await expect(page.getByTestId('btn-sandbox-back')).toBeEnabled();
    await page.getByTestId('btn-sandbox-back').click();
    await jumpEnded(page, fades);
    expect(dist((await observe(page)).player!.pos, away)).toBeLessThanOrEqual(3);
    await expect(page.locator('[data-toast-id="sandbox.teleport"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
