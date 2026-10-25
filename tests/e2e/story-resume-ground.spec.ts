import { expect, test, type Page } from '@playwright/test';
import type { MissionBridge } from '../../packages/modes/story/src/debug/bridge.ts';
import type { EngineBridge } from '../../packages/engine/src/client/debug/bridge.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { observe, SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * DL-736 (BD-FIX-SPAWN-11; `@story-resume-ground`, outside the graybox half of CI, on a `DV_WORLD=synth` QA build): a checkpoint resumed
 * after a reload waits for the ground under its saved pose. Before, the saved pose was written into `Transform` while its tiles were not
 * resident (the reload boots the player at the default spawn, kilometres from the Yard), so the player fell until the below-the-world net
 * caught it 2 s later.
 *
 * m.a1.01 starts (the far start moves the player to the Yard), the player stands idle there, the mission is moved to its checkpoint stage,
 * and once the checkpoint save is confirmed the page is reloaded. The mission continues at that stage with the player grounded at the
 * saved pose (within 1 m), and the player is never under the ground: not before the restore, and not over the 300 ticks after it.
 */
test.use({ storageState: { cookies: [], origins: [] } });

type W = { __dvBridge: { engine: EngineBridge; mission: MissionBridge; world: WorldBridge } };
type State = { phase: string; mission: string; stage: number; stageId: string | null };
type Pose = { x: number; y: number; z: number };

const FLAGS = 'play=story&story=1&tier=mobile-low&hooks=stub';
/** A player standing on the ground has its feet within this of the ground height under it. */
const ON_GROUND_M = 1;
/** The restored player stands within this of the saved pose. */
const AT_SAVED_M = 1;
const IDLE = 100;
const CONTROL_TELEPORT_WAITING = 701;

const state = (page: Page): Promise<State | null> => page.evaluate(() => (window as unknown as W).__dvBridge.mission.state() as unknown as State | null);
const mission = <T>(page: Page, fn: (m: W['__dvBridge']['mission']) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__dvBridge.mission)`) as Promise<T>;
const groundY = async (page: Page, x: number, z: number): Promise<number | null> =>
  ((await page.evaluate(([a, b]) => (window as unknown as W).__dvBridge.world.call('query', { x: a, z: b }), [x, z] as const)) as { groundY: number | null } | null)?.groundY ?? null;
const lastSave = (page: Page): Promise<{ reason: string; ok: boolean } | null> =>
  page.evaluate(async () => {
    const s = (await (window as unknown as W).__dvBridge.engine.save.list())[0]?.lastSave;
    return s ? { reason: s.reason, ok: s.ok } : null;
  });
/** The saved checkpoint of `story:auto` (the QA save bridge reads the real `dv-saves` database): its stage and the player pose in it. */
const savedCheckpoint = (page: Page): Promise<{ active: string | null; stage: number | null; player: Pose | null }> =>
  page.evaluate(async () => {
    const s = (await (window as unknown as W).__dvBridge.engine.save.load()).game.story['auto'];
    const cp = s?.activeMission?.checkpoint.data as { stage?: number; player?: { x: number; y: number; z: number } } | undefined;
    return { active: s?.activeMission?.id ?? null, stage: cp?.stage ?? null, player: cp?.player ? { x: cp.player.x, y: cp.player.y, z: cp.player.z } : null };
  });

async function waitForBridges(page: Page): Promise<void> {
  await waitForEngine(page);
  await page.waitForFunction(() => {
    const b = (window as unknown as Partial<W>).__dvBridge;
    return b?.mission !== undefined && b.world !== undefined;
  }, undefined, { timeout: 120_000 });
}

test.describe('checkpoint resume on the ground @story-resume-ground', () => {
  test.describe.configure({ timeout: 360_000 });

  test('a reload resumes m.a1.01 at its checkpoint with the player grounded at the saved pose @story-resume-ground', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto(`/?${FLAGS}`);
    await waitForBridges(page);

    // m.a1.01 runs at the Yard (after the far start's move), and the player stands idle on the ground there
    await expect.poll(async () => (await state(page))?.phase, { timeout: 150_000, intervals: [500] }).toBe('stage');
    expect((await state(page))?.mission).toBe('m.a1.01');
    await expect.poll(async () => {
      const pl = (await observe(page)).player;
      return pl !== null && pl.grounded && pl.control === IDLE;
    }, { timeout: 60_000, intervals: [250] }).toBe(true);

    // the checkpoint stage: entering it writes the checkpoint with the player's pose and asks for a save
    expect(await mission(page, (m) => m.jump(5))).toBe(true);
    await expect.poll(async () => (await state(page))?.stageId, { timeout: 30_000 }).toBe('tow_home');
    await expect.poll(() => lastSave(page), { timeout: 60_000, intervals: [250, 500, 1000] }).toEqual({ reason: 'checkpoint', ok: true });
    const cp = await savedCheckpoint(page);
    expect(cp).toMatchObject({ active: 'm.a1.01', stage: 5 });
    const saved = cp.player as Pose;
    expect(saved).not.toBeNull();

    await page.reload();
    await waitForBridges(page);

    // until the mission runs again: the player is never under the ground (where the ground under it is resident)
    let lowestBefore = Infinity;
    await expect
      .poll(async () => {
        const o = await observe(page);
        const p = o.player;
        if (p) {
          const gy = await groundY(page, p.pos[0], p.pos[2]);
          if (gy !== null) lowestBefore = Math.min(lowestBefore, p.pos[1] - gy);
        }
        const s = await state(page);
        return s?.mission === 'm.a1.01' && s.phase === 'stage' ? s.stageId : (s?.phase ?? 'none');
      }, { timeout: 180_000, intervals: [100] })
      .toBe('tow_home');
    expect(lowestBefore, 'the player sank under the ground before the restore').toBeGreaterThan(-ON_GROUND_M);

    // from the restore on, for 300 ticks: at the saved pose, on the resident ground, never under it; grounded at the end
    const startTick = (await observe(page)).tick;
    let lowest = Infinity;
    let farthest = 0;
    for (;;) {
      const o = await observe(page);
      const p = o.player;
      expect(p, 'the player exists').not.toBeNull();
      const pos = p!.pos;
      const gy = await groundY(page, pos[0], pos[2]);
      expect(gy, `the ground under the player at ${pos.map((n) => n.toFixed(1)).join(', ')} is resident`).not.toBeNull();
      lowest = Math.min(lowest, pos[1] - (gy as number));
      farthest = Math.max(farthest, Math.hypot(pos[0] - saved.x, pos[1] - saved.y, pos[2] - saved.z));
      if (o.tick - startTick >= 300 && p!.control !== CONTROL_TELEPORT_WAITING) {
        expect(p!.grounded, `grounded at tick ${o.tick}`).toBe(true);
        expect(Math.abs(pos[1] - (gy as number)), `feet ${pos[1].toFixed(2)} on the ground ${(gy as number).toFixed(2)}`).toBeLessThanOrEqual(ON_GROUND_M);
        break;
      }
      await page.waitForTimeout(200);
    }
    console.log(`story-resume-ground: saved (${saved.x.toFixed(2)}, ${saved.y.toFixed(2)}, ${saved.z.toFixed(2)}), farthest ${farthest.toFixed(3)} m, lowest ${lowest.toFixed(3)} m over the ground`);
    expect(farthest, 'the player stood at the saved pose').toBeLessThanOrEqual(AT_SAVED_M);
    expect(lowest, 'the player never sank under the ground').toBeGreaterThan(-ON_GROUND_M);
    expect((await state(page))?.stageId).toBe('tow_home');
    expect(errors).toEqual([]);
  });
});
