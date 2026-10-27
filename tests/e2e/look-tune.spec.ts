import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { MissionBridge } from '../../packages/modes/story/src/debug/bridge.ts';
import type { PlatformBridge } from '../../packages/engine/src/platform/probe.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { composeGrid, decodePng, diffImages, encodePng, goldenFailures, identical, meanAbsDifference, type Rgba } from '../support/image-diff.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M02g1 look-tune in a real browser, on a `DV_WORLD=synth` QA build (the world half of the e2e legs).
 *
 *  - @look-tune    AC-3  per tier (desktop, mobile, mobile-low; both browsers): `look()` lists the layers of the tier's profile; blob shadows
 *                  are drawn; the dynamic casters are the player, the traffic and the trees on desktop and nothing on mobile; the analytic
 *                  sky reflection is in force wherever there is no environment map; `setLook(false)` has no layers
 *  - @look-ledger  AC-4  (`chromium-webgl2`) the render-object ledger of `docs/look/M02g1-render-ledger.json`: each layer toggled on a held frame
 *  - @look-owner   AC-6  (`webkit-webgl2`) the owner's two frames, `a1-truck` and `a1-burnoff`, at the owner tier and `mobile-low`: golden,
 *                  byte-identical twice, the before/after difference, and the committed before/after sheet
 *
 * `DV_LOOK_WRITE=1` writes the ledger and the before/after sheet, `DV_UPDATE_GOLDEN=1` (outside CI, under the golden-update label) the
 * webkit goldens. `DV_OWNER_BEFORE_DIR=<dir>` runs the @look-owner capture only and writes the "before" frames there: it is how the
 * frames of the code before this milestone were taken (Step 0).
 */
type W = { __dvBridge: { world: WorldBridge; mission: MissionBridge; platform: PlatformBridge } };
type FlatTier = 'desktop' | 'mobile' | 'mobile-low';
const TIERS: readonly FlatTier[] = ['desktop', 'mobile', 'mobile-low'];

const read = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
interface LookJson {
  tierProfile: Record<string, 'full' | 'lite' | 'min' | 'legacy'>;
  layers: Record<'full' | 'lite' | 'min' | 'legacy', string[]>;
  dynamicCasterRadiusM: number;
}
const LOOK = read<LookJson>('config/world/look.json');
const layersOf = (tier: string): string[] => LOOK.layers[LOOK.tierProfile[tier] as 'full'] ?? [];

async function bootWorld(page: Page, tier: string, query = '', size: { width: number; height: number } = SMALL_VIEWPORT): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/?tier=${tier}&debug=1${query}`);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 180_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 240_000 });
  await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(90_000));
}

const world = <T>(page: Page, fn: (w: WorldBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.world)`) as Promise<T>;

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

/** Frames the page presents after now. */
const frames = async (page: Page, n: number): Promise<void> => {
  const f0 = await world(page, (w) => w.chunks().frame);
  await page.waitForFunction((t) => (window as unknown as W).__dvBridge.world.chunks().frame >= t, f0 + n, { timeout: 180_000, polling: 250 });
};

// ---- @look-tune ---------------------------------------------------------------------------------------------------------

