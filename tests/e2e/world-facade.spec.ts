import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { decodePng, diffImages, encodePng, goldenFailures, identical, type Rgba } from '../support/image-diff.ts';
import { FLICKER_FLOOR, FLICKER_VIEWPORT, flickerShare } from '../support/flicker.ts';
import { canvasRgba } from './canvas-capture.ts';
import { HIDE_ALL, captureShot as capturePair } from './look-fixes-helpers.ts';
import { FLAT_TIERS, GOLDEN_VIEWPORT, HIDE, bakeIdOf, bootWorld, frames, read, setSky, world, type W } from './markings-helpers.ts';
import { SMALL_VIEWPORT } from './engine-helpers.ts';

/**
 * M02h7 facade kit in a real browser, on a `DV_WORLD=synth` QA build.
 *
 *  - @world-facade (AC-4) per flat tier on `chromium-webgl2` and `webkit-webgl2` (and the same report on `chromium-webgpu`): at
 *    `shot('facade-shopfront')` `look().facade` reports the kit on `desktop` and `mobile` (awnings, bays and shop walls above 0, cornices
 *    above 0 only at `desktop`) and off at `mobile-low` (`kitTriangles` 0, the `min` bands on); `setLook(false)` reports the kit off; the
 *    sign glow is 0 at 13:00 and above 0 at 22:00; the glass's analytic sky reflection is on wherever no environment map is; brick and
 *    stucco are in `look().textures.sets` at `desktop` and `mobile` (unless the backend is in M10d0's `unsupported` list) and neither at
 *    `mobile-low`.
 *  - @world-facade, the `facade-graze` pair at `mobile` (WebGL2 projects): its flicker share at most 10 % over the committed baseline (the same
 *    pair with the `facade` layer off, that is the parent commit's buildings; `DV_FACADE_BASELINE=1` writes it), never under FLICKER_FLOOR.
 *  - @facade-golden (AC-5, `chromium-webgl2`): `facade-shopfront`, `facade-bays` and `facade-night` at `desktop`, `mobile` and `mobile-low`
 *    against `tests/e2e/golden/facade`, each repeated byte-identical; the manifest names the synth bake (`DV_UPDATE_GOLDEN=1` writes them).
 *  - @facade-ledger (AC-6) is `facade-ledger.spec.ts` (a serial group in a file of its own, as BD-M02h5-07).
 */

type Facade = NonNullable<NonNullable<ReturnType<W['__dvBridge']['world']['look']>>['facade']>;
const facade = async (page: Page): Promise<Facade> => (await world(page, (w) => w.look()?.facade ?? null)) as Facade;

const GOLDEN_DIR = 'tests/e2e/golden/facade';
const GOLDEN_SHOTS = ['facade-shopfront', 'facade-bays', 'facade-night'] as const;
const BASELINE_FILE = `${GOLDEN_DIR}/flicker-baseline.json`;
const PAIR = 'facade-graze';
const PAIR_TIER = 'mobile';
const update = process.env['DV_UPDATE_GOLDEN'] === '1' && !process.env['CI'];
const baselineMode = process.env['DV_FACADE_BASELINE'] === '1';

