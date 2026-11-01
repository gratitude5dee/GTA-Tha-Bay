import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type TestInfo } from '@playwright/test';
import { decodePng, diffImages, encodePng, goldenFailures, identical, type Rgba } from '../support/image-diff.ts';
import { GOLDEN_VIEWPORT, HIDE, bootWorld, clearActors, frames, type W } from './markings-helpers.ts';

/**
 * M02h3 AC-7 (@look-golden, `chromium-webgl2` only): the `yard-street` and `hill-scrub` shots at `desktop` and `mobile-low` against
 * `tests/e2e/golden/look/<tier>.<shot>.png`, each repeated byte-identical; the look manifest lists them (`city-look-golden.spec.ts` writes it).
 * `DV_UPDATE_GOLDEN=1` (outside CI, under the golden-update label) writes them.
 */
const GOLDEN_DIR = 'tests/e2e/golden/look';
const COVER_GOLDEN_SHOTS = ['yard-street', 'hill-scrub'] as const;
const COVER_GOLDEN_TIERS = ['desktop', 'mobile-low'] as const;

test.describe('cover goldens @look-golden', () => {
  test.describe.configure({ timeout: 1_800_000 });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'goldens are chromium-webgl2 only');
  });
  const update = process.env['DV_UPDATE_GOLDEN'] === '1' && !process.env['CI'];

  for (const tier of COVER_GOLDEN_TIERS) {
    for (const shot of COVER_GOLDEN_SHOTS) {
      test(`${tier} ${shot} is within the tolerance of its golden and a second capture is byte-identical @look-golden`, async ({ page }) => {
        const file = `${GOLDEN_DIR}/${tier}.${shot}.png`;
        await bootWorld(page, tier, '', GOLDEN_VIEWPORT);
        await page.addStyleTag({ content: HIDE });
        await clearActors(page);
        await page.evaluate((id) => (window as unknown as W).__dvBridge.world.shot(id, { held: true }), shot);
        await frames(page, 2);
        const first: Rgba = decodePng(await page.locator('#dv-engine-canvas').screenshot());
        await frames(page, 2);
        const second = decodePng(await page.locator('#dv-engine-canvas').screenshot());
        expect(identical(first, second), 'two consecutive captures differ').toBe(true);
        if (update) {
          mkdirSync(GOLDEN_DIR, { recursive: true });
          writeFileSync(file, encodePng(first));
          return;
        }
        expect(existsSync(file), `${file} is missing; DV_UPDATE_GOLDEN=1 writes it (outside CI, under the golden-update label)`).toBe(true);
        const diff = diffImages(first, decodePng(readFileSync(file)));
        if (goldenFailures(diff).length > 0) {
          // the capture beside its golden, for the report (test-results is uploaded on failure)
          mkdirSync('test-results/cover-golden', { recursive: true });
          writeFileSync(`test-results/cover-golden/${tier}.${shot}.actual.png`, encodePng(first));
        }
        expect(goldenFailures(diff), `${tier} ${shot}: ${JSON.stringify(diff)}`).toEqual([]);
      });
    }
  }
});