test.describe('look tune @look-tune', () => {
  test.describe.configure({ timeout: 900_000 });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(process.env['DV_OWNER_BEFORE_DIR'] !== undefined, 'before-frames mode');
    void testInfo;
  });

  for (const tier of TIERS) {
    test(`${tier}: the profile's layers, blob shadows, dynamic casters and the analytic sky reflection @look-tune`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await bootWorld(page, tier);
      await setSky(page, 13, 'clear');
      await frames(page, 3);

      const rep = await world(page, (w) => w.look());
      if (!rep) throw new Error('no look report');
      const expected = layersOf(tier);
      expect(rep.layers, 'the layers of the profile').toEqual(expected);
      expect(rep.profile).toBe(LOOK.tierProfile[tier]);

      // blob shadows: drawn while anything stands on the ground (the player at least), one object whatever the count
      await expect.poll(async () => (await world(page, (w) => w.look()))?.blobs ?? 0, { timeout: 120_000, intervals: [250] }).toBeGreaterThan(0);
      const traffic = await world(page, (w) => w.traffic());
      if ((traffic?.instances ?? 0) > 0) expect((await world(page, (w) => w.look()))?.blobs ?? 0).toBeGreaterThanOrEqual(1);

      // the dynamic casters
      if (tier === 'desktop') {
        await expect
          .poll(async () => (await world(page, (w) => w.look()))?.dynamicCasters ?? [], { timeout: 120_000, intervals: [250] })
          .toEqual(expect.arrayContaining(['player', 'traffic']));
        // trees: stand the stream on a resident tree and the trees within the radius cast
        const tree = await page.evaluate(() => {
          type U = { level: string; group: { position: { x: number; z: number }; children: { userData: Record<string, unknown>; count?: number; instanceMatrix?: { array: Float32Array } }[] } };
          const units = (window as unknown as { __dvBridge: { world: { internals(): { view: { renderer: { units: Map<string, U> } } } } } }).__dvBridge.world.internals().view.renderer.units;
          for (const u of units.values()) {
            if (u.level !== 'l0') continue;
            for (const c of u.group.children) {
              if (c.userData['kind'] === 'vegetation' && (c.count ?? 0) > 0 && c.instanceMatrix) {
                const m = c.instanceMatrix.array;
                return { x: u.group.position.x + (m[12] as number), z: u.group.position.z + (m[14] as number) };
              }
            }
          }
          return null;
        });
        expect(tree, 'a resident L0 unit with trees').not.toBeNull();
        if (tree) {
          await page.evaluate((t) => (window as unknown as W).__dvBridge.world.focus(t.x, t.z), tree);
          await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(90_000));
          await frames(page, 45);
          const casters = (await world(page, (w) => w.look()))?.dynamicCasters ?? [];
          expect(casters, 'player, traffic and trees cast on desktop').toEqual(expect.arrayContaining(['player', 'traffic', 'trees']));
          await page.evaluate(() => (window as unknown as W).__dvBridge.world.clearFocus());
        }
        // the layer off: nothing casts
        expect(await world(page, (w) => w.setLookLayer('casters', false))).toBe(true);
        expect((await world(page, (w) => w.look()))?.dynamicCasters).toEqual([]);
        expect(await world(page, (w) => w.setLookLayer('casters', true))).toBe(true);
      } else {
        expect(rep.dynamicCasters, `${tier} has no dynamic casters`).toEqual([]);
        expect(expected).not.toContain('casters');
        expect(await world(page, (w) => w.setLookLayer('casters', true)), 'the profile has no casters layer').toBe(false);
      }

      // the analytic sky reflection wherever there is no environment map
      expect(rep.skyReflect).toBe(expected.includes('skyReflect') && !rep.envMap);
      if (!rep.envMap) expect(rep.skyReflect, `no environment map on ${tier}`).toBe(true);

      // the colour grade runs once: in tonemap on a stack with a target, in the fog nodes on mobile-low
      expect(rep.gradeOn).toBe(tier === 'mobile-low' ? 'fog' : 'tonemap');

      // one layer off and on
      await world(page, (w) => w.setLookLayer('blob', false));
      await frames(page, 2);
      expect((await world(page, (w) => w.look()))?.blobs).toBe(0);
      expect((await world(page, (w) => w.look()))?.layers).not.toContain('blob');
      await world(page, (w) => w.setLookLayer('blob', true));
      await expect.poll(async () => (await world(page, (w) => w.look()))?.blobs ?? 0, { timeout: 60_000, intervals: [250] }).toBeGreaterThan(0);

      // the look off: no layers, no blobs, no casters, no reflection
      expect(await world(page, (w) => w.setLook(false))).toBe(true);
      await frames(page, 3);
      const off = await world(page, (w) => w.look());
      expect(off).toMatchObject({ on: false, layers: [], blobs: 0, dynamicCasters: [], skyReflect: false });
      expect(await world(page, (w) => w.setLook(true))).toBe(true);
      await frames(page, 3);
      expect((await world(page, (w) => w.look()))?.layers).toEqual(expected);
      expect(errors).toEqual([]);
    });
  }
});

// ---- @look-ledger -------------------------------------------------------------------------------------------------------

const LEDGER = 'docs/look/M02g1-render-ledger.json';
interface TierLedger { baseline: number; after: number; perLayer: Record<string, number> }
interface Ledger { commit: string; bakeId: string; tiers: Record<string, TierLedger>; xr?: { baseline: number; after: number } }
const write = process.env['DV_LOOK_WRITE'] === '1';
const bakeIdOf = (): string => read<{ bakeId: string }>('dist/world/latest-synth.json').bakeId;
const commitOf = (): string => process.env['GITHUB_SHA'] ?? process.env['DV_COMMIT'] ?? 'local';
const live = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as W).__dvBridge.platform.perf.live().renderObjects);

