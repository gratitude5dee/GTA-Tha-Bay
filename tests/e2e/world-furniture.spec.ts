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
      // the player at the junction, so the heads stay within 200 m of the camera once the shot is released
      await page.evaluate(() => (window as unknown as W).__dvBridge.world.teleport({ x: 70, z: 318 }));
      await setSky(page, 13, 'clear');
      // `held` settles with the world's draw held: a desktop frame with the traffic drawn costs seconds on software GL (BD-FIX-CI-TEXGOLD-01)
      await world(page, (w) => w.shot('junction-noon', { held: true }));
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
      // `heads.aspects` counts per aspect, which a symmetric junction keeps (two green, two red) when its phases swap, so the change is
      // read on the codes of the heads the last 10 Hz pass evaluated (within 200 m of the camera), together with those counts. The 30 s
      // are the sim's (1,800 ticks of the heads' own clock, `heads.tick`): on a loaded runner the sim worker runs below real time, and a
      // phase of the synth programs lasts at most 28 s of green, 3 s of amber and 1 s of all-red (BD-M02h6-10)
      // the world's draw is held meanwhile (`RendererHost.holdWorld('cover')`, as `streamAtPlan`): the loop, the sim and the heads' 10 Hz
      // pass run as before and only the render call is skipped, so a desktop frame on software GL no longer starves the sim worker
      await page.evaluate(() => {
        const v = (window as unknown as W).__dvBridge.world.internals().view as unknown as { host: { holdWorld(kind: 'cover'): () => void } };
        (window as unknown as { __dvFurnRelease?: () => void }).__dvFurnRelease = v.host.holdWorld('cover');
      });
      const seen = new Set<string>();
      let tick0 = -1;
      let lastTick = -1;
      await expect
        .poll(async () => {
          const h = (await furniture(page)).heads;
          if (h.tick <= 0) return 'no tick'; // tick 0: the held shot's frozen heads, not yet a frame after the release
          if (tick0 < 0) tick0 = h.tick;
          lastTick = h.tick;
          const codes = await page.evaluate(() => {
            type P = { headCodes(): { x: number; z: number; code: number }[] } | null;
            const v = (window as unknown as W).__dvBridge.world.internals().view as unknown as { renderer: { furniture: P }; host: { camera: { position: { x: number; z: number } } } };
            const c = v.host.camera.position;
            return (v.renderer.furniture?.headCodes() ?? []).filter((k) => Math.hypot(k.x - c.x, k.z - c.z) <= 200).map((k) => k.code).join('');
          });
          seen.add(`${JSON.stringify(h.aspects)} ${codes}`);
          if (seen.size > 1) return 'changed';
          return h.tick - tick0 > 1800 ? 'still after 30 s of sim time' : 'waiting';
        }, { timeout: 600_000, intervals: [500] })
        .toMatch(/changed|still/);
      expect([...seen].length, `the heads changed within 1,800 ticks (from ${tick0} to ${lastTick}): ${[...seen].join(' | ')}`).toBeGreaterThan(1);
      expect(lastTick - tick0).toBeLessThanOrEqual(1800);
      await page.evaluate(() => (window as unknown as { __dvFurnRelease?: () => void }).__dvFurnRelease?.());

      // the layers off: no render object; on again: back, and no request
      const before = requests.length;
      expect(await world(page, (w) => w.setLookLayer('furniture', false))).toBe(true);
      expect(await world(page, (w) => w.setLookLayer('parked', false))).toBe(true);
      const off = await furniture(page);
      expect(off.objects).toBe(0);
      expect(off.layers).toEqual({ furniture: false, parked: false });
      expect(await world(page, (w) => w.setLookLayer('furniture', true))).toBe(true);
      expect(await world(page, (w) => w.setLookLayer('parked', true))).toBe(true);
      expect((await furniture(page)).objects).toBeGreaterThan(0);
      await frames(page, 2);
      expect(requests.length, 'the layers fetch nothing').toBe(before);

      // every image or texture request is a surface texture ref (M10d0), a vehicle art ref (M10d1), a people-kit ref (M10d4) or the
      // backdrop's skyline cards (M02c2, `texture/far-bay-cards`, on the tiers that draw them): none is a furniture part or a sign face
      const refs = await world(page, (w) => [...(w.look()?.textures?.refs ?? []), ...(w.art()?.refs ?? []), ...(w.peds()?.art.refs ?? []), 'texture/far-bay-cards']);
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
