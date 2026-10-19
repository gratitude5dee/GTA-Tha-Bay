import { expect, test } from '@playwright/test';
import { act, chunkIndexOf, observe, SMALL_VIEWPORT, terrainAt, waitForEngine } from './engine-helpers.ts';

test.describe('gray-box Civic Center block @graybox', () => {
  test('the home page shows 4 chunks of at most 6 render objects; W + Shift crosses a chunk boundary without sinking @graybox', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/');
    await waitForEngine(page);

    // The block is there before anyone presses Start: the title sits over the world.
    await expect.poll(async () => (await observe(page)).world?.chunks, { timeout: 60_000 }).toBe(4);
    const world = (await observe(page)).world;
    expect(world?.objectsPerChunk).toHaveLength(4);
    expect(world?.maxObjectsPerChunk).toBeLessThanOrEqual(6);
    expect(world?.maxObjectsPerChunk).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId('title')).toBeVisible();
    await expect.poll(async () => (await observe(page)).chunksLoaded, { timeout: 30_000 }).toBe(4);
    await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 30_000 }).toBe(true);
    expect((await observe(page)).play).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('graybox-title.png') });

    // Start: the title goes away and the keyboard reaches the game.
    await page.getByTestId('title-start').click();
    await expect(page.getByTestId('title')).toBeHidden();
    expect((await observe(page)).play).toBe(true);

    // The spawn is 68 m from the z = 128 chunk edge along the heading; start 28 m before it so that 10 s of sprint crosses.
    expect(await act(page, { t: 'debug.teleport', pos: [89, 16, 100] })).toBe(true);
    await expect.poll(async () => (await observe(page)).player?.control, { timeout: 30_000 }).toBe(100);
    const start = (await observe(page)).player!;
    expect(chunkIndexOf(start.pos[0], start.pos[2])).toEqual([0, 0]); // x 89 and z 100 are in the first chunk

    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    let worstDrop = 0;
    let crossed = false;
    const startChunk = chunkIndexOf(start.pos[0], start.pos[2]);
    const t0 = Date.now();
    while (Date.now() - t0 < 10_000) {
      const o = await observe(page);
      const p = o.player!;
      const ground = terrainAt(p.pos[0], p.pos[2]);
      if (!Number.isNaN(ground)) worstDrop = Math.max(worstDrop, ground - p.pos[1]);
      const c = chunkIndexOf(p.pos[0], p.pos[2]);
      if (c[0] !== startChunk[0] || c[1] !== startChunk[1]) crossed = true;
      await page.waitForTimeout(100);
    }
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');
    const end = (await observe(page)).player!;
    console.log(`${testInfo.project.name}: ${Math.hypot(end.pos[0] - start.pos[0], end.pos[2] - start.pos[2]).toFixed(1)} m in 10 s, worst drop ${worstDrop.toFixed(3)} m`);
    await page.screenshot({ path: testInfo.outputPath('graybox-play.png') });
    expect(crossed).toBe(true);
    expect(worstDrop).toBeLessThanOrEqual(0.1);
    expect((await observe(page)).world?.maxObjectsPerChunk).toBeLessThanOrEqual(6);
    expect(errors).toEqual([]);
  });

  test('F3 shows the sim panel and F4 detaches the camera while the player stands still @graybox', async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'AC-10 runs on Chromium');
    test.setTimeout(120_000);
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?debug=1');
    await waitForEngine(page);
    await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 60_000 }).toBe(true);
    expect((await observe(page)).play).toBe(true);

    await page.keyboard.press('F3');
    const panel = page.locator('[data-dv-sim-panel]');
    await expect(panel).toBeVisible();
    await expect.poll(async () => Number(await panel.getAttribute('data-fps')), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(async () => Number(await panel.getAttribute('data-tick-p99')), { timeout: 15_000 }).toBeGreaterThanOrEqual(0);
    expect(await panel.getAttribute('data-tick-p99')).toMatch(/^\d+(\.\d+)?$/);
    expect(await panel.getAttribute('data-fps')).toMatch(/^\d+(\.\d+)?$/);
    expect(await panel.textContent()).toMatch(/fps [\d.]+/);
    expect(await panel.textContent()).toMatch(/p99 [\d.]+ ms/);

    await page.keyboard.press('F4');
    await expect.poll(async () => (await observe(page)).debug?.freeCam, { timeout: 10_000 }).toBe(true);
    const before = await observe(page);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2000);
    await page.keyboard.up('KeyW');
    const after = await observe(page);
    const moved = Math.hypot(after.camera!.pos[0] - before.camera!.pos[0], after.camera!.pos[1] - before.camera!.pos[1], after.camera!.pos[2] - before.camera!.pos[2]);
    const playerMoved = Math.hypot(after.player!.pos[0] - before.player!.pos[0], after.player!.pos[2] - before.player!.pos[2]);
    console.log(`free cam moved ${moved.toFixed(1)} m, player moved ${playerMoved.toFixed(3)} m`);
    expect(moved).toBeGreaterThan(8);
    expect(playerMoved).toBeLessThan(0.05);
    expect(after.tick).toBeGreaterThan(before.tick); // the sim kept running
    await page.screenshot({ path: testInfo.outputPath('graybox-freecam.png') });

    // F4 again returns to the player's camera; F3 hides the panel.
    await page.keyboard.press('F4');
    await expect.poll(async () => (await observe(page)).debug?.freeCam, { timeout: 10_000 }).toBe(false);
    await page.keyboard.press('F3');
    await expect(panel).toBeHidden();
  });
});
