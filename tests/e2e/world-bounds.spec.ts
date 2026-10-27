import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { Portal, ShoreNode, TeleportResult } from '../../packages/shared/src/index.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { act, observe, SMALL_VIEWPORT, waitForEngine, type Obs } from './engine-helpers.ts';

/**
 * M02c1 world edges in a real browser, on a `DV_WORLD=synth` QA build (AC-12; `@world-bounds`):
 *
 *  - a player walked into the water of the south coast is in Swim and is respawned on the shore within 3 s, where it then stands still;
 *    with forward held through the respawn it faces inland and waits there until the stick is let go (DL-753);
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

/**
 * The south coast of the synth city: water lies beyond the shore nodes of the chunks around x 1100, z 8200. Goes there first, so the
 * chunks (and their shore nodes) are resident, then stands 30 m inland of a shore node and returns it.
 */
async function toTheCoast(page: Page): Promise<ShoreNode> {
  const coast = (await page.evaluate((pt) => (window as unknown as W).__dvBridge.world.teleport(pt), { x: 1180, z: 8100 })) as TeleportResult;
  expect(coast.ok, JSON.stringify(coast)).toBe(true);
  const shore = (await call<{ node: ShoreNode | null }>(page, 'shore', { x: 1180, z: 8150 })).node;
  expect(shore, 'a shore node near the south coast').not.toBeNull();
  const s = shore as ShoreNode;
  const start = { x: s.x - s.nx * 30, z: s.z - s.nz * 30 };
  const there = (await page.evaluate((p) => (window as unknown as W).__dvBridge.world.teleport(p), start)) as TeleportResult;
  expect(there.ok, JSON.stringify(there)).toBe(true);
  return s;
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
const CONTROL_STATE_IDLE = 100;

/**
 * Ticks of one step of the walk into the water. Under the swim's 90 ticks before the respawn (`SWIM_RESPAWN_TICKS`), so the step that
 * reaches deep water has ended, and the stick is free, before the player is put back on the shore (BD-FIX-WATERRESPAWN-01).
 */
const STEP_TICKS = 45;

/**
 * Walks forward along `camYaw` by bot input in steps of `STEP_TICKS` sim ticks until the Swim owner takes over, and returns the observation
 * that first showed Swim. A step starts only while the player stands still on land (the step before it is over: on foot, idle, not moving,
 * and away from where that step began). So the stick is held at most `STEP_TICKS` after the player enters the water, counted by the sim
 * itself: a page that looks late (a busy runner) only adds standing time between steps, and the stick is never held into the respawn.
 */
async function walkIntoWater(page: Page, camYaw: number): Promise<Obs> {
  for (let step = 0; step < 60; step++) {
    const from = (await observe(page)).player!;
    expect(await act(page, { t: 'debug.bot', script: [{ from: 0, to: STEP_TICKS, moveY: -127, camYaw }] })).toBe(true);
    const seen: { swim: Obs | null } = { swim: null };
    await expect
      .poll(async () => {
        const o = await observe(page);
        const p = o.player;
        if (p?.owner === CONTROL_OWNER_SWIM) {
          seen.swim = o;
          return true;
        }
        return p !== null && p.owner === CONTROL_OWNER_ONFOOT && p.control === CONTROL_STATE_IDLE
          && Math.hypot(p.vel[0], p.vel[2]) < 0.01 && Math.hypot(p.pos[0] - from.pos[0], p.pos[2] - from.pos[2]) > 0.5;
      }, { timeout: 60_000, intervals: [100, 200, 500] })
      .toBe(true);
    if (seen.swim) return seen.swim;
  }
  throw new Error('the walk did not reach water deeper than the chest');
}

test.describe('world edges @world', () => {
  test.describe.configure({ timeout: 600_000 });

  test('a player walked into the water respawns on the shore within 3 s @world-bounds', async ({ page }) => {
    await boot(page);
    const s = await toTheCoast(page);
    const fadeBefore = (await world(page, (w) => w.fade())).log.length;

    // into the water: the Swim owner takes over (the sim's own tick counter, not wall time)
    const swim = await walkIntoWater(page, camYawFor(s.nx, s.nz));
    const swimTick = swim.stats.tick;
    const into = swim.player!;
    const wet = await call<{ isWater: boolean; depth: number }>(page, 'query', { x: into.pos[0], z: into.pos[2] });
    expect(wet.isWater).toBe(true);
    expect(wet.depth).toBeGreaterThan(1.35);
    const wanted = await call<{ node: ShoreNode; pose: { x: number; z: number } }>(page, 'shore', { x: into.pos[0], z: into.pos[2] });

    let arrivedTick = -1;
    await expect
      .poll(async () => {
        const o = await observe(page);
        const p = o.player;
        if (p && p.owner === CONTROL_OWNER_ONFOOT && p.control === CONTROL_STATE_IDLE) {
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
    await stopWalking(page);
  });

  // BD-FIX-WATERRESPAWN-01: the CI flake of the test above was its walk, one 40 s bot script stopped by a command sent after four page
  // round trips; on a busy runner the stop reached the sim after the respawn, and the player ran from the shore pose back toward the sea.
  // This test looks at the player only long after the respawn, as the slowest runner would: with a walk that holds the stick into the
  // respawn it fails every time; with `walkIntoWater` the player stands at the shore pose, still.
  test('a player respawned from the water stands still at the shore pose, however late the page looks @world-bounds', async ({ page }) => {
    await boot(page);
    const s = await toTheCoast(page);
    const swim = await walkIntoWater(page, camYawFor(s.nx, s.nz));
    const into = swim.player!;
    const wanted = await call<{ pose: { x: number; z: number } }>(page, 'shore', { x: into.pos[0], z: into.pos[2] });
    // 4 s of sim time after the swim began: the respawn (1.5 s, then the teleport and its settle) is long over
    const late = swim.stats.tick + 4 * 60;
    await expect.poll(async () => (await observe(page)).stats.tick, { timeout: 120_000, intervals: [200, 500] }).toBeGreaterThanOrEqual(late);
    const first = (await observe(page)).player!;
    await expect.poll(async () => (await observe(page)).stats.tick, { timeout: 60_000, intervals: [200, 500] }).toBeGreaterThanOrEqual(late + 60);
    const then = (await observe(page)).player!;
    console.log(`world-bounds water, late look: at ${first.pos.map((v) => v.toFixed(3)).join(', ')}, a second later ${then.pos.map((v) => v.toFixed(3)).join(', ')}, pose ${wanted.pose.x}, ${wanted.pose.z}`);
    for (const p of [first, then]) {
      expect(p.owner).toBe(CONTROL_OWNER_ONFOOT);
      expect(p.control).toBe(CONTROL_STATE_IDLE);
      expect(Math.hypot(p.pos[0] - wanted.pose.x, p.pos[2] - wanted.pose.z)).toBeLessThanOrEqual(0.5);
    }
    expect(Math.hypot(then.pos[0] - first.pos[0], then.pos[2] - first.pos[2])).toBeLessThan(0.01);
    expect((await call<{ isWater: boolean }>(page, 'query', { x: then.pos[0], z: then.pos[2] })).isWater).toBe(false);
    await stopWalking(page);
  });

  // DL-753 (02-world-maps.md 4.1 a): forward held through the whole water respawn. One bot script holds the stick toward the sea for 40 s:
  // into the water, through the swim, the fade and the respawn. The player is put back facing inland, the page's camera turns inland
  // with it, and the held stick moves nothing; once the stick is free the latch lets go, and the keyboard's W (real input, along the
  // page's camera) walks the player inland, away from the water.
  test('forward held through a water respawn: the player waits on the shore pose facing inland until released, then walks inland @world-bounds', async ({ page }) => {
    await boot(page);
    const s = await toTheCoast(page);
    expect((await observe(page)).play).toBe(true);
    const seq0 = (await observe(page)).player?.respawn?.seq ?? 0;
    expect(await walk(page, camYawFor(s.nx, s.nz), 40)).toBe(true);

    // the respawn: the sim records it when the fade-in starts
    const seen: { back: Obs | null } = { back: null };
    await expect
      .poll(async () => {
        const o = await observe(page);
        if ((o.player?.respawn?.seq ?? 0) > seq0) seen.back = o;
        return seen.back !== null;
      }, { timeout: 120_000, intervals: [100, 200, 500] })
      .toBe(true);
    const back = seen.back as unknown as Obs;
    const respawn = back.player!.respawn!;
    // the shore node 2 m seaward of where the player stands, along the published yaw: the player is on its pose, facing along its normal
    const pose = { x: back.player!.pos[0], z: back.player!.pos[2] };
    const node = (await call<{ node: ShoreNode }>(page, 'shore', { x: pose.x + 2 * Math.sin(respawn.yaw), z: pose.z + 2 * Math.cos(respawn.yaw) })).node;
    expect(Math.hypot(node.x - node.nx * 2 - pose.x, node.z - node.nz * 2 - pose.z)).toBeLessThan(0.01);
    const inland = Math.atan2(node.nx, node.nz);
    const angleTo = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    expect(angleTo(respawn.yaw, inland)).toBeLessThan(1e-6);

    // 2 s of sim time later, and once more a second after that, with the stick still held toward the sea
    const tick0 = back.stats.tick;
    const looks: Obs[] = [];
    for (const wait of [120, 180]) {
      await expect.poll(async () => (await observe(page)).stats.tick, { timeout: 120_000, intervals: [200, 500] }).toBeGreaterThanOrEqual(tick0 + wait);
      looks.push(await observe(page));
    }
    for (const o of looks) {
      const p = o.player!;
      expect(p.owner).toBe(CONTROL_OWNER_ONFOOT);
      expect(p.control).toBe(CONTROL_STATE_IDLE);
      expect(p.latched).toBe(true);
      expect(Math.hypot(p.pos[0] - pose.x, p.pos[2] - pose.z)).toBeLessThanOrEqual(0.5);
      // the page's camera looks inland too (the same yaw the keyboard's W walks along)
      expect(angleTo(o.camera!.yaw, inland)).toBeLessThan(1e-3);
    }
    const [first, then] = looks as [Obs, Obs];
    expect(Math.hypot(then.player!.pos[0] - first.player!.pos[0], then.player!.pos[2] - first.player!.pos[2])).toBeLessThan(0.01);
    console.log(`world-bounds water latch: respawned at tick ${tick0}, held 3 s at ${then.player!.pos.map((v) => v.toFixed(3)).join(', ')}, pose ${pose.x}, ${pose.z}`);

    // the stick is let go: the next frame is centred and the latch lets go
    await stopWalking(page);
    await expect.poll(async () => (await observe(page)).player?.latched ?? false, { timeout: 60_000, intervals: [100, 200, 500] }).toBe(false);

    // W walks the player along the camera, inland, away from the water
    await page.keyboard.down('KeyW');
    try {
      await expect
        .poll(async () => {
          const p = (await observe(page)).player!;
          return (p.pos[0] - pose.x) * -node.nx + (p.pos[2] - pose.z) * -node.nz;
        }, { timeout: 60_000, intervals: [100, 200, 500] })
        .toBeGreaterThan(2);
    } finally {
      await page.keyboard.up('KeyW');
    }
    const walked = (await observe(page)).player!;
    expect(walked.owner).toBe(CONTROL_OWNER_ONFOOT);
    expect(Math.abs((walked.pos[0] - pose.x) * node.nz - (walked.pos[2] - pose.z) * node.nx)).toBeLessThan(1);   // straight inland
    expect((await call<{ isWater: boolean }>(page, 'query', { x: walked.pos[0], z: walked.pos[2] })).isWater).toBe(false);
    expect((await observe(page)).player?.respawn?.seq).toBe(respawn.seq);    // no second trip into the water
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
    const catalog = JSON.parse(readFileSync('content/ui/i18n/en.json', 'utf8')) as Record<string, string>;
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
