import { expect, test, type Page } from '@playwright/test';
import { waitForEngine } from './engine-helpers.ts';
import { FLAT_TIERS, GOLDEN_VIEWPORT, bootWorld, frames, setSky, world, type W } from './markings-helpers.ts';
import { SMALL_VIEWPORT } from './engine-helpers.ts';

/**
 * M02h6 street furniture and parked dressing in a real browser, on a `DV_WORLD=synth` QA build.
 *
 *  - @world-furniture (AC-6) per flat tier on `chromium-webgl2` and `webkit-webgl2`: at `shot('junction-noon')` `look().furniture` lists the
 *    profile's pools (`desktop` signal, post, shelter, pole, wire; `mobile` signal, post, shelter; `mobile-low` signal, post) with its
 *    render objects at or below the table (9, 6, 3), parked instances above 0; released, the heads' aspects change within 30 s; the layers
 *    `furniture` and `parked` off report 0 render objects; every image or `texture/` request of the page is a ref of `look().textures` or
 *    `world.art()`, and switching the two layers on again adds no request at all.
 *  - @xr @world-furniture (`xr-quest3`): the Quest tier (`legacy` look) has no pool, no dressing and no layer to switch.
 *  - @furniture-ledger (AC-7) is `furniture-ledger.spec.ts` (a serial group in a file of its own, as BD-M02h5-07).
 */

/** The render objects the profile may add (M02h6 table). */
const OBJECTS_MAX: Record<string, number> = { desktop: 9, mobile: 6, 'mobile-low': 3 };
const POOLS: Record<string, string[]> = { desktop: ['signal', 'post', 'shelter', 'pole', 'wire'], mobile: ['signal', 'post', 'shelter'], 'mobile-low': ['signal', 'post'] };

type Furniture = NonNullable<NonNullable<ReturnType<W['__dvBridge']['world']['look']>>['furniture']>;
const furniture = async (page: Page): Promise<Furniture> => (await world(page, (w) => w.look()?.furniture ?? null)) as Furniture;

test.describe('street furniture @world-furniture', () => {
  test.describe.configure({ timeout: 1_800_000 });

  for (const tier of FLAT_TIERS) {
    test(`${tier}: junction-noon lists the profile's pools and parked cars, the heads change, the layers switch, nothing is fetched @world-furniture`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const requests: string[] = [];
      page.on('request', (r) => {
        const url = new URL(r.url());
        if (url.protocol === 'data:') return;
        if (r.resourceType() === 'image' || /\/texture\//.test(url.pathname)) requests.push(url.pathname);
      });
      await bootWorld(page, tier, '', SMALL_VIEWPORT);
      await setSky(page, 13, 'clear');
      await world(page, (w) => w.shot('junction-noon'));
      await frames(page, 8);
      await expect.poll(async () => (await furniture(page)).parked.instances, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
      const f = await furniture(page);
      console.log(`world-furniture ${testInfo.project.name} ${tier}: ${JSON.stringify({ ...f, parked: { ...f.parked, drawn: undefined } })}`);
      expect(f.source).toBe('mesher');
      expect(Object.keys(f.pools)).toEqual(POOLS[tier]);
      expect(f.objects, `${tier}: render objects of the pools and the dressing`).toBeLessThanOrEqual(OBJECTS_MAX[tier] as number);
      expect(f.objects).toBeGreaterThan(0);
      expect(f.pools['signal']?.instances ?? 0).toBeGreaterThan(0);
      expect(f.pools['post']?.instances ?? 0).toBeGreaterThan(0);
      expect(f.heads.total).toBeGreaterThan(0);
      for (const p of Object.values(f.pools)) expect(p.instances).toBeLessThanOrEqual(p.cap);
      expect(f.parked.instances).toBeLessThanOrEqual(f.parked.cap);

      // released: the sim runs and the heads follow its tick (a held shot freezes them)
      await world(page, (w) => w.clearShot());
      await world(page, (w) => w.freeze(false));
      const seen = new Set<string>();
      await expect
        .poll(async () => {
          const h = (await furniture(page)).heads;
          seen.add(JSON.stringify(h.aspects));
          return seen.size;
        }, { timeout: 30_000, intervals: [500] })
        .toBeGreaterThan(1);

      // the layers off: no render object; on again: back, and no request
      const before = requests.length;
      expect(await world(page, (w) => w.setLookLayer('furniture', false))).toBe(true);
      expect(await world(page, (w) => w.setLookLayer('parked', false))).toBe(true);
      await frames(page, 4);
      const off = await furniture(page);
      expect(off.objects).toBe(0);
      expect(off.layers).toEqual({ furniture: false, parked: false });
      expect(await world(page, (w) => w.setLookLayer('furniture', true))).toBe(true);
      expect(await world(page, (w) => w.setLookLayer('parked', true))).toBe(true);
      await frames(page, 8);
      expect((await furniture(page)).objects).toBeGreaterThan(0);
      expect(requests.length, 'the layers fetch nothing').toBe(before);

      // every image or texture request is a surface texture ref (M10d0) or an art ref (M10d1)
      const refs = await world(page, (w) => [...(w.look()?.textures?.refs ?? []), ...(w.art()?.refs ?? [])]);
      for (const url of requests) expect(refs.some((ref) => url.includes(`/${ref}/`)), `${url} is not one of the texture or art refs`).toBe(true);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('xr furniture @world-furniture', () => {
  test('the Quest tier has no furniture pool, no parked dressing and no layer to switch @xr @world-furniture', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize(GOLDEN_VIEWPORT);
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
    const f = await furniture(page);
    expect(f).toMatchObject({ profile: 'legacy', objects: 0, pools: {}, parked: { instances: 0, cap: 0 } });
    expect(await world(page, (w) => w.setLookLayer('furniture', true))).toBe(false);
    expect(await world(page, (w) => w.setLookLayer('parked', true))).toBe(false);
    const groups = await page.evaluate(() => {
      const view = (window as unknown as W).__dvBridge.world.internals().view as unknown as { renderer: { furniture: unknown }; parked: unknown };
      return { furniture: view.renderer.furniture === null, parked: view.parked === null };
    });
    expect(groups).toEqual({ furniture: true, parked: true });
  });
});
