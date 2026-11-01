import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type TestInfo } from '@playwright/test';
import { decodePng, encodePng, meanAbsDifference } from '../support/image-diff.ts';
import { SMALL_VIEWPORT } from './engine-helpers.ts';
import { CLASSES, cover, coverSettled, parts, setCover } from './cover-helpers.ts';
import { FLAT_TIERS, HIDE, bootWorld, clearActors, live, world } from './markings-helpers.ts';

/**
 * M02h3 ground cover in a real browser, on a `DV_WORLD=synth` QA build: @world-cover (AC-6) per flat tier (desktop, mobile, mobile-low; both
 * browsers): `look().cover.cells` is above 0 for all seven classes across the `yard-street` and `hill-scrub` shots; the `cover` layer toggle
 * changes the `yard-street` frame by a mean |delta| of at least 0.02 and leaves the render objects and triangles as they were; no page error.
 * The cover goldens are `ground-cover-golden.spec.ts`, the ledger `terrain-cover-ledger.spec.ts` (shared helpers: `cover-helpers.ts`).
 */
test.describe('world cover @world-cover', () => {
  test.describe.configure({ timeout: 1_800_000 });

  for (const tier of FLAT_TIERS) {
    test(`${tier}: all seven classes are resident across yard-street and hill-scrub, and the layer changes the frame and no render object @world-cover`, async ({ page }, testInfo: TestInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text());
      });
      // chromium-webgpu `desktop`: the albedo maps alone (BD-REPAIR-M02h3-02). Its full texture set passes WebGPU's 16 sampled textures of a
      // stage (BD-REPAIR-M02h1-03), and with no textures at all the toggle measured something else: on every textured tier the layer swaps
      // the bound `grass-dirt` set of the lawns for the procedural cover (BD-M02h3-05), which is the change the 0.02 bar was set on; with the
      // textures off both frames are procedural and differ by 0.0194 on WebGPU. With the albedo maps the WebGPU frame keeps that swap.
      const query = testInfo.project.name === 'chromium-webgpu' && tier === 'desktop' ? '&textures=albedo' : '';
      await bootWorld(page, tier, query, SMALL_VIEWPORT);
      expect((await cover(page)).enabled, 'world.cover is on by default').toBe(true);
      await page.addStyleTag({ content: HIDE });
      await clearActors(page);
      await world(page, (w) => w.shot('yard-street', { held: true }));
      await coverSettled(page);
      const atYard = await cover(page);
      // Casters are decided when a unit is committed, relative to the focus then (`ChunkRenderer.castsShadows`): the toggle re-commits every
      // resident chunk at the shot's focus, so the frame before it can hold casters of an earlier focus. The two frames compared are
      // therefore both re-committed ones: off, then on again.
      expect(await setCover(page, false)).toBe(true);
      await coverSettled(page);
      const offImg = decodePng(await page.locator('#dv-engine-canvas').screenshot());
      await world(page, (w) => w.hold(true));
      const offCount = await live(page);
      const offParts = await parts(page);
      const off = await cover(page);
      await world(page, (w) => w.hold(false));
      expect(off.enabled).toBe(false);
      expect(off.pending).toBe(0);

      expect(await setCover(page, true)).toBe(true);
      await coverSettled(page);
      const onImg = decodePng(await page.locator('#dv-engine-canvas').screenshot());
      await world(page, (w) => w.hold(true));
      const onCount = await live(page);
      const onParts = await parts(page);
      await world(page, (w) => w.hold(false));
      const delta = meanAbsDifference(onImg, offImg);
      if (process.env['DV_COVER_DEBUG'] === '1') {
        mkdirSync('test-results/cover', { recursive: true });
        writeFileSync(`test-results/cover/${testInfo.project.name}.${tier}.yard-street.on.png`, encodePng(onImg));
        writeFileSync(`test-results/cover/${testInfo.project.name}.${tier}.yard-street.off.png`, encodePng(offImg));
      }
      console.log(`world-cover ${testInfo.project.name} ${tier}: yard-street mean |delta| ${delta.toFixed(4)}; render objects on ${onCount.renderObjects} off ${offCount.renderObjects}; cells ${JSON.stringify(atYard.cells)}`);
      expect(delta, `${tier}: the cover layer changes the yard-street frame`).toBeGreaterThanOrEqual(0.02);
      expect(offCount.renderObjects, `${tier}: the cover adds no render object (on ${JSON.stringify(onParts)}, off ${JSON.stringify(offParts)})`).toBe(onCount.renderObjects);
      expect(offCount.triangles, `${tier}: the cover adds no triangle`).toBe(onCount.triangles);

      await world(page, (w) => w.shot('hill-scrub', { held: true }));
      const atHill = await cover(page);
      if (process.env['DV_COVER_DEBUG'] === '1') writeFileSync(`test-results/cover/${testInfo.project.name}.${tier}.hill-scrub.png`, await page.locator('#dv-engine-canvas').screenshot());
      console.log(`world-cover ${testInfo.project.name} ${tier}: hill-scrub cells ${JSON.stringify(atHill.cells)}`);
      for (const c of CLASSES) expect((atYard.cells[c] ?? 0) + (atHill.cells[c] ?? 0), `${tier}: ${c} cells across both shots`).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
  }
});
