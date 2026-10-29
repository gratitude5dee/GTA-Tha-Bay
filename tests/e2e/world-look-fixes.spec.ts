import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { PlatformBridge } from '../../packages/engine/src/platform/probe.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { decodePng, encodePng, identical, type Rgba } from '../support/image-diff.ts';
import { FLICKER_BASELINE_FILE, FLICKER_FLOOR, FLICKER_PAIRS, FLICKER_THRESHOLD, FLICKER_VIEWPORT, flickerLimit, flickerShare, flickerShareRaw, type FlickerBaseline } from '../support/flicker.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M02g2 look fixes in a real browser, on a `DV_WORLD=synth` QA build (the world half of the e2e legs).
 *
 *  - @look-fixes    AC-6  the three shot pairs (`junction-graze` and `civic-hall-graze` at `desktop`, `asphalt-low` at `mobile-low`) flicker at
 *                   most half as much as the committed baselines of the parent commit; the trees beyond `tree.drawM` are hidden
 *                   (`look().vegetation.farthestM`); `look().envMap` is on at `desktop` on Chromium and off on WebKit
 *  - @fixes-ledger  AC-9  the render-object ledger of `docs/look/M02g2-render-ledger.json` per tier, the `mobile-low` triangle delta, and
 *                   (`@xr`, `xr-quest3`) the Quest tier's count
 *
 * `DV_LOOK_WRITE=1` writes the ledger. `DV_FIXES_BASELINE=1` runs the pair and the ledger cases as measurements and writes
 * `tests/e2e/golden/look/flicker-baseline.json` (flicker shares, per project, plus the object and triangle counts of the tiers): it is
 * how the baselines of the code before this milestone were taken. Run it on the parent commit with this spec and the support files
 * copied in; nothing is asserted in that mode.
 */
type W = { __dvBridge: { world: WorldBridge; platform: PlatformBridge; engine: { setPaused(p: boolean): void } } };
const read = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const BASELINE_MODE = process.env['DV_FIXES_BASELINE'] === '1';
const WRITE = process.env['DV_LOOK_WRITE'] === '1';

const MESHER = read<{ tierProfile: Record<string, string>; tree: { drawM: Record<string, number> } }>('config/world/mesher.json');
const HIDE_ALL = '* { visibility: hidden !important } #dv-engine-canvas { visibility: visible !important }';

async function bootWorld(page: Page, tier: string, size: { width: number; height: number } = SMALL_VIEWPORT, query = ''): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/?tier=${tier}&debug=1${query}`);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 180_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 240_000 });
  await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(90_000));
}

const world = <T>(page: Page, fn: (w: WorldBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.world)`) as Promise<T>;

/** Frames the page presents after now. */
const frames = async (page: Page, n: number): Promise<void> => {
  const f0 = await world(page, (w) => w.chunks().frame);
  await page.waitForFunction((t) => (window as unknown as W).__dvBridge.world.chunks().frame >= t, f0 + n, { timeout: 180_000, polling: 250 });
};

