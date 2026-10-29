import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { QualityTierId } from '../../packages/shared/src/index.ts';
import { decodePng, diffImages, encodePng, goldenFailures, identical, meanAbsDifference, type Rgba } from '../support/image-diff.ts';
import { bakeIdOf, bootWorld, frames, GOLDEN_VIEWPORT, HIDE, read, texturesSettled, type W } from './art-textures-helpers.ts';

/**
 * M10d0 AC-7 (@textures-golden, `chromium-webgl2`): the shots of `config/world/surface-textures.json` against the committed goldens,
 * byte-identical repeats, and the mean difference from textures-off. Split out of `art-textures.spec.ts` so CI's file-level sharding can
 * place these long desktop boots apart from the other texture cases (BD-FIX-CI-TEXGOLD-01).
 *
 * `DV_UPDATE_GOLDEN=1` (outside CI, under the golden-update label) writes the goldens.
 */

const GOLDEN_DIR = 'tests/e2e/golden/textures';
const SHOT_IDS = new Set(read<{ shots: { id: string }[] }>('config/world/look-shots.json').shots.map((s) => s.id));
/** `curb-corner` and `lot-plaza` join once M02h2 has added them to config/world/look-shots.json. */
const GOLDEN_SHOTS = ['noon-street', 'night-street', 'curb-corner', 'lot-plaza'].filter((s) => SHOT_IDS.has(s));
/** The shots where the textures must show: the mean difference from textures-off. */
const SHOWS = new Set(['noon-street', 'curb-corner', 'lot-plaza']);

async function capture(page: Page, tier: string, shot: string, textures: boolean): Promise<Rgba> {
  await bootWorld(page, tier as QualityTierId, textures ? '' : '&textures=0', GOLDEN_VIEWPORT);
  await texturesSettled(page);
  await page.addStyleTag({ content: HIDE });
  await page.evaluate(() => {
    type G = { group: { visible: boolean } } | null;
    const view = (window as unknown as { __dvBridge: { world: { internals(): { view: { traffic: G; peds: G; transit: G } } } } }).__dvBridge.world.internals().view;
    for (const r of [view.traffic, view.peds, view.transit]) if (r) r.group.visible = false;
  });
  await page.evaluate((id) => (window as unknown as W).__dvBridge.world.shot(id), shot);
  await frames(page, 2);
  return decodePng(await page.locator('#dv-engine-canvas').screenshot());
}

test.describe('textures goldens @textures-golden', () => {
  test.describe.configure({ timeout: 1_800_000 });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'goldens are chromium-webgl2 only');
  });
  const update = process.env['DV_UPDATE_GOLDEN'] === '1' && !process.env['CI'];

  test('the manifest names the current synth bake, or fails naming both @textures-golden', () => {
    if (update) return;
    const manifest = read<{ bakeId: string }>(`${GOLDEN_DIR}/manifest.json`);
    expect(manifest.bakeId, `textures golden from bake ${manifest.bakeId}, current bake ${bakeIdOf()}`).toBe(bakeIdOf());
  });

  for (const tier of ['desktop', 'mobile-low'] as const) {
    for (const shot of GOLDEN_SHOTS) {
      test(`${tier} ${shot} is within the tolerance of its golden, a repeat is byte-identical @textures-golden`, async ({ page }) => {
        const file = `${GOLDEN_DIR}/${tier}.${shot}.png`;
        const first = await capture(page, tier, shot, true);
        expect(first).toMatchObject({ width: GOLDEN_VIEWPORT.width, height: GOLDEN_VIEWPORT.height });
        await frames(page, 2);
        const second = decodePng(await page.locator('#dv-engine-canvas').screenshot());
        expect(identical(first, second), 'two consecutive captures differ').toBe(true);
        if (update) {
          mkdirSync(GOLDEN_DIR, { recursive: true });
          writeFileSync(file, encodePng(first));
        } else {
          expect(existsSync(file), `${file} is missing; DV_UPDATE_GOLDEN=1 writes it (outside CI, under the golden-update label)`).toBe(true);
          const diff = diffImages(first, decodePng(readFileSync(file)));
          expect(goldenFailures(diff), `${tier} ${shot}: ${JSON.stringify(diff)}`).toEqual([]);
        }
      });
    }
  }

  // Its own tests (two boots each): the textures must show, not only repeat.
  for (const tier of ['desktop', 'mobile-low'] as const) {
    for (const shot of GOLDEN_SHOTS.filter((s) => SHOWS.has(s))) {
      test(`${tier} ${shot} differs from textures-off by at least 0.02 @textures-golden`, async ({ page }) => {
        test.setTimeout(3_600_000);
        const on = await capture(page, tier, shot, true);
        // the second boot reuses the page, so the first world is gone (its renderer released) before the textures-off world renders:
        // two software-rendered worlds at once doubled this case's time on CI (BD-FIX-CI-TEXGOLD-01)
        const without = await capture(page, tier, shot, false);
        const delta = meanAbsDifference(on, without);
        expect(delta, `${tier} ${shot}: the textures change the picture by ${delta.toFixed(4)}`).toBeGreaterThanOrEqual(0.02);
      });
    }
  }

  test('regenerating writes the manifest @textures-golden', () => {
    test.skip(!update, 'DV_UPDATE_GOLDEN=1 only');
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(
      `${GOLDEN_DIR}/manifest.json`,
      `${JSON.stringify(
        {
          $comment: 'M10d0 texture goldens: written by DV_UPDATE_GOLDEN=1 pnpm check:e2e -- --project=chromium-webgl2 --grep @textures-golden (outside CI, under the golden-update label). 256 x 144 captures of the canvas on chromium-webgl2 with the surface textures on.',
          schema: 'textures-golden/1',
          bakeId: bakeIdOf(),
          source: 'synth',
          viewport: GOLDEN_VIEWPORT,
          tolerance: { channel: 6, minFraction: 0.99, meanAbs: 2 },
          shots: ['desktop', 'mobile-low'].flatMap((t) => GOLDEN_SHOTS.map((s) => `${t}.${s}.png`)),
        },
        null,
        2,
      )}\n`,
    );
  });
});

