import { expect, test, type Page } from '@playwright/test';
import type { MissionBridge } from '../../packages/modes/story/src/debug/bridge.ts';
import type { EngineBridge } from '../../packages/engine/src/client/debug/bridge.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M05a1 AC-10 in a real browser, on the QA build without DV_WORLD (the default `civic-graybox` scene; CI runs `@mission-debug` in
 * the GRAYBOX_GREP half): `/?mission=m.dev.sample&stage=0&seed=1&talk=scripted&beats=instant` boots the story mode on the sample
 * mission; `__dvBridge.mission.state()` reports phase `stage`, `hud.mission` holds the first objective key, `jump(3)` makes stage 3
 * active and the overlay lists the live threads. It also shows the overlay's start button in the default QA scene.
 */
test.use({ storageState: { cookies: [], origins: [] } });

type W = { __dvBridge: { engine: EngineBridge; mission: MissionBridge } };
type State = { phase: string; stage: number; stageId: string | null; stages: number; cast: { name: string; alive: boolean }[]; objectives: { id: string; state: string }[]; threads: { id: string }[] };

const FLAGS = 'mission=m.dev.sample&stage=0&seed=1&talk=scripted&beats=instant';
const mission = <T>(page: Page, fn: (m: MissionBridge) => T | Promise<T>): Promise<T> => page.evaluate(`(${fn.toString()})(window.__dvBridge.mission)`) as Promise<T>;
const state = (page: Page): Promise<State | null> => mission(page, (m) => m.state() as unknown as State | null);

async function boot(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto(`/?play=off&tier=mobile-low&${query}`);
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.mission !== undefined, undefined, { timeout: 60_000 });
  return errors;
}

test.describe('mission debugger @mission-debug', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the sample mission boots at stage 0, hud.mission holds the first objective, jump(3) moves to stage 3, the overlay lists the threads @mission-debug', async ({ page }) => {
    const errors = await boot(page, FLAGS);

    await expect.poll(async () => (await state(page))?.phase, { timeout: 60_000 }).toBe('stage');
    const s0 = (await state(page)) as State;
    expect(s0.stage).toBe(0);
    expect(s0.stageId).toBe('arrive');
    expect(s0.stages).toBe(16);
    expect(s0.objectives.map((o) => [o.id, o.state])).toEqual([['arrive_plaza', 'active']]);

    // the cast is in the world (the entities come to life one tick after the spawn)
    await expect.poll(async () => ((await state(page)) as State).cast.filter((c) => c.alive).map((c) => c.name).sort(), { timeout: 30_000 }).toEqual(['buddy', 'car', 'crate', 'runner']);

    // hud.mission carries the first objective's key
    await expect
      .poll(() => page.evaluate(() => (window as unknown as W).__dvBridge.engine.modes.vm('hud.mission')), { timeout: 30_000 })
      .toMatchObject({ titleKey: 'mission.m.dev.sample.title', objectiveKey: 'mission.m.dev.sample.obj.arrive_plaza' });

    // jump(3): stage 3 ('wheels') becomes active
    expect(await mission(page, (m) => m.jump(3))).toBe(true);
    await expect.poll(async () => (await state(page))?.stage, { timeout: 30_000 }).toBe(3);
    const s3 = (await state(page)) as State;
    expect(s3.stageId).toBe('wheels');
    expect(s3.objectives.map((o) => o.id)).toEqual(['enter_car']);

    // the overlay lists the live threads and objectives
    await expect(page.getByTestId('mission-overlay')).toBeVisible();
    await expect(page.getByTestId('mission-head')).toContainText('wheels');
    await expect(page.getByTestId('mission-threads')).toBeVisible();
    await expect(page.getByTestId('mission-overlay')).toContainText('1.obj.enter_car');
    await expect(page.getByTestId('mission-overlay')).toContainText('2.thr.nudge');
    expect(errors).toEqual([]);
  });

  test('the talk objective applies its default under ?talk=scripted, the stage moves on and the events are on the bridge @mission-debug', async ({ page }) => {
    await boot(page, FLAGS);
    await expect.poll(async () => (await state(page))?.phase, { timeout: 60_000 }).toBe('stage');
    expect(await mission(page, (m) => m.jump(1))).toBe(true);
    await expect.poll(async () => (await state(page))?.stageId, { timeout: 30_000 }).toBe('pickup');
    const events = await mission(page, (m) => m.events().map((e) => e.t));
    expect(events).toContain('talk');
    expect(events).toContain('stage');
    const pass = await mission(page, (m) => m.predicate('/requires'));
    expect(pass).toBeNull();
  });

  test('force pass ends the mission; the reward is in the wallet and the overlay says passed @mission-debug', async ({ page }) => {
    await boot(page, FLAGS);
    await expect.poll(async () => (await state(page))?.phase, { timeout: 60_000 }).toBe('stage');
    expect(await mission(page, (m) => m.pass())).toBe(true);
    await expect.poll(async () => (await state(page))?.phase, { timeout: 30_000 }).toBe('passed');
    await expect.poll(() => page.evaluate(() => (window as unknown as W).__dvBridge.engine.modes.vm('hud.wallet')), { timeout: 30_000 }).toMatchObject({ cashCents: 10_000, streetCred: 5 });
  });

  test('the default QA scene offers the sample mission; with no mission the bridge state is null @mission-debug', async ({ page }) => {
    await boot(page, '');
    await expect(page.getByTestId('mission-overlay')).toBeVisible();
    await expect(page.getByTestId('mission-start-sample')).toBeVisible();
    expect(await state(page)).toBeNull();
  });
});
