import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { TeleportResult } from '../../packages/shared/src/index.ts';
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
    await expect.poll(async () => (await observe(page)).records, { timeout: 30_000 }).toBeGreaterThanOrEqual(7);   // the player and six cars
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
    // 200 (entering) lasts only a few ticks and the page samples slower than that, so it is optional here (the unit spec
    // vehicle.enter-exit pins the sequence); when it is seen it must come before 201.
    const states = await seen(page, [201], 15_000);
    expect(states).toContain(201);
    if (states.includes(200)) expect(states.indexOf(200)).toBeLessThan(states.indexOf(201));
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
    const target = spawned?.handle ?? 0;
    const locked = await page.evaluate((h) => (window as unknown as { __dvBridge: { engine: Bridge } }).__dvBridge.engine.vehicleOp('lock', h), target);
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


/**
 * AC-10 on the `DV_WORLD=synth` build. The synth city has one layered overpass (the avenue at x = 1340 from z = 2216 to 2696, deck at
 * terrain + 5.5 m) and one short tunnel (the street at z = 3016 from x = -2660 to -2180, with a hood over it), `config/world/synth.json`.
 * A sedan is driven over each by a canonical input line; every sample of the run is checked against the world's own `groundY`, asked
 * while the car is there (a chunk that the car has left is no longer resident, and `groundY` is then `null`).
 *
 * A chunk that has not streamed in yet is a wall (`wallPrism`), so a car that outruns the stream waits at it. The run therefore plays
 * the line in rounds of 15 s and goes on until the car is through, instead of trusting one long throttle line.
 */
type W = { __dvBridge: { world: { call(op: string, args?: Record<string, unknown>): Promise<unknown>; teleport(pt: { x: number; z: number }): Promise<TeleportResult | null> } } };
type EB = { __dvBridge: { engine: Bridge } };
const wcall = <T>(page: Page, op: string, args?: Record<string, unknown>): Promise<T> =>
  page.evaluate(([o, a]) => (window as unknown as W).__dvBridge.world.call(o as string, a as Record<string, unknown> | undefined), [op, args]) as Promise<T>;

async function bootWorld(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto('/?debug=1&tier=mobile-low');
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as { __dvBridge: { world: { boot(): { revealed: boolean } } } }).__dvBridge.world.boot().revealed, undefined, { timeout: 180_000 });
  await expect.poll(async () => ((await wcall<{ topology?: boolean } | null>(page, 'state'))?.topology ?? false), { timeout: 120_000, intervals: [500, 1000, 2000] }).toBe(true);
  return errors;
}

const groundAt = async (page: Page, x: number, z: number, y?: number): Promise<number> =>
  (await wcall<{ groundY: number | null }>(page, 'query', { x, z, ...(y !== undefined ? { y } : {}) })).groundY ?? Number.NaN;

interface Sample {
  x: number; y: number; z: number; speed: number;
  /** `groundY` at the car with the car's height as the hint, and the terrain below any deck (hint far below). */
  g: number; terrain: number; top: number;
  /** Distance to the first solid thing straight above the car, or null. */
  up: number | null;
}

/** Where a run keeps to and where it ends: the centre line is `lateral = centre`, `sign` makes an offset positive on the car's own right. */
interface Course { lateral: 'x' | 'z'; centre: number; sign: 1 | -1; keep: boolean; endAxis: 'x' | 'z'; endValue: number; endDir: 1 | -1 }

/**
 * Puts a sedan 6 m ahead of (x, z) facing `yaw`, seats the player in it and drives it along `course` with a controller that runs in the
 * page (every ~100 ms, without a round trip per look): full `throttle` below `cruise` m/s, the brake above it, and a steer that holds
 * the centre line. The street through the tunnel falls 25 %, and an eastbound sedan at 40 m/s leaves the road on the cell steps of the
 * heightfield and hits a hood (BD-M03a1-10). Every look also asks the world, while the car is there, for the surface under it.
 */
