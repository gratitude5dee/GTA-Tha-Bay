import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';
import { crowdMax, streamAtPlan } from './ledger-helpers.ts';
import { bakeIdOf, frames, live, read, setSky, world, type W } from './markings-helpers.ts';

/**
 * M02h8, the `xr` look profile in a real browser, on a `DV_WORLD=synth` QA build.
 *
 *  - @world-xr-look (AC-4), flat on `chromium-webgl2` at `?tier=xr-visionpro` (the tier forced on the flat canvas) and as `@xr` on
 *    `xr-quest3` (`?tier=xr-quest&xr-emulate=quest3`): `look()` reports the `xr` profile on the `direct` pipeline with no post node, no
 *    shadow pass and the blob layer, its six layers, the `flat` paint and the `low` trees; on `xr-quest3` an immersive session reports
 *    `xrMultiview` as a boolean and the view passes that follow from it; `?look=0` and `?look=legacy` boot the `legacy` profile with
 *    M02h1's flat paint; the `xr` boot makes no image or `texture/` request that the `?look=0` boot does not also make; and the story
 *    start (`?play=story&story=1`) draws the same profile as the default QA scene.
 *  - @look-xr-ledger (AC-5), `chromium-webgl2` and the `@xr` case: the render objects of the ledger frame (DL-758) per row against the
 *    `after` of the latest merged ledger. `xr-quest`: at most one more (the blob mesh), at most 150 per view pass and 750,000 triangles;
 *    `xr-visionpro` (forced flat, counted per view pass; the tier draws two): at most one more than with its layers off and at most 200;
 *    `desktop` with TRAA (`?post=3`), `mobile-low` (at most 100 with its crowd) and `legacy`: no more than their baselines, and TRAA adds
 *    no render object (the same frame at level 3 and at level 2). `DV_LOOK_WRITE=1` writes `docs/look/M02h8-render-ledger.json` (M02g1's
 *    shape, `perLayer` from switching each layer of the profile off on the held frame, plus `xrMultiview` and `viewPassesObserved`).
 *
 * Every boot of a case is closed before the next opens: never two software-rendered worlds at once.
 */

const LOOK = read<{ tierProfile: Record<string, string>; layers: Record<string, string[]>; shadowsOff: string[] }>('config/world/look.json');
const BUDGETS = read<{ tiers: Record<string, { render: { maxRenderObjects: number; maxTriangles: number; viewPasses: number }; features: { shadows: { mode: string } } }> }>('config/tier-budgets.json');
const XR_LAYERS = ['grade', 'haze', 'markings', 'skyReflect', 'blob', 'ao'] as const;
type XrTier = 'xr-quest' | 'xr-visionpro';

