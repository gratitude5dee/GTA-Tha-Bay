import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { decodeGraph, type TeleportResult, type WorldIndex } from '../../packages/shared/src/index.ts';
import { RoadNetwork } from '../../packages/world/src/sim/graph/adjacency.ts';
import { RoadGraph } from '../../packages/world/src/sim/graph/query.ts';
import type { RouteReply, WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { observe, SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M02c1 teleports and routes in a real browser, on a `DV_WORLD=synth` QA build (everything goes through `__dvBridge.world`):
 *
 *  - @world-teleport  AC-7  ten landmarks: each request lands with the player within 0.2 m of the ground at the arrival pose, or
 *                    answers with a precondition message and leaves the player where it was; at least eight land
 *  - @world-astar     AC-8  50 seeded origin-destination pairs: the route Node computes with `@dv/world` and the one the sim worker
 *                    computes in the page have the same edges and lengths
 */
type W = { __dvBridge: { world: WorldBridge } };

const TEN = [
  'lm.city-hall', 'lm.coit-tower', 'lm.ferry-building', 'lm.pyramid-tower', 'lm.crown-tower',
  'lm.sutro-tower', 'lm.twin-peaks', 'lm.painted-ladies', 'lm.dolores-park', 'lm.haight-ashbury',
] as const;

const world = <T>(page: Page, fn: (w: WorldBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.world)`) as Promise<T>;

async function boot(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto('/?debug=1&tier=mobile-low');
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 180_000 });
  // the world services exist once the sim module has the index; the topology and the district grid arrive a little later
  await expect
    .poll(async () => {
      const s = (await world(page, (w) => w.call('state'))) as { topology?: boolean } | null;
      return s?.topology === true;
    }, { timeout: 120_000, intervals: [500, 1000, 2000] })
    .toBe(true);
}

test.describe('world teleport and routes @world', () => {
  test.describe.configure({ timeout: 600_000 });

  test('ten landmarks: each teleport lands within 0.2 m of the ground or leaves the player unmoved, and at least eight land @world-teleport', async ({ page }) => {
    await boot(page);
    let landed = 0;
    const candidates = (await page.evaluate(() => (window as unknown as W).__dvBridge.world.call('candidates', { kind: 'sandbox' }))) as { id: string; x: number; z: number }[];
    const arrival = new Map(candidates.map((c) => [c.id, c]));
    for (const id of TEN) {
      const before = (await observe(page)).player!;
      const result = (await page.evaluate((lm) => (window as unknown as W).__dvBridge.world.teleport(lm), id)) as TeleportResult | null;
      expect(result, id).not.toBeNull();
      const after = (await observe(page)).player!;
      if (result!.ok) {
        landed++;
        // the player stands where the service says, at the ground height there
        const q = (await page.evaluate(([x, z]) => (window as unknown as W).__dvBridge.world.call('query', { x, z }), [result!.x, result!.z])) as { groundY: number | null; isWater: boolean };
        expect(q.groundY, `${id} ground`).not.toBeNull();
        expect(Math.abs(after.pos[1] - (q.groundY as number)), `${id}: player y ${after.pos[1]} vs ground ${String(q.groundY)}`).toBeLessThanOrEqual(0.2);
        expect(Math.hypot(after.pos[0] - result!.x, after.pos[2] - result!.z), `${id} xz`).toBeLessThanOrEqual(0.5);
        const a = arrival.get(id)!;
        expect(Math.hypot(result!.x - a.x, result!.z - a.z), `${id} within 40 m of the arrival pose`).toBeLessThanOrEqual(40.5);
        expect(q.isWater).toBe(false);
      } else {
        expect(result!.messageKey, id).toMatch(/^world\.teleport\./);
        expect(after.pos[0], `${id} unmoved x`).toBeCloseTo(before.pos[0], 1);
        expect(after.pos[2], `${id} unmoved z`).toBeCloseTo(before.pos[2], 1);
      }
      console.log(`world-teleport ${id}: ${result!.ok ? `ok (${result!.x.toFixed(1)}, ${result!.y.toFixed(2)}, ${result!.z.toFixed(1)})` : `${result!.reason} ${result!.messageKey}`}`);
    }
    expect(landed).toBeGreaterThanOrEqual(8);
    const fade = await world(page, (w) => w.fade());
    expect(fade.log.filter((d) => d === 'out').length).toBe(fade.log.filter((d) => d === 'in').length);
    expect(fade.log.filter((d) => d === 'out').length).toBeGreaterThanOrEqual(landed);
    expect(fade.state).not.toBe('out');
  });

  test('the debug panel lists the landmarks, Go teleports there, and Route sets a GPS route the sim plans @world-teleport', async ({ page }) => {
    await boot(page);
    const go = page.getByTestId('world-go');
    await expect.poll(async () => go.locator('option').count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(25);
    await go.selectOption('lm.coit-tower');
    // the test viewport is small (the software renderer): click through the DOM, the panel sits below the fold there
    await page.getByTestId('world-go-button').evaluate((el) => (el as HTMLElement).click());
    await expect(page.getByTestId('world-controls-out')).toContainText('at Coit Tower', { timeout: 120_000 });
    const p = (await observe(page)).player!;
    expect(Math.hypot(p.pos[0] - 1185.4, p.pos[2] + 2566.2)).toBeLessThan(40);
    expect((await world(page, (w) => w.fade())).log.slice(-2)).toEqual(['out', 'in']);
    // the GPS route to the ferry building: planned in the sim, published as a map patch
    await page.getByTestId('world-gps').selectOption('lm.ferry-building');
    await page.getByTestId('world-route-button').evaluate((el) => (el as HTMLElement).click());
    await expect
      .poll(async () => (await world(page, (w) => w.map()))?.route != null, { timeout: 60_000, intervals: [250, 500, 1000] })
      .toBe(true);
    const route = (await world(page, (w) => w.map()))!.route as { points: number[]; lengthM: number; etaS: number };
    expect(route.points.length).toBeGreaterThan(8);
    expect(route.lengthM).toBeGreaterThan(500);
    expect(route.lengthM).toBeLessThan(6000);
    await expect(page.getByTestId('world-controls-stat')).toContainText('gps ', { timeout: 5000 });
    await page.setViewportSize({ width: 960, height: 640 });
    await page.screenshot({ path: 'test-results/world-controls.png' });
  });

  test('50 seeded routes: the page and Node compute the same edges and lengths @world-astar', async ({ page }) => {
    const latest = path.resolve('dist/world/latest-synth.json');
    test.skip(!existsSync(latest), 'no synth bake in dist/world (pnpm map:build -- --area synth)');
    const { bakeId } = JSON.parse(readFileSync(latest, 'utf8')) as { bakeId: string };
    const dir = path.resolve('dist/world', bakeId);
    const index = JSON.parse(readFileSync(path.join(dir, 'world-index.json'), 'utf8')) as WorldIndex;
    const graph = new RoadGraph(new RoadNetwork(decodeGraph(readFileSync(path.join(dir, 'packs', 'sf-graph.v1.pack')))), { tick: () => 0, blackout: () => false, closed: () => false });

    // 50 seeded pairs among the landmarks (arrival poses) and the POIs
    const spots: { id: string; x: number; z: number }[] = [
      ...index.landmarks.map((l) => ({ id: l.id as string, x: l.arrival.x, z: l.arrival.z })),
      ...index.pois.map((p) => ({ id: p.id as string, x: p.x, z: p.z })),
    ];
    let seed = 0x2468ace1;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    const pairs: [(typeof spots)[number], (typeof spots)[number]][] = [];
    while (pairs.length < 50) {
      const a = spots[next() % spots.length]!;
      const b = spots[next() % spots.length]!;
      if (a.id !== b.id) pairs.push([a, b]);
    }
    const expected = pairs.map(([a, b]) => graph.route({ from: { x: a.x, z: a.z }, to: { x: b.x, z: b.z }, maxExpand: 200_000, useTopology: true }));
    expect(expected.filter((r) => r !== null).length).toBeGreaterThan(40);

    await boot(page);
    let compared = 0;
    for (let i = 0; i < pairs.length; i++) {
      const [a, b] = pairs[i]!;
      const got = (await page.evaluate(([from, to]) => (window as unknown as W).__dvBridge.world.route(from!, to!), [a.id, b.id])) as RouteReply | null;
      const want = expected[i];
      if (!want) {
        expect(got, `${a.id} to ${b.id}`).toBeNull();
        continue;
      }
      expect(got, `${a.id} to ${b.id}`).not.toBeNull();
      expect(got!.count).toBe(want.edges.length);
      expect(got!.edges, `${a.id} to ${b.id} edges`).toEqual(want.edges.slice(0, got!.edges.length));
      expect(got!.lengthM, `${a.id} to ${b.id} length`).toBe(want.lengthM);
      expect(got!.etaS).toBe(want.etaS);
      expect(got!.complete).toBe(want.complete);
      compared++;
    }
    console.log(`world-astar: ${compared} of ${pairs.length} routes identical in Node and in the page`);
    expect(compared).toBeGreaterThan(40);
  });
});
