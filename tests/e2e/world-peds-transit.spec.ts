import { expect, test, type Page } from '@playwright/test';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { observe, SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M03b2 in a real browser, on a `DV_WORLD=synth` QA build (everything goes through `__dvBridge.world`), `mobile-low`:
 *
 *  - @world-peds    pedestrians walk the City Hall streets: far figures (one instanced mesh per body) and skinned near figures within the
 *                   tier caps (80 drawn, 6 skinned); a `crowd.attract` source gathers the ones within 40 m
 *  - @world-transit the baked routes spawn buses, Metro trains, ferries and airliners to the config row; a Bay Rail ride of three stops
 *                   lands at the target station and charges 350 cents once; the QA panel (`?debug=1`) shows both
 */
type W = { __dvBridge: { world: WorldBridge } };

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
  await expect
    .poll(async () => {
      const s = (await world(page, (w) => w.call('state'))) as { topology?: boolean } | null;
      return s?.topology === true;
    }, { timeout: 120_000, intervals: [500, 1000, 2000] })
    .toBe(true);
}

test.describe('pedestrians and transit @world', () => {
  test.describe.configure({ timeout: 600_000 });

  test('pedestrians walk the streets within the tier caps, and a crowd source gathers them @world-peds', async ({ page }) => {
    await boot(page);
    // the first fill: pedestrians in the ring around the player
    await expect
      .poll(async () => (await world(page, (w) => w.peds()))?.instances ?? 0, { timeout: 120_000, intervals: [500, 1000, 2000] })
      .toBeGreaterThan(3);
    const p = (await world(page, (w) => w.peds()))!;
    expect(p.cap).toBe(80);
    expect(p.nearCap).toBe(6);
    expect(p.instances).toBeLessThanOrEqual(80);
    expect(p.near).toBeLessThanOrEqual(6);
    expect(p.draws).toBeLessThanOrEqual(8 + 6);
    const sim = (await world(page, (w) => w.pedsSim())) as { peds: number; cap: number; filled: boolean };
    expect(sim.peds).toBeGreaterThan(3);
    expect(sim.peds).toBeLessThanOrEqual(80);

    // the QA crowd stands twelve pedestrians 8 to 40 m around the player: those within 25 m draw as skinned near figures (one render
    // object each), the nearest first, up to the tier's cap of 6
    const crowd = (await page.evaluate(() => (window as unknown as W).__dvBridge.world.call('crowd', { n: 12 }))) as { placed: number } | null;
    expect(crowd?.placed ?? 0).toBeGreaterThan(3);
    await expect
      .poll(async () => (await world(page, (w) => w.peds()))?.near ?? 0, { timeout: 90_000, intervals: [500, 1000, 2000] })
      .toBeGreaterThan(0);
    const withNear = (await world(page, (w) => w.peds()))!;
    expect(withNear.near).toBeLessThanOrEqual(6);
    expect(withNear.instances).toBeLessThanOrEqual(80);
    expect(withNear.objects).toBeLessThanOrEqual(8 + 6);

    // a crowd source at the player: at most 3 live, the fourth is refused
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) ids.push(((await world(page, (w) => w.attract(0, 0))) as { id: number }).id);
    expect(ids.slice(0, 3).every((i) => i > 0)).toBe(true);
    expect(ids[3]).toBe(0);
    for (const id of ids) if (id > 0) await page.evaluate((i) => (window as unknown as W).__dvBridge.world.releaseAttract(i), id);
    await expect(page.getByTestId('world-controls-crowd')).toContainText('pedestrians');
  });

  test('transit spawns to the config row, and a three-stop Bay Rail ride charges 350 cents once @world-transit', async ({ page }) => {
    await boot(page);
    await expect
      .poll(async () => ((await world(page, (w) => w.transitSim())) as { counts?: { bus: number } } | null)?.counts?.bus ?? 0, { timeout: 120_000, intervals: [500, 1000, 2000] })
      .toBeGreaterThan(0);
    const t = (await world(page, (w) => w.transitSim())) as { counts: Record<string, number>; want: Record<string, number> };
    // the synth bake has no cable-car chain; everything else equals the mobile-low row of config/world/transit.json
    expect(t.counts['bus']).toBe(t.want['bus']);
    expect(t.counts['metro']).toBe(t.want['metro']);
    expect(t.counts['ferry']).toBe(t.want['ferry']);
    expect(t.counts['air']).toBe(t.want['air']);
    expect(t.counts['cablecar']).toBe(0);

    // three stops: Embarcadero to Civic Center
    const before = (await observe(page)).player!;
    const res = (await world(page, (w) => w.ride('rail.embarcadero', 'rail.civic-center'))) as { ok: boolean; cents?: number; stops?: number; to?: string; reason?: string } | null;
    expect(res, 'the ride answered').not.toBeNull();
    expect(res).toMatchObject({ ok: true, cents: 350, stops: 3, to: 'rail.civic-center' });
    const after = (await observe(page)).player!;
    expect(Math.hypot(after.pos[0] - before.pos[0], after.pos[2] - before.pos[2])).toBeGreaterThan(100);
    const sim = (await world(page, (w) => w.transitSim())) as { fares: { cents: number; kind: string; idemKey: string }[] };
    expect(sim.fares).toHaveLength(1);
    expect(sim.fares[0]).toMatchObject({ cents: 350, kind: 'bay-rail' });
    expect(sim.fares[0]?.idemKey).toMatch(/^fare:bay-rail:\d+:rail\.embarcadero:rail\.civic-center$/);
    await expect(page.getByTestId('world-controls-crowd')).toContainText('transit');
  });
});
