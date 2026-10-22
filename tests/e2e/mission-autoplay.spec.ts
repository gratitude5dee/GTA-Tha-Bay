import { expect, test, type Page } from '@playwright/test';
import type { MissionBridge } from '../../packages/modes/story/src/debug/bridge.ts';
import type { EngineBridge } from '../../packages/engine/src/client/debug/bridge.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M05a2 in the default QA scene (the gray-box block, no DV_WORLD): the story director takes the camera for the sample's beats
 * and the autoplayer plays the mission live from the console. `/?mission=m.dev.sample&seed=1&talk=scripted` starts the sample with
 * its beats played; the intro (2 s) is a cinematic shot (`camera.mode` is `cinematic`); then `__dvBridge.mission.autoplay(true)`
 * hands the controls to the bot, which walks to the friend, takes the parcel and drives. A live run is not an oracle (the `local`
 * profile differs from the `canonical` runs of `check:missions`); this only shows it makes progress.
 */
test.use({ storageState: { cookies: [], origins: [] } });

type W = { __dvBridge: { engine: EngineBridge; mission: MissionBridge & { autoplay(on: boolean): boolean } } };
type State = { phase: string; stage: number; stageId: string | null; objectives: { id: string; state: string }[] };

const mission = <T>(page: Page, fn: (m: W['__dvBridge']['mission']) => T | Promise<T>): Promise<T> => page.evaluate(`(${fn.toString()})(window.__dvBridge.mission)`) as Promise<T>;
const state = (page: Page): Promise<State | null> => mission(page, (m) => m.state() as unknown as State | null);
const cameraMode = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => (window as unknown as W).__dvBridge.engine.observe().camera?.mode as string | undefined);

test.describe('mission autoplay and director @mission-autoplay', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the intro beat is a cinematic shot, and the live autoplayer makes the sample progress @mission-autoplay', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize(SMALL_VIEWPORT);
    // sample the camera mode every 20 ms from the first frame: the intro is over in 2 s, before the page is ready for a first look
    await page.addInitScript(() => {
      const w = window as unknown as { __sawCinematic: boolean | object; __dvBridge?: { engine?: { observe?: () => { camera?: { mode?: string; pos?: number[] } | null } } } };
      w.__sawCinematic = false;
      setInterval(() => {
        try {
          const c = w.__dvBridge?.engine?.observe?.().camera;
          if (c?.mode === 'cinematic' && w.__sawCinematic === false) w.__sawCinematic = { pos: c.pos ?? null };
        } catch {
          // the bridge is not there yet
        }
      }, 20);
    });
    await page.goto('/?play=off&tier=mobile-low&mission=m.dev.sample&seed=1&talk=scripted');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.mission !== undefined, undefined, { timeout: 60_000 });

    // the beats (the 2 s intro, the 6 s meeting): the director's shot replaces the player's camera while they play. The page sampler
    // saw the camera in `cinematic` mode, at the position the director placed
    await page.waitForFunction(() => (window as unknown as { __sawCinematic?: unknown }).__sawCinematic !== false, undefined, { timeout: 90_000, polling: 100 });
    const saw = await page.evaluate(() => (window as unknown as { __sawCinematic: unknown }).__sawCinematic);
    expect(saw, 'a cinematic camera was seen during the beats').toBeTruthy();
    await expect.poll(() => cameraMode(page), { timeout: 30_000 }).not.toBe('cinematic');
    await expect.poll(async () => (await state(page))?.phase, { timeout: 30_000 }).toBe('stage');

    // the bot plays: it passes the first stages and gets into the car
    expect(await mission(page, (m) => m.autoplay(true))).toBe(true);
    await expect.poll(async () => (await state(page))?.stage ?? 0, { timeout: 150_000, intervals: [1000] }).toBeGreaterThanOrEqual(4);
    expect(errors).toEqual([]);
    await mission(page, (m) => m.autoplay(false));
  });
});