async function drive(page: Page, at: { x: number; z: number }, yaw: number, throttle: number, cruise: number, course: Course): Promise<Sample[]> {
  const tp = await page.evaluate((pt) => (window as unknown as W).__dvBridge.world.teleport(pt), { x: at.x, z: at.z });
  expect(tp?.ok, JSON.stringify(tp)).toBe(true);
  // the car stands 6 m ahead of the player (a capsule inside the hull would shove it), the player is seated at once
  const cx = at.x - 6 * Math.sin(yaw), cz = at.z - 6 * Math.cos(yaw);
  const y = await groundAt(page, cx, cz);
  expect(Number.isFinite(y)).toBe(true);
  const car = await page.evaluate(([p, ya]) => (window as unknown as EB).__dvBridge.engine.spawn('vehicle.sedan', p as [number, number, number], ya as number), [[cx, y + 0.9, cz], yaw] as const);
  expect(car?.ok, JSON.stringify(car)).toBe(true);
  const seat = await page.evaluate((h) => (window as unknown as EB).__dvBridge.engine.vehicleOp('seat', h), car?.handle ?? 0);
  expect(seat?.ok, JSON.stringify(seat)).toBe(true);
  const samples = await page.evaluate(async (a) => {
    type Call = (op: string, args?: Record<string, unknown>) => Promise<unknown>;
    const eng = (window as unknown as { __dvBridge: { engine: Bridge & { observe(): { vehicle: { pos: number[]; speed: number } | null } } } }).__dvBridge.engine;
    const call = (window as unknown as { __dvBridge: { world: { call: Call } } }).__dvBridge.world.call;
    const ground = async (x: number, z: number, h?: number): Promise<number> => ((await call('query', { x, z, ...(h !== undefined ? { y: h } : {}) })) as { groundY: number | null }).groundY ?? Number.NaN;
    const out: { x: number; y: number; z: number; speed: number; g: number; terrain: number; top: number; up: number | null }[] = [];
    const t0 = performance.now();
    let speed = 0, steer = 0;
    while (performance.now() - t0 < 420_000) {
      const v = eng.observe().vehicle;
      if (v) {
        const x = v.pos[0] as number, vy = v.pos[1] as number, z = v.pos[2] as number;
        speed = v.speed;
        const off = a.course.sign * ((a.course.lateral === 'x' ? x : z) - a.course.centre);
        steer = a.course.keep ? Math.round(-Math.max(-0.06, Math.min(0.06, 0.015 * off)) * 127) : 0;   // a weak pull to the centre line: the deck's cross-fall drifts a car 20 m in 500 m
        const up = (await call('ray', { from: [x, vy + 1, z], dir: [0, 1, 0], max: 12 })) as { toi: number } | null;
        out.push({ x, y: vy, z, speed, g: await ground(x, z, vy), terrain: await ground(x, z, -50), top: await ground(x, z), up: up ? up.toi : null });
        if ((a.course.endAxis === 'x' ? x : z) * a.course.endDir > a.course.endValue * a.course.endDir) break;
      }
      await eng.line.play({
        v: 1, scenario: 'vehicle-world', seed: 0xc0ffee, profile: 'local', start: { pos: [a.cx, a.y, a.cz], yaw: a.yaw, prefab: 'vehicle.sedan' },
        frames: [{ tick: 0, run: 90, input: { buttons: 0, moveX: 0, moveY: 0, throttle: speed < a.cruise ? a.throttle : 0, brake: speed > a.cruise + 1 ? 70 : 0, steer, camYaw: 0, camPitch: 0, context: 1 } }],
      });
      await new Promise((r) => setTimeout(r, 40));
    }
    await eng.line.stop();
    return out;
  }, { course, cx, cz, y, yaw, throttle, cruise });
  return samples as Sample[];
}

