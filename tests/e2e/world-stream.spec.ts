import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type BrowserContext, type Page, type Route } from '@playwright/test';
import type { PerfReport, QualityTierId } from '../../packages/shared/src/index.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { act, observe, SMALL_VIEWPORT } from './engine-helpers.ts';

/**
 * M02b1 world streaming in a real browser, on a `DV_WORLD=synth` QA build (the build step of the world half of the e2e legs; the
 * gray-box tags run on a build without a world). Everything goes through `__dvBridge.world` and the served `/media-local/` mirror.
 *
 *  - @world-route    AC-6  the camera follows `route-ferry-ocean-beach`: no frame uploads two chunks, resident L2 equals the plan, no failed tile
 *  - @world-boot-size AC-8 bytes downloaded before the reveal, per flat tier, from an empty cache
 *  - @world-faults   AC-9  a p0 that fails its hash twice, an l0 that is unavailable, a spawn tile that cannot be had offline
 *  - @world-backdrop AC-14 the backdrop of each flat tier
 */
type W = { __dvBridge: { world: WorldBridge; platform: { perf: { run(id: string, o: { durationS: number; warmupS: number }): Promise<PerfReport> } } } };

const budgets = JSON.parse(readFileSync('config/tier-budgets.json', 'utf8')) as {
  tiers: Record<string, { world: { buildingDrawDistanceM: number }; boot: { coldBootDownloadMB: number } }>;
};
type FlatTier = 'desktop-ultra' | 'desktop' | 'mobile' | 'mobile-low';
const TIERS: readonly FlatTier[] = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'];
/** AC-8: the cold-download budget of each flat tier (60, 60, 40, 30 MB). */
const COLD_MB: Record<FlatTier, number> = { 'desktop-ultra': 60, desktop: 60, mobile: 40, 'mobile-low': 30 };

async function bootWorld(page: Page, tier: QualityTierId, query = '', waitForBridge = true): Promise<void> {
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto(`/?tier=${tier}${query}`);
  if (!waitForBridge) return;
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
}

