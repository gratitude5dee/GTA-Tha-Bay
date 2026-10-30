import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type TestInfo } from '@playwright/test';
import { encodePng } from '../support/image-diff.ts';
import { FLICKER_THRESHOLD, FLICKER_VIEWPORT, flickerShare, roadRegion } from '../support/flicker.ts';
import { bootWorld, world, type W } from './markings-helpers.ts';
import { HIDE_ALL, captureShot, setSky } from './look-fixes-helpers.ts';

/**
 * The `markings-graze` pair of M02h1 AC-5 (@markings-golden): two shots 0.05 m apart looking along 400 m of straight road from 1.6 m, at 640 x 360.
 * The share of road pixels (below the horizon, inside the cone of the road's edges) that change past 32/255 with no look-alike a pixel away must
 * be at most `MARKINGS_FLICKER_LIMIT`; with the antialiasing and the distance fade off (`markings.aa`) the same pair must exceed it, which proves
 * the measure sees the sparkle the fade removes. Textures are off (as in the M02g2 pairs, DL-757): the asphalt's own texture detail under a 0.05 m
 * parallax is not what this case counts.
 *
 * One case per tier in a file of its own (`markings-flicker-desktop.spec.ts`, `markings-flicker-low.spec.ts`): a `desktop` pair is the longest
 * single case of the suite on software GL, and a shard is cut out of the sorted file names by test count (BD-REPAIR-M02g2-03).
 */
export const MARKINGS_FLICKER_LIMIT = 0.002;
const SHOT = { id: 'markings-graze', pitchDeg: -0.5, fovDeg: 60, eyeM: 1.6, halfWidthM: 9.1 } as const;

export function registerMarkingsPair(tier: 'desktop' | 'mobile-low' | 'xr-quest'): void {
  test.describe('markings flicker @markings-golden', () => {
    test.describe.configure({ timeout: 3_600_000 });
    test(`${tier}: the pair ${SHOT.id} flickers at most 0.2 % of the road pixels, and more than that with markings.aa off @markings-golden`, async ({ page }, testInfo: TestInfo) => {
      test.skip(testInfo.project.name === 'chromium-webgpu', 'the pair bounds are WebGL2 bounds');
      const t0 = Date.now();
      await bootWorld(page, tier, '&textures=0', FLICKER_VIEWPORT);
      await page.addStyleTag({ content: HIDE_ALL });
      await setSky(page, 13, 'clear');
      const mask = roadRegion({ width: FLICKER_VIEWPORT.width, height: FLICKER_VIEWPORT.height, ...SHOT });
      const measure = async (first: 'shot' | 'move'): Promise<{ share: number; raw: number; a: Awaited<ReturnType<typeof captureShot>>; b: Awaited<ReturnType<typeof captureShot>> }> => {
        const a = await captureShot(page, SHOT.id, first);
        const b = await captureShot(page, `${SHOT.id}-b`, 'move');
        return { share: flickerShare(a, b, FLICKER_THRESHOLD, 1, mask), raw: flickerShare(a, b, FLICKER_THRESHOLD, 0, mask), a, b };
      };
      const on = await measure('shot');
      console.log(`markings flicker ${testInfo.project.name} ${tier}: ${(on.share * 100).toFixed(3)} % (${(on.raw * 100).toFixed(3)} % without the window), boot and shots ${Math.round((Date.now() - t0) / 1000)} s`);
      const keep = process.env['DV_FLICKER_DIR'];
      if (keep) {
        mkdirSync(keep, { recursive: true });
        writeFileSync(`${keep}/${testInfo.project.name}.${tier}.markings-graze.png`, encodePng(on.a));
        writeFileSync(`${keep}/${testInfo.project.name}.${tier}.markings-graze-b.png`, encodePng(on.b));
      }
      expect(on.a.width).toBe(FLICKER_VIEWPORT.width);
      expect((await world(page, (w) => w.look()))?.markings.mode).toBe(tier === 'desktop' ? 'worn' : 'flat');
      expect(on.share, `flicker of the pair against ${MARKINGS_FLICKER_LIMIT}`).toBeLessThanOrEqual(MARKINGS_FLICKER_LIMIT);

      // the same pair with the antialiasing and the fade off: the hard edges sparkle
      expect(await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('markings.aa', false))).toBe(true);
      const off = await measure('move');
      console.log(`markings flicker ${testInfo.project.name} ${tier} with markings.aa off: ${(off.share * 100).toFixed(3)} %`);
      expect(off.share, 'with markings.aa off the pair flickers past the bound').toBeGreaterThan(MARKINGS_FLICKER_LIMIT);
    });
  });
}