test.describe('look ledger @look-ledger', () => {
  test.describe.configure({ timeout: 1_800_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the ledger is chromium-webgl2 only');
    test.skip(process.env['DV_OWNER_BEFORE_DIR'] !== undefined, 'before-frames mode');
  });

  const measured: Record<string, TierLedger> = {};

  for (const tier of ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'] as const) {
    test(`${tier}: each layer toggled on a held frame; the baseline is every layer off @look-ledger`, async ({ page }) => {
      await bootWorld(page, tier, '&perf=1');
      await setSky(page, 13, 'clear');
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
      await frames(page, 6);
      const layers = (await world(page, (w) => w.look()))?.layers ?? [];
      expect(layers).toEqual(layersOf(tier));
      // a held frame: the render loop stops, so the scene is the same for every reading
      await world(page, (w) => w.hold(true));
      const set = (id: string, on: boolean): Promise<boolean> => page.evaluate(([i, o]) => (window as unknown as W).__dvBridge.world.setLookLayer(i as string, o as boolean), [id, on] as const);
      for (const id of layers) expect(await set(id, false)).toBe(true);
      const baseline = await live(page);
      const perLayer: Record<string, number> = {};
      for (const id of layers) {
        await set(id, true);
        perLayer[id] = (await live(page)) - baseline;
        await set(id, false);
      }
      for (const id of layers) await set(id, true);
      const after = await live(page);
      await world(page, (w) => w.hold(false));

      // the blob is one render object; the colour and light layers add none; the casters add shadow passes per casting object
      expect(perLayer['blob'], 'blob').toBeLessThanOrEqual(1);
      expect(perLayer['blob'], 'blob').toBeGreaterThanOrEqual(0);
      for (const id of ['grade', 'haze', 'skyReflect', 'windows']) if (id in perLayer) expect(perLayer[id], id).toBe(0);
      if (!layers.includes('casters')) expect(after).toBeLessThanOrEqual(baseline + 1);
      if (tier === 'mobile-low') {
        expect(after, 'mobile-low after').toBeLessThanOrEqual(100);
        expect(after, 'mobile-low after <= baseline + 1').toBeLessThanOrEqual(baseline + 1);
      }
      measured[tier] = { baseline, after, perLayer };
      console.log(`look ledger ${tier}: baseline ${baseline}, after ${after}, ${JSON.stringify(perLayer)}`);
    });
  }

  test('writes (DV_LOOK_WRITE=1) or checks the committed ledger @look-ledger', () => {
    if (write) {
      const prev = existsSync(LEDGER) ? read<Ledger>(LEDGER) : null;
      const out: Ledger = {
        commit: commitOf(),
        bakeId: bakeIdOf(),
        tiers: { ...(prev?.tiers ?? {}), ...measured },
        ...(prev?.xr ? { xr: prev.xr } : {}),
      };
      mkdirSync(dirname(LEDGER), { recursive: true });
      writeFileSync(LEDGER, `${JSON.stringify(out, null, 2)}\n`);
    }
    expect(existsSync(LEDGER), `${LEDGER} is committed`).toBe(true);
    const ledger = read<Ledger>(LEDGER);
    expect(ledger.bakeId).toMatch(/^[0-9a-f]{64}$/);
    for (const tier of ['desktop-ultra', 'desktop', 'mobile', 'mobile-low']) {
      const t = ledger.tiers[tier];
      expect(t, `${tier} is in the ledger`).toBeDefined();
      if (!t) continue;
      expect(t.after).toBeGreaterThanOrEqual(t.baseline);
      expect(t.perLayer['blob'] ?? 0).toBeLessThanOrEqual(1);
      expect(Object.keys(t.perLayer).sort()).toEqual([...layersOf(tier)].sort());
    }
    expect(ledger.tiers['mobile-low']?.after ?? 0).toBeLessThanOrEqual(100);
    expect((ledger.tiers['mobile-low']?.after ?? 0) - (ledger.tiers['mobile-low']?.baseline ?? 0)).toBeLessThanOrEqual(1);
    if (ledger.xr) expect(ledger.xr.after).toBe(ledger.xr.baseline);
  });
});

// ---- @look-owner --------------------------------------------------------------------------------------------------------

