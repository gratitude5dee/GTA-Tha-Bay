import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { enuFromLatLng, latLngFromEnu } from '../../packages/shared/src/index.ts';
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
 *  3. The vehicle net (DL-734, DL-735, BD-FIX-SPAWN-05, -09): a driven car 25 m under the terrain respawns, with its driver, on the nearest
 *     road within 3 s of sim time, through the ownership machine's move with the teleport's own fade (never `TeleportApi.request`).
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

  test('a driven car 25 m under the terrain is back on a road, with its driver, within 3 s of sim time @story-start', async ({ page }) => {
    const errors = await boot(page, 'debug=1&tier=mobile-low', false);
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 180_000 });
    await expect.poll(async () => {
      const pl = (await observe(page)).player;
      return pl !== null && pl.grounded && pl.control === 100;
    }, { timeout: 120_000, intervals: [250] }).toBe(true);
    // the road graph must be there for the net to find a road (it arrives after the first chunks)
    await expect.poll(async () => ((await page.evaluate(() => (window as unknown as W).__dvBridge.world.call('state'))) as { topology?: boolean } | null)?.topology ?? false, { timeout: 120_000, intervals: [500, 1000] }).toBe(true);
    const before = (await observe(page)).player!;
    const cx = before.pos[0] + 4, cz = before.pos[2];
    const gy = await groundY(page, cx, cz);
    expect(gy).not.toBeNull();

    // a sedan 25 m under the ground at the player's side, with the player seated at its wheel at once (the existing QA hooks)
    type EB = { __dvBridge: { engine: { spawn(p: string, at: [number, number, number], yaw: number): Promise<{ ok: boolean; handle?: number } | null>; vehicleOp(op: string, h?: number): Promise<{ ok: boolean } | null> } } };
    const sunkY = (gy as number) - 25;
    const car = await page.evaluate(([x, y, z]) => (window as unknown as EB).__dvBridge.engine.spawn('vehicle.sedan', [x, y, z], 0), [cx, sunkY, cz] as const);
    expect(car?.ok, JSON.stringify(car)).toBe(true);
    const seat = await page.evaluate((h) => (window as unknown as EB).__dvBridge.engine.vehicleOp('seat', h), car?.handle ?? 0);
    expect(seat?.ok, JSON.stringify(seat)).toBe(true);

    // sim time is the tick of the snapshot the car's pose comes from: from the first snapshot of the driven car under the ground ...
    let sunkTick = -1;
    let sunkPos: number[] = [];
    await expect
      .poll(async () => {
        const o = await observe(page);
        const v = o.vehicle as { pos: number[] } | null;
        if (o.player?.owner === 2 && v && (v.pos[1] as number) < (gy as number) - 20) {
          sunkTick = o.tick;
          sunkPos = v.pos;
        }
        return sunkTick >= 0;
      }, { timeout: 30_000, intervals: [20] })
      .toBe(true);
    // ... to the first one after the net moved it (up by more than 15 m, or across): observe alone, so the samples stay close together
    let backTick = -1;
    let backPos: number[] = [];
    await expect
      .poll(async () => {
        const o = await observe(page);
        const v = o.vehicle as { pos: number[] } | null;
        if (o.player?.owner === 2 && v && ((v.pos[1] as number) > (gy as number) - 10 || Math.hypot((v.pos[0] as number) - (sunkPos[0] as number), (v.pos[2] as number) - (sunkPos[2] as number)) > 2)) {
          backTick = o.tick;
          backPos = v.pos;
          return true;
        }
        return false;
      }, { timeout: 60_000, intervals: [20] })
      .toBe(true);
    const ticks = backTick - sunkTick;
    console.log(`story-start car: under the ground at tick ${sunkTick}, back at tick ${backTick} (${(ticks / 60).toFixed(2)} s of sim time) at ${backPos.map((n) => n.toFixed(1)).join(', ')}`);
    expect(ticks).toBeLessThanOrEqual(3 * 60);

    // back on a road: on the resident ground there, within 4 m of a drivable edge line, the player still at the wheel
    const backGround = await groundY(page, backPos[0] as number, backPos[2] as number);
    expect(backGround, 'the ground under the recovered car is resident').not.toBeNull();
    expect((backPos[1] as number) - (backGround as number), `car ${(backPos[1] as number).toFixed(2)} on the ground ${(backGround as number).toFixed(2)}`).toBeGreaterThan(-0.5);
    expect((backPos[1] as number) - (backGround as number)).toBeLessThan(2.5);
    const ll = latLngFromEnu(backPos[0] as number, backPos[2] as number);
    const snap = (await page.evaluate((a) => (window as unknown as W).__dvBridge.world.call('snap', a), { at: ll, snap: 'road' })) as { distM: number } | null;
    expect(snap, 'a road within 25 m').not.toBeNull();
    expect(snap!.distM, 'the car stands on the road (lane 0 lies about 2 m off the edge line)').toBeLessThanOrEqual(4);
    await page.waitForTimeout(1000);
    const later = await observe(page);
    expect(later.player?.owner, 'the player still drives').toBe(2);
    const lv = later.vehicle as { pos: number[] } | null;
    expect(lv, 'the car is still there').not.toBeNull();
    const lg = await groundY(page, lv!.pos[0] as number, lv!.pos[2] as number);
    expect(Math.abs((lv!.pos[1] as number) - (lg as number)), 'the car stays on the ground').toBeLessThan(2.5);
    expect(errors).toEqual([]);
  });
});
