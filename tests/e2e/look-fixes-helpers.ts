import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { PlatformBridge } from '../../packages/engine/src/platform/probe.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { decodePng, encodePng, identical, type Rgba } from '../support/image-diff.ts';
import { FLICKER_BASELINE_FILE, FLICKER_FLOOR, FLICKER_PAIRS, FLICKER_THRESHOLD, FLICKER_VIEWPORT, flickerLimit, flickerShare, flickerShareRaw, type FlickerBaseline, type FlickerPairId } from '../support/flicker.ts';
import { SMALL_VIEWPORT } from './engine-helpers.ts';

/**
 * What the M02g2 look-fix specs share (BD-REPAIR-M02g2-03): `world-sky-look-fixes.spec.ts` (the `mobile-low` pair, the environment-map case, the
 * render-object ledger), `street-look-fixes-junction.spec.ts` and `look-fixes-civic.spec.ts` (one `desktop` pair each). The pairs are separate
 * files because Playwright cuts a shard out of the sorted list of tests by their count, and a `desktop` pair is the longest single case of
 * the suite (about 20 minutes on software GL); their file names place them in different, light shards.
 *
 * `DV_FIXES_BASELINE=1` runs the pair and the ledger cases as measurements and writes `tests/e2e/golden/look/flicker-baseline.json`
 * (flicker shares, per project, plus the object and triangle counts of the tiers): it is how the baselines of the code before this
 * milestone were taken. Run it on the parent commit with these specs and the support files copied in; nothing is asserted in that mode.
 */
export type W = { __dvBridge: { world: WorldBridge; platform: PlatformBridge; engine: { setPaused(p: boolean): void } } };
export const read = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
export const BASELINE_MODE = process.env['DV_FIXES_BASELINE'] === '1';
export const WRITE = process.env['DV_LOOK_WRITE'] === '1';

export const MESHER = read<{ tierProfile: Record<string, string>; tree: { drawM: Record<string, number> } }>('config/world/mesher.json');
export const HIDE_ALL = '* { visibility: hidden !important } #dv-engine-canvas { visibility: visible !important }';

export async function bootWorld(page: Page, tier: string, size: { width: number; height: number } = SMALL_VIEWPORT, query = ''): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/?tier=${tier}&debug=1${query}`);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 180_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 240_000 });
  await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(90_000));
}

export const world = <T>(page: Page, fn: (w: WorldBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.world)`) as Promise<T>;

/** Frames the page presents after now. */
export const frames = async (page: Page, n: number): Promise<void> => {
  const f0 = await world(page, (w) => w.chunks().frame);
  await page.waitForFunction((t) => (window as unknown as W).__dvBridge.world.chunks().frame >= t, f0 + n, { timeout: 180_000, polling: 250 });
};

export async function setSky(page: Page, hour: number, weather: string): Promise<void> {
  await page.evaluate(
    ([h, w]) => {
      const bridge = (window as unknown as W).__dvBridge.world;
      bridge.setHour(h as number, true);
      bridge.setWeather(w as never, 0);
    },
    [hour, weather] as const,
  );
  await page.waitForFunction(
    ([h, w]) => {
      const s = (window as unknown as W).__dvBridge.world.sky();
      return !!s && Math.abs(s.hour - (h as number)) < 0.05 && s.weather === w && s.next === w;
    },
    [hour, weather] as const,
    { timeout: 120_000 },
  );
}

/**
 * The canvas after the shot has presented its frame, with the crowds and the animated characters out of the picture. `how` is `shot`
 * for the first picture of a pair (the full QA shot: the sky, the streamer's settle, the fade, one environment bake) and `move` for the
 * second (`shotMove`: the same sky and the same environment map, the camera 0.05 m along).
 */
