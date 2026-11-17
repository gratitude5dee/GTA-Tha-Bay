import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { decodePng, diffImages, encodePng, goldenFailures, identical, type Rgba } from '../support/image-diff.ts';
import { canvasRgba } from './canvas-capture.ts';
import { SMALL_VIEWPORT } from './engine-helpers.ts';
import { settleText, timed } from './lap.ts';
import { veg } from './trees-helpers.ts';
import { FLAT_TIERS, GOLDEN_VIEWPORT, HIDE, bootWorld, clearActors, frames, world, type W } from './markings-helpers.ts';

/**
 * M02h4 street-tree forms in a real browser, on a `DV_WORLD=synth` QA build.
 *
 *  - @world-trees (AC-5) per flat tier on `chromium-webgl2` and `webkit-webgl2`: `look().vegetation` reports the `full` / `lite` / `low`
 *    set with 10 / 5 / 2 pools (M02h5: 14 / 8 / 3 with the scatter's) and all five forms resident, the wind above 0 at `desktop` only, and after a 2 km teleport and back the
 *    drawn instances are the resident units' within `tree.drawM` (each unit shown within `drawM`, hidden beyond `drawM` x 1.1, nothing
 *    pending); `?treeForms=0` (the QA twin of `world.treeForms: false`) reports one cone pool.
 *  - @look-golden (AC-6, `chromium-webgl2`): `trees-street` at `desktop` and `mobile-low` against `tests/e2e/golden/look/<tier>.trees-street.png`,
 *    two captures byte-identical (the wind clock is the look clock, which `shot()` freezes). `DV_UPDATE_GOLDEN=1` writes them.
 *  - @trees-ledger (AC-8) is `trees-ledger.spec.ts`: a serial group makes its whole file one scheduling unit of the duration-packed
 *    shards (`tools/ci/e2e-plan.ts`), so the ledger lives in a file of its own (BD-M02h4-08).
 */

// M02h5: the scatter adds 4 / 3 / 1 pools (understory and impostors) to M02h4's 10 / 5 / 2 (BD-M02h5-08)
const SET: Record<string, { set: string; pools: number }> = { desktop: { set: 'full', pools: 14 }, mobile: { set: 'lite', pools: 8 }, 'mobile-low': { set: 'low', pools: 3 } };

/**
 * The trees of the resident L0 units as the renderer holds them: per unit its instances, whether they are drawn and its distance (the
 * nearest edge of its square, in plan) from the camera of the last visibility pass.
 */
async function residentTrees(page: Page): Promise<{ id: string; n: number; shown: boolean; distM: number }[]> {
  return page.evaluate(() => {
    type U = { level: string; hasTrees: boolean; vegShown: boolean; mesh: { trees: Float32Array; originX: number; originZ: number } };
    const r = (window as unknown as W).__dvBridge.world.internals().view as unknown as {
      renderer: { units: Map<string, U>; camPos: [number, number, number] | null; vegetation: { bandsOf(id: string): { band: number }[] } };
    };
    const cam = r.renderer.camPos ?? [0, 0, 0];
    const out: { id: string; n: number; shown: boolean; distM: number }[] = [];
    for (const [id, u] of r.renderer.units) {
      if (u.level !== 'l0' || !u.hasTrees) continue;
      const dx = Math.max(0, Math.abs(u.mesh.originX + 128 - cam[0]) - 128);
      const dz = Math.max(0, Math.abs(u.mesh.originZ + 128 - cam[2]) - 128);
      // M02h5: the unit's kept instances that draw in some band (thinning and the understory's shrubDrawM leave the rest out)
      out.push({ id, n: r.renderer.vegetation.bandsOf(id).filter((b) => b.band !== 2).length, shown: u.vegShown, distM: Math.hypot(dx, dz) });
    }
    return out;
  });
}

const cameraXZ = (page: Page): Promise<{ x: number; z: number }> =>
  page.evaluate(() => {
    const v = (window as unknown as W).__dvBridge.world.internals().view as unknown as { host: { camera: { position: { x: number; z: number } } } };
    return { x: v.host.camera.position.x, z: v.host.camera.position.z };
  });