test.describe('facade kit @world-facade', () => {
  test.describe.configure({ timeout: 1_800_000 });

  for (const tier of FLAT_TIERS) {
    test(`${tier}: facade-shopfront reports the kit, the min bands, the sign glow by the hour, the glass reflection and the wall textures @world-facade`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await bootWorld(page, tier, '', SMALL_VIEWPORT);
      await setSky(page, 13, 'clear');
      await world(page, (w) => w.shot('facade-shopfront', { held: true }));
      // the shop front's chunk carries the kit once it is meshed and resident
      if (tier !== 'mobile-low') await expect.poll(async () => (await facade(page)).awnings, { timeout: 300_000, intervals: [500] }).toBeGreaterThan(0);
      const f = await facade(page);
      const look = await world(page, (w) => w.look());
      console.log(`world-facade ${testInfo.project.name} ${tier}: ${JSON.stringify(f)}`);
      if (tier === 'mobile-low') {
        expect(f).toMatchObject({ kit: false, kitTriangles: 0, minBands: true, awnings: 0, bays: 0, cornices: 0 });
      } else {
        expect(f.kit).toBe(true);
        expect(f.minBands).toBe(false);
        expect(f.shopWalls).toBeGreaterThan(0);
        expect(f.awnings).toBeGreaterThan(0);
        expect(f.bays).toBeGreaterThan(0);
        expect(f.kitTriangles).toBeGreaterThan(0);
        if (tier === 'desktop') expect(f.cornices).toBeGreaterThan(0);
        else expect(f.cornices).toBe(0);
      }
      // the analytic sky in the glass wherever no environment map carries the reflection
      if (look && !look.envMap) expect(f.skyReflect, 'skyReflect where envMap is false').toBe(true);
      // signs and shop glass: dark at 13:00, lit at 22:00
      expect(f.signEmissive).toBe(0);
      await setSky(page, 22, 'clear');
      await frames(page, 2);
      await expect.poll(async () => (await facade(page)).signEmissive, { timeout: 60_000, intervals: [250] }).toBeGreaterThan(0);
      await setSky(page, 13, 'clear');
      // the wall textures (M10d0's sets bound through the seam): brick and stucco on desktop and mobile, neither on mobile-low
      await world(page, (w) => w.clearShot());
      await expect.poll(async () => (await world(page, (w) => w.look()?.textures ?? null))?.settled ?? true, { timeout: 600_000, intervals: [1000] }).toBe(true);
      const tex = await world(page, (w) => w.look()?.textures ?? null);
      if (tier === 'mobile-low' || !tex || tex.unsupported) {
        expect(tex?.sets ?? []).not.toContain('brick');
        expect(tex?.sets ?? []).not.toContain('stucco');
      } else {
        expect(tex.sets).toEqual(expect.arrayContaining(['brick', 'stucco']));
      }
      // the `facade` layer off re-meshes the resident chunks once without the kit (and switches its shading off); on again brings it back.
      // At `mobile` only: at `desktop` the re-mesh of every resident unit through the upload gate takes longer than the case (BD-M02h7-08)
      if (tier === 'mobile') {
        expect(await world(page, (w) => w.setLookLayer('facade', false))).toBe(true);
        expect((await facade(page)).layer).toBe(false);
        await expect.poll(async () => (await facade(page)).kitTriangles, { timeout: 900_000, intervals: [1000] }).toBe(0);
        expect(await world(page, (w) => w.setLookLayer('facade', true))).toBe(true);
        await expect.poll(async () => (await facade(page)).kitTriangles, { timeout: 900_000, intervals: [1000] }).toBeGreaterThan(0);
      }
      if (tier === 'mobile-low') expect(await world(page, (w) => w.setLookLayer('facade', false)), 'the min bands are a layer of mobile-low').toBe(true);
      // the look off: the legacy materials, no kit
      expect(await world(page, (w) => w.setLook(false))).toBe(true);
      expect((await facade(page)).kit).toBe(false);
      expect(await world(page, (w) => w.setLook(true))).toBe(true);
      expect(errors).toEqual([]);
    });
  }

  test(`${PAIR_TIER}: the facade-graze pair flickers at most 10 % over its committed baseline @world-facade`, async ({ page }, testInfo: TestInfo) => {
    test.skip(testInfo.project.name === 'chromium-webgpu', 'the pair baselines are WebGL2 baselines');
    // textures off (as the look-fix pairs): the pair counts geometry and shading flicker, not an albedo's own detail under the parallax
    await bootWorld(page, PAIR_TIER, '&textures=0', FLICKER_VIEWPORT);
    await page.addStyleTag({ content: HIDE_ALL });
    await setSky(page, 13, 'clear');
    await page.evaluate(() => {
      const w = (window as unknown as W).__dvBridge.world;
      w.setLookLayer('markings', false);
      w.setLookLayer('furniture', false);
      w.setLookLayer('parked', false);
    });
    // the baseline is the parent commit's buildings: the `facade` layer off (no kit geometry, no kit shading)
    if (baselineMode) expect(await world(page, (w) => w.setLookLayer('facade', false))).toBe(true);
    const a = await capturePair(page, PAIR, 'shot');
    if (!baselineMode) expect((await facade(page)).awnings, 'the pair sees the kit').toBeGreaterThan(0);
    const b = await capturePair(page, `${PAIR}-b`, 'move');
    const share = flickerShare(a, b);
    console.log(`facade flicker ${testInfo.project.name} ${PAIR}${baselineMode ? ' (baseline, facade off)' : ''}: ${(share * 100).toFixed(3)} %`);
    const keep = process.env['DV_FLICKER_DIR'];
    if (keep) {
      mkdirSync(keep, { recursive: true });
      writeFileSync(`${keep}/${testInfo.project.name}.${PAIR}${baselineMode ? '.off' : ''}.png`, encodePng(a));
      writeFileSync(`${keep}/${testInfo.project.name}.${PAIR}-b${baselineMode ? '.off' : ''}.png`, encodePng(b));
    }
    type Base = { $comment: string; baselines: Record<string, Record<string, number>> };
    if (baselineMode) {
      const f: Base = existsSync(BASELINE_FILE)
        ? read<Base>(BASELINE_FILE)
        : { $comment: 'M02h7: flicker share of the facade-graze pair at mobile with the facade layer off (the parent commit\'s buildings), per project; written by DV_FACADE_BASELINE=1 (tests/support/flicker.ts flickerShare, 640 x 360, 32/255, one-pixel window).', baselines: {} };
      f.baselines[testInfo.project.name] = { [PAIR]: Number(share.toFixed(6)) };
      mkdirSync(GOLDEN_DIR, { recursive: true });
      writeFileSync(BASELINE_FILE, `${JSON.stringify(f, null, 2)}\n`);
      return;
    }
    const base = existsSync(BASELINE_FILE) ? read<Base>(BASELINE_FILE).baselines[testInfo.project.name]?.[PAIR] : undefined;
    expect(base, `${BASELINE_FILE} holds ${testInfo.project.name} / ${PAIR}`).toBeDefined();
    expect(share, `flicker of ${PAIR} against 1.1 x the baseline ${base} (never under FLICKER_FLOOR ${FLICKER_FLOOR})`).toBeLessThanOrEqual(Math.max((base ?? 0) * 1.1, FLICKER_FLOOR));
  });
});

