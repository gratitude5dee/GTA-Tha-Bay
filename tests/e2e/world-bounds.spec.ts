import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { Portal, ShoreNode, TeleportResult } from '../../packages/shared/src/index.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { act, observe, SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M02c1 world edges in a real browser, on a `DV_WORLD=synth` QA build (AC-12; `@world-bounds`):
 *
 *  - a player walked into the water of the south coast is in Swim and is respawned on the shore within 3 s;
 *  - a player teleported 100 m inside a county-line edge and walked outward by bot input gets `world.boundary` (`countyLine`) once,
 *    stops at the barrier, and the fog far plane ramps toward 0.4 at the line (the toast itself is M04b2's: the key is in en.json);
 *  - the play bounds plus 50 m are a wall in the physics world (a ray finds its face on every side).
 */
type W = { __dvBridge: { world: WorldBridge } };

const world = <T>(page: Page, fn: (w: WorldBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.world)`) as Promise<T>;

const call = <T>(page: Page, op: string, args?: Record<string, unknown>): Promise<T> =>
  page.evaluate(([o, a]) => (window as unknown as W).__dvBridge.world.call(o as string, a as Record<string, unknown> | undefined), [op, args]) as Promise<T>;

async function boot(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto('/?debug=1&tier=mobile-low');
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 180_000 });
  await expect
    .poll(async () => ((await call<{ topology?: boolean } | null>(page, 'state'))?.topology ?? false), { timeout: 120_000, intervals: [500, 1000, 2000] })
    .toBe(true);
}

/** `camYaw` (u16) that faces the direction (dx, dz): forward is (-sin yaw, -cos yaw). */
const camYawFor = (dx: number, dz: number): number => {
  let yaw = Math.atan2(-dx, -dz);
  if (yaw < 0) yaw += 2 * Math.PI;
  return Math.round((yaw / (2 * Math.PI)) * 65536) & 0xffff;
};

/** Walks forward along `camYaw` for `seconds` of sim time by bot input. */
const walk = (page: Page, camYaw: number, seconds: number): Promise<boolean> => act(page, { t: 'debug.bot', script: [{ from: 0, to: Math.round(seconds * 60), moveY: -127, camYaw }] });
const stopWalking = (page: Page): Promise<boolean> => act(page, { t: 'debug.bot', script: [] });

const CONTROL_OWNER_SWIM = 3;
const CONTROL_OWNER_ONFOOT = 1;

test.describe('world edges @world', () => {
  test.describe.configure({ timeout: 600_000 });

  test('a player walked into the water respawns on the shore within 3 s @world-bounds', async ({ page }) => {
    await boot(page);
    // the south coast of the synth city: water lies beyond the shore nodes of the chunks around x 1100, z 8200. Go there first, so the
    // chunks (and their shore nodes) are resident.
    const coast = (await page.evaluate((pt) => (window as unknown as W).__dvBridge.world.teleport(pt), { x: 1180, z: 8100 })) as TeleportResult;
    expect(coast.ok, JSON.stringify(coast)).toBe(true);
    const shore = (await call<{ node: ShoreNode | null }>(page, 'shore', { x: 1180, z: 8150 })).node;
    expect(shore, 'a shore node near the south coast').not.toBeNull();
    const s = shore as ShoreNode;
    const start = { x: s.x - s.nx * 30, z: s.z - s.nz * 30 };
    const there = (await page.evaluate((p) => (window as unknown as W).__dvBridge.world.teleport(p), start)) as TeleportResult;
    expect(there.ok, JSON.stringify(there)).toBe(true);

    const fadeBefore = (await world(page, (w) => w.fade())).log.length;
    expect(await walk(page, camYawFor(s.nx, s.nz), 40)).toBe(true);

    // into the water: the Swim owner takes over (poll the sim's own tick counter, not wall time)
    let swimTick = -1;
    await expect
      .poll(async () => {
        const o = await observe(page);
        if (o.player?.owner === CONTROL_OWNER_SWIM) swimTick = swimTick < 0 ? o.stats.tick : swimTick;
        return o.player?.owner;
      }, { timeout: 120_000, intervals: [100, 200, 500] })
      .toBe(CONTROL_OWNER_SWIM);
    const into = (await observe(page)).player!;
    const wet = await call<{ isWater: boolean; depth: number }>(page, 'query', { x: into.pos[0], z: into.pos[2] });
    expect(wet.isWater).toBe(true);
    expect(wet.depth).toBeGreaterThan(1.35);
    const wanted = await call<{ node: ShoreNode; pose: { x: number; z: number } }>(page, 'shore', { x: into.pos[0], z: into.pos[2] });
    await stopWalking(page);

    let arrivedTick = -1;
    await expect
      .poll(async () => {
        const o = await observe(page);
        const p = o.player;
        if (p && p.owner === CONTROL_OWNER_ONFOOT && p.control === 100) {
          arrivedTick = o.stats.tick;
          return true;
        }
        return false;
      }, { timeout: 60_000, intervals: [50, 100, 200] })
      .toBe(true);
    const ticks = arrivedTick - swimTick;
    console.log(`world-bounds water: swam at tick ${swimTick}, back on land at tick ${arrivedTick} (${(ticks / 60).toFixed(2)} s of sim time)`);
    expect(ticks).toBeLessThanOrEqual(3 * 60);
    const after = (await observe(page)).player!;
    const dry = await call<{ isWater: boolean }>(page, 'query', { x: after.pos[0], z: after.pos[2] });
    expect(dry.isWater).toBe(false);
    expect(Math.hypot(after.pos[0] - wanted.pose.x, after.pos[2] - wanted.pose.z)).toBeLessThanOrEqual(3);
    const fade = await world(page, (w) => w.fade());
    expect(fade.log.slice(fadeBefore).filter((d) => d === 'out').length).toBeGreaterThanOrEqual(1);
    expect(fade.log[fade.log.length - 1]).toBe('in');
  });

  test('walked outward from 100 m inside a county-line edge: one boundary event, a barrier stops the player, the fog closes in @world-bounds', async ({ page }) => {
    await boot(page);
    const { portals } = await call<{ portals: Portal[] }>(page, 'portals');
    const county = portals.filter((p) => p.kind === 'county-line');
    expect(county.length).toBeGreaterThan(0);

    // the first county-line portal with ground under the walk-in point
    let chosen: Portal | null = null;
    let fwd: [number, number] = [0, -1];
    for (const p of county) {
      const f: [number, number] = [-Math.sin(p.yaw), -Math.cos(p.yaw)];
      const sx = p.x - f[0] * 100, sz = p.z - f[1] * 100;
      const ok = (await page.evaluate((pt) => (window as unknown as W).__dvBridge.world.teleport(pt), { x: sx, z: sz })) as TeleportResult;
      // the service puts the player on the nearest valid ground; keep the portal whose walk-in point it did not have to move
      if (ok.ok && Math.hypot(ok.x - sx, ok.z - sz) <= 1) {
        chosen = p;
        fwd = f;
        break;
      }
    }
    expect(chosen, 'a county-line portal to walk to').not.toBeNull();
    const portal = chosen as Portal;
    const before = await world(page, (w) => w.boundaryEvents());

    expect(await walk(page, camYawFor(fwd[0], fwd[1]), 45)).toBe(true);
    const along = async (): Promise<number> => {
      const p = (await observe(page)).player!;
      return (p.pos[0] - portal.x) * fwd[0] + (p.pos[2] - portal.z) * fwd[1];
    };
    // wait until the player has reached the barrier: its position along the walk stops changing close to the portal
    let last = -1000;
    await expect
      .poll(async () => {
        const a = await along();
        const settled = Math.abs(a - last) < 0.02 && a > -3;
        last = a;
        return settled;
      }, { timeout: 150_000, intervals: [1500] })
      .toBe(true);
    const stop = await along();
    console.log(`world-bounds county line: stopped ${stop.toFixed(2)} m from the portal along the walk`);
    expect(stop).toBeLessThan(0);                  // still on the inside of the barrier
    expect(stop).toBeGreaterThan(-3);              // and up against it
    // walking on against the wall changes nothing, and the approach fired its event exactly once
    await new Promise((r) => setTimeout(r, 2500));
    expect(Math.abs((await along()) - stop)).toBeLessThan(0.05);
    expect((await world(page, (w) => w.boundaryEvents())) - before).toBe(1);
    expect((await world(page, (w) => w.lastBoundaryEvent()))?.s).toBe('countyLine');
    const state = await call<{ fog: number; boundary: { s: string } | null }>(page, 'state');
    expect(state.fog).toBeLessThan(0.45);
    expect(state.fog).toBeGreaterThanOrEqual(0.4);
    await stopWalking(page);
    const catalog = JSON.parse(readFileSync('packages/ui/src/i18n/en.json', 'utf8')) as Record<string, string>;
    expect(catalog['world.boundary.countyLine']).toBe('Leaving SF — coming soon');
  });

  test('the play bounds plus 50 m are a wall in the physics world, on every side @world-bounds', async ({ page }) => {
    await boot(page);
    const play = (await call<{ play: { minX: number; maxX: number; minZ: number; maxZ: number } }>(page, 'state')).play;
    const hit = async (from: [number, number, number], dir: [number, number, number]): Promise<number[] | null> =>
      (await call<{ at: number[] } | null>(page, 'ray', { from, dir, max: 500 }))?.at ?? null;
    const east = await hit([play.maxX - 5, 0, 0], [1, 0, 0]);
    const west = await hit([play.minX + 5, 0, 0], [-1, 0, 0]);
    const south = await hit([0, 0, play.maxZ - 5], [0, 0, 1]);
    const north = await hit([0, 0, play.minZ + 5], [0, 0, -1]);
    expect(east?.[0]).toBeCloseTo(play.maxX + 50, 1);
    expect(west?.[0]).toBeCloseTo(play.minX - 50, 1);
    expect(south?.[2]).toBeCloseTo(play.maxZ + 50, 1);
    expect(north?.[2]).toBeCloseTo(play.minZ - 50, 1);
  });
});
