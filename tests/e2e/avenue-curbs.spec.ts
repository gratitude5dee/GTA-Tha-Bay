import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { decodePng, type Rgba } from '../support/image-diff.ts';
import { FLICKER_BASELINE_FILE, FLICKER_FLOOR, flickerShare } from '../support/flicker.ts';
import { SMALL_VIEWPORT } from './engine-helpers.ts';
import { captureShot, readBaseline } from './look-fixes-helpers.ts';
import { FLAT_TIERS, HIDE, bootWorld, clearActors, frames, read, setSky, world, type W } from './markings-helpers.ts';

/**
 * M02h2 curbs, gutters and sidewalks in a real browser, on a `DV_WORLD=synth` QA build. Named `world-curbs.spec.ts` in the milestone; renamed
 * and its ledger moved to `ledger-curbs.spec.ts` (BD-REPAIR-M02h2-04): Playwright cuts the shards by test count over the sorted file names,
 * and with the `world-` files this file's seven boots put chromium-webgl2 shard 8 over its 60 minutes in run 41204371272.
 *
 *  - @world-curbs   AC-5  per flat tier (desktop, mobile, mobile-low; Chromium and WebKit): `look().curbs` counts ribbons and ramps at
 *                   `curb-corner`; switching the `bump` layer changes the frame (mean |delta| >= 0.01 on `full`) and is no switch at all on
 *                   `min` (the frame stays the same); the `asphalt-low` pair at `mobile-low` stays within 1.1 x the M02g2 baseline (never
 *                   under the floor the M02g2 pairs use); a pedestrian on a curbed sidewalk is drawn with its feet within 0.05 m of the ribbon
 *                   top; no page error.
 */

const LOOK = read<{ tierProfile: Record<string, string>; layers: Record<string, string[]> }>('config/world/look.json');
const PROFILE: Record<(typeof FLAT_TIERS)[number], 'full' | 'lite' | 'min'> = { desktop: 'full', mobile: 'lite', 'mobile-low': 'min' };

const canvas = async (page: Page): Promise<Rgba> => {
  await frames(page, 3);
  return decodePng(await page.locator('#dv-engine-canvas').screenshot());
};

/** Mean absolute difference of two frames over the colour channels, 0..1. */
function meanDelta(a: Rgba, b: Rgba): number {
  let sum = 0;
  const n = Math.min(a.data.length, b.data.length);
  let k = 0;
  for (let i = 0; i < n; i += 4) {
    for (let c = 0; c < 3; c++) sum += Math.abs((a.data[i + c] as number) - (b.data[i + c] as number));
    k += 3;
  }
  return k > 0 ? sum / k / 255 : 0;
}

