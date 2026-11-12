import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { decodePng, diffImages, encodePng, goldenFailures, identical, meanAbsDifference, type Rgba } from '../support/image-diff.ts';
import { canvasRgba } from './canvas-capture.ts';
import { SMALL_VIEWPORT } from './engine-helpers.ts';
import { lap, secs, settleText, tierOf, timed } from './lap.ts';
import { veg } from './trees-helpers.ts';
import { FLAT_TIERS, GOLDEN_VIEWPORT, HIDE, bootWorld, clearActors, frames, world, type W } from './markings-helpers.ts';

/**
 * M02h5 vegetation scatter in a real browser, on a `DV_WORLD=synth` QA build.
 *
 *  - @world-scatter (AC-5) per flat tier on `chromium-webgl2` and `webkit-webgl2`: at `shot('park-forest')` `look().vegetation.scatter`
 *    reports impostors, shrubs and hedges drawn, the re-banding's writes within the cap (no step over it); the `scatter` layer toggle
 *    changes the frame by a mean |delta| of at least 0.02; `?scatter=0` (the QA twin of `world.scatter: false`) reports no scatter instance
 *    and no impostor pool.
 *  - @look-golden (AC-6, `chromium-webgl2`): `park-forest` at `desktop` and `mobile-low` against
 *    `tests/e2e/golden/look/<tier>.park-forest.png`, two captures byte-identical. `DV_UPDATE_GOLDEN=1` writes them.
 *  - @scatter-ledger (AC-8) is `scatter-ledger.spec.ts`: a serial group makes its whole file one scheduling unit of the duration-packed
 *    shards, so the ledger lives in a file of its own (as M02h4's, BD-M02h4-08; BD-M02h5-07).
 */

type Scatter = {
  enabled: boolean; impostorPools: number; understoryPools: number; scatterInstances: number; impostors: number; shrubs: number; hedges: number;
  meshTrees: number; bandWrites: { cap: number; maxInFrame: number; total: number; pending: number; overCap: number; rebands: number };
};
const scatter = async (page: Page): Promise<Scatter> => (await veg(page)).scatter as Scatter;

/** The stream quiet at the shot and the bands written (nothing pending). */
async function scatterSettled(page: Page): Promise<void> {
  // BD-FIX-CI-PLAN-01: the seconds of the settle and of the whole call, as lap lines; the waits are the same
  const t0 = Date.now();
  await timed(`scatterSettled ${tierOf(page)}: settle(240 s)`, () => page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(240_000)), settleText);
  await expect.poll(async () => (await scatter(page)).bandWrites.pending, { timeout: 180_000, intervals: [500] }).toBe(0);
  await frames(page, 4);
  await expect.poll(async () => (await scatter(page)).bandWrites.pending, { timeout: 180_000, intervals: [500] }).toBe(0);
  lap(`scatterSettled ${tierOf(page)}`, `whole call ${secs(t0)} s`);
}

const canvas = async (page: Page): Promise<Rgba> => await canvasRgba(page);

