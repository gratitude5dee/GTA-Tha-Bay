import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { decodePng, diffImages, encodePng, goldenFailures, identical, type Rgba } from '../support/image-diff.ts';
import { GOLDEN_VIEWPORT, HIDE, MARKINGS_GOLDEN_SHOTS, PAINT_TIERS, bakeIdOf, bootWorld, clearActors, frames, read, setSky, world, type W } from './markings-helpers.ts';

/**
 * M02h1 AC-5 (@markings-golden, `chromium-webgl2` only): the shots `markings-near` and `markings-graze` at `desktop`, `mobile-low` and
 * `xr-quest` (the Quest tier forced on the flat canvas, no immersive session) against the committed goldens, each repeated byte-identical.
 * The goldens sit in `tests/e2e/golden/look/` with the other look goldens and are listed in its manifest. The flicker of the `markings-graze`
 * pair is `art-markings-flicker-desktop.spec.ts` and `markings-flicker-low.spec.ts`.
 *
 * `DV_UPDATE_GOLDEN=1` (outside CI, under the golden-update label) writes the goldens and the manifest.
 */
const GOLDEN_DIR = 'tests/e2e/golden/look';


async function captureShot(page: Page, tier: string, shot: string): Promise<Rgba> {
  await bootWorld(page, tier, '', GOLDEN_VIEWPORT);
  await page.addStyleTag({ content: HIDE });
  await clearActors(page);
  await setSky(page, 13, 'clear');
  await page.evaluate((id) => (window as unknown as W).__dvBridge.world.shot(id), shot);
  await frames(page, 2);
  return decodePng(await page.locator('#dv-engine-canvas').screenshot());
}

test.describe('markings goldens @markings-golden', () => {
  test.describe.configure({ timeout: 1_800_000 });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'goldens are chromium-webgl2 only');
  });
  const update = process.env['DV_UPDATE_GOLDEN'] === '1' && !process.env['CI'];

  test('the manifest lists the six markings goldens and names the current synth bake @markings-golden', () => {
    if (update) return;
    const manifest = read<{ bakeId: string; shots: string[] }>(`${GOLDEN_DIR}/manifest.json`);
    expect(manifest.bakeId, `look golden from bake ${manifest.bakeId}, current bake ${bakeIdOf()}`).toBe(bakeIdOf());
    for (const tier of PAINT_TIERS) for (const shot of MARKINGS_GOLDEN_SHOTS) expect(manifest.shots).toContain(`${tier}.${shot}.png`);
  });

  for (const tier of PAINT_TIERS) {
    for (const shot of MARKINGS_GOLDEN_SHOTS) {
      test(`${tier} ${shot} is within the tolerance of its golden and a second capture is byte-identical @markings-golden`, async ({ page }) => {
        const file = `${GOLDEN_DIR}/${tier}.${shot}.png`;
        const first = await captureShot(page, tier, shot);
        expect(first).toMatchObject({ width: GOLDEN_VIEWPORT.width, height: GOLDEN_VIEWPORT.height });
        await frames(page, 2);
        const second = decodePng(await page.locator('#dv-engine-canvas').screenshot());
        expect(identical(first, second), 'two consecutive captures differ').toBe(true);
        const mode = (await world(page, (w) => w.look()))?.markings.mode;
        expect(mode, `${tier} paints`).toBe(tier === 'desktop' ? 'worn' : 'flat');
        if (update) {
          mkdirSync(GOLDEN_DIR, { recursive: true });
          writeFileSync(file, encodePng(first));
          return;
        }
        expect(existsSync(file), `${file} is missing; DV_UPDATE_GOLDEN=1 writes it (outside CI, under the golden-update label)`).toBe(true);
        const diff = diffImages(first, decodePng(readFileSync(file)));
        expect(goldenFailures(diff), `${tier} ${shot}: ${JSON.stringify(diff)}`).toEqual([]);
      });
    }
  }
});
