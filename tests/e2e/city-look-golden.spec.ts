import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { QualityTierId } from '../../packages/shared/src/index.ts';
import { decodePng, diffImages, encodePng, goldenFailures, identical, type Rgba } from '../support/image-diff.ts';
import { bakeIdOf, bootWorld, frames, GOLDEN_VIEWPORT, read, type Json, type W } from './world-look-helpers.ts';
import { MARKINGS_GOLDEN_SHOTS, PAINT_TIERS } from './markings-helpers.ts';

/**
 * M02e AC-6 (@look-golden, `chromium-webgl2` only): ten 256 x 144 captures (fourteen since M02h2's `curb-corner` and `lot-plaza`) against the committed goldens, each repeated byte-identical.
 * Split out of `world-look.spec.ts` (BD-FIX-CI-WORLDLOOK-01): Playwright shards by file and by test count over the sorted file names, so
 * the goldens and the other look cases (one desktop boot each, seconds per frame on software GL) shared chromium-webgl2 shard 8, 53 to
 * 56 of its 60 minutes; the `city-` name sorts this file into a light slice.
 *
 * `DV_UPDATE_GOLDEN=1` (outside CI, under the golden-update label) writes the goldens and the manifest.
 */

const GOLDEN_DIR = 'tests/e2e/golden/look';
const GOLDEN_SHOTS: { tier: string; shot: string }[] = [
  ...(['desktop', 'mobile', 'mobile-low'] as const).flatMap((tier) => ['noon-street', 'golden-water', 'night-street'].map((shot) => ({ tier, shot }))),
  { tier: 'desktop', shot: 'fog-west' },
  // M02h2: the curb, gutter and ramp at a corner, and a lot beside a plaza
  ...(['desktop', 'mobile-low'] as const).flatMap((tier) => ['curb-corner', 'lot-plaza'].map((shot) => ({ tier, shot }))),
];

/** The 256 x 144 canvas of the page after `shot(id)` has presented its frame. The debug panel is hidden so the picture is the canvas alone. */
async function captureShot(page: Page, tier: string, shot: string): Promise<Rgba> {
  await bootWorld(page, tier as QualityTierId, '', GOLDEN_VIEWPORT);
  await page.addStyleTag({ content: '.dv-hud, .dv-sim-panel, .dv-sky-controls, .dv-pursuit, .dv-modes, .dv-mission, .dv-npcdbg, .dv-npcagency, [data-dv-xr-smoke], [data-dv-world-controls] { display: none !important }' });
  // M03b1/M03b2 integration: the ambient traffic, pedestrians and transit vehicles move between two captures, so the goldens are taken
  // without them (their groups are hidden; the goldens predate them). The groups are children of the scene, so the shadow pass skips them too.
  await page.evaluate(() => {
    type G = { group: { visible: boolean } } | null;
    const view = (window as unknown as { __dvBridge: { world: { internals(): { view: { traffic: G; peds: G; transit: G } } } } }).__dvBridge.world.internals().view;
    for (const r of [view.traffic, view.peds, view.transit]) if (r) r.group.visible = false;
  });
  await page.evaluate((id) => (window as unknown as W).__dvBridge.world.shot(id), shot);
  await frames(page, 2);
  const buf = await page.locator('#dv-engine-canvas').screenshot();
  return decodePng(buf);
}

test.describe('look goldens @look-golden', () => {
  test.describe.configure({ timeout: 1_800_000 });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'goldens are chromium-webgl2 only');
  });

  const update = process.env['DV_UPDATE_GOLDEN'] === '1' && !process.env['CI'];

  test('the manifest names the current synth bake, or fails naming both @look-golden', () => {
    if (update) return;
    const manifest = read<{ bakeId: string }>(`${GOLDEN_DIR}/manifest.json`);
    const current = bakeIdOf();
    expect(manifest.bakeId, `look golden from bake ${manifest.bakeId}, current bake ${current}`).toBe(current);
  });

  for (const { tier, shot } of GOLDEN_SHOTS) {
    test(`${tier} ${shot} is within the tolerance of its golden and a second capture is byte-identical @look-golden`, async ({ page }) => {
      const file = `${GOLDEN_DIR}/${tier}.${shot}.png`;
      const first = await captureShot(page, tier, shot);
      expect(first).toMatchObject({ width: GOLDEN_VIEWPORT.width, height: GOLDEN_VIEWPORT.height });
      // Two consecutive captures of one shot are byte-identical.
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
      expect(goldenFailures(diff), `${tier} ${shot}: ${JSON.stringify(diff)}`).toEqual([]);
    });
  }

  test('regenerating writes the manifest @look-golden', () => {
    test.skip(!update, 'DV_UPDATE_GOLDEN=1 only');
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(
      `${GOLDEN_DIR}/manifest.json`,
      `${JSON.stringify(
        {
          $comment: 'M02e look goldens: written by DV_UPDATE_GOLDEN=1 pnpm check:e2e -- --project=chromium-webgl2 --grep @look-golden (outside CI, under the golden-update label). 256 x 144 captures of the canvas on chromium-webgl2 at the shots of config/world/look-shots.json.',
          schema: 'look-golden/1',
          bakeId: bakeIdOf(),
          source: 'synth',
          viewport: GOLDEN_VIEWPORT,
          tolerance: { channel: 6, minFraction: 0.99, meanAbs: 2 },
          // M02h1: the six markings goldens are written by markings-golden.spec.ts (@markings-golden) and listed here with the others
          shots: [...GOLDEN_SHOTS.map((s) => `${s.tier}.${s.shot}.png`), ...PAINT_TIERS.flatMap((t) => MARKINGS_GOLDEN_SHOTS.map((s) => `${t}.${s}.png`))],
        } satisfies Json,
        null,
        2,
      )}\n`,
    );
  });
});
