import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { act, observe, SMALL_VIEWPORT, terrainAt, waitForEngine, type Obs } from './engine-helpers.ts';

/**
 * M03a1 in a real browser (AC-9, AC-10). `@vehicle` runs on the gray-box build (no DV_WORLD; the `GRAYBOX_GREP` half of the
 * e2e leg), `@vehicle-world` on the `DV_WORLD=synth` build.
 *
 * Open `/?debug=1` on a QA build to see it: six cars stand along the west kerb of the street next to the spawn (a sedan, a compact,
 * a police cruiser, a van, a pickup, a robotaxi). Walk up to one and press F (or Y on a pad) to get in; W/S/A/D drive, Space is the
 * handbrake, V cycles the five cameras, F gets out. F6 draws the physics wireframe, F7 opens the entity inspector.
 */
interface Reply { ok: boolean; handle?: number; reason?: string; [k: string]: unknown }
interface Bridge {
  spawn(prefab: string, at: [number, number, number], yaw?: number): Promise<Reply | null>;
  vehicleOp(op: string, target?: number): Promise<Reply | null>;
  vehicleCamera: { views(): string[]; view(): string; set(v: string): void; cycle(): string; last(): { x: number; y: number; z: number; distance: number; view: string } };
  line: { play(line: unknown): Promise<Reply | null>; stop(): Promise<Reply | null> };
  tools: { inspector(on?: boolean): void; physics(on?: boolean): void; inspect(handle?: number): Promise<Reply | null> };
}