test.describe('world scatter @world-scatter', () => {
  test.describe.configure({ timeout: 1_800_000 });

  for (const tier of FLAT_TIERS) {
    test(`${tier}: park-forest draws impostors, shrubs and hedges within the write cap; the scatter layer changes the frame @world-scatter`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text());
      });
      await bootWorld(page, tier, '', SMALL_VIEWPORT);
      await page.addStyleTag({ content: HIDE });
      await clearActors(page);
      await world(page, (w) => w.shot('park-forest', { held: true }));
      await scatterSettled(page);
      await expect.poll(async () => {
        const s = await scatter(page);
        return Math.min(s.impostors, s.shrubs, s.hedges);
      }, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
      const on = await scatter(page);
      const onImg = await canvas(page);
      expect(on.enabled).toBe(true);
      expect(on.impostorPools).toBeGreaterThan(0);
      expect(on.scatterInstances).toBeGreaterThan(0);
      expect(on.bandWrites.maxInFrame, 'band writes within the cap').toBeLessThanOrEqual(on.bandWrites.cap);
      expect(on.bandWrites.overCap, 'no band step over the whole cap').toBe(0);

      // the scatter layer off: the street trees alone
      expect(await world(page, (w) => w.setLookLayer('scatter', false))).toBe(true);
      await scatterSettled(page);
      const off = await scatter(page);
      const offImg = await canvas(page);
      const delta = meanAbsDifference(onImg, offImg);
      if (process.env['DV_SCATTER_DEBUG'] === '1') {
        mkdirSync('test-results/scatter', { recursive: true });
        writeFileSync(`test-results/scatter/${testInfo.project.name}.${tier}.on.png`, encodePng(onImg));
        writeFileSync(`test-results/scatter/${testInfo.project.name}.${tier}.off.png`, encodePng(offImg));
      }
      console.log(`world-scatter ${testInfo.project.name} ${tier}: on ${JSON.stringify(on)}; off ${JSON.stringify(off)}; mean |delta| ${delta.toFixed(4)}`);
      expect(off.scatterInstances).toBe(0);
      expect(delta, `${tier}: the scatter layer changes the park-forest frame`).toBeGreaterThanOrEqual(0.02);
      expect(await world(page, (w) => w.setLookLayer('scatter', true))).toBe(true);
      // the impostor layer: off, nothing draws as an impostor
      expect(await world(page, (w) => w.setLookLayer('impostors', false))).toBe(true);
      await scatterSettled(page);
      expect((await scatter(page)).impostors).toBe(0);
      expect(await world(page, (w) => w.setLookLayer('impostors', true))).toBe(true);
      await scatterSettled(page);
      const end = await scatter(page);
      expect(end.impostors).toBeGreaterThan(0);
      expect(end.bandWrites.maxInFrame).toBeLessThanOrEqual(end.bandWrites.cap);
      expect(errors).toEqual([]);
    });
  }

  test('mobile-low: world.scatter off (?scatter=0) reports no scatter instance and no impostor pool @world-scatter', async ({ page }) => {
    await bootWorld(page, 'mobile-low', '&scatter=0', SMALL_VIEWPORT);
    await world(page, (w) => w.shot('park-forest', { held: true }));
    await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(240_000));
    const s = await scatter(page);
    const v = await veg(page);
    expect(s.enabled).toBe(false);
    expect(s.scatterInstances).toBe(0);
    expect(s.impostorPools).toBe(0);
    expect(s.impostors).toBe(0);
    expect(v.pools).toBe(2);
  });
});

// ---- the goldens (AC-6) --------------------------------------------------------------------------------------------------------

const GOLDEN_DIR = 'tests/e2e/golden/look';
const SCATTER_GOLDEN_TIERS = ['desktop', 'mobile-low'] as const;

test.describe('scatter goldens @look-golden', () => {
  test.describe.configure({ timeout: 1_800_000 });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'goldens are chromium-webgl2 only');
  });
  const update = process.env['DV_UPDATE_GOLDEN'] === '1' && !process.env['CI'];

  for (const tier of SCATTER_GOLDEN_TIERS) {
    test(`${tier} park-forest is within the tolerance of its golden and a second capture is byte-identical @look-golden`, async ({ page }) => {
      const file = `${GOLDEN_DIR}/${tier}.park-forest.png`;
      await bootWorld(page, tier, '', GOLDEN_VIEWPORT);
      await page.addStyleTag({ content: HIDE });
      await clearActors(page);
      await page.evaluate(() => (window as unknown as W).__dvBridge.world.shot('park-forest', { held: true }));
      await scatterSettled(page);
      await frames(page, 2);
      const first = await canvas(page);
      await frames(page, 2);
      const second = await canvas(page);
      expect(identical(first, second), 'two consecutive captures differ').toBe(true);
      if (update) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(file, encodePng(first));
        return;
      }
      expect(existsSync(file), `${file} is missing; DV_UPDATE_GOLDEN=1 writes it (outside CI, under the golden-update label)`).toBe(true);
      const diff = diffImages(first, decodePng(readFileSync(file)));
      if (goldenFailures(diff).length > 0) {
        mkdirSync('test-results/scatter-golden', { recursive: true });
        writeFileSync(`test-results/scatter-golden/${tier}.park-forest.actual.png`, encodePng(first));
      }
      expect(goldenFailures(diff), `${tier} park-forest: ${JSON.stringify(diff)}`).toEqual([]);
    });
  }
});