const OWNER_JSON = 'docs/look/M02g1-owner.json';
const OWNER = existsSync(OWNER_JSON) ? read<{ browser: string; tier: string }>(OWNER_JSON) : { browser: 'safari', tier: 'desktop' };
const OWNER_SHOTS = ['a1-truck', 'a1-burnoff'] as const;
const OWNER_TIERS: readonly string[] = [...new Set([OWNER.tier, 'mobile-low'])];
const OWNER_VIEWPORT = { width: 480, height: 270 } as const;
const GOLDEN_DIR = 'tests/e2e/golden/look-webkit';
const BEFORE = (tier: string, shot: string): string => `docs/look/M02g1-before-${tier}.${shot}.png`;
const SHEET_PNG = 'docs/look/M02g1-before-after-webkit.png';
const SHEET_JSON = 'docs/look/M02g1-before-after-webkit.json';
const beforeDir = process.env['DV_OWNER_BEFORE_DIR'];
const updateGolden = process.env['DV_UPDATE_GOLDEN'] === '1' && !process.env['CI'];

const HIDE_ALL = '* { visibility: hidden !important } #dv-engine-canvas { visibility: visible !important }';

/** The story's start at `tier`, past the intro, in the `truck` stage: the tow truck stands at the synth Yard. */
async function bootStory(page: Page, tier: string): Promise<void> {
  await page.setViewportSize(OWNER_VIEWPORT);
  await page.goto(`/?play=story&story=1&tier=${tier}&beats=instant`);
  await waitForEngine(page);
  await page.waitForFunction(
    () => (window as unknown as Partial<W>).__dvBridge?.world !== undefined && (window as unknown as Partial<W>).__dvBridge?.mission !== undefined,
    undefined,
    { timeout: 240_000 },
  );
  await page.waitForFunction(
    () => {
      const s = (window as unknown as W).__dvBridge.mission.state() as unknown as { stageId?: string | null } | null;
      return s?.stageId === 'to_gate';
    },
    undefined,
    { timeout: 400_000 },
  );
  await page.evaluate(() => (window as unknown as W).__dvBridge.mission.jump(1));
  await page.waitForFunction(
    () => {
      const s = (window as unknown as W).__dvBridge.mission.state() as unknown as { stageId?: string | null } | null;
      return s?.stageId === 'truck';
    },
    undefined,
    { timeout: 120_000 },
  );
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 240_000 });
  await page.addStyleTag({ content: HIDE_ALL });
}

/** The canvas after `shot(id)` has presented its frame. */
async function captureOwnerShot(page: Page, shot: string): Promise<Rgba> {
  await page.evaluate((id) => (window as unknown as W).__dvBridge.world.shot(id), shot);
  // Still pictures: the sim stops (the shot's clock and weather were applied before), the ambient crowds are hidden and so are the
  // animated characters (the goldens of M02e do the same with the crowds); the tow truck, the street and the sky are what is compared.
  await page.evaluate(() => {
    const b = (window as unknown as { __dvBridge: { engine: { setPaused(p: boolean): void }; world: WorldBridge } }).__dvBridge;
    b.engine.setPaused(true);
    type G = { group: { visible: boolean } } | null;
    const view = b.world.internals().view as unknown as { traffic: G; peds: G; transit: G; host: { scene: { children: { userData: Record<string, unknown>; visible: boolean }[] } } };
    for (const r of [view.traffic, view.peds, view.transit]) if (r) r.group.visible = false;
    for (const c of view.host.scene.children) if (c.userData['dvActor'] === 'avatar') c.visible = false;
  });
  await frames(page, 3);
  const img = decodePng(await page.locator('#dv-engine-canvas').screenshot());
  await page.evaluate(() => (window as unknown as { __dvBridge: { engine: { setPaused(p: boolean): void } } }).__dvBridge.engine.setPaused(false));
  return img;
}

