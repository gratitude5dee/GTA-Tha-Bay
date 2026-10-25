import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { enuFromLatLng } from '../../packages/shared/src/index.ts';
import type { MissionBridge } from '../../packages/modes/story/src/debug/bridge.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { act, observe, SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * The new game's start on a `DV_WORLD=synth` QA build (fix S, BD-FIX-SPAWN-01 and -02; `@story-start`, outside the graybox half of CI).
 * The owner's report: with `?play=story&story=1` the player started by falling through the void under the city while the mission's
 * cast stood at the Yard 1.9 km above it. The first auto mission (m.a1.01) moved the player to the Yard before the ground there was
 * resident, at the resolver's fallback height. Now the move is a `TeleportApi.request('respawn', ...)`, and the mission starts only
 * once the player stands on the ground there.
 *
 *  1. `?play=story&story=1`: m.a1.01 starts within a bounded time; whenever it is active the player is within the teleport's search
 *     radius of the Yard; once it runs the player is grounded on the resident ground and stays there; the cast stands near.
 *  2. The safety net: a player pushed under the terrain is back on the ground within 3 s of sim time.
 */
test.use({ storageState: { cookies: [], origins: [] } });

type W = { __dvBridge: { mission: MissionBridge; world: WorldBridge } };
type CastRow = { name: string; alive: boolean; distance: number };
type State = { phase: string; mission: string; stage: number; cast?: CastRow[] };

const starts = JSON.parse(readFileSync('config/autoplay/mission-starts.json', 'utf8')) as { default: { lat: number; lng: number } };
const YARD = enuFromLatLng(starts.default.lat, starts.default.lng);
/** The teleport places within 40 m of its target (`PLACE_RADIUS_M`, 02-world-maps.md 5 step 4). */
const NEAR_START_M = 40;
/** The cast of m.a1.01 stands at the Yard gate, about 20 m from the start; anything past this is another place. */
const CAST_NEAR_M = 60;
/** A player standing on the ground has its feet within this of the ground height under it. */
const ON_GROUND_M = 1;
const CONTROL_TELEPORT_WAITING = 701;

const state = (page: Page): Promise<State | null> => page.evaluate(() => (window as unknown as W).__dvBridge.mission.state() as unknown as State | null);
const groundY = async (page: Page, x: number, z: number): Promise<number | null> =>
  ((await page.evaluate(([a, b]) => (window as unknown as W).__dvBridge.world.call('query', { x: a, z: b }), [x, z] as const)) as { groundY: number | null } | null)?.groundY ?? null;
const distToYard = (p: [number, number, number]): number => Math.hypot(p[0] - YARD.x, p[2] - YARD.z);

async function boot(page: Page, query: string, mission = true): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto(`/?${query}`);
  await waitForEngine(page);
  await page.waitForFunction((m) => (window as unknown as Partial<W>).__dvBridge?.world !== undefined && (!m || (window as unknown as Partial<W>).__dvBridge?.mission !== undefined), mission, { timeout: 120_000 });
  return errors;
}