const bridge = <T>(page: Page, fn: (b: Bridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.engine)`) as Promise<T>;

const LINE = JSON.parse(readFileSync(new URL('../../packages/engine/test/lines/walk-drive.line.json', import.meta.url), 'utf8')) as unknown;

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto('/?debug=1');
  await waitForEngine(page);
  await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 60_000 }).toBe(true);
  expect((await observe(page)).play).toBe(true);
  return errors;
}

/** Control state ids of the player, sampled until `want` has been seen. */
async function seen(page: Page, want: number[], timeoutMs: number): Promise<number[]> {
  const log: number[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs && !want.every((w) => log.includes(w))) {
    const c = (await observe(page)).player?.control;
    if (c !== undefined && log[log.length - 1] !== c) log.push(c);
    await page.waitForTimeout(20);
  }
  return log;
}

test.describe('vehicles in the gray-box block @vehicle', () => {
  test('spawn the sedan at the junction, get in, play the walk-drive line, cycle the five cameras, get out, and use the debug tools @vehicle', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors = await boot(page);

    // the default scene: parked cars stand next to the spawn
    await expect.poll(async () => (await observe(page)).records, { timeout: 30_000 }).toBeGreaterThanOrEqual(8);
    await page.screenshot({ path: testInfo.outputPath('vehicle-1-parked.png') });

    // the sedan at the junction (the street crossing is at x = 100, z = 100), heading north; the player stands 1.75 m from its driver door
    const carAt: [number, number] = [96, 92];
    const spawned = await bridge(page, (b) => b.spawn('vehicle.sedan', [96, 15.9, 92], 0));
    expect(spawned?.ok, JSON.stringify(spawned)).toBe(true);
    expect(await act(page, { t: 'debug.teleport', pos: [carAt[0] - 3.2, terrainAt(carAt[0] - 3.2, carAt[1]), carAt[1]] })).toBe(true);
    await expect.poll(async () => (await observe(page)).player?.control, { timeout: 30_000 }).toBe(100);

    // the prompt is offered for the vehicle, and F gets in: 200 (entering), then 201 (driving) in the vehicle input context
    await expect.poll(async () => (await observe(page)).prompt?.kind, { timeout: 30_000 }).toBe(1);
    await expect(page.getByTestId('dv-prompt')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('vehicle-2-prompt.png') });
    await page.keyboard.press('KeyF');
    const states = await seen(page, [200, 201], 15_000);
    expect(states).toEqual(expect.arrayContaining([200, 201]));
    expect(states.indexOf(200)).toBeLessThan(states.indexOf(201));
    let obs = await observe(page);
    expect(obs.player?.owner).toBe(2);
    expect(obs.vehicle?.handling).toBe('hp.sedan');
    expect(obs.vehicleCamera.active).toBe(true);
    await expect(page.getByTestId('dv-speed')).toBeVisible();

    // the keyboard drives it
    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await observe(page)).vehicle?.speed ?? 0, { timeout: 20_000 }).toBeGreaterThan(4);
    await page.screenshot({ path: testInfo.outputPath('vehicle-3-driving.png') });
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyS');
    await expect.poll(async () => Math.abs((await observe(page)).vehicle?.speed ?? 99), { timeout: 20_000 }).toBeLessThan(1.5);
    await page.keyboard.up('KeyS');

    // the five cameras: each view is somewhere above the ground, and the chase views stay inside the distance the sim allowed
    const order = await bridge(page, (b) => b.vehicleCamera.views());
    expect(order).toEqual(['chase-mid', 'chase-near', 'chase-far', 'hood', 'cockpit']);
    const seenViews: string[] = [];
    await bridge(page, (b) => b.vehicleCamera.set('chase-mid'));
    await page.keyboard.press('KeyV');   // the key cycles from chase-mid
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(250);
      obs = await observe(page);
      const cam = obs.vehicleCamera;
      seenViews.push(cam.view);
      expect(Number.isFinite(cam.x + cam.y + cam.z)).toBe(true);
      expect(cam.y, `${cam.view} above the ground`).toBeGreaterThan(terrainAt(cam.x, cam.z) + 0.1);
      if (cam.view.startsWith('chase')) {
        const allowed = obs.camera?.allowedDistance;
        if (allowed !== null && allowed !== undefined) expect(cam.distance, `${cam.view} inside the allowed distance`).toBeLessThanOrEqual(allowed + 1e-6);
      }
      await page.screenshot({ path: testInfo.outputPath(`vehicle-4-camera-${i}-${cam.view}.png`) });
      if (i < 4) await page.keyboard.press('KeyV');
    }
    expect(new Set(seenViews).size).toBe(5);
    await bridge(page, (b) => b.vehicleCamera.set('chase-mid'));

    // the walk-drive line drives a loop and gets out
    await page.evaluate((l) => { (window as unknown as { __line: unknown }).__line = l; }, LINE);
    const playRes = await bridge(page, (b) => b.line.play((window as unknown as { __line: unknown }).__line));
    expect(playRes?.ok, JSON.stringify(playRes)).toBe(true);
    await expect.poll(async () => (await observe(page)).vehicle?.speed ?? 0, { timeout: 40_000 }).toBeGreaterThan(4);
    await expect.poll(async () => (await observe(page)).player?.control, { timeout: 90_000 }).toBe(100);
    obs = await observe(page);
    expect(obs.player?.owner).toBe(1);
    expect(obs.vehicle).toBeNull();
    expect(obs.vehicleCamera.active).toBe(false);

    // the inspector lists the Vehicle component of the car and the wireframe toggles
    await bridge(page, (b) => b.tools.inspector(true));
    await expect.poll(async () => (await observe(page)).tools?.inspector, { timeout: 5_000 }).toBe(true);
    const car = await bridge(page, (b) => b.vehicleOp('state'));
    const handle = ((car?.['vehicle'] as { handle?: number } | null)?.handle) ?? 0;
    expect(handle).toBeGreaterThan(0);
    const sedan = await page.evaluate(async (h) => (window as unknown as { __dvBridge: { engine: Bridge } }).__dvBridge.engine.tools.inspect(h), handle);
    expect(Object.keys((sedan?.['components'] as object) ?? {})).toEqual(expect.arrayContaining(['Vehicle', 'VehicleDamage', 'Transform']));
    await bridge(page, (b) => b.tools.physics(true));
    await expect.poll(async () => (await observe(page)).tools?.physics, { timeout: 5_000 }).toBe(true);
    await expect.poll(async () => (await observe(page)).tools?.physicsBodies ?? 0, { timeout: 15_000 }).toBeGreaterThan(3);
    expect((await observe(page)).tools?.physicsShapes).toContain('box');
    await page.screenshot({ path: testInfo.outputPath('vehicle-5-debug-tools.png') });
    await bridge(page, (b) => b.tools.physics(false));
    await expect.poll(async () => (await observe(page)).tools?.physics, { timeout: 5_000 }).toBe(false);
    await bridge(page, (b) => b.tools.inspector(false));
    expect(errors).toEqual([]);
  });

  test('a locked car refuses with its reason and a parked police car can be entered @vehicle', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = await boot(page);
    const spawned = await bridge(page, (b) => b.spawn('vehicle.compact', [96, 15.9, 92], 0));
    expect(spawned?.ok).toBe(true);
    const locked = await bridge(page, (b) => b.vehicleOp('lock', undefined));
    expect(locked?.ok).toBe(true);
    await act(page, { t: 'debug.teleport', pos: [92.8, terrainAt(92.8, 92), 92] });
    await expect.poll(async () => (await observe(page)).player?.control, { timeout: 30_000 }).toBe(100);
    await expect.poll(async () => (await observe(page)).prompt?.reason, { timeout: 30_000 }).toBe('engine.vehicle.locked');
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(500);
    const obs: Obs = await observe(page);
    expect(obs.player?.owner).toBe(1);
    expect(obs.player?.control).toBe(100);
    expect(errors).toEqual([]);
  });
});
