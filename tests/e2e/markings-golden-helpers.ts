import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { decodePng, diffImages, encodePng, goldenFailures, identical, type Rgba } from '../support/image-diff.ts';
import { GOLDEN_VIEWPORT, HIDE, MARKINGS_GOLDEN_SHOTS, bootWorld, clearActors, frames, setSky, world, type W } from './markings-helpers.ts';

/**
 * The golden cases of M02h1 AC-5 (@markings-golden, `chromium-webgl2` only), registered by `markings-golden.spec.ts` (the manifest, the
 * `mobile-low` and `xr-quest` shots) and `markings-shots-desktop.spec.ts` (the two `desktop` shots). The cases, titles, captures and
 * tolerances are the ones `markings-golden.spec.ts` held before BD-REPAIR-M02h1-02; only the file of the `desktop` pair changed: a `desktop`
 * golden takes about 14 minutes on software GL, and Playwright cuts a shard out of the sorted list of tests by count, so the two of them sat
 * in chromium-webgl2 shard 3 beside `look-tune.spec.ts`.
 *
 * `DV_UPDATE_GOLDEN=1` (outside CI, under the golden-update label) writes the goldens; `markings-golden.spec.ts` checks the manifest.
 */
export const MARKINGS_GOLDEN_DIR = 'tests/e2e/golden/look';
export const MARKINGS_GOLDEN_UPDATE = process.env['DV_UPDATE_GOLDEN'] === '1' && !process.env['CI'];

async function captureShot(page: Page, tier: string, shot: string): Promise<Rgba> {
  await bootWorld(page, tier, '', GOLDEN_VIEWPORT);
  await page.addStyleTag({ content: HIDE });
  await clearActors(page);
  await setSky(page, 13, 'clear');
  await page.evaluate((id) => (window as unknown as W).__dvBridge.world.shot(id), shot);
  await frames(page, 2);
  return decodePng(await page.locator('#dv-engine-canvas').screenshot());
}

/** The `describe` of the markings goldens, with `body` inside it (the manifest case of `markings-golden.spec.ts`, then the shots). */
export function markingsGoldens(body: () => void): void {
  test.describe('markings goldens @markings-golden', () => {
    test.describe.configure({ timeout: 1_800_000 });
    test.beforeEach(({}, testInfo: TestInfo) => {
      test.skip(testInfo.project.name !== 'chromium-webgl2', 'goldens are chromium-webgl2 only');
    });
    body();
  });
}

/** One case per shot of `MARKINGS_GOLDEN_SHOTS` at `tier`: within the tolerance of its golden, and a second capture byte-identical. Call inside `markingsGoldens`. */
export function registerMarkingsGoldenShots(tier: string): void {
  for (const shot of MARKINGS_GOLDEN_SHOTS) {
    test(`${tier} ${shot} is within the tolerance of its golden and a second capture is byte-identical @markings-golden`, async ({ page }) => {
      const file = `${MARKINGS_GOLDEN_DIR}/${tier}.${shot}.png`;
      const first = await captureShot(page, tier, shot);
      expect(first).toMatchObject({ width: GOLDEN_VIEWPORT.width, height: GOLDEN_VIEWPORT.height });
      await frames(page, 2);
      const second = decodePng(await page.locator('#dv-engine-canvas').screenshot());
      expect(identical(first, second), 'two consecutive captures differ').toBe(true);
      const mode = (await world(page, (w) => w.look()))?.markings.mode;
      expect(mode, `${tier} paints`).toBe(tier === 'desktop' ? 'worn' : 'flat');
      if (MARKINGS_GOLDEN_UPDATE) {
        mkdirSync(MARKINGS_GOLDEN_DIR, { recursive: true });
        writeFileSync(file, encodePng(first));
        return;
      }
      expect(existsSync(file), `${file} is missing; DV_UPDATE_GOLDEN=1 writes it (outside CI, under the golden-update label)`).toBe(true);
      const diff = diffImages(first, decodePng(readFileSync(file)));
      expect(goldenFailures(diff), `${tier} ${shot}: ${JSON.stringify(diff)}`).toEqual([]);
    });
  }
}
