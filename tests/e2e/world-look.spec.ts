import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { adaptForBackend, postNodes } from '../../packages/engine/src/platform/post/levels.ts';
import { composeGrid, decodePng, encodePng, meanAbsDifference, type Rgba } from '../support/image-diff.ts';
import { waitForEngine } from './engine-helpers.ts';
import { streamAtPlan } from './ledger-helpers.ts';
import { bakeIdOf, bootWorld, frames, GOLDEN_VIEWPORT, read, world, type W } from './world-look-helpers.ts';

/**
 * M02e look pass in a real browser, on a `DV_WORLD=synth` QA build (the world half of the e2e legs).
 *
 *  - @world-look    AC-5  per flat tier: the profile, the post nodes (minus `webgl2Unsupported`, `webgl2AaFallback` applied on the WebGL2
 *                   backend), the shadow mode and pass count, the casters, the sky, the window emissive; `setLook(false)` is the legacy
 *                   look; no image or `texture/` request that a `?look=0` boot does not make, other than the tier's bound surface
 *                   textures (`look().textures.refs`, M10d0)
 *  - @look-golden   AC-6  in `city-look-golden.spec.ts` (BD-FIX-CI-WORLDLOOK-01)
 *  - @look-compare  AC-10 the before/after pair of `docs/look` (`chromium-webgl2` only)
 *  - @xr @world-look AC-7 the Quest tier keeps the direct pipeline and the legacy look
 */
type FlatTier = 'desktop-ultra' | 'desktop' | 'mobile' | 'mobile-low';
const FLAT_TIERS: readonly FlatTier[] = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'];

const LOOK = read<{
  tierProfile: Record<string, string>;
  postLevelCap: 0 | 1 | 2 | 3;
  shadowsOff: string[];
  webgl2Unsupported: string[];
  webgl2AaFallback: Record<string, string>;
}>('config/world/look.json');
const BUDGETS = read<{ tiers: Record<string, { features: Parameters<typeof postNodes>[0] & { shadows: { mode: string } } }> }>('config/tier-budgets.json');