const world = <T>(page: Page, fn: (w: WorldBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.world)`) as Promise<T>;

const revealed = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 180_000 });

test.describe('world streaming @world', () => {
  test.describe.configure({ timeout: 420_000 });

  for (const tier of ['mobile-low', 'desktop'] as const) {
    test(`route-ferry-ocean-beach at ${tier}: at most one chunk upload per frame, resident L2 equals the plan, no failed tile @world-route`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await bootWorld(page, tier, '&perf=1');
      await revealed(page);

      const report = (await page.evaluate(`window.__dvBridge.platform.perf.run('route-ferry-ocean-beach', { durationS: 12, warmupS: 2 })`)) as PerfReport;
      expect(report.tier).toBe(tier);
      expect(report.frames.count).toBeGreaterThan(0);
      expect(report.errors.gpuLost).toBe(0);

      // The coarse level fills first; software GL meshes L0 slowly, so the check waits for L2 and not for the whole stream to settle.
      await expect
        .poll(
          async () =>
            world(page, (w) => {
              const c = w.chunks();
              const have = new Set([...c.resident.l2, ...c.empty.l2]);
              return w.wanted('l2').filter((k) => !have.has(k)).length;
            }),
          { timeout: 240_000, intervals: [1000, 2000, 5000] },
        )
        .toBe(0);
      const chunks = await world(page, (w) => w.chunks());
      console.log(`world-route ${tier}: perFrameMax=${chunks.uploads.perFrameMax} total=${chunks.uploads.total} oversize=${chunks.uploads.oversize} l0=${chunks.resident.l0.length} l1=${chunks.resident.l1.length} l2=${chunks.resident.l2.length}`);
      expect(chunks.uploads.perFrameMax).toBeLessThanOrEqual(1);
      // A chunk goes up whole and within the tier's byte cap (2 MB per frame on mobile-low): the mesher reduces it to fit.
      expect(chunks.uploads.oversize).toBe(0);
      if (tier === 'mobile-low') expect(chunks.uploads.maxBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
      expect(chunks.uploads.total).toBeGreaterThan(0);
      expect(chunks.failed).toEqual([]);
      expect(chunks.sim.failed).toBe(0);
      // Resident L2 coverage equals the tier's r2: every wanted block is up, nothing outside the plan stays beyond the keep ring.
      const wanted = await world(page, (w) => w.wanted('l2'));
      expect(wanted.length).toBeGreaterThan(0);
      const plan = await world(page, (w) => w.plan());
      expect(plan.r2M).toBe(budgets.tiers[tier]?.world.buildingDrawDistanceM);
      expect([...chunks.resident.l2, ...chunks.empty.l2]).toEqual(expect.arrayContaining(wanted));
      expect(errors).toEqual([]);
    });
  }

  for (const tier of TIERS) {
    test(`boot at City Hall on ${tier} downloads at most ${COLD_MB[tier]} MB before the reveal @world-boot-size`, async ({ page }) => {
      await bootWorld(page, tier);
      await revealed(page);
      const boot = await world(page, (w) => w.boot());
      const mb = (boot.bytesBeforeReveal ?? Number.NaN) / (1024 * 1024);
      console.log(`world-boot-size ${tier}: ${mb.toFixed(2)} MB before the reveal after ${String(boot.revealMs)} ms`);
      expect(boot.bytesBeforeReveal).not.toBeNull();
      expect(mb).toBeGreaterThan(0);
      expect(mb).toBeLessThanOrEqual(COLD_MB[tier] as number);
      // The tier table's own cold-download number is the same one.
      expect(COLD_MB[tier]).toBe(budgets.tiers[tier]?.boot.coldBootDownloadMB);
    });
  }

  test.describe('faults', () => {
    /** The object key the catalog gives a world pack, read the way the pack-store spec reads it. */
    async function keyOf(request: APIRequestContext, ref: string): Promise<string> {
      const get = async <T>(rel: string): Promise<T> => {
        const res = await request.get(`/media-local/${rel}`);
        expect(res.ok(), `GET /media-local/${rel}`).toBe(true);
        return (await res.json()) as T;
      };
      const pointer = await get<{ key: string }>('asset-catalog.json');
      const catalog = await get<{ entries: Record<string, { variants: Record<string, { key: string }> }> }>(pointer.key);
      const v = catalog.entries[ref]?.variants['default'];
      if (!v) throw new Error(`no default variant for ${ref}`);
      return v.key;
    }

    /** Serves `/media-local/<key>` through `handler` (the asset worker's fetches included: the context routes workers too). */
    async function intercept(context: BrowserContext, key: string, handler: (route: Route, hit: number) => Promise<void>): Promise<{ hits(): number }> {
      let hits = 0;
      await context.route(`**/media-local/${key}`, async (route) => handler(route, hits++));
      return { hits: () => hits };
    }

    test('a p0 pack with a wrong hash twice is refetched once, then its tile is failed and walled; an l0 that is unavailable shows the overlay and clears it @world-faults', async ({ page, context, request }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const eastP0 = await keyOf(request, 'world_pack/p0-65-64');
      const spawnL0 = await keyOf(request, 'world_pack/l0-64-64');

      // The east tile's p0 always answers with its first byte flipped: the hash check fails on the fetch and again on the refetch.
      const p0 = await intercept(context, eastP0, async (route) => {
        const res = await route.fetch();
        const body = Buffer.from(await res.body());
        body[0] = (body[0] ?? 0) ^ 0xff;
        await route.fulfill({ response: res, body });
      });
      // The spawn tile's l0 is unreachable for one whole fetch (the fetch layer tries 8 times), then comes back.
      const l0 = await intercept(context, spawnL0, async (route, hit) => (hit < 8 ? route.abort('internetdisconnected') : route.continue()));

      await bootWorld(page, 'desktop');
      await revealed(page);
      // Force the sim to want the east tile.
      expect(await act(page, { t: 'debug.teleport', pos: [1400, 60, 500] })).toBe(true);
      await expect.poll(async () => (await world(page, (w) => w.chunks())).sim.failed, { timeout: 120_000 }).toBeGreaterThanOrEqual(1);
      expect(p0.hits()).toBeGreaterThanOrEqual(2); // the fetch and the one refetch of the store
      await expect.poll(() => l0.hits(), { timeout: 120_000 }).toBeGreaterThanOrEqual(9); // the outage ends and the l0 comes back
      // The player does not fall through the failed tile: its wall holds the capsule at or above the tile edge.
      await page.waitForTimeout(1500);
      const y = (await observe(page)).player?.pos[1] ?? -1e9;
      expect(y).toBeGreaterThan(-5);
      expect(errors).toEqual([]);
    });

    test('an l0 pack that is unavailable shows "re-downloading district" and the overlay clears once it is back @world-faults', async ({ page, context, request }) => {
      const l0Key = await keyOf(request, 'world_pack/l0-64-64');
      const l0 = await intercept(context, l0Key, async (route, hit) => (hit < 8 ? route.abort('internetdisconnected') : route.continue()));
      await bootWorld(page, 'desktop');
      await expect(page.getByTestId('world-redownload')).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId('world-redownload')).toBeHidden({ timeout: 180_000 });
      expect(l0.hits()).toBeGreaterThanOrEqual(9);
      await revealed(page);
      expect((await world(page, (w) => w.chunks())).failed).toEqual([]);
    });

    test('a missing spawn tile while offline blocks the session with the offline message @world-faults', async ({ page, context, request }) => {
      const spawnP0 = await keyOf(request, 'world_pack/p0-64-64');
      await intercept(context, spawnP0, async (route) => route.abort('internetdisconnected'));
      await bootWorld(page, 'desktop', '', false);
      await expect(page.getByTestId('world-offline')).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId('world-redownload')).toBeHidden();
    });
  });

  for (const tier of TIERS) {
    const table: Record<FlatTier, { ringKm: number | null; cardsKm: number | null; massing: boolean }> = {
      'desktop-ultra': { ringKm: 80, cardsKm: null, massing: true },
      desktop: { ringKm: 80, cardsKm: null, massing: true },
      mobile: { ringKm: null, cardsKm: 20, massing: false },
      'mobile-low': { ringKm: null, cardsKm: 10, massing: false },
    };
    const expected = table[tier];
    test(`the backdrop at ${tier}: ring ${String(expected.ringKm)} km, cards ${String(expected.cardsKm)} km, massing ${String(expected.massing)}, at most 3 objects, one upload @world-backdrop`, async ({ page }) => {
      await bootWorld(page, tier);
      await revealed(page);
      await expect.poll(async () => (await world(page, (w) => w.backdrop())).bootUploads, { timeout: 60_000 }).toBe(1);
      const info = await world(page, (w) => w.backdrop());
      expect(info).toMatchObject({ ringKm: expected.ringKm, cardsKm: expected.cardsKm, massing: expected.massing, bootUploads: 1 });
      expect(info.renderObjects).toBeGreaterThan(0);
      expect(info.renderObjects).toBeLessThanOrEqual(3);
    });
  }
});