export async function captureShot(page: Page, shot: string, how: 'shot' | 'move' = 'shot'): Promise<Rgba> {
  await page.evaluate(([id, h]) => (window as unknown as W).__dvBridge.world[h === 'move' ? 'shotMove' : 'shot'](id as string), [shot, how] as const);
  await page.evaluate(() => {
    const b = (window as unknown as { __dvBridge: { engine: { setPaused(p: boolean): void }; world: WorldBridge } }).__dvBridge;
    b.engine.setPaused(true);
    type G = { group: { visible: boolean } } | null;
    const view = b.world.internals().view as unknown as { traffic: G; peds: G; transit: G; host: { scene: { children: { userData: Record<string, unknown>; traverse(f: (o: { layers: { set(n: number): void } }) => void): void }[] } } };
    for (const r of [view.traffic, view.peds, view.transit]) if (r) r.group.visible = false;
    for (const c of view.host.scene.children) if (c.userData['dvActor'] === 'avatar') c.traverse((o) => o.layers.set(31));
  });
  await frames(page, 3);
  // the sky's blend and the exposure settle over a few presented frames: the picture counts once two consecutive frames agree
  let img = decodePng(await page.locator('#dv-engine-canvas').screenshot());
  for (let i = 0; i < 5; i++) {
    await frames(page, 2);
    const next = decodePng(await page.locator('#dv-engine-canvas').screenshot());
    const same = identical(img, next);
    img = next;
    if (same) break;
  }
  await page.evaluate(() => {
    const b = (window as unknown as { __dvBridge: { engine: { setPaused(p: boolean): void }; world: WorldBridge } }).__dvBridge;
    const view = b.world.internals().view as unknown as { host: { scene: { children: { userData: Record<string, unknown>; traverse(f: (o: { layers: { set(n: number): void } }) => void): void }[] } } };
    for (const c of view.host.scene.children) if (c.userData['dvActor'] === 'avatar') c.traverse((o) => o.layers.set(0));
    b.engine.setPaused(false);
  });
  return img;
}

// ---- the committed baselines (the parent commit) and the file the baseline mode writes ----------------------------------------

const BASELINE_COMMENT =
  'M02g2 flicker baselines: written by DV_FIXES_BASELINE=1 on the parent commit of M02g2 (the code before the look fixes) with the same shot pairs: ' +
  'per project, the share of pixels at 640 x 360 whose largest colour-channel difference between the two shots of a pair is above 32/255; ' +
  '`ledger` holds the render objects and triangles the @fixes-ledger protocol reads at that commit, per tier (chromium-webgl2).';
export interface BaselineFile extends FlickerBaseline { ledger?: Record<string, { objects: number; triangles: number }> }
export const readBaseline = (): BaselineFile | null => (existsSync(FLICKER_BASELINE_FILE) ? read<BaselineFile>(FLICKER_BASELINE_FILE) : null);
export function writeBaseline(patch: (b: BaselineFile) => void): void {
  const b: BaselineFile = readBaseline() ?? {
    $comment: BASELINE_COMMENT, schema: 'look-flicker-baseline/1', viewport: { ...FLICKER_VIEWPORT }, threshold: FLICKER_THRESHOLD, baselines: {},
  };
  b.$comment = BASELINE_COMMENT;
  patch(b);
  mkdirSync(dirname(FLICKER_BASELINE_FILE), { recursive: true });
  writeFileSync(FLICKER_BASELINE_FILE, `${JSON.stringify(b, null, 2)}\n`);
}

// ---- @look-fixes: one flicker pair per test -------------------------------------------------------------------------------------

/**
 * Registers the case of one shot pair (`config/world/look-shots.json`, `tests/support/flicker.ts`): one boot, the first shot, the second
 * shot, the measure. Call it from a spec file at module level.
 *
 * The first shot is the full QA `shot()`, which waits twice for the streamer to settle (10 minutes each at most). At `desktop` the
 * streamer releases one chunk per presented frame (C08 rule 13) and a frame takes 5 to 10 s on software GL, so the wait always runs out its
 * ten minutes, and the second shot used to pay another 20 minutes for the same chunks: a `desktop` pair took 41 and 46 minutes in CI
 * (run 40903387571). The second shot is `shotMove`, the camera 0.05 m along under the sky and the environment map of the first.
 */