/** Sets the sky through the sim and waits until the page's sky shows it. */
async function setSky(page: Page, hour: number, weather: string): Promise<void> {
  await page.evaluate(
    ([h, w]) => {
      const world = (window as unknown as W).__dvBridge.world;
      world.setHour(h as number, true);
      world.setWeather(w as never, 0);
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

/** The nodes `AC-5` expects: the tier list at the effective level, for the backend the page reports. */
function expectedNodes(tier: FlatTier, backend: string): string[] {
  const features = (BUDGETS.tiers[tier] as { features: Parameters<typeof postNodes>[0] }).features;
  const list = postNodes(features, 2, LOOK.postLevelCap);
  return adaptForBackend(list, backend === 'webgl2' ? 'webgl2' : 'webgpu', {
    webgl2Unsupported: LOOK.webgl2Unsupported as never,
    webgl2AaFallback: LOOK.webgl2AaFallback as never,
  });
}

test.describe('world look @world-look', () => {
  test.describe.configure({ timeout: 900_000 });

  for (const tier of FLAT_TIERS) {
    test(`${tier}: the look reports its profile, post nodes, shadows, sky and window glow; setLook(false) is the legacy look @world-look`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await bootWorld(page, tier);

      await setSky(page, 13, 'clear');
      const noon = await world(page, (w) => w.look());
      if (!noon) throw new Error('no look report');
      expect(noon.tier).toBe(tier);
      expect(noon.on).toBe(true);
      expect(noon.profile).toBe(LOOK.tierProfile[tier]);
      expect(noon.postNodes).toEqual(expectedNodes(tier, noon.backend));
      // The debug panel (?debug=1) carries a look switch and the list of the post nodes running.
      await expect(page.getByTestId('look-toggle')).toBeChecked();
      await expect(page.getByTestId('look-nodes')).toContainText(noon.postNodes.join(' > '));
      const asked = (BUDGETS.tiers[tier] as { features: { shadows: { mode: string } } }).features.shadows.mode;
      const off = LOOK.shadowsOff.includes(tier);
      expect(noon.shadowMode).toBe(off ? 'none' : asked);
      // The pass count is what the active shadow object reports: 3 (CSMShadowNode), 2 (SunLight fallback), 1 (fitted), 0 (blob, off).
      const allowed = off || asked === 'blob' ? [0] : asked === 'csm3' ? [3, 2, 1] : [1];
      expect(allowed).toContain(noon.shadowPasses);
      if (noon.shadowPasses === 3) expect(noon.shadowPath).toBe('csm');
      for (const kind of noon.casterKinds) expect(kind).toBe('l0:buildings');
      if (noon.shadowPasses > 0) expect(noon.casters).toBeGreaterThan(0);
      else expect(noon.casters).toBe(0);
      expect(noon.sky).toBe(tier === 'desktop-ultra' || tier === 'desktop' ? 'physical' : 'dome');
      expect(noon.windowEmissive).toBe(0);
      if (noon.fallbacks.length > 0) console.log(`world-look ${tier} (${noon.backend}): ${noon.fallbacks.join(' | ')}`);

      // Night: the windows are lit.
      await setSky(page, 22, 'clear');
      await frames(page, 2);
      const night = await world(page, (w) => w.look());
      expect(night?.windowEmissive ?? 0).toBeGreaterThan(0);
      await setSky(page, 13, 'clear');
      await frames(page, 2);

      // The rollback switch: legacy materials, no post stack, no shadow map.
      expect(await world(page, (w) => w.setLook(false))).toBe(true);
      await frames(page, 3);
      const legacy = await world(page, (w) => w.look());
      expect(legacy).toMatchObject({ profile: 'legacy', on: false, postNodes: [], shadowMode: 'none', shadowPasses: 0 });
      expect(await page.evaluate(() => (window as unknown as { __dvBridge: { world: { internals(): { view: { materials: { lookOn(): boolean } } } } } }).__dvBridge.world.internals().view.materials.lookOn())).toBe(false);
      expect(await world(page, (w) => w.setLook(true))).toBe(true);
      await frames(page, 3);
      const back = await world(page, (w) => w.look());
      expect(back?.profile).toBe(LOOK.tierProfile[tier]);
      expect(back?.postNodes).toEqual(noon.postNodes);
      expect(errors).toEqual([]);
    });
  }

  test('the look makes no image or texture request that a look-off boot does not also make, but the tier\'s bound surface textures @world-look', async ({ browser }) => {
    const boot = async (query: string): Promise<{ seen: Set<string>; refs: string[] }> => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const seen = new Set<string>();
      page.on('request', (r) => {
        const url = new URL(r.url());
        if (url.protocol === 'data:') return;
        if (r.resourceType() === 'image' || /\/texture\//.test(url.pathname)) seen.add(url.pathname);
      });
      await bootWorld(page, 'desktop', query);
      // M10d0: the surface textures load after the reveal; the refs the tier asks for are the only texture requests the look may add.
      await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.look()?.textures?.settled === true, undefined, { timeout: 240_000 });
      const refs = await world(page, (w) => w.look()?.textures?.refs ?? []);
      await ctx.close();
      return { seen, refs };
    };
    const withLook = await boot('');
    const withoutLook = await boot('&look=0');
    expect(withoutLook.refs).toEqual([]);
    for (const url of withLook.seen) {
      if (withoutLook.seen.has(url)) continue;
      expect(withLook.refs.some((ref) => url.includes(`/${ref}/`)), `${url} is requested only with the look on and is not one of ${withLook.refs.join(', ')}`).toBe(true);
    }
  });
});

test.describe('xr look @world-look', () => {
  test('the Quest tier keeps the direct pipeline and the legacy look, with no post nodes @xr @world-look', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(GOLDEN_VIEWPORT);
    // `&textures=0&art=0` (DL-758): the XR row of M02g1's ledger is M02g1's own scene, so the later rows' layers stay out of the frame
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1&textures=0&art=0');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
    const look = await world(page, (w) => w.look());
    expect(look).toMatchObject({ profile: 'legacy', postNodes: [], shadowMode: 'none', shadowPasses: 0, pipeline: 'direct' });
    // M02g1 (AC-4): the legacy profile has no layers, so asking for any of them changes nothing and costs no render object
    expect(look).toMatchObject({ layers: [], blobs: 0, dynamicCasters: [], skyReflect: false, gradeOn: null });
    const LAYERS = ['grade', 'haze', 'blob', 'casters', 'skyReflect', 'windows'];
    const liveObjects = (): Promise<number> => page.evaluate(() => (window as unknown as { __dvBridge: { platform: { perf: { live(): { renderObjects: number } } } } }).__dvBridge.platform.perf.live().renderObjects);
    // the frame of the whole plan, six frames after it (DL-758)
    await streamAtPlan(page);
    await world(page, (w) => w.hold(true));
    const baseline = await liveObjects();
    for (const id of LAYERS) expect(await page.evaluate((i) => (window as unknown as W).__dvBridge.world.setLookLayer(i, true), id), `${id} on a legacy tier`).toBe(false);
    const withLayers = await liveObjects();
    await world(page, (w) => w.hold(false));
    expect(withLayers, 'xr after = baseline').toBe(baseline);
    if (process.env['DV_LOOK_WRITE'] === '1') {
      const file = 'docs/look/M02g1-render-ledger.json';
      const prev = existsSync(file) ? read<{ commit: string; bakeId: string; tiers: Record<string, unknown>; xr?: unknown }>(file) : { commit: process.env['GITHUB_SHA'] ?? process.env['DV_COMMIT'] ?? 'local', bakeId: read<{ bakeId: string }>('dist/world/latest-synth.json').bakeId, tiers: {} };
      writeFileSync(file, `${JSON.stringify({ ...prev, xr: { baseline, after: withLayers } }, null, 2)}\n`);
    }
  });
});

