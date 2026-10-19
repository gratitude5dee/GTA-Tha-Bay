import { expect, test, type Page } from '@playwright/test';

interface PlayerObs {
  pos: [number, number, number];
  vel: [number, number, number];
  control: number;
  owner: number;
  grounded: boolean;
}
interface Obs {
  tick: number;
  records: number;
  crashed: string | null;
  player: PlayerObs | null;
  camera: { mode: string; allowedDistance: number | null; lastToggleRefused: boolean; locked: boolean } | null;
}

async function waitForEngine(page: Page): Promise<void> {
  await page.waitForSelector('html[data-dv-engine="ready"]', { state: 'attached', timeout: 60_000 });
}

const observe = (page: Page): Promise<Obs> =>
  page.evaluate(() => {
    const engine = (window as unknown as { __dvBridge?: { engine?: { observe(): unknown } } }).__dvBridge?.engine;
    if (!engine) throw new Error('missing __dvBridge.engine');
    return engine.observe();
  }) as Promise<Obs>;

const act = (page: Page, cmd: object): Promise<boolean> =>
  page.evaluate((c) => {
    const engine = (window as unknown as { __dvBridge?: { engine?: { act(c: object): boolean } } }).__dvBridge?.engine;
    if (!engine) throw new Error('missing __dvBridge.engine');
    return engine.act(c);
  }, cmd);

async function boot(page: Page): Promise<PlayerObs> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The software renderer draws the full-window play view at about 6 frames a second at 720p, and the sim clamps a
  // frame to 0.15 s of ticks; a small viewport keeps it near 60 ticks a second, which the 12 s budget assumes.
  await page.setViewportSize({ width: 480, height: 270 });
  await page.goto('/?debug=1');
  await waitForEngine(page);
  await expect.poll(async () => (await observe(page)).player != null, { timeout: 30_000 }).toBe(true);
  // The camera rig exists once the view does; give it a few frames to receive the first directive.
  await expect.poll(async () => (await observe(page)).camera != null, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 30_000 }).toBe(true);
  expect(errors).toEqual([]);
  return (await observe(page)).player as PlayerObs;
}

const dist = (a: [number, number, number], b: [number, number, number]): number => Math.hypot(a[0] - b[0], a[2] - b[2]);

test.describe('controller and cameras @fp-tp', () => {
  test('W + Shift covers 50 m in 12 s; V toggles first and third person; the lock refuses the toggle @fp-tp', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const start = await boot(page);

    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    const t0 = Date.now();
    let covered = 0;
    await expect
      .poll(
        async () => {
          const p = (await observe(page)).player;
          covered = p ? dist(p.pos, start.pos) : 0;
          return covered;
        },
        { timeout: 12_000, intervals: [100] },
      )
      .toBeGreaterThanOrEqual(50);
    console.log(`${testInfo.project.name}: ${covered.toFixed(1)} m in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');

    // V: tp -> fp -> tp.
    expect((await observe(page)).camera?.mode).toBe('tp');
    await page.keyboard.press('KeyV');
    await expect.poll(async () => (await observe(page)).camera?.mode, { timeout: 5_000 }).toBe('fp');
    await page.keyboard.press('KeyV');
    await expect.poll(async () => (await observe(page)).camera?.mode, { timeout: 5_000 }).toBe('tp');
    expect((await observe(page)).camera?.lastToggleRefused).toBe(false);

    // The lock: the toggle is refused, the mode stays, and the refusal is recorded.
    expect(await act(page, { t: 'debug.camera.lock', on: true })).toBe(true);
    await expect.poll(async () => (await observe(page)).camera?.locked, { timeout: 5_000 }).toBe(true);
    await page.keyboard.press('KeyV');
    await expect.poll(async () => (await observe(page)).camera?.lastToggleRefused, { timeout: 5_000 }).toBe(true);
    expect((await observe(page)).camera?.mode).toBe('tp');

    // Unlock: V works again.
    expect(await act(page, { t: 'debug.camera.lock', on: false })).toBe(true);
    await expect.poll(async () => (await observe(page)).camera?.locked, { timeout: 5_000 }).toBe(false);
    await page.keyboard.press('KeyV');
    await expect.poll(async () => (await observe(page)).camera?.mode, { timeout: 5_000 }).toBe('fp');
    expect((await observe(page)).camera?.lastToggleRefused).toBe(false);
  });

  test('Space jumps and C swaps the shoulder; a teleport with no ground leaves the player where it was @fp-tp', async ({ page }) => {
    test.setTimeout(120_000);
    const start = await boot(page);

    // A jump leaves the ground and comes back.
    await page.keyboard.press('Space');
    await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 5_000, intervals: [16] }).toBe(false);
    await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 5_000 }).toBe(true);
    const landed = (await observe(page)).player as PlayerObs;
    expect(Math.abs(landed.pos[1] - start.pos[1])).toBeLessThan(0.05);

    // The shoulder swap is client-side and never refused.
    await page.keyboard.press('KeyC');
    expect((await observe(page)).camera?.lastToggleRefused).toBe(false);

    // Teleport to a point with no statics: 700, 701, and after 300 ticks back to Ready with the position unchanged.
    expect(await act(page, { t: 'debug.teleport', pos: [5000, 0, 0] })).toBe(true);
    await expect.poll(async () => (await observe(page)).player?.control, { timeout: 5_000, intervals: [16] }).toBe(701);
    await expect.poll(async () => (await observe(page)).player?.control, { timeout: 20_000 }).toBe(100);
    const after = (await observe(page)).player as PlayerObs;
    expect(dist(after.pos, landed.pos)).toBeLessThan(0.01);
  });
});