test.describe('vehicles in the synth city @vehicle-world', () => {
  // one at a time: two software-rendered synth worlds side by side starve each other's chunk streaming
  test.describe.configure({ timeout: 600_000, mode: 'serial' });

  test('a sedan drives over the overpass slab and never falls below the ground @vehicle-world', async ({ page }) => {
    const errors = await bootWorld(page);
    // south along the avenue (yaw pi), from the deck's first metres (the synth deck starts 1.6 to 2.9 m above the approach, a lip no car
    // mounts: BD-M03a1-10) to past its far end, where the car drops back onto the street
    const samples = await drive(page, { x: 1340, z: 2232 }, Math.PI, 90, 8, { lateral: 'x', centre: 1340, sign: -1, keep: true, endAxis: 'z', endValue: 2520, endDir: 1 });
    expect(samples.length).toBeGreaterThan(8);
    expect(samples[samples.length - 1]!.z, 'reached the far end').toBeGreaterThan(2500);
    let onDeck = 0;
    for (const s of samples) {
      if (Number.isNaN(s.g)) continue;   // the chunk was not resident for this sample
      expect(s.y, `above the surface at z ${s.z.toFixed(1)}`).toBeGreaterThan(s.g + 0.1);
      expect(s.y, `on the surface (not airborne) at z ${s.z.toFixed(1)}`).toBeLessThan(s.g + 4);
      if (s.z > 2260 && s.z < 2480) {
        expect(Math.abs(s.g - s.top), `the car's surface is the deck at z ${s.z.toFixed(1)}`).toBeLessThan(0.05);
        expect(s.y, `on the deck at z ${s.z.toFixed(1)}`).toBeGreaterThan(s.top);
        expect(s.y, `not airborne above the deck at z ${s.z.toFixed(1)}`).toBeLessThan(s.top + 1.5);
        onDeck++;
      }
    }
    expect(onDeck, 'samples while on the deck').toBeGreaterThan(5);
    expect(errors).toEqual([]);
  });

  test('a sedan drives through the tunnel and leaves it from under the hood @vehicle-world', async ({ page }) => {
    const errors = await bootWorld(page);
    // east along the street (yaw -pi/2), from 140 m before the west portal to 100 m after the east one, at 6 m/s (it falls 25 %; the
    // west-bound climb ends at a 52 % step at the east portal that no sedan mounts, BD-M03a1-10)
    const samples = await drive(page, { x: -2800, z: 3016 }, -Math.PI / 2, 90, 6, { lateral: 'z', centre: 3016, sign: 1, keep: true, endAxis: 'x', endValue: -2080, endDir: 1 });
    expect(samples.length).toBeGreaterThan(8);
    expect(samples[samples.length - 1]!.x, 'came out of the tunnel').toBeGreaterThan(-2100);
    let under = 0;
    for (const s of samples) {
      if (Number.isNaN(s.g)) continue;
      expect(s.y, `above the road at x ${s.x.toFixed(1)}`).toBeGreaterThan(s.g + 0.1);
      const covered = s.up !== null && s.up < 9;
      if (s.x > -2600 && s.x < -2240 && covered) under++;
      if (s.x < -2720 || s.x > -2120) expect(covered, `open sky at x ${s.x.toFixed(1)}`).toBe(false);
    }
    expect(under, 'samples under the hood').toBeGreaterThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  test('a closed edge shows a barrier at both ends and loses them when it opens @vehicle-world', async ({ page }) => {
    const errors = await bootWorld(page);
    const tp = await page.evaluate((pt) => (window as unknown as W).__dvBridge.world.teleport(pt), { x: 1340, z: 1700 });
    expect(tp?.ok, JSON.stringify(tp)).toBe(true);
    const route = await wcall<{ edges: number[]; count: number } | null>(page, 'route', { from: { x: 1340, z: 1640 }, to: { x: 1340, z: 1760 } });
    expect(route && route.edges.length > 0, JSON.stringify(route)).toBe(true);
    const edge = route!.edges[0] as number;
    await expect.poll(async () => (await observe(page)).records, { timeout: 30_000 }).toBeGreaterThan(0);
    const before = (await observe(page)).records;
    await wcall(page, 'closeEdges', { edges: [edge], by: 'e2e' });
    await expect.poll(async () => (await observe(page)).records - before, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    await wcall(page, 'release', { by: 'e2e' });
    await expect.poll(async () => (await observe(page)).records - before, { timeout: 30_000 }).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});
