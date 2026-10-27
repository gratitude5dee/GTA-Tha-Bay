import { expect, test, type Page } from '@playwright/test';
import type { MissionBridge } from '../../packages/modes/story/src/debug/bridge.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M02g1 AC-8 in a real browser, on a `DV_WORLD=synth` QA build (`@story-burnoff`, outside the graybox half of CI).
 *
 * m.a1.01 v2 holds the clock at 06:30 in Karl fog until the `truck` stage and releases it there (C09 1.1: `clock` with `unlock` and a
 * weather-only `lock`): the fog burns off into morning sun over one blend (16 s of real time, 480 game seconds) and the clock runs on.
 *
 *  1. `?play=story&story=1`: at `to_gate` the clock is held at 06:30 in `karl-fog`; `mission.jump(1)` enters `truck`;
 *  2. within 1,800 game seconds the weather is `clear` with the blend done, the clock has moved on (it is unlocked), and by 07:00 the
 *     sun is up (`look().sun`);
 *  3. a checkpoint retry at `tow_home` (stage 5) puts the clock back as the earlier stages left it: held and fogged, then released and
 *     blending to `clear` within one blend.
 *
 * `@story-start` (the new game's start) runs beside it in the same command and is unchanged.
 */
test.use({ storageState: { cookies: [], origins: [] } });

type W = { __dvBridge: { mission: MissionBridge; world: WorldBridge } };
type MissionState = { phase: string; mission: string; stage: number; stageId: string | null };
type Sky = { hour: number; weather: string; next: string };

const GAME_SEC_PER_REAL_SEC = 30;
const BLEND_GAME_SEC = 480;

const mstate = (page: Page): Promise<MissionState | null> => page.evaluate(() => (window as unknown as W).__dvBridge.mission.state() as unknown as MissionState | null);
const sky = (page: Page): Promise<Sky | null> =>
  page.evaluate(() => {
    const s = (window as unknown as W).__dvBridge.world.sky();
    return s ? { hour: s.hour, weather: s.weather, next: s.next } : null;
  });
const sun = (page: Page): Promise<{ intensity: number; moon: boolean } | null> =>
  page.evaluate(() => {
    const l = (window as unknown as W).__dvBridge.world.look();
    return l?.sun ? { intensity: l.sun.intensity, moon: l.sun.moon } : null;
  });

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto('/?play=story&story=1&tier=mobile-low&beats=instant');
  await waitForEngine(page);
  await page.waitForFunction(
    () => (window as unknown as Partial<W>).__dvBridge?.world !== undefined && (window as unknown as Partial<W>).__dvBridge?.mission !== undefined,
    undefined,
    { timeout: 180_000 },
  );
  return errors;
}

test.describe('story burn-off @story-burnoff', () => {
  test.describe.configure({ timeout: 600_000 });

  test('the fog is held at 06:30 until the truck stage, then burns off into morning sun within 1,800 game seconds @story-burnoff', async ({ page }) => {
    const errors = await boot(page);

    // to_gate: the dawn lock, 06:30 in Karl fog
    await expect.poll(async () => (await mstate(page))?.stageId, { timeout: 300_000, intervals: [250] }).toBe('to_gate');
    await expect.poll(async () => (await sky(page))?.weather, { timeout: 60_000, intervals: [250] }).toBe('karl-fog');
    const locked0 = (await sky(page)) as Sky;
    expect(locked0.hour).toBeCloseTo(6.5, 1);
    // held: the hour does not move while the stage runs
    await page.waitForTimeout(2500);
    expect(Math.abs(((await sky(page)) as Sky).hour - locked0.hour)).toBeLessThan(0.02);

    // the truck stage: released
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.mission.jump(1))).toBe(true);
    await expect.poll(async () => (await mstate(page))?.stageId, { timeout: 60_000, intervals: [250] }).toBe('truck');
    const start = (await sky(page)) as Sky;

    // within 1,800 game seconds the weather is clear (`current` takes the preset when the blend ends; `next` is then the schedule's draw)
    let clearAt = -1;
    await expect
      .poll(
        async () => {
          const s = await sky(page);
          if (s && s.weather === 'clear') {
            clearAt = s.hour;
            return true;
          }
          return false;
        },
        { timeout: 300_000, intervals: [200] },
      )
      .toBe(true);
    const elapsedGameSec = (clearAt - start.hour) * 3600;
    expect(elapsedGameSec, `clear after ${elapsedGameSec.toFixed(0)} game seconds (one blend is ${BLEND_GAME_SEC})`).toBeLessThanOrEqual(1800);
    expect(elapsedGameSec).toBeGreaterThan(0);
    // the clock runs on (it is unlocked) and the hour never went back below 06:30
    expect(clearAt).toBeGreaterThanOrEqual(6.5);
    await page.waitForTimeout(1500);
    expect(((await sky(page)) as Sky).hour).toBeGreaterThan(clearAt);
    expect(GAME_SEC_PER_REAL_SEC).toBe(30);

    // by 07:00 the sun is on
    await expect.poll(async () => ((await sky(page)) as Sky).hour, { timeout: 300_000, intervals: [250] }).toBeGreaterThanOrEqual(7);
    const s = (await sun(page)) as { intensity: number; moon: boolean };
    expect(s.moon).toBe(false);
    expect(s.intensity).toBeGreaterThan(0.5);
    expect(errors).toEqual([]);
  });

  test('a checkpoint retry at tow_home finds the clock released and blending to clear, never fogged @story-burnoff', async ({ page }) => {
    const errors = await boot(page);
    await expect.poll(async () => (await mstate(page))?.stageId, { timeout: 300_000, intervals: [250] }).toBe('to_gate');

    // tow_home (stage 5) writes the checkpoint on entry. The jump skips the truck stage, so the dawn hold of to_gate still stands: the world
    // is fogged at 06:30, as a late-loaded world is before the mission has put the clock back.
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.mission.jump(5))).toBe(true);
    await expect.poll(async () => (await mstate(page))?.stageId, { timeout: 60_000, intervals: [250] }).toBe('tow_home');
    await expect.poll(async () => (await sky(page))?.weather, { timeout: 60_000, intervals: [200] }).toBe('karl-fog');

    // fail and retry: the restore runs the clock ops of the stages before tow_home in order
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.mission.fail())).toBe(true);
    await expect.poll(async () => (await mstate(page))?.phase, { timeout: 60_000, intervals: [200] }).toBe('failed');
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.mission.retry())).toBe(true);
    await expect.poll(async () => (await mstate(page))?.stageId, { timeout: 60_000, intervals: [200] }).toBe('tow_home');
    const after = (await sky(page)) as Sky;
    expect(after.hour).toBeGreaterThanOrEqual(6.4);

    // released: the hour moves; and one blend later it is clear
    await page.waitForTimeout(1500);
    expect(((await sky(page)) as Sky).hour).toBeGreaterThan(after.hour);
    await expect
      .poll(async () => {
        const s = await sky(page);
        return s !== null && s.weather === 'clear';
      }, { timeout: 300_000, intervals: [250] })
      .toBe(true);
    expect(errors).toEqual([]);
  });
});