/** Boots an XR tier on the flat canvas (the Quest tier with the IWER Quest 3 the XR specs use) and waits for the reveal. */
async function bootXr(page: Page, tier: XrTier, query = '', size: { width: number; height: number } = SMALL_VIEWPORT): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/?tier=${tier}${tier === 'xr-quest' ? '&xr-emulate=quest3' : ''}&debug=1${query}`);
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 240_000 });
}

type LookReport = NonNullable<ReturnType<WorldBridge['look']>>;
const lookOf = async (page: Page): Promise<LookReport> => {
  const r = await world(page, (w) => w.look());
  if (!r) throw new Error('no look report');
  return r;
};

/** Enter VR (smoke): the debug button of the XR smoke spec, under the IWER Quest 3; resolves once ten XR frames were drawn. */
async function enterVr(page: Page): Promise<void> {
  const f0 = await page.evaluate(() => (window as unknown as W).__dvBridge.platform.xr.state().frames);
  await page.locator('[data-dv-xr-smoke]').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__dvBridge.platform.xr.state().isPresenting), { timeout: 60_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__dvBridge.platform.xr.state().frames), { timeout: 60_000 }).toBeGreaterThanOrEqual(f0 + 10);
}

/** The `xr` profile as `look()` reports it (AC-4, first bullet). */
function expectXrLook(look: LookReport, tier: XrTier): void {
  const blobTier = BUDGETS.tiers[tier]?.features.shadows.mode === 'blob';
  expect(LOOK.tierProfile[tier], `look.json maps ${tier} to xr`).toBe('xr');
  expect(look).toMatchObject({
    profile: 'xr', on: true, tier, pipeline: 'direct', postNodes: [], postMode: 'none', postLevel: 0,
    // blob shadows with no shadow pass: Quest by its tier (`blob`), Vision Pro with its map off in look.json (`shadowsOff`)
    shadowMode: blobTier ? 'blob' : 'none', shadowPath: blobTier ? 'blob' : 'off', shadowPasses: 0, casters: 0, dynamicCasters: [],
    sky: 'dome', envMap: false, gradeOn: 'fog', skyReflect: true, traa: null,
  });
  if (!blobTier) expect(LOOK.shadowsOff, `${tier} has its shadow map off`).toContain(tier);
  expect(look.layers, 'the six layers of the xr profile').toEqual([...XR_LAYERS]);
  expect(look.layers).toEqual(LOOK.layers['xr']);
  expect(look.markings.mode, 'the flat paint').toBe('flat');
  expect(look.markings.roadVerts).toBeGreaterThan(0);
  expect(look.vegetation.set, 'the low tree pools').toBe('low');
  expect(look.facade?.kit, 'no facade kit geometry').toBe(false);
  expect(look.furniture).toMatchObject({ source: 'none', objects: 0 });
}

/** The `legacy` fallback of an XR tier (`?look=0`, `?look=legacy`): no look view, M02h1's flat paint on the legacy roads material. */
function expectLegacyLook(look: LookReport, tier: XrTier): void {
  expect(look).toMatchObject({ profile: 'legacy', on: false, tier, pipeline: 'direct', postNodes: [], shadowMode: 'none', shadowPasses: 0, layers: [], blobs: 0, skyReflect: false, gradeOn: null });
  expect(look.markings.mode, 'the flat paint of M02h1').toBe('flat');
  expect(look.markings.roadVerts).toBeGreaterThan(0);
}

/** One boot in a context of its own, with the image and `texture/` requests it made; the context is closed before it returns. */
async function bootAndCollect(browser: Browser, tier: XrTier, query: string, check: (page: Page) => Promise<void>): Promise<Set<string>> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const seen = new Set<string>();
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol === 'data:') return;
    if (r.resourceType() === 'image' || /\/texture\//.test(url.pathname)) seen.add(url.pathname);
  });
  try {
    await bootXr(page, tier, query);
    await check(page);
    // the textures (none on these tiers) and the art load after the reveal: the comparison waits for them
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.look()?.textures?.settled !== false, undefined, { timeout: 240_000 });
    await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(90_000));
    expect(errors, `page errors of ${tier}${query}`).toEqual([]);
  } finally {
    await ctx.close();
  }
  return seen;
}

/** The layer switches of the `xr` profile, the look switch and the window mask at night, on a booted page. */
async function exerciseXrLook(page: Page, tier: XrTier): Promise<void> {
  await setSky(page, 13, 'clear');
  await frames(page, 2);
  const noon = await lookOf(page);
  expectXrLook(noon, tier);
  expect(noon.windowEmissive).toBe(0);
  expect(noon.textures, 'no surface texture on an XR tier').toMatchObject({ refs: [] });
  // the blobs follow the actors: the player's at least
  await expect.poll(async () => (await lookOf(page)).blobs, { timeout: 120_000, intervals: [500, 1000] }).toBeGreaterThan(0);
  // a layer of the profile switches; one it does not have refuses
  for (const id of XR_LAYERS) {
    expect(await page.evaluate((i) => (window as unknown as W).__dvBridge.world.setLookLayer(i, false), id), `${id} off`).toBe(true);
    expect((await lookOf(page)).layers, `${id} off`).toEqual(XR_LAYERS.filter((l) => l !== id));
    expect(await page.evaluate((i) => (window as unknown as W).__dvBridge.world.setLookLayer(i, true), id), `${id} on`).toBe(true);
  }
  for (const id of ['casters', 'windows', 'curbs', 'bump', 'macro', 'lots', 'facade']) {
    expect(await page.evaluate((i) => (window as unknown as W).__dvBridge.world.setLookLayer(i, true), id), `${id} is not a layer of xr`).toBe(false);
  }
  expect((await lookOf(page)).layers).toEqual([...XR_LAYERS]);
  // night: the window mask of the `min` wall path glows
  await setSky(page, 22, 'clear');
  await frames(page, 2);
  expect((await lookOf(page)).windowEmissive).toBeGreaterThan(0);
  await setSky(page, 13, 'clear');
  // the runtime switch: the legacy materials and back
  expect(await world(page, (w) => w.setLook(false))).toBe(true);
  await frames(page, 2);
  expect(await lookOf(page)).toMatchObject({ profile: 'legacy', on: false, layers: [], postNodes: [], gradeOn: null });
  expect(await world(page, (w) => w.setLook(true))).toBe(true);
  await frames(page, 2);
  expectXrLook(await lookOf(page), tier);
}

/** AC-4, last bullet: every image or texture path of the `xr` boot is also one of the `?look=0` boot. */
function expectNoNewRequests(withLook: Set<string>, withoutLook: Set<string>): void {
  const extra = [...withLook].filter((url) => !withoutLook.has(url));
  expect(extra, 'image or texture requests only the xr look makes').toEqual([]);
}

test.describe('xr look, flat @world-xr-look', () => {
  test.describe.configure({ timeout: 1_500_000 });

  test('xr-visionpro forced flat: the xr profile, its layers and switches; look=0 and look=legacy are the legacy look; no request of its own @world-xr-look', async ({ browser }, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the flat leg of the XR look is chromium-webgl2 (AC-4)');
    const tier: XrTier = 'xr-visionpro';
    const withLook = await bootAndCollect(browser, tier, '', async (page) => {
      await exerciseXrLook(page, tier);
      const look = await lookOf(page);
      // a flat page: no session presents, one view pass
      expect(look.xrMultiview ?? null).toBeNull();
      expect(look.viewPassesObserved).toBe(1);
    });
    const withoutLook = await bootAndCollect(browser, tier, '&look=0', async (page) => expectLegacyLook(await lookOf(page), tier));
    await bootAndCollect(browser, tier, '&look=legacy', async (page) => expectLegacyLook(await lookOf(page), tier));
    expectNoNewRequests(withLook, withoutLook);
  });
});

test.describe('xr look on the Quest tier @xr @world-xr-look', () => {
  test.describe.configure({ timeout: 900_000 });

  test('the Quest tier draws the xr look; an immersive session reports multiview; look=0 and look=legacy are the legacy look; no request of its own @xr @world-xr-look', async ({ browser }) => {
    const tier: XrTier = 'xr-quest';
    const withLook = await bootAndCollect(browser, tier, '', async (page) => {
      await exerciseXrLook(page, tier);
      expect((await lookOf(page)).xrMultiview ?? null, 'no session yet').toBeNull();
      // Enter VR (smoke), as the XR smoke spec does under IWER
      await enterVr(page);
      const state = await page.evaluate(() => (window as unknown as W).__dvBridge.platform.xr.state());
      const look = await lookOf(page);
      expect(typeof look.xrMultiview, 'xrMultiview is a boolean while a session presents').toBe('boolean');
      expect(state.multiview).toBe(look.xrMultiview);
      // one pass on a multiview target, one per eye without it
      expect(look.viewPassesObserved).toBe(look.xrMultiview ? 1 : 2);
      expect(state.viewPasses).toBe(look.viewPassesObserved);
      expectXrLook(look, tier);
      console.log(`world-xr-look xr-quest3: xrMultiview ${String(look.xrMultiview)}, viewPassesObserved ${look.viewPassesObserved}`);
      await page.evaluate(() => (window as unknown as { __dvBridge: { engine: { endXr(): Promise<void> } } }).__dvBridge.engine.endXr());
      await expect.poll(() => page.evaluate(() => (window as unknown as W).__dvBridge.platform.xr.state().isPresenting), { timeout: 30_000 }).toBe(false);
      expect((await lookOf(page)).viewPassesObserved).toBe(1);
    });
    const withoutLook = await bootAndCollect(browser, tier, '&look=0', async (page) => expectLegacyLook(await lookOf(page), tier));
    await bootAndCollect(browser, tier, '&look=legacy', async (page) => expectLegacyLook(await lookOf(page), tier));
    // `?look=xr` is the configured profile on this build; it is the switch that keeps the xr look reachable if the data falls back to legacy
    await bootAndCollect(browser, tier, '&look=xr', async (page) => expectXrLook(await lookOf(page), tier));
    // the real story start (`?play=story&story=1`, the new game's first mission) draws the same look as the sandbox scene
    await bootAndCollect(browser, tier, '&play=story&story=1', async (page) => expectXrLook(await lookOf(page), tier));
    expectNoNewRequests(withLook, withoutLook);
  });
});

// ---- @look-xr-ledger --------------------------------------------------------------------------------------------------------

const LEDGER = 'docs/look/M02h8-render-ledger.json';
/** The latest merged ledger first (its `after` is this one's baseline). */
const PRIORS = ['docs/look/M02h7-render-ledger.json', 'docs/look/M02h6-render-ledger.json'];
const FLAT_ROWS = ['desktop', 'mobile-low', 'legacy'] as const;
const QUEST_PER_PASS_MAX = 150;
const QUEST_TRIANGLES_MAX = 750_000;
const VISIONPRO_PER_PASS_MAX = 200;

interface Row {
  baseline: number;
  after: number;
  /** Render objects each layer of this milestone adds to the ledger frame (the count with the layer on minus the count with it off). */
  perLayer: Record<string, number>;
  triangles?: number;
}
interface XrRow extends Row {
  /** `look().xrMultiview` in the immersive session of the run (null for a row counted on the flat canvas). */
  xrMultiview: boolean | null;
  /** `look().viewPassesObserved` in that session (1 on the flat canvas). */
  viewPassesObserved: number;
  /** C13 `RenderLimits.viewPasses` of the tier: the passes its budget is counted for. */
  viewPasses: number;
  /** The per-pass cap of the tier and `after x viewPassesObserved`. */
  perPassMax: number;
  total: number;
  note?: string;
}
interface Ledger {
  commit: string;
  bakeId: string;
  baselineFrom: string;
  drift?: { reason: string; measured: Record<string, number> };
  tiers: Record<string, Row | XrRow>;
  xr?: XrRow;
}
const write = process.env['DV_LOOK_WRITE'] === '1';
const commitOf = (): string => process.env['GITHUB_SHA'] ?? process.env['DV_COMMIT'] ?? 'local';

function prior(): { file: string; ledger: { tiers: Record<string, { after: number }>; xr?: { after: number } } } {
  for (const file of PRIORS) if (existsSync(file)) return { file, ledger: read(file) };
  throw new Error(`no ledger before M02h8 in docs/look (${PRIORS.join(', ')})`);
}

/** The render objects of the held ledger frame with every layer of the xr profile on, with all of them off, and per layer. */
async function xrLayerCounts(page: Page): Promise<{ on: number; off: number; perLayer: Record<string, number>; triangles: number }> {
  const set = (id: string, on: boolean): Promise<boolean> => page.evaluate(([i, o]) => (window as unknown as W).__dvBridge.world.setLookLayer(i as string, o as boolean), [id, on] as const);
  const on = await live(page);
  const perLayer: Record<string, number> = {};
  for (const id of XR_LAYERS) {
    expect(await set(id, false), `${id} off`).toBe(true);
    perLayer[id] = on.renderObjects - (await live(page)).renderObjects;
    expect(await set(id, true), `${id} on`).toBe(true);
  }
  for (const id of XR_LAYERS) await set(id, false);
  const off = (await live(page)).renderObjects;
  for (const id of XR_LAYERS) await set(id, true);
  expect((await live(page)).renderObjects, 'the layers back on').toBe(on.renderObjects);
  return { on: on.renderObjects, off, perLayer, triangles: on.triangles };
}

test.describe('xr look ledger @look-xr-ledger', () => {
  test.describe.configure({ timeout: 1_800_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the ledger is chromium-webgl2 only (the Quest row runs on xr-quest3)');
  });
  const measured: Record<string, Row | XrRow> = {};

  for (const row of FLAT_ROWS) {
    test(`${row}: no more render objects than the latest merged ledger; the xr look and TRAA add none here @look-xr-ledger`, async ({ page }) => {
      const tier = row === 'legacy' ? 'mobile-low' : row;
      await page.setViewportSize(SMALL_VIEWPORT);
      // `post=3` on desktop: the build's own cap, so the frame is the TRAA frame (the fixture holds other pages at level 2, BD-M02h8-02)
      await page.goto(`/?play=sandbox&tier=${tier}&debug=1${row === 'desktop' ? '&post=3' : ''}`);
      await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 420_000 });
      await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(90_000));
      if (row === 'legacy') expect(await world(page, (w) => w.setLook(false)), 'the look switched off').toBe(true);
      await setSky(page, 13, 'clear');
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
      if (tier === 'mobile-low') await world(page, (w) => w.shot('fog-west'));
      await streamAtPlan(page);
      await world(page, (w) => w.hold(true));
      const on = await live(page);
      const perLayer: Record<string, number> = {};
      if (row === 'desktop') {
        const nodes = (await lookOf(page)).postNodes;
        expect(nodes, 'desktop at the cap of 3 runs traa').toContain('traa');
        // the same held frame at level 2: the post nodes are not scene objects
        await page.evaluate(() => ((window as unknown as W).__dvBridge.world.internals() as unknown as { look: { setPostLevel(n: number): void } }).look.setPostLevel(2));
        expect((await lookOf(page)).postNodes).not.toContain('traa');
        perLayer['traa'] = on.renderObjects - (await live(page)).renderObjects;
        expect(perLayer['traa'], 'TRAA adds no render object').toBe(0);
      }
      await world(page, (w) => w.hold(false));
      const baseline = row === 'legacy' ? on.renderObjects : prior().ledger.tiers[tier]?.after;
      expect(baseline, `${prior().file} holds ${tier}`).toBeDefined();
      console.log(`xr look ledger ${row}: ${on.renderObjects} render objects (baseline ${String(baseline)}; crowd max ${crowdMax(tier)}), ${on.triangles} triangles`);
      expect(on.renderObjects, `${row}: render objects against the after (${String(baseline)}) of ${prior().file}`).toBeLessThanOrEqual(baseline ?? 0);
      if (tier === 'mobile-low') expect(on.renderObjects + crowdMax(tier), `mobile-low ${on.renderObjects} + crowd max ${crowdMax(tier)}`).toBeLessThanOrEqual(100);
      measured[row] = { baseline: baseline ?? on.renderObjects, after: on.renderObjects, perLayer, triangles: on.triangles };
    });
  }

  test('xr-visionpro forced flat: at most one render object over its layers-off frame and at most 200 per view pass @look-xr-ledger', async ({ page }) => {
    const tier: XrTier = 'xr-visionpro';
    await bootXr(page, tier);
    await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(90_000));
    await setSky(page, 13, 'clear');
    await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
    await streamAtPlan(page);
    await world(page, (w) => w.hold(true));
    const c = await xrLayerCounts(page);
    const look = await lookOf(page);
    await world(page, (w) => w.hold(false));
    const passes = BUDGETS.tiers[tier]?.render.viewPasses ?? 2;
    console.log(`xr look ledger ${tier} (flat, per view pass; the tier draws ${passes}): ${c.on} render objects, ${c.off} with its layers off; per layer ${JSON.stringify(c.perLayer)}; ${c.triangles} triangles; crowd max ${crowdMax(tier)}`);
    expect(look.profile).toBe('xr');
    expect(c.on, `${tier}: at most one render object over the layers-off frame (${c.off})`).toBeLessThanOrEqual(c.off + 1);
    expect(c.perLayer['blob'], 'the blob mesh is the one object').toBeLessThanOrEqual(1);
    for (const id of XR_LAYERS) if (id !== 'blob') expect(c.perLayer[id], `${id} adds no render object`).toBe(0);
    expect(c.on + crowdMax(tier), `${tier}: ${c.on} + crowd max ${crowdMax(tier)} per view pass`).toBeLessThanOrEqual(VISIONPRO_PER_PASS_MAX);
    expect(c.triangles).toBeLessThanOrEqual(BUDGETS.tiers[tier]?.render.maxTriangles ?? 0);
    measured[tier] = { baseline: c.off, after: c.on, perLayer: c.perLayer, triangles: c.triangles, xrMultiview: null, viewPassesObserved: look.viewPassesObserved ?? 1, viewPasses: passes, perPassMax: VISIONPRO_PER_PASS_MAX, total: c.on * passes, note: 'forced flat on chromium-webgl2: counted per view pass; the device run is M11b1' };
  });

  test('writes (DV_LOOK_WRITE=1) or checks the committed ledger @look-xr-ledger', () => {
    const base = prior();
    if (write) {
      const drift: Record<string, number> = {};
      const tiers: Record<string, Row | XrRow> = {};
      for (const row of [...FLAT_ROWS, 'xr-visionpro'] as const) {
        const m = measured[row];
        if (!m) continue;
        tiers[row] = m;
        if (row !== 'legacy' && row !== 'xr-visionpro' && m.after !== m.baseline) drift[row] = m.after;
      }
      const old = existsSync(LEDGER) ? read<Ledger>(LEDGER) : undefined;
      const out: Ledger = {
        commit: commitOf(),
        bakeId: bakeIdOf(),
        baselineFrom: base.file,
        ...(Object.keys(drift).length > 0 ? { drift: { reason: `${base.file} was measured on its own run; the rows in measured are this checkout's render objects, none of them this milestone's (perLayer)`, measured: drift } } : {}),
        tiers,
        ...(old?.xr ? { xr: old.xr } : {}),
      };
      mkdirSync(dirname(LEDGER), { recursive: true });
      writeFileSync(LEDGER, `${JSON.stringify(out, null, 2)}\n`);
    }
    expect(existsSync(LEDGER), `${LEDGER} is committed`).toBe(true);
    const ledger = read<Ledger>(LEDGER);
    expect(ledger.bakeId).toMatch(/^[0-9a-f]{64}$/);
    expect(ledger.baselineFrom, 'the ledger names the latest merged one it measured from').toBe(base.file);
    for (const row of FLAT_ROWS) {
      const t = ledger.tiers[row];
      expect(t, `${row} is in the ledger`).toBeDefined();
      if (!t) continue;
      if (row !== 'legacy') expect(t.baseline, `${row} baseline is the after of ${base.file}`).toBe(base.ledger.tiers[row]?.after);
      expect(t.after, `${row}: no render object added`).toBeLessThanOrEqual(t.baseline);
      for (const [id, n] of Object.entries(t.perLayer)) expect(n, `${row} ${id}`).toBe(0);
      if (t.after !== t.baseline) expect(ledger.drift?.measured[row], `${row}: after ${t.after} is not the baseline: the ledger says why`).toBe(t.after);
    }
    expect((ledger.tiers['mobile-low']?.after ?? 0) + crowdMax('mobile-low'), 'mobile-low after + crowd max').toBeLessThanOrEqual(100);
    const vp = ledger.tiers['xr-visionpro'] as XrRow | undefined;
    expect(vp, 'xr-visionpro is in the ledger').toBeDefined();
    if (vp) {
      expect(vp.after).toBeLessThanOrEqual(vp.baseline + 1);
      expect(vp.after + crowdMax('xr-visionpro')).toBeLessThanOrEqual(VISIONPRO_PER_PASS_MAX);
      expect(vp.viewPasses).toBe(2);
    }
    const xr = ledger.xr;
    // a first write has no Quest row yet: the `@xr` case of the `xr-quest3` project adds it to the file this case wrote
    if (write && !xr) {
      console.log(`xr look ledger: ${LEDGER} written without its Quest row; run the @xr case with DV_LOOK_WRITE=1 next`);
      return;
    }
    expect(xr, 'the Quest row is in the ledger (written by the @xr case)').toBeDefined();
    if (xr) {
      expect(xr.baseline, `the Quest baseline is the xr after of ${base.file}`).toBe(base.ledger.xr?.after);
      expect(xr.after).toBeLessThanOrEqual(xr.baseline + 1);
      expect(typeof xr.xrMultiview).toBe('boolean');
      expect([1, 2]).toContain(xr.viewPassesObserved);
      expect(xr.after + crowdMax('xr-quest'), 'the Quest frame with its crowd, per view pass').toBeLessThanOrEqual(QUEST_PER_PASS_MAX);
      // the doubled rule holds on a multiview target; without one (the IWER emulation) the row says so (BD-M02h8-03)
      if (xr.viewPassesObserved === 1) expect(xr.total).toBeLessThanOrEqual(QUEST_PER_PASS_MAX);
      else expect(xr.note, 'a Quest row counted without multiview says why its doubled total is not the device figure').toBeDefined();
      expect(xr.triangles ?? 0).toBeLessThanOrEqual(QUEST_TRIANGLES_MAX);
    }
  });
});

test.describe('xr look ledger on the Quest tier @xr @look-xr-ledger', () => {
  test('the Quest tier: at most one render object over the latest merged ledger, within 150 per view pass and 750,000 triangles @xr @look-xr-ledger', async ({ page }) => {
    test.setTimeout(900_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const tier: XrTier = 'xr-quest';
    // the protocol of the XR rows of the earlier ledgers: 256 x 144, the player's body drawn, traffic resident, the frame of the plan (DL-758)
    await bootXr(page, tier, '', { width: 256, height: 144 });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __dvBridge: { engine: { observe(): { bodies?: { player?: { drawn?: string } | null } | null } } } }).__dvBridge.engine.observe().bodies?.player?.drawn ?? 'none'), { timeout: 300_000, intervals: [500, 1000, 2000] })
      .toBe('body');
    await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
    await streamAtPlan(page);
    await world(page, (w) => w.hold(true));
    const c = await xrLayerCounts(page);
    await world(page, (w) => w.hold(false));
    // the view passes of an immersive session on this run
    await enterVr(page);
    const look = await lookOf(page);
    await page.evaluate(() => (window as unknown as { __dvBridge: { engine: { endXr(): Promise<void> } } }).__dvBridge.engine.endXr());
    const passes = look.viewPassesObserved ?? 1;
    const priorXr = prior().ledger.xr?.after;
    const total = c.on * passes;
    console.log(`xr look ledger xr-quest: ${c.on} render objects per view pass (baseline ${String(priorXr)}; ${c.off} with its layers off; per layer ${JSON.stringify(c.perLayer)}); xrMultiview ${String(look.xrMultiview)}, viewPassesObserved ${passes}, total ${total}; ${c.triangles} triangles; crowd max ${crowdMax(tier)}`);
    expect(typeof look.xrMultiview).toBe('boolean');
    expect(priorXr, `${prior().file} holds the Quest row`).toBeDefined();
    expect(c.off, 'the layers-off frame is the frame of the latest merged ledger').toBeLessThanOrEqual(priorXr ?? 0);
    expect(c.on, `after against the baseline ${String(priorXr)} + 1`).toBeLessThanOrEqual((priorXr ?? 0) + 1);
    expect(c.perLayer['blob'], 'the blob mesh is the one object').toBeLessThanOrEqual(1);
    for (const id of XR_LAYERS) if (id !== 'blob') expect(c.perLayer[id], `${id} adds no render object`).toBe(0);
    expect(c.triangles, 'triangles per view pass').toBeLessThanOrEqual(QUEST_TRIANGLES_MAX);
    // per view pass, with the crowd the ledger frame hides
    expect(c.on + crowdMax(tier), `${c.on} + crowd max ${crowdMax(tier)} per view pass`).toBeLessThanOrEqual(QUEST_PER_PASS_MAX);
    // `after x viewPassesObserved` holds on a multiview target (the Quest path, one pass). The IWER session does not take three's layers path, so
    // three draws each eye (`xrMultiview` false, two passes): there the per-pass rule above stands and the device run carries the doubled
    // rule (M02h8 Risks, BD-M02h8-03).
    if (passes === 1) expect(total, 'after x viewPassesObserved').toBeLessThanOrEqual(QUEST_PER_PASS_MAX);
    if (write && existsSync(LEDGER)) {
      const l = read<Ledger>(LEDGER);
      l.xr = {
        baseline: priorXr ?? c.off, after: c.on, perLayer: c.perLayer, triangles: c.triangles, xrMultiview: look.xrMultiview ?? null, viewPassesObserved: passes,
        viewPasses: BUDGETS.tiers[tier]?.render.viewPasses ?? 1, perPassMax: QUEST_PER_PASS_MAX, total,
        ...(passes !== 1 ? { note: 'the IWER session of the run does not take the layers path of three, so each eye is rendered (no multiview, two passes): after is the per-pass count; the doubled total is the emulation\'s, the device figure is the Quest 3 run (AC-11)' } : {}),
      };
      writeFileSync(LEDGER, `${JSON.stringify(l, null, 2)}\n`);
    }
    expect(errors).toEqual([]);
  });
});