test.describe('look owner frames @look-owner', () => {
  test.describe.configure({ timeout: 3_600_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'webkit-webgl2', 'the owner frames are webkit-webgl2 only (the owner is on Safari)');
  });

  const after: Record<string, Rgba> = {};

  for (const tier of OWNER_TIERS) {
    test(`${tier}: a1-truck and a1-burnoff are within the golden tolerance, byte-identical twice, and differ from the frames before this milestone @look-owner`, async ({ page }) => {
      await bootStory(page, tier);
      for (const shot of OWNER_SHOTS) {
        const first = await captureOwnerShot(page, shot);
        expect(first).toMatchObject({ width: OWNER_VIEWPORT.width, height: OWNER_VIEWPORT.height });
        if (beforeDir !== undefined) {
          // Step 0: the frames of the code before the milestone
          mkdirSync(beforeDir, { recursive: true });
          writeFileSync(`${beforeDir}/M02g1-before-${tier}.${shot}.png`, encodePng(first));
          continue;
        }
        const second = await captureOwnerShot(page, shot);
        if (!identical(first, second)) {
          mkdirSync('test-results/look-owner', { recursive: true });
          writeFileSync(`test-results/look-owner/${tier}.${shot}.first.png`, encodePng(first));
          writeFileSync(`test-results/look-owner/${tier}.${shot}.second.png`, encodePng(second));
          console.log(`look owner ${tier} ${shot}: two captures differ ${JSON.stringify(diffImages(first, second))}`);
        }
        expect(identical(first, second), `${tier} ${shot}: two consecutive captures differ`).toBe(true);
        after[`${tier}.${shot}`] = first;
        const file = `${GOLDEN_DIR}/${tier}.${shot}.png`;
        if (updateGolden) {
          mkdirSync(GOLDEN_DIR, { recursive: true });
          writeFileSync(file, encodePng(first));
        } else {
          expect(existsSync(file), `${file} is missing; DV_UPDATE_GOLDEN=1 writes it (outside CI, under the golden-update label)`).toBe(true);
          const diff = diffImages(first, decodePng(readFileSync(file)));
          expect(goldenFailures(diff), `${tier} ${shot}: ${JSON.stringify(diff)}`).toEqual([]);
        }
        // the frame before this milestone: this one is clearly different
        expect(existsSync(BEFORE(tier, shot)), `${BEFORE(tier, shot)} is committed (Step 0)`).toBe(true);
        const before = decodePng(readFileSync(BEFORE(tier, shot)));
        const mean = meanAbsDifference(before, first);
        console.log(`look owner ${tier} ${shot}: mean before/after difference ${mean.toFixed(4)}`);
        expect(mean, `${tier} ${shot}: before/after`).toBeGreaterThanOrEqual(0.04);
      }
    });
  }

  test('writes (DV_LOOK_WRITE=1) or checks the before/after sheet of the owner tier @look-owner', async ({ page }, testInfo) => {
    test.skip(beforeDir !== undefined, 'before-frames mode');
    if (write) {
      const tiles: Rgba[] = [];
      const means: Record<string, number> = {};
      for (const shot of OWNER_SHOTS) {
        const a = after[`${OWNER.tier}.${shot}`];
        if (!a) throw new Error(`no after frame for ${OWNER.tier} ${shot}: run the @look-owner tests of this tier first in the same run`);
        const b = decodePng(readFileSync(BEFORE(OWNER.tier, shot)));
        means[shot] = meanAbsDifference(b, a);
        tiles.push(b, a);
      }
      const png = encodePng(composeGrid(tiles, 2));
      mkdirSync('docs/look', { recursive: true });
      writeFileSync(SHEET_PNG, png);
      const info = await page.evaluate(() => ({ backend: 'webgl2', ua: navigator.userAgent }));
      writeFileSync(
        SHEET_JSON,
        `${JSON.stringify(
          {
            commit: commitOf(),
            bakeId: bakeIdOf(),
            tier: OWNER.tier,
            browser: 'webkit-webgl2',
            backend: info.backend,
            viewport: OWNER_VIEWPORT,
            shots: [...OWNER_SHOTS],
            layout: 'rows: a1-truck (06:30 Karl fog), a1-burnoff (07:00 clear); columns: before M02g1, after',
            meanAbsDifference: means,
            sha256: createHash('sha256').update(png).digest('hex'),
          },
          null,
          2,
        )}\n`,
      );
      testInfo.annotations.push({ type: 'wrote', description: SHEET_PNG });
    }
    expect(existsSync(SHEET_PNG) && existsSync(SHEET_JSON), `${SHEET_PNG} and ${SHEET_JSON} are committed`).toBe(true);
    const meta = read<{ bakeId: string; tier: string; shots: string[]; sha256: string; meanAbsDifference: Record<string, number> }>(SHEET_JSON);
    const bytes = readFileSync(SHEET_PNG);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
    expect(decodePng(bytes)).toMatchObject({ width: OWNER_VIEWPORT.width * 2, height: OWNER_VIEWPORT.height * 2 });
    expect(meta.shots).toEqual([...OWNER_SHOTS]);
    expect(meta.tier).toBe(OWNER.tier);
    for (const shot of OWNER_SHOTS) expect(meta.meanAbsDifference[shot] ?? 0).toBeGreaterThanOrEqual(0.04);
  });
});