// ---- before / after -------------------------------------------------------------------------------------------------------

const COMPARE_PNG = 'docs/look/M02e-before-after.png';
const COMPARE_JSON = 'docs/look/M02e-before-after.json';
const COMPARE_SHOTS = ['noon-street', 'night-street'] as const;
const COMPARE_VIEWPORT = { width: 960, height: 540 } as const;

test.describe('look before and after @look-compare', () => {
  test.describe.configure({ timeout: 3_600_000 });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the before/after image is chromium-webgl2 only');
  });

  const write = process.env['DV_LOOK_WRITE'] === '1';

  test('writes (DV_LOOK_WRITE=1) or checks the pair of docs/look @look-compare', async ({ page }, testInfo) => {
    if (write) {
      // Boot and place the shot at the small size (the software renderer needs seconds per frame at 960 x 540 and the shot waits for
      // many frames), then grow the viewport for the capture only: the aspect is 16:9 in both, so the frustum and the residents stay.
      await bootWorld(page, 'desktop', '', GOLDEN_VIEWPORT);
      await page.addStyleTag({ content: '.dv-hud, .dv-sim-panel, .dv-sky-controls, .dv-pursuit, .dv-modes, .dv-mission, .dv-npcdbg, .dv-npcagency, [data-dv-xr-smoke], [data-dv-world-controls] { display: none !important }' });
      const tiles: Rgba[] = [];
      const means: Record<string, number> = {};
      for (const id of COMPARE_SHOTS) {
        const pair: Rgba[] = [];
        for (const on of [false, true]) {
          await page.evaluate(([flag]) => (window as unknown as W).__dvBridge.world.setLook(flag as boolean), [on] as const);
          await page.evaluate((shot) => (window as unknown as W).__dvBridge.world.shot(shot), id);
          await frames(page, 2);
          await page.setViewportSize(COMPARE_VIEWPORT);
          await frames(page, 2);
          // Stop the loop so the element screenshot does not wait on new frames; the canvas keeps the last one.
          await page.evaluate(() => (window as unknown as W).__dvBridge.world.hold(true));
          pair.push(decodePng(await page.locator('#dv-engine-canvas').screenshot()));
          await page.evaluate(() => (window as unknown as W).__dvBridge.world.hold(false));
          await page.setViewportSize(GOLDEN_VIEWPORT);
        }
        means[id] = meanAbsDifference(pair[0] as Rgba, pair[1] as Rgba);
        tiles.push(...pair);
      }
      const sheet = composeGrid(tiles, 2);
      mkdirSync('docs/look', { recursive: true });
      const png = encodePng(sheet);
      writeFileSync(COMPARE_PNG, png);
      const info = await page.evaluate(() => {
        const w = (window as unknown as W).__dvBridge.world;
        return { backend: w.look()?.backend ?? 'unknown', tier: w.tier() };
      });
      writeFileSync(
        COMPARE_JSON,
        `${JSON.stringify(
          {
            commit: process.env['GITHUB_SHA'] ?? process.env['DV_COMMIT'] ?? 'local',
            bakeId: bakeIdOf(),
            tier: info.tier,
            backend: info.backend,
            shots: [...COMPARE_SHOTS],
            layout: 'rows: noon-street, night-street; columns: before (look off), after (look on)',
            meanAbsDifference: means,
            sha256: createHash('sha256').update(png).digest('hex'),
          },
          null,
          2,
        )}\n`,
      );
      testInfo.annotations.push({ type: 'wrote', description: COMPARE_PNG });
    }
    // Check mode: the committed pair.
    expect(existsSync(COMPARE_PNG) && existsSync(COMPARE_JSON), `${COMPARE_PNG} and ${COMPARE_JSON} are committed`).toBe(true);
    const meta = read<{ bakeId: string; tier: string; backend: string; shots: string[]; sha256: string; meanAbsDifference: Record<string, number> }>(COMPARE_JSON);
    const bytes = readFileSync(COMPARE_PNG);
    const img = decodePng(bytes);
    expect(img).toMatchObject({ width: 1920, height: 1080 });
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
    expect(meta.tier).toBe('desktop');
    expect(['webgl2', 'webgpu']).toContain(meta.backend);
    expect(meta.bakeId).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.shots).toEqual([...COMPARE_SHOTS]);
    for (const id of COMPARE_SHOTS) expect(meta.meanAbsDifference[id] ?? 0).toBeGreaterThanOrEqual(0.04);
  });
});