/** The stream quiet and the pools' crossing queue empty: the drawn prefix follows the units. */
async function treesSettled(page: Page, where: string): Promise<void> {
  // BD-FIX-CI-PLAN-01: `timed` runs each wait as it is and prints its seconds (a lap line); nothing else changes
  await timed(`world-trees ${where}: settle(240 s)`, () => page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(240_000)), settleText);
  await timed(`world-trees ${where}: crossings poll`, () => expect.poll(async () => (await veg(page)).pendingCrossings, { timeout: 180_000, intervals: [500] }).toBe(0));
  // one visibility pass after the settle (every 8 frames), so every unit has its drawM state for this camera
  await timed(`world-trees ${where}: frames(10)`, () => frames(page, 10));
  await timed(`world-trees ${where}: crossings poll after the frames`, () => expect.poll(async () => (await veg(page)).pendingCrossings, { timeout: 180_000, intervals: [500] }).toBe(0));
  // M02h5: and the scatter's band writes (capped per frame) have all landed, so the pools draw the bands the units hold
  await timed(`world-trees ${where}: band-writes poll`, () =>
    expect.poll(async () => ((await veg(page)).scatter as { bandWrites?: { pending: number } } | undefined)?.bandWrites?.pending ?? 0, { timeout: 180_000, intervals: [500] }).toBe(0),
  );
}

test.describe('world trees @world-trees', () => {
  test.describe.configure({ timeout: 1_800_000 });

  for (const tier of FLAT_TIERS) {
    test(`${tier}: the set, its pools and all five forms; wind on desktop only; drawn trees follow a 2 km teleport and back @world-trees`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text());
      });
      await bootWorld(page, tier, '', SMALL_VIEWPORT);
      const want = SET[tier] as { set: string; pools: number };
      const v0 = await veg(page);
      expect(v0.set).toBe(want.set);
      expect(v0.pools).toBe(want.pools);
      expect(v0.drawnPools).toBeLessThanOrEqual(want.pools);
      // all five tree forms among the resident trees (M02h5: the shrub and the hedge may be resident too)
      await expect.poll(async () => (await veg(page)).forms.slice(0, 5).filter((f) => f.instances > 0).length, { timeout: 180_000, intervals: [500] }).toBe(5);
      // the wind: above 0 at desktop (the sky's frame sets it), 0 elsewhere, and the layer only on desktop
      if (tier === 'desktop') {
        await expect.poll(async () => (await veg(page)).wind, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
        expect(await world(page, (w) => w.setLookLayer('wind', false))).toBe(true);
        expect((await veg(page)).wind).toBe(0);
        expect(await world(page, (w) => w.setLookLayer('wind', true))).toBe(true);
      } else {
        await frames(page, 4);
        expect((await veg(page)).wind).toBe(0);
        expect(await world(page, (w) => w.setLookLayer('wind', true))).toBe(false);
      }

      // a 2 km teleport and back
      const home = await cameraXZ(page);
      let away = false;
      for (const [dx, dz] of [[2000, 0], [-2000, 0], [0, 2000], [0, -2000]] as const) {
        await timed(`world-trees ${tier} away: teleport (${dx}, ${dz})`, () =>
          page.evaluate((p) => (window as unknown as W).__dvBridge.world.teleport({ x: p.x, z: p.z }), { x: home.x + dx, z: home.z + dz }),
        );
        await timed(`world-trees ${tier} away: settle(240 s) after the teleport`, () => page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(240_000)), settleText);
        const at = await cameraXZ(page);
        if (Math.hypot(at.x - home.x, at.z - home.z) > 1500) {
          away = true;
          break;
        }
      }
      expect(away, 'the player teleported 2 km away').toBe(true);
      await treesSettled(page, `${tier} away`);
      await timed(`world-trees ${tier} home: teleport`, () => page.evaluate((p) => (window as unknown as W).__dvBridge.world.teleport({ x: p.x, z: p.z }), home));
      await treesSettled(page, `${tier} home`);
      const back = await cameraXZ(page);
      expect(Math.hypot(back.x - home.x, back.z - home.z), 'back home').toBeLessThan(50);

      // M02h5: both reads of one held frame (a unit that lands between them would add its hundreds of scatter instances to one side)
      await world(page, (w) => w.hold(true));
      const units = await residentTrees(page);
      const v = await veg(page);
      await world(page, (w) => w.hold(false));
      const drawnByUnits = units.filter((u) => u.shown).reduce((n, u) => n + u.n, 0);
      console.log(`world-trees ${tier}: set ${v.set}, pools ${v.pools} (${v.drawnPools} drawing), forms ${JSON.stringify(v.forms)}, wind ${v.wind}, drawn ${v.drawnInstances} of ${units.reduce((n, u) => n + u.n, 0)} resident in ${units.length} units, crossings ${v.crossings}`);
      expect(units.length).toBeGreaterThan(0);
      expect(v.drawnInstances, 'the pools draw the instances of the units within drawM').toBe(drawnByUnits);
      expect(v.forms.reduce((n, f) => n + f.drawn, 0)).toBe(drawnByUnits);
      for (const u of units) {
        if (u.distM <= v.drawM) expect(u.shown, `${u.id} at ${u.distM.toFixed(0)} m is within drawM ${v.drawM}`).toBe(true);
        if (u.distM > v.drawM * 1.1) expect(u.shown, `${u.id} at ${u.distM.toFixed(0)} m is beyond drawM x 1.1`).toBe(false);
      }
      expect(errors).toEqual([]);
    });
  }

  test('mobile-low: world.treeForms off (?treeForms=0) draws one cone pool @world-trees', async ({ page }) => {
    await bootWorld(page, 'mobile-low', '&treeForms=0', SMALL_VIEWPORT);
    const v = await veg(page);
    expect(v.set).toBe('cone');
    expect(v.pools).toBe(1);
    expect(v.drawnPools).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await veg(page)).drawnInstances, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
  });
});