async function setSky(page: Page, hour: number, weather: string): Promise<void> {
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

/** The canvas after `shot(id)` has presented its frame, with the crowds and the animated characters out of the picture. */
async function captureShot(page: Page, shot: string): Promise<Rgba> {
  await page.evaluate((id) => (window as unknown as W).__dvBridge.world.shot(id), shot);
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
interface BaselineFile extends FlickerBaseline { ledger?: Record<string, { objects: number; triangles: number }> }
const readBaseline = (): BaselineFile | null => (existsSync(FLICKER_BASELINE_FILE) ? read<BaselineFile>(FLICKER_BASELINE_FILE) : null);
function writeBaseline(patch: (b: BaselineFile) => void): void {
  const b: BaselineFile = readBaseline() ?? {
    $comment: BASELINE_COMMENT, schema: 'look-flicker-baseline/1', viewport: { ...FLICKER_VIEWPORT }, threshold: FLICKER_THRESHOLD, baselines: {},
  };
  b.$comment = BASELINE_COMMENT;
  patch(b);
  mkdirSync(dirname(FLICKER_BASELINE_FILE), { recursive: true });
  writeFileSync(FLICKER_BASELINE_FILE, `${JSON.stringify(b, null, 2)}\n`);
}

// ---- @look-fixes --------------------------------------------------------------------------------------------------------

test.describe('look fixes @look-fixes', () => {
  // software GL draws a desktop frame in seconds (the GPU process takes every core) and a pair stands where the sky, the streaming and
  // the shadows all have to settle first: one boot per pair keeps each test well under its timeout, and a shard from running an hour
  test.describe.configure({ timeout: 3_600_000 });

  for (const pair of FLICKER_PAIRS) {
    const tier = pair.tier;
    test(`${tier}: the shot pair ${pair.id} flickers at most half as much as the baseline (or the floor), and no tree is drawn beyond tree.drawM @look-fixes`, async ({ page }, testInfo: TestInfo) => {
      test.skip(testInfo.project.name === 'chromium-webgpu', 'the pair baselines are WebGL2 baselines');
      // textures off: the baselines were measured before the surface textures (M10d0); this case counts depth flicker, and an albedo's own
      // detail under the 0.05 m parallax is not that (webkit-webgl2 mobile-low asphalt-low read 0.50 % with them on, DL-757)
      await bootWorld(page, tier, FLICKER_VIEWPORT, '&textures=0');
      await page.addStyleTag({ content: HIDE_ALL });
      await setSky(page, 13, 'clear');

      const a = await captureShot(page, pair.id);
      const b = await captureShot(page, `${pair.id}-b`);
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
  }

  test('desktop: look().envMap is on on Chromium and off on WebKit; the trees stay inside tree.drawM @look-fixes', async ({ page }, testInfo: TestInfo) => {
    test.skip(BASELINE_MODE, 'baseline mode measures only');
    await bootWorld(page, 'desktop');
    await setSky(page, 13, 'clear');
    await frames(page, 6);
    const look = await world(page, (w) => w.look());
    expect(look?.envMap, `environment map on ${testInfo.project.name}`).toBe(testInfo.project.name.startsWith('chromium'));
    expect(look?.profile).toBe('full');
    const veg = look?.vegetation;
    expect(veg?.drawM).toBe(MESHER.tree.drawM['desktop']);
    expect(veg?.farthestM ?? 0).toBeLessThanOrEqual((veg?.drawM ?? 0) * 1.1);
    // a re-record per crossing, counted: at rest nothing crosses
    const c0 = veg?.crossings ?? 0;
    await frames(page, 6);
    expect((await world(page, (w) => w.look()))?.vegetation.crossings).toBe(c0);
  });
});

// ---- @fixes-ledger ------------------------------------------------------------------------------------------------------

const LEDGER = 'docs/look/M02g2-render-ledger.json';
const PRIOR = 'docs/look/M10d0-render-ledger.json';
interface TierLedger { baseline: number; after: number; triangles?: { baseline: number; after: number } }
interface Ledger { commit: string; bakeId: string; tiers: Record<string, TierLedger>; xr?: { baseline: number; after: number } }
const bakeIdOf = (): string => read<{ bakeId: string }>('dist/world/latest-synth.json').bakeId;
const commitOf = (): string => process.env['GITHUB_SHA'] ?? process.env['DV_COMMIT'] ?? 'local';
const TRIANGLE_BUDGET_LOW = 16_000;
const LEDGER_TIERS = ['desktop', 'mobile', 'mobile-low'] as const;
const live = (page: Page): Promise<{ renderObjects: number; triangles: number }> =>
  page.evaluate(() => (window as unknown as W).__dvBridge.platform.perf.live());

test.describe('fixes ledger @fixes-ledger', () => {
  test.describe.configure({ timeout: 1_800_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the ledger is chromium-webgl2 only (the XR case runs on xr-quest3)');
  });

  const measured: Record<string, { objects: number; triangles: number }> = {};

  for (const tier of LEDGER_TIERS) {
    test(`${tier}: render objects and triangles on a held frame, against M10d0's ledger @fixes-ledger`, async ({ page }) => {
      // the protocol of M02g1's ledger: no `perf=1` (a held frame must not change), traffic resident, `mobile-low` at the `fog-west` shot
      await bootWorld(page, tier);
      await setSky(page, 13, 'clear');
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
      if (tier === 'mobile-low') await world(page, (w) => w.shot('fog-west'));
      await frames(page, 6);
      await world(page, (w) => w.hold(true));
      const m = await live(page);
      await world(page, (w) => w.hold(false));
      measured[tier] = { objects: m.renderObjects, triangles: m.triangles };
      console.log(`fixes ledger ${tier}: ${m.renderObjects} render objects, ${m.triangles} triangles`);
      if (BASELINE_MODE) return;
      const prior = read<Ledger>(PRIOR).tiers[tier];
      expect(prior, `${PRIOR} holds ${tier}`).toBeDefined();
      expect(m.renderObjects, `${tier}: objects against M10d0's after (${prior?.after})`).toBeLessThanOrEqual(prior?.after ?? 0);
      if (tier === 'mobile-low') expect(m.renderObjects, 'mobile-low render objects').toBeLessThanOrEqual(100);
    });
  }

  test('writes (DV_LOOK_WRITE=1, DV_FIXES_BASELINE=1) or checks the committed ledger @fixes-ledger', () => {
    if (BASELINE_MODE) {
      writeBaseline((f) => {
        f.ledger = { ...(f.ledger ?? {}), ...measured };
      });
      return;
    }
    const prior = read<Ledger>(PRIOR);
    const base = readBaseline()?.ledger;
    if (WRITE) {
      const prev = existsSync(LEDGER) ? read<Ledger>(LEDGER) : null;
      const tiers: Record<string, TierLedger> = { ...(prev?.tiers ?? {}) };
      for (const tier of LEDGER_TIERS) {
        const m = measured[tier];
        if (!m) continue;
        tiers[tier] = {
          baseline: prior.tiers[tier]?.after ?? 0,
          after: m.objects,
          ...(tier === 'mobile-low' && base?.[tier] ? { triangles: { baseline: base[tier].triangles, after: m.triangles } } : {}),
        };
      }
      const out: Ledger = { commit: commitOf(), bakeId: bakeIdOf(), tiers, ...(prev?.xr ? { xr: prev.xr } : {}) };
      mkdirSync(dirname(LEDGER), { recursive: true });
      writeFileSync(LEDGER, `${JSON.stringify(out, null, 2)}\n`);
    }
    expect(existsSync(LEDGER), `${LEDGER} is committed`).toBe(true);
    const ledger = read<Ledger>(LEDGER);
    expect(ledger.bakeId).toMatch(/^[0-9a-f]{64}$/);
    for (const tier of LEDGER_TIERS) {
      const t = ledger.tiers[tier];
      expect(t, `${tier} is in the ledger`).toBeDefined();
      if (!t) continue;
      expect(t.baseline, `${tier} baseline is M10d0's after`).toBe(prior.tiers[tier]?.after);
      expect(t.after - t.baseline, `${tier} object delta`).toBeLessThanOrEqual(0);
    }
    const low = ledger.tiers['mobile-low'];
    expect(low?.after ?? 0).toBeLessThanOrEqual(100);
    expect(low?.triangles, 'mobile-low triangles are in the ledger').toBeDefined();
    if (low?.triangles) expect(low.triangles.after - low.triangles.baseline, 'mobile-low triangle delta').toBeLessThanOrEqual(TRIANGLE_BUDGET_LOW);
    expect(Object.keys(ledger.tiers).sort()).toEqual([...LEDGER_TIERS].sort());
    if (ledger.xr) expect(ledger.xr.after - ledger.xr.baseline, 'xr object delta').toBeLessThanOrEqual(0);
  });
});

test.describe('xr fixes ledger @fixes-ledger', () => {
  test('the Quest tier holds its render objects on a held frame, against M10d0 @xr @fixes-ledger', async ({ page }, testInfo: TestInfo) => {
    test.setTimeout(240_000);
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
    await world(page, (w) => w.hold(true));
    const m = await live(page);
    await world(page, (w) => w.hold(false));
    console.log(`fixes ledger ${testInfo.project.name} xr: ${m.renderObjects} render objects`);
    const prior = read<Ledger>(PRIOR).xr;
    expect(prior, `${PRIOR} holds xr`).toBeDefined();
    if (BASELINE_MODE) return;
    expect(m.renderObjects, `xr objects against M10d0's after (${prior?.after})`).toBeLessThanOrEqual(prior?.after ?? 0);
    if (WRITE) {
      const prev = existsSync(LEDGER) ? read<Ledger>(LEDGER) : { commit: commitOf(), bakeId: bakeIdOf(), tiers: {} };
      mkdirSync(dirname(LEDGER), { recursive: true });
      writeFileSync(LEDGER, `${JSON.stringify({ ...prev, xr: { baseline: prior?.after ?? 0, after: m.renderObjects } }, null, 2)}\n`);
    }
  });
});