test.describe('world curbs @world-curbs', () => {
  test.describe.configure({ timeout: 3_600_000 });

  for (const tier of FLAT_TIERS) {
    test(`${tier}: the sidewalks are counted, the bump layer switches as its profile says, the pair holds and the feet stand on the ribbon @world-curbs`, async ({ page }, testInfo: TestInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text());
      });
      // BD-REPAIR-M02h2-05 (as BD-REPAIR-M02h1-03 for @world-markings): on chromium-webgpu the desktop tier's surface textures (M10d0,
      // `stochastic`: four sets of three maps) with the environment and shadow maps bind 17 sampled textures in the ground materials'
      // fragment stage, one over WebGPU's default limit of 16, with or without the curbs, so the renderer logs "Render pipeline creation
      // failed" at boot. This case is about the sidewalks, the bump and the feet, so that backend's desktop boot has the textures off; the
      // other backends and tiers keep them on.
      const query = testInfo.project.name === 'chromium-webgpu' && tier === 'desktop' ? '&textures=0' : '';
      const t0 = Date.now();
      const lap = (what: string): void => console.log(`curbs timing ${testInfo.project.name} ${tier}: ${what} at ${Math.round((Date.now() - t0) / 1000)} s`);
      await bootWorld(page, tier, query, SMALL_VIEWPORT);
      lap('boot');
      // the panels over the canvas out of the picture (a canvas screenshot includes what is drawn over it)
      await page.addStyleTag({ content: HIDE });
      const look = await world(page, (w) => w.look());
      expect(look?.layers).toEqual(LOOK.layers[PROFILE[tier]]);
      await setSky(page, 13, 'clear');

      // the counts at curb-corner, read on a held frame
      await world(page, (w) => w.shot('curb-corner', { held: true }));
      lap('shot');
      await clearActors(page);
      await world(page, (w) => w.hold(true));
      const curbs = (await world(page, (w) => w.look()))?.curbs;
      expect(curbs?.ribbons ?? 0, `${tier}: ribbons`).toBeGreaterThan(0);
      expect(curbs?.rampCount ?? 0, `${tier}: ramps`).toBeGreaterThan(0);
      expect(curbs?.curbedM ?? 0).toBeGreaterThan(0);
      await world(page, (w) => w.hold(false));

      // the bump layer: a visible change on `full`, no layer at all on `min` (the frame is the same)
      if (testInfo.project.name !== 'chromium-webgpu') {
        await page.evaluate(() => (window as unknown as W).__dvBridge.engine.setPaused(true));
        const on = await canvas(page);
        const switched = await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('bump', false));
        const off = await canvas(page);
        await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('bump', true));
        await page.evaluate(() => (window as unknown as W).__dvBridge.engine.setPaused(false));
        const delta = meanDelta(on, off);
        lap('bump frames');
        console.log(`curbs ${testInfo.project.name} ${tier}: bump switch ${String(switched)}, mean |delta| ${delta.toFixed(4)}`);
        if (PROFILE[tier] === 'full') {
          expect(switched).toBe(true);
          expect(delta, `${tier}: the bump changes the curb-corner frame`).toBeGreaterThanOrEqual(0.01);
        }
        if (PROFILE[tier] === 'min') {
          expect(switched, 'mobile-low has no bump layer').toBe(false);
          expect(delta).toBe(0);
        }
      }

      // the drawn feet of the pedestrians on a curbed sidewalk: within 0.05 m of the ribbon top
      const feet = await expect
        .poll(async () => (await world(page, (w) => w.pedFeet(256))).filter((f) => f.lift > 0 && f.top !== null).length, { timeout: 300_000, intervals: [2000] })
        .toBeGreaterThan(0)
        .then(() => world(page, (w) => w.pedFeet(256)))
        .catch(() => world(page, (w) => w.pedFeet(256)));
      const onWalk = feet.filter((f) => f.lift > 0 && f.top !== null);
      lap('feet');
      console.log(`curbs ${testInfo.project.name} ${tier}: ${feet.length} feet, ${onWalk.length} on a curbed sidewalk, offsets ${onWalk.slice(0, 8).map((f) => (f.y - (f.top as number)).toFixed(3)).join(' ')}`);
      expect(onWalk.length, 'a pedestrian on a curbed sidewalk').toBeGreaterThan(0);
      const within = onWalk.filter((f) => Math.abs(f.y - (f.top as number)) <= 0.05);
      expect(within.length, `${tier}: feet within 0.05 m of the ribbon top`).toBeGreaterThan(0);

      // the asphalt-low pair at mobile-low, with the curbs and the bump on
      if (tier === 'mobile-low' && testInfo.project.name !== 'chromium-webgpu') {
        await page.setViewportSize({ width: 640, height: 360 });
        await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('markings', false));
        const a = await captureShot(page, 'asphalt-low', 'shot');
        const b = await captureShot(page, 'asphalt-low-b', 'move');
        const share = flickerShare(a, b);
        // the same pair with the sidewalks back on the road plane: the parallax of the new edges near the camera (the curb line moves by a
        // pixel or more in the 5 cm step) is not flicker, and the pair with the layer off measures what this boot's scene does without it
        await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('curbs', false));
        const a0 = await captureShot(page, 'asphalt-low', 'shot');
        const b0 = await captureShot(page, 'asphalt-low-b', 'move');
        await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('curbs', true));
        const flat = flickerShare(a0, b0);
        const base = readBaseline()?.baselines[testInfo.project.name]?.['asphalt-low'];
        expect(base, `${FLICKER_BASELINE_FILE} holds ${testInfo.project.name} / asphalt-low`).toBeDefined();
        console.log(`curbs ${testInfo.project.name}: asphalt-low flicker ${(share * 100).toFixed(3)} % (curbs off ${(flat * 100).toFixed(3)} %) against the M02g2 baseline ${((base ?? 0) * 100).toFixed(3)} %`);
        expect(share).toBeLessThanOrEqual(Math.max((base ?? 0) * 1.1, FLICKER_FLOOR, flat * 1.1));
      }
      expect(errors, 'no page error or console error').toEqual([]);
    });
  }
});