/** The golden canvas of a shot (held, the actors hidden, the debug panel out of the picture). */
async function goldenShot(page: Page, shot: string): Promise<Rgba> {
  await page.addStyleTag({ content: HIDE });
  await page.evaluate(() => {
    type G = { group: { visible: boolean } } | null;
    const view = (window as unknown as W).__dvBridge.world.internals().view as unknown as { traffic: G; peds: G; transit: G };
    for (const r of [view.traffic, view.peds, view.transit]) if (r) r.group.visible = false;
  });
  await page.evaluate((id) => (window as unknown as W).__dvBridge.world.shot(id, { held: true }), shot);
  await frames(page, 2);
  return canvasRgba(page);
}

test.describe('facade goldens @facade-golden', () => {
  test.describe.configure({ timeout: 1_800_000 });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'goldens are chromium-webgl2 only');
  });

  test('the manifest names the current synth bake, or fails naming both @facade-golden', () => {
    if (update) return;
    const manifest = read<{ bakeId: string }>(`${GOLDEN_DIR}/manifest.json`);
    const current = bakeIdOf();
    expect(manifest.bakeId, `facade golden from bake ${manifest.bakeId}, current bake ${current}`).toBe(current);
  });

  for (const tier of FLAT_TIERS) {
    // one boot per tier: the three shots stand within 90 m of each other on the x = -408 street (CI capacity, BD-FIX-CI-TEXGOLD-01)
    test(`${tier}: facade-shopfront, facade-bays and facade-night are within the tolerance of their goldens and repeat byte-identical @facade-golden`, async ({ page }) => {
      await bootWorld(page, tier, '', GOLDEN_VIEWPORT);
      // the wall sets (brick, stucco) and the facade atlas load after the reveal: a golden is taken once both have settled, so no texture
      // arrives between two captures (the `mobile` bays differed once when the 512 px atlas landed between them)
      await expect
        .poll(async () => world(page, (w) => {
          const t = w.look()?.textures ?? null;
          const a = w.art()?.facadeAtlas ?? null;
          return (t?.settled ?? true) && (!a || !a.on || a.loaded || a.failed !== null);
        }), { timeout: 900_000, intervals: [1000] })
        .toBe(true);
      for (const shot of GOLDEN_SHOTS) {
        const file = `${GOLDEN_DIR}/${tier}.${shot}.png`;
        let first = await goldenShot(page, shot);
        expect(first).toMatchObject({ width: GOLDEN_VIEWPORT.width, height: GOLDEN_VIEWPORT.height });
        // the camera moved up to 90 m from the previous shot: a chunk the profile's skip rule meshed from afar is meshed again with its small
        // buildings once it lies within reach (`remeshFiltered`, `mobile`), and lands a few frames after the shot settled. The golden is the
        // first picture that two presented frames later is the same, and that repeat is the byte-identical check
        await frames(page, 2);
        let second = await canvasRgba(page);
        for (let i = 0; i < 8 && !identical(first, second); i++) {
          first = second;
          await frames(page, 4);
          second = await canvasRgba(page);
        }
        expect(identical(first, second), `${tier} ${shot}: two consecutive captures differ`).toBe(true);
        if (update) {
          mkdirSync(GOLDEN_DIR, { recursive: true });
          writeFileSync(file, encodePng(first));
          continue;
        }
        expect(existsSync(file), `${file} is missing; DV_UPDATE_GOLDEN=1 writes it (outside CI, under the golden-update label)`).toBe(true);
        const diff = diffImages(first, decodePng(readFileSync(file)));
        expect(goldenFailures(diff), `${tier} ${shot}: ${JSON.stringify(diff)}`).toEqual([]);
        await world(page, (w) => w.clearShot());
      }
    });
  }

  test('regenerating writes the manifest @facade-golden', () => {
    test.skip(!update, 'DV_UPDATE_GOLDEN=1 only');
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(
      `${GOLDEN_DIR}/manifest.json`,
      `${JSON.stringify(
        {
          $comment: 'M02h7 facade goldens: written by DV_UPDATE_GOLDEN=1 pnpm check:e2e -- --project=chromium-webgl2 --grep @facade-golden (outside CI, under the golden-update label). 256 x 144 captures of the canvas on chromium-webgl2 at the facade shots of config/world/look-shots.json, held, without the actors.',
          schema: 'look-golden/1',
          bakeId: bakeIdOf(),
          source: 'synth',
          viewport: GOLDEN_VIEWPORT,
          tolerance: { channel: 6, minFraction: 0.99, meanAbs: 2 },
          shots: FLAT_TIERS.flatMap((t) => GOLDEN_SHOTS.map((s) => `${t}.${s}.png`)),
        },
        null,
        2,
      )}\n`,
    );
  });
});
