import { expect, test, type Page } from '@playwright/test';
import type { EngineBridge } from '../../../packages/engine/src/client/debug/bridge.ts';
import { observe, SMALL_VIEWPORT, waitForEngine } from '../engine-helpers.ts';

/**
 * M03c AC-9 in a real browser, on a `DV_WORLD=synth` QA build (`@pursuit`): `__dvBridge.engine.pursuit.setHeat(2)` makes at least one
 * cruiser spawn at least 120 m away and out of view and close in within 60 s of sim time, the snapshot side block reports level 2, and
 * `clear()` makes the units leave and be removed once they are unseen. The default QA scene carries the pursuit panel (no ?debug=1).
 */
type Reply = {
  ok: boolean;
  level: number;
  phase: string;
  units: number;
  spawns: { tick: number; role: string; x: number; z: number }[];
  unitList: { id: number; role: string; mode: string; x: number; z: number; speed: number; sees: boolean }[];
  player: { x: number; z: number; speed: number } | null;
  lost: number;
};
type W = { __dvBridge: { engine: EngineBridge; world: unknown } };

const state = (page: Page): Promise<Reply> => page.evaluate(() => (window as unknown as W).__dvBridge.engine.pursuit.state()) as Promise<Reply>;
const simTick = async (page: Page): Promise<number> => (await observe(page)).stats.tick;

async function boot(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto('/?tier=mobile-low');
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
  await page.waitForFunction(
    () => (window as unknown as { __dvBridge: { world: { boot(): { revealed: boolean } } } }).__dvBridge.world.boot().revealed,
    undefined,
    { timeout: 180_000 },
  );
  // the road network and the ground under the arrival pose must be up before the police can be placed
  await expect
    .poll(async () => ((await page.evaluate(() => (window as unknown as { __dvBridge: { world: { call(op: string): Promise<{ topology?: boolean } | null> } } }).__dvBridge.world.call('state'))) as { topology?: boolean } | null)?.topology ?? false, {
      timeout: 120_000,
      intervals: [500, 1000, 2000],
    })
    .toBe(true);
  expect(errors).toEqual([]);
}

test.describe('pursuit director @pursuit', () => {
  test.describe.configure({ timeout: 600_000 });

  test('heat 2 sends a cruiser from out of view; the side block says level 2; clear sends the units away @pursuit', async ({ page }, testInfo) => {
    await boot(page);

    // the default QA scene shows the panel
    await expect(page.getByTestId('pursuit-panel')).toBeVisible();
    await expect(page.getByTestId('pursuit-line')).toContainText('HEAT 0');

    // nothing before the toggle
    const before = await state(page);
    expect(before.ok).toBe(true);
    expect(before.level).toBe(0);
    expect(before.units).toBe(0);

    const t0 = await simTick(page);
    const set = (await page.evaluate(() => (window as unknown as W).__dvBridge.engine.pursuit.setHeat(2))) as Reply;
    expect(set.ok).toBe(true);
    expect(set.level).toBe(2);

    // a cruiser appears, at least 120 m from the player
    let st = set;
    await expect
      .poll(async () => {
        st = await state(page);
        return st.units;
      }, { timeout: 120_000, intervals: [250, 500, 1000] })
      .toBeGreaterThanOrEqual(1);
    const first = st.spawns[0];
    expect(first).toBeDefined();
    const me = st.player as NonNullable<Reply['player']>;
    expect(Math.hypot((first as { x: number }).x - me.x, (first as { z: number }).z - me.z)).toBeGreaterThanOrEqual(120);

    // it follows: within 60 s of sim time a cruiser is closer to the player than where it spawned, or already in sight
    const spawnAt = { x: (first as { x: number }).x, z: (first as { z: number }).z };
    const spawnDist = Math.hypot(spawnAt.x - me.x, spawnAt.z - me.z);
    await expect
      .poll(async () => {
        st = await state(page);
        const ground = st.unitList.filter((u) => u.role !== 'heli');
        const closest = Math.min(...ground.map((u) => Math.hypot(u.x - me.x, u.z - me.z)), 1e9);
        return closest < spawnDist - 20 || ground.some((u) => u.sees);
      }, { timeout: 150_000, intervals: [500, 1000, 2000] })
      .toBe(true);
    expect((await simTick(page)) - t0).toBeLessThanOrEqual(60 * 60 + 600);

    await testInfo.attach('heat-2', { body: await page.screenshot(), contentType: 'image/png' });
    if (process.env['DV_PURSUIT_SHOT']) await page.screenshot({ path: process.env['DV_PURSUIT_SHOT'] });
    // the snapshot side block carries the heat
    await expect.poll(async () => (await observe(page)).pursuit?.level ?? 0, { timeout: 30_000 }).toBe(2);
    await expect(page.getByTestId('pursuit-line')).toContainText('HEAT 2');

    // clear: the units leave and are removed once unseen
    const cleared = (await page.evaluate(() => (window as unknown as W).__dvBridge.engine.pursuit.clear())) as Reply;
    expect(cleared.ok).toBe(true);
    expect(cleared.level).toBe(0);
    await expect
      .poll(async () => (await state(page)).units, { timeout: 240_000, intervals: [1000, 2000] })
      .toBe(0);
    await expect.poll(async () => (await observe(page)).pursuit, { timeout: 30_000 }).toBeNull();
    await expect(page.getByTestId('pursuit-line')).toContainText('HEAT 0');
  });

  test('the panel buttons set the heat; heat lock refuses it @pursuit', async ({ page }) => {
    await boot(page);
    await page.getByTestId('pursuit-heat-3').click();
    await expect.poll(async () => (await observe(page)).pursuit?.level ?? 0, { timeout: 30_000 }).toBe(3);
    await expect(page.getByTestId('pursuit-line')).toContainText('HEAT 3');
    await page.getByTestId('pursuit-heat-0').click();
    await expect.poll(async () => (await observe(page)).pursuit, { timeout: 30_000 }).toBeNull();
    await expect(page.getByTestId('pursuit-never').locator('xpath=ancestor::label')).toHaveText('heat lock');
    await page.getByTestId('pursuit-never').check();
    await page.getByTestId('pursuit-heat-4').click();
    await page.waitForTimeout(1500);
    expect((await observe(page)).pursuit).toBeNull();
    const s = await state(page);
    expect(s.level).toBe(0);
  });
});