// ---- the goldens (AC-6) --------------------------------------------------------------------------------------------------------

const GOLDEN_DIR = 'tests/e2e/golden/look';
const TREE_GOLDEN_TIERS = ['desktop', 'mobile-low'] as const;

test.describe('tree goldens @look-golden', () => {
  test.describe.configure({ timeout: 1_800_000 });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'goldens are chromium-webgl2 only');
  });
  const update = process.env['DV_UPDATE_GOLDEN'] === '1' && !process.env['CI'];

  for (const tier of TREE_GOLDEN_TIERS) {
    test(`${tier} trees-street is within the tolerance of its golden and a second capture is byte-identical @look-golden`, async ({ page }) => {
      const file = `${GOLDEN_DIR}/${tier}.trees-street.png`;
      await bootWorld(page, tier, '', GOLDEN_VIEWPORT);
      await page.addStyleTag({ content: HIDE });
      await clearActors(page);
      await page.evaluate(() => (window as unknown as W).__dvBridge.world.shot('trees-street', { held: true }));
      await frames(page, 2);
      const first: Rgba = await canvasRgba(page);
      await frames(page, 2);
      const second = await canvasRgba(page);
      expect(identical(first, second), 'two consecutive captures differ').toBe(true);
      if (update) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(file, encodePng(first));
        return;
      }
      expect(existsSync(file), `${file} is missing; DV_UPDATE_GOLDEN=1 writes it (outside CI, under the golden-update label)`).toBe(true);
      const diff = diffImages(first, decodePng(readFileSync(file)));
      if (goldenFailures(diff).length > 0) {
        mkdirSync('test-results/trees-golden', { recursive: true });
        writeFileSync(`test-results/trees-golden/${tier}.trees-street.actual.png`, encodePng(first));
      }
      expect(goldenFailures(diff), `${tier} trees-street: ${JSON.stringify(diff)}`).toEqual([]);
    });
  }
});
