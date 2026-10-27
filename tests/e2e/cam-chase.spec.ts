import { expect, test, type Page } from '@playwright/test';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { act, observe, SMALL_VIEWPORT, waitForEngine, type Obs } from './engine-helpers.ts';

/**
 * M02g1 AC-7 in a real browser, on a `DV_WORLD=synth` QA build (`@cam-chase`, outside the graybox half of CI).
 *
 * The chase camera follows the vehicle: the sim casts and publishes a far distance of 1.6 x length + 1.5 m of the vehicle's body (the
 * pickup is longer than the sedan), the camera sits at that distance on the far view, the rest pitch puts the horizon 35 to 40 % from the
 * top of the picture, and the tow boom of the pickup, which stands between the camera and the truck, is faded (the sedan has no
 * attachment). After a teleport the view turns to the player's heading.
 */
type W = { __dvBridge: { world: WorldBridge; engine: Bridge } };
interface Reply { ok: boolean; handle?: number; reason?: string; [k: string]: unknown }
interface Bridge {
  spawn(prefab: string, at: [number, number, number], yaw?: number): Promise<Reply | null>;
  vehicleCamera: { views(): string[]; view(): string; set(v: string): void; cycle(): string; last(): { x: number; y: number; z: number; distance: number; view: string } };
}
const bridge = <T>(page: Page, fn: (b: Bridge) => T | Promise<T>): Promise<T> => page.evaluate(`(${fn.toString()})(window.__dvBridge.engine)`) as Promise<T>;
const groundAt = (page: Page, x: number, z: number): Promise<number> =>
  page.evaluate(([a, b]) => (window as unknown as W).__dvBridge.world.groundY(a as number, b as number), [x, z] as const).then((y) => {
    if (y === null) throw new Error(`no ground at ${x}, ${z}`);
    return y;
  });

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const LENGTH_M = { 'vehicle.pickup': 5.3, 'vehicle.sedan': 4.7 } as const;
const expectedFar = (prefab: keyof typeof LENGTH_M): number => 1.6 * LENGTH_M[prefab] + 1.5;

async function bootWorld(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto('/?tier=mobile-low&debug=1');
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 180_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 240_000 });
  await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(90_000));
  await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 120_000 }).toBe(true);
  return errors;
}

/** Spawns `prefab` 6 m east of the player on the ground, stands the player at its driver door and gets in. */
async function driveNew(page: Page, prefab: keyof typeof LENGTH_M): Promise<Obs> {
  const p = (await observe(page)).player as NonNullable<Obs['player']>;
  const cx = p.pos[0] + 6, cz = p.pos[2];
  await page.evaluate(([x, z]) => (window as unknown as W).__dvBridge.world.focus(x as number, z as number), [cx, cz] as const);
  await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(90_000));
  const gy = await groundAt(page, cx, cz);
  const spawned = (await page.evaluate(([pf, x, y, z]) => (window as unknown as W).__dvBridge.engine.spawn(pf as string, [x as number, y as number, z as number], 0), [prefab, cx, gy + 0.8, cz] as const)) as Reply | null;
  expect(spawned?.ok, JSON.stringify(spawned)).toBe(true);
  expect(await act(page, { t: 'debug.teleport', pos: [cx - 3.2, await groundAt(page, cx - 3.2, cz), cz] })).toBe(true);
  await expect.poll(async () => (await observe(page)).prompt?.kind, { timeout: 60_000 }).toBe(1);
  await page.keyboard.press('KeyF');
  await expect.poll(async () => (await observe(page)).vehicleCamera.active, { timeout: 60_000 }).toBe(true);
  return observe(page);
}

test.describe('chase camera @cam-chase', () => {
  test.describe.configure({ timeout: 900_000, mode: 'serial' });

  for (const prefab of ['vehicle.pickup', 'vehicle.sedan'] as const) {
    test(`${prefab}: far = 1.6 x length + 1.5 m, the horizon 35 to 40 % from the top, no unfaded part in the way @cam-chase`, async ({ page }) => {
      const errors = await bootWorld(page);
      let obs = await driveNew(page, prefab);
      const want = expectedFar(prefab);

      // the sim's numbers: the far distance of this body, the anchor at roof height
      expect(obs.vehicleCamera.farM ?? 0, 'farM').toBeCloseTo(want, 1);
      expect(obs.vehicleCamera.anchorUpM ?? 0, 'anchorUpM').toBeCloseTo(0.92, 1);

      // the far view puts the camera at that distance behind the anchor (the lift adds 0.15 %); a wall may only shorten it
      await bridge(page, (b) => b.vehicleCamera.set('chase-far'));
      // idle for the recentre (1.5 s) and the lag, then read
      await page.waitForTimeout(4000);
      obs = await observe(page);
      const lift = (0.6 * want) / 11;
      const len = Math.hypot(want, lift);
      expect(obs.vehicleCamera.view).toBe('chase-far');
      expect(obs.vehicleCamera.distance, `distance ${obs.vehicleCamera.distance} of ${len.toFixed(2)}`).toBeLessThanOrEqual(len + 0.02);
      expect(obs.vehicleCamera.distance).toBeGreaterThan(Math.min(len, 4) - 0.02);

      // the horizon, 35 to 40 % from the top, once the view has swung back behind the car
      expect(obs.vehicleCamera.horizon).toBeGreaterThanOrEqual(0.35);
      expect(obs.vehicleCamera.horizon).toBeLessThanOrEqual(0.4);

      // nothing unfaded between the camera and the anchor: the pickup's boom is faded, the sedan has none
      if (prefab === 'vehicle.pickup') expect(obs.vehicleCamera.attachOpacity, 'the boom in the way').toBeLessThan(0.2);
      else expect(obs.vehicleCamera.attachOpacity).toBe(1);
      expect(errors).toEqual([]);
    });
  }

  test('a longer vehicle gets a longer chase: pickup > sedan @cam-chase', () => {
    expect(expectedFar('vehicle.pickup')).toBeGreaterThan(expectedFar('vehicle.sedan'));
  });

  test('after teleport({x, z, yaw: 90}) the camera yaw is within 5 degrees of the player\'s @cam-chase', async ({ page }) => {
    const errors = await bootWorld(page);
    const p = (await observe(page)).player as NonNullable<Obs['player']>;
    const to = { x: p.pos[0] + 12, z: p.pos[2] + 9, yaw: 90 };
    const result = await page.evaluate((t) => (window as unknown as W).__dvBridge.world.teleport(t, 'debug'), to);
    expect(result?.ok, JSON.stringify(result)).toBe(true);
    // the move, the fade and a few frames for the view to turn
    await expect
      .poll(
        async () => {
          const o = await observe(page);
          const h = o.look.playerHeading;
          if (h === null) return Infinity;
          return Math.abs(wrap(o.look.yaw - h)) * (180 / Math.PI);
        },
        { timeout: 120_000, intervals: [250] },
      )
      .toBeLessThanOrEqual(5);
    const o = await observe(page);
    expect(Math.hypot((o.player?.pos[0] ?? 0) - to.x, (o.player?.pos[2] ?? 0) - to.z), 'the player arrived').toBeLessThan(45);
    expect(errors).toEqual([]);
  });
});