test.describe('story start @story-start', () => {
  test.describe.configure({ timeout: 300_000 });

  test('?play=story&story=1 starts m.a1.01 with the player grounded at the Yard and the cast near @story-start', async ({ page }) => {
    const errors = await boot(page, 'play=story&story=1&tier=mobile-low');

    // until the mission runs: every look at it while it is active finds the player at the Yard, never somewhere else (the bug: in the void)
    let farWhileActive = 0;
    await expect
      .poll(async () => {
        const s = await state(page);
        const pl = (await observe(page)).player;
        if (s && pl) farWhileActive = Math.max(farWhileActive, distToYard(pl.pos));
        return s?.mission === 'm.a1.01' && (s.phase === 'intro' || s.phase === 'stage') ? 'running' : (s?.phase ?? 'none');
      }, { timeout: 120_000, intervals: [200] })
      .toBe('running');
    expect(farWhileActive, 'the player was away from the Yard while m.a1.01 was active').toBeLessThanOrEqual(NEAR_START_M);

    // grounded on the resident ground there, and still there 5 s of sim time later (not falling)
    const first = await observe(page);
    const startTick = first.tick;
    let lowest = Infinity;
    for (;;) {
      const o = await observe(page);
      const pl = o.player;
      expect(pl, 'the player exists').not.toBeNull();
      const p = pl!;
      expect(distToYard(p.pos), `player ${JSON.stringify(p.pos)} near the Yard (${YARD.x.toFixed(1)}, ${YARD.z.toFixed(1)})`).toBeLessThanOrEqual(NEAR_START_M);
      const gy = await groundY(page, p.pos[0], p.pos[2]);
      expect(gy, 'the ground under the player is resident').not.toBeNull();
      lowest = Math.min(lowest, p.pos[1] - (gy as number));
      if (o.tick - startTick >= 300 && p.control !== CONTROL_TELEPORT_WAITING) {
        expect(p.grounded, `grounded at tick ${o.tick}`).toBe(true);
        expect(Math.abs(p.pos[1] - (gy as number)), `feet ${p.pos[1].toFixed(2)} on the ground ${(gy as number).toFixed(2)}`).toBeLessThanOrEqual(ON_GROUND_M);
        break;
      }
      await page.waitForTimeout(250);
    }
    expect(lowest, 'the player never sank under the ground').toBeGreaterThan(-ON_GROUND_M);

    // the cast stands near (a member not spawned yet reports -1)
    const s = (await state(page)) as State;
    const cast = (s.cast ?? []).filter((c) => c.alive && c.distance >= 0);
    expect(cast.length, JSON.stringify(s.cast)).toBeGreaterThan(0);
    for (const c of cast) expect(c.distance, `${c.name} ${c.distance} m from the player`).toBeLessThanOrEqual(CAST_NEAR_M);
    expect(errors).toEqual([]);
  });

  test('a player pushed under the terrain is back on the ground within 3 s of sim time @story-start', async ({ page }) => {
    const errors = await boot(page, 'debug=1&tier=mobile-low', false);
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 180_000 });
    await expect.poll(async () => {
      const pl = (await observe(page)).player;
      return pl !== null && pl.grounded && pl.control === 100;
    }, { timeout: 120_000, intervals: [250] }).toBe(true);
    const before = (await observe(page)).player!;
    const gy = await groundY(page, before.pos[0], before.pos[2]);
    expect(gy).not.toBeNull();

    // 25 m under the ground: the character falls through nothing, as the player of the report did
    const ins = (await page.evaluate(() => (window as unknown as { __dvBridge: { engine: { tools: { inspect(): Promise<{ handle: number } | null> } } } }).__dvBridge.engine.tools.inspect())) as { handle: number };
    const sunk = (gy as number) - 25;
    expect(await act(page, { t: 'debug.edit', id: 4242, handle: ins.handle, component: 'Transform', field: 'py', value: sunk })).toBe(true);
    // sim time is the tick of the snapshot the player pose comes from: from the first snapshot under the ground to the first back on it
    let sunkTick = -1;
    await expect
      .poll(async () => {
        const o = await observe(page);
        if (o.player!.pos[1] < (gy as number) - 20) sunkTick = o.tick;
        return sunkTick >= 0;
      }, { timeout: 30_000, intervals: [20] })
      .toBe(true);

    // back: grounded and up at the ground level again (observe alone, so the samples stay close together); then the ground there is checked
    let backTick = -1;
    await expect
      .poll(async () => {
        const o = await observe(page);
        const p = o.player!;
        if (p.grounded && p.pos[1] > (gy as number) - 5) {
          backTick = o.tick;
          return true;
        }
        return false;
      }, { timeout: 60_000, intervals: [20] })
      .toBe(true);
    const back = (await observe(page)).player!;
    const backGround = await groundY(page, back.pos[0], back.pos[2]);
    expect(backGround, 'the ground under the recovered player is resident').not.toBeNull();
    expect(Math.abs(back.pos[1] - (backGround as number)), `feet ${back.pos[1].toFixed(2)} on the ground ${(backGround as number).toFixed(2)}`).toBeLessThanOrEqual(ON_GROUND_M);
    const ticks = backTick - sunkTick;
    console.log(`story-start fall: under the ground at tick ${sunkTick}, back on the ground at tick ${backTick} (${(ticks / 60).toFixed(2)} s of sim time)`);
    expect(ticks).toBeLessThanOrEqual(3 * 60);
    const after = (await observe(page)).player!;
    expect(Math.hypot(after.pos[0] - before.pos[0], after.pos[2] - before.pos[2])).toBeLessThanOrEqual(60);
    expect(errors).toEqual([]);
  });
});