export function registerFlickerPair(pairId: FlickerPairId): void {
  const pair = FLICKER_PAIRS.find((p) => p.id === pairId);
  if (!pair) throw new Error(`no flicker pair ${pairId}`);
  const tier = pair.tier;
  test.describe('look fixes @look-fixes', () => {
    // software GL draws a desktop frame in seconds (the GPU process takes every core) and a pair stands where the sky, the streaming and
    // the shadows all have to settle first: one boot per pair keeps each test well under its timeout, and a shard from running an hour
    test.describe.configure({ timeout: 3_600_000 });

    test(`${tier}: the shot pair ${pair.id} flickers at most half as much as the baseline (or the floor), and no tree is drawn beyond tree.drawM @look-fixes`, async ({ page }, testInfo: TestInfo) => {
      test.skip(testInfo.project.name === 'chromium-webgpu', 'the pair baselines are WebGL2 baselines');
      // textures off: the baselines were measured before the surface textures (M10d0); this case counts depth flicker, and an albedo's own
      // detail under the 0.05 m parallax is not that (webkit-webgl2 mobile-low asphalt-low read 0.50 % with them on, DL-757)
      const t0 = Date.now();
      await bootWorld(page, tier, FLICKER_VIEWPORT, '&textures=0');
      await page.addStyleTag({ content: HIDE_ALL });
      await setSky(page, 13, 'clear');
      const t1 = Date.now();
      const a = await captureShot(page, pair.id, 'shot');
      const t2 = Date.now();
      const b = await captureShot(page, `${pair.id}-b`, 'move');
      console.log(`flicker timing ${testInfo.project.name} ${pair.id}: boot and sky ${Math.round((t1 - t0) / 1000)} s, first shot ${Math.round((t2 - t1) / 1000)} s, second shot ${Math.round((Date.now() - t2) / 1000)} s`);
      expect(a.width).toBe(FLICKER_VIEWPORT.width);
      expect(a.height).toBe(FLICKER_VIEWPORT.height);
      const share = flickerShare(a, b);
      console.log(`flicker ${testInfo.project.name} ${pair.id}: ${(share * 100).toFixed(3)} % of pixels with no look-alike within one pixel over ${FLICKER_THRESHOLD}/255 (${(flickerShareRaw(a, b) * 100).toFixed(3)} % without the window)`);
      // DV_FLICKER_DIR=<dir> keeps the pictures of both shots (to look at them, or to put the before/after in docs/look)
      const keep = process.env['DV_FLICKER_DIR'];
      if (keep) {
        mkdirSync(keep, { recursive: true });
        writeFileSync(`${keep}/${testInfo.project.name}.${pair.id}.png`, encodePng(a));
        writeFileSync(`${keep}/${testInfo.project.name}.${pair.id}-b.png`, encodePng(b));
      }
      // the trees beyond tree.drawM x 1.1 are not drawn
      const veg = (await world(page, (w) => w.look()))?.vegetation;
      if (!BASELINE_MODE) {
        expect(veg, 'look().vegetation').toBeDefined();
        if (veg) {
          expect(veg.drawM).toBe(MESHER.tree.drawM[MESHER.tierProfile[tier] as string]);
          expect(veg.farthestM, `${pair.id}: farthest shown tree unit`).toBeLessThanOrEqual(veg.drawM * 1.1);
        }
      }

      if (BASELINE_MODE) {
        writeBaseline((f) => {
          f.baselines[testInfo.project.name] = { ...(f.baselines[testInfo.project.name] ?? {}), [pair.id]: Number(share.toFixed(6)) };
        });
        return;
      }
      const base = readBaseline()?.baselines[testInfo.project.name]?.[pair.id];
      expect(base, `${FLICKER_BASELINE_FILE} holds ${testInfo.project.name} / ${pair.id}`).toBeDefined();
      expect(share, `flicker of ${pair.id} against half of the baseline ${base} (never under FLICKER_FLOOR ${FLICKER_FLOOR})`).toBeLessThanOrEqual(flickerLimit(base ?? 0));
    });
  });
}
