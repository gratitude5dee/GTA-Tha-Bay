import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { SMALL_VIEWPORT } from './engine-helpers.ts';
import { streamAtPlan } from './ledger-helpers.ts';
import { bakeIdOf, bootWorld, frames, GOLDEN_VIEWPORT, read, texturesSettled, world, type W } from './art-textures-helpers.ts';

/**
 * M10d0 surface textures in a real browser, on a `DV_WORLD=synth` QA build (the world half of the e2e legs).
 *
 *  - @art-textures    AC-6   per flat tier: `look().textures` reports `stochastic`, `single` and `albedo` with the bound sets and its byte
 *                     figures inside the tier's budget; only those refs are requested; `setLookLayer('textures', false)` and a
 *                     `?textures=0` boot (the QA form of `world.textures: false`) report `off`, the second with no `texture/` request
 *  - @textures-golden AC-7   in `pavement-textures-golden.spec.ts` (BD-FIX-CI-TEXGOLD-01, renamed by BD-FIX-CI-REBAL-01)
 *  - @textures-ledger AC-8   `chromium-webgl2`: the render-object ledger of `docs/look/M10d0-render-ledger.json` (the textures add no render
 *                     object); the XR leg `@xr @textures-ledger` has no texture request and the baseline objects
 *  - @credits-art     AC-9   `/menu/credits` shows the Art section: a courtesy line per CC0 pack and the five fields of a CC-BY entry
 *
 * `DV_UPDATE_GOLDEN=1` (outside CI, under the golden-update label) writes the goldens, `DV_LOOK_WRITE=1` the ledger.
 */
type FlatTier = 'desktop' | 'mobile' | 'mobile-low';
const FLAT_TIERS: readonly FlatTier[] = ['desktop', 'mobile', 'mobile-low'];
const MODE_OF: Record<FlatTier, string> = { desktop: 'stochastic', mobile: 'single', 'mobile-low': 'albedo' };
const MIB = 1024 * 1024;

interface Cfg {
  sets: Record<string, unknown>;
  bindings: Record<string, string>;
  budgets: Record<string, { downloadMB: number; gpuMB: number }>;
  unsupported: string[];
}
const CFG = read<Cfg>('config/world/surface-textures.json');
const BOUND = Object.keys(CFG.sets).filter((s) => Object.values(CFG.bindings).includes(s));

const refsFor = (mode: string): string[] => {
  const maps = mode === 'albedo' ? ['albedo'] : ['albedo', 'normal', 'orm'];
  return BOUND.flatMap((s) => maps.map((m) => `texture/pbr.${s}.${m}`)).sort();
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
      const sky = (window as unknown as W).__dvBridge.world.sky();
      return !!sky && Math.abs(sky.hour - (h as number)) < 0.05 && sky.weather === w && sky.next === w;
    },
    [hour, weather] as const,
    { timeout: 120_000 },
  );
}


/** Texture asset ids (`texture/pbr.<set>.<map>`) of the requests a page makes. */
function watchTextureRequests(page: Page): Set<string> {
  const seen = new Set<string>();
  page.on('request', (r) => {
    const m = /\/assets\/(texture\/pbr\.[a-z0-9-]+\.[a-z]+)\//.exec(new URL(r.url()).pathname);
    if (m) seen.add(m[1] as string);
  });
  return seen;
}

test.describe('surface textures @art-textures', () => {
  test.describe.configure({ timeout: 900_000 });

  for (const tier of FLAT_TIERS) {
    test(`${tier}: the bound sets load as ${MODE_OF[tier]} within the budget, only their refs are requested @art-textures`, async ({ page }, testInfo: TestInfo) => {
      const requested = watchTextureRequests(page);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await bootWorld(page, tier);
      await texturesSettled(page);
      const look = await world(page, (w) => w.look());
      const t = look?.textures;
      expect(t, 'look().textures').toBeTruthy();
      if (!t) return;
      const budget = CFG.budgets[tier] as { downloadMB: number; gpuMB: number };
      const unsupported = CFG.unsupported.includes(look?.backend ?? '') || CFG.unsupported.includes(`${testInfo.project.name.split('-')[0]}-${look?.backend}`);
      if (unsupported) {
        expect(t).toMatchObject({ mode: 'off', refs: [], sets: [], unsupported: true });
        expect([...requested]).toEqual([]);
        return;
      }
      const refs = refsFor(MODE_OF[tier]);
      expect(t.mode).toBe(MODE_OF[tier]);
      expect([...t.refs].sort()).toEqual(refs);
      expect(t.failed).toEqual([]);
      expect([...t.sets].sort()).toEqual([...BOUND].sort());
      expect(t.format, 'the GPU format the maps were transcoded to').toMatch(/^(BC7|ASTC4x4|ETC2|RGBA8|DXT5|DXT1|ETC1|PVRTC)$/);
      expect(t.gpuBytes).toBeGreaterThan(0);
      expect(t.gpuBytes).toBeLessThanOrEqual(budget.gpuMB * MIB);
      expect(t.downloadBytes).toBeGreaterThan(0);
      expect(t.downloadBytes).toBeLessThanOrEqual(budget.downloadMB * MIB);
      // Only the bound refs are requested (a second boot of the same context would read the pack store's copy, so this one is a cold context).
      expect([...requested].sort()).toEqual(refs);
      expect(errors).toEqual([]);

      // The QA layer switch: off reads the procedural look, on brings the sets back.
      expect(await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('textures', false))).toBe(true);
      expect((await world(page, (w) => w.look()))?.textures).toMatchObject({ mode: 'off', on: false, configured: MODE_OF[tier] });
      expect(await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('textures', true))).toBe(true);
      expect((await world(page, (w) => w.look()))?.textures).toMatchObject({ mode: MODE_OF[tier], on: true });
    });
  }

  test('a ?textures=0 boot reports off and makes no texture request @art-textures', async ({ page }) => {
    const requested = watchTextureRequests(page);
    await bootWorld(page, 'desktop', '&textures=0');
    await texturesSettled(page);
    const t = (await world(page, (w) => w.look()))?.textures;
    expect(t).toMatchObject({ mode: 'off', refs: [], sets: [], gpuBytes: 0, downloadBytes: 0 });
    await frames(page, 30);
    expect([...requested]).toEqual([]);
  });

  test('@world-look still passes with the textures on: the look profile and its nodes are unchanged @art-textures', async ({ page }) => {
    await bootWorld(page, 'desktop');
    await texturesSettled(page);
    const look = await world(page, (w) => w.look());
    expect(look).toMatchObject({ profile: 'full', on: true });
    expect(look?.postNodes.length).toBeGreaterThan(0);
  });
});

// ---- the render-object ledger -----------------------------------------------------------------------------------------------

const LEDGER = 'docs/look/M10d0-render-ledger.json';
interface TierRow { baseline: number; after: number; perLayer: { textures: number }; textureMB: number }
interface Ledger {
  commit: string;
  bakeId: string;
  baselineFrom: string;
  /** Present when a tier's baseline is not the `after` of `baselineFrom`: that ledger predates changes merged since (BD-M10d0-10). */
  drift?: { reason: string; previousAfter: Record<string, number> };
  tiers: Record<string, TierRow>;
  xr?: { baseline: number; after: number };
}
const write = process.env['DV_LOOK_WRITE'] === '1';
const commitOf = (): string => process.env['GITHUB_SHA'] ?? process.env['DV_COMMIT'] ?? 'local';
const live = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as W).__dvBridge.platform.perf.live().renderObjects);

/** The `after` of the newest ledger of `docs/look` that is not this milestone's: the baseline this row measures from. */
function previousLedger(): { file: string; after: Record<string, number> } | null {
  const candidates = ['docs/look/M02h8-render-ledger.json', 'docs/look/M02h7-render-ledger.json', 'docs/look/M02h6-render-ledger.json', 'docs/look/M02h5-render-ledger.json', 'docs/look/M02h4-render-ledger.json', 'docs/look/M02h3-render-ledger.json', 'docs/look/M02h2-render-ledger.json', 'docs/look/M02h1-render-ledger.json', 'docs/look/M02g2-render-ledger.json', 'docs/look/M02g1-render-ledger.json'];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const l = read<{ tiers: Record<string, { after: number }> }>(file);
    return { file, after: Object.fromEntries(Object.entries(l.tiers).map(([k, v]) => [k, v.after])) };
  }
  return null;
}

test.describe('textures ledger @textures-ledger', () => {
  test.describe.configure({ timeout: 1_800_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the ledger is chromium-webgl2 only');
  });
  const measured: Record<string, TierRow> = {};

  for (const tier of ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'] as const) {
    test(`${tier}: the textures add no render object @textures-ledger`, async ({ page }) => {
      // The same state as the ledger it measures from (M02g1): 480 x 270, 13:00 clear, traffic resident, `fog-west` at `mobile-low`.
      // `&art=0` (DL-758): this row is M10d0's own scene, so the art of the later M10d1 row stays out of the frame (BD-REPAIR-M10d1-01)
      await bootWorld(page, tier, '&art=0', SMALL_VIEWPORT);
      await texturesSettled(page);
      await setSky(page, 13, 'clear');
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
      if (tier === 'mobile-low') await world(page, (w) => w.shot('fog-west'));
      // the frame of the whole plan, six frames after it (DL-758)
      await streamAtPlan(page);
      await world(page, (w) => w.hold(true));
      const set = (on: boolean): Promise<boolean> => page.evaluate((o) => (window as unknown as W).__dvBridge.world.setLookLayer('textures', o as boolean), on);
      expect(await set(false)).toBe(true);
      const baseline = await live(page);
      expect(await set(true)).toBe(true);
      const after = await live(page);
      await world(page, (w) => w.hold(false));
      const t = (await world(page, (w) => w.look()))?.textures;
      expect(after - baseline, `${tier}: render objects added by the textures`).toBe(0);
      measured[tier] = { baseline, after, perLayer: { textures: after - baseline }, textureMB: Math.round(((t?.gpuBytes ?? 0) / MIB) * 100) / 100 };
      console.log(`textures ledger ${tier}: ${JSON.stringify(measured[tier])}`);
    });
  }

  test('writes (DV_LOOK_WRITE=1) or checks the committed ledger @textures-ledger', () => {
    if (write) {
      const prev = previousLedger();
      const out: Ledger = {
        commit: commitOf(),
        bakeId: bakeIdOf(),
        baselineFrom: prev?.file ?? 'none',
        ...(prev && Object.entries(measured).some(([k, v]) => prev.after[k] !== undefined && prev.after[k] !== v.baseline)
          ? {
              drift: {
                reason: `${prev.file} was measured before later milestones changed the scene; \`pnpm check:e2e -- --project=chromium-webgl2 --grep @look-ledger\` on this checkout reads the same textures-off counts, so the textures are measured against what the scene draws now`,
                previousAfter: prev.after,
              },
            }
          : {}),
        tiers: measured,
        ...(existsSync(LEDGER) && read<Ledger>(LEDGER).xr ? { xr: (read<Ledger>(LEDGER) as Ledger).xr as { baseline: number; after: number } } : {}),
      };
      mkdirSync(dirname(LEDGER), { recursive: true });
      writeFileSync(LEDGER, `${JSON.stringify(out, null, 2)}\n`);
    }
    expect(existsSync(LEDGER), `${LEDGER} is committed`).toBe(true);
    const ledger = read<Ledger>(LEDGER);
    expect(ledger.bakeId).toMatch(/^[0-9a-f]{64}$/);
    const prev = previousLedger();
    expect(ledger.baselineFrom, 'the ledger names the latest merged one it measured from').toBe(prev?.file ?? 'none');
    for (const tier of ['desktop-ultra', 'desktop', 'mobile', 'mobile-low']) {
      const t = ledger.tiers[tier];
      expect(t, `${tier} is in the ledger`).toBeDefined();
      if (!t) continue;
      expect(t.after - t.baseline, `${tier} object delta`).toBe(0);
      expect(t.perLayer.textures).toBe(0);
      const base = prev?.after[tier];
      if (base !== undefined && t.baseline !== base) expect(ledger.drift?.previousAfter[tier], `${tier} baseline ${t.baseline} is not the after ${base} of ${prev?.file}: the ledger says why`).toBe(base);
    }
    expect(ledger.tiers['mobile-low']?.after ?? 0).toBeLessThanOrEqual(100);
    if (ledger.xr) expect(ledger.xr.after).toBe(ledger.xr.baseline);
  });
});

test.describe('xr textures @xr @textures-ledger', () => {
  test('the Quest tier requests no texture and keeps its baseline objects @xr @textures-ledger', async ({ page }) => {
    test.setTimeout(240_000);
    const requested = watchTextureRequests(page);
    await page.setViewportSize(GOLDEN_VIEWPORT);
    // `&art=0` (DL-758): the XR row of M10d0's ledger is M10d0's own scene, so the art of the later M10d1 row stays out of the frame
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1&art=0');
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
    await texturesSettled(page);
    expect((await world(page, (w) => w.look()))?.textures).toMatchObject({ mode: 'off', refs: [], sets: [], gpuBytes: 0, downloadBytes: 0 });
    expect(await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('textures', true))).toBe(false);
    // the frame of the whole plan, six frames after it (DL-758)
    await streamAtPlan(page);
    await world(page, (w) => w.hold(true));
    const baseline = await live(page);
    await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('textures', true));
    const after = await live(page);
    await world(page, (w) => w.hold(false));
    expect(after, 'xr after = baseline').toBe(baseline);
    expect([...requested]).toEqual([]);
    if (write) {
      const prev = existsSync(LEDGER) ? read<Ledger>(LEDGER) : { commit: commitOf(), bakeId: bakeIdOf(), baselineFrom: previousLedger()?.file ?? 'none', tiers: {} };
      writeFileSync(LEDGER, `${JSON.stringify({ ...prev, xr: { baseline, after } }, null, 2)}\n`);
    }
  });
});

// ---- credits ------------------------------------------------------------------------------------------------------------------

test.describe('credits art @credits-art', () => {
  test('/menu/credits shows the courtesy lines and the five fields of a CC-BY fixture, with licence links that open @credits-art', async ({ page, context }) => {
    const fixture = {
      pack: 'ccby-fixture',
      title: 'Weathered Wall',
      author: 'Jane Doe',
      sourceUrl: 'https://example.org/items/1',
      licence: 'CC-BY-4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
      changes: 'resized to 1024 px and encoded as KTX2',
    };
    // The build's own credits.json plus a CC-BY entry: no CC-BY file is in the repository yet, so the fixture is what shows the five fields.
    await page.route('**/credits.json', async (route) => {
      const res = await route.fetch();
      const doc = (await res.json()) as { art?: unknown[] };
      // Not `response: res`: it would keep the original content-encoding on a plain JSON body.
      await route.fulfill({ status: 200, contentType: 'application/json', json: { ...doc, art: [...(doc.art ?? []), fixture] } });
    });
    await context.route('https://creativecommons.org/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>licence</title>' }));
    await page.goto('/menu/credits');
    const section = page.getByTestId('credits-art');
    await expect(section).toBeVisible();
    await expect(section.getByRole('heading', { name: 'Art' })).toBeVisible();
    const built = read<{ art?: { pack: string; courtesy?: string }[] }>('apps/web/dist/credits.json');
    for (const a of (built.art ?? []).filter((x) => x.courtesy)) await expect(page.getByTestId(`credit-art-${a.pack}`)).toHaveText(a.courtesy as string);
    const row = page.getByTestId('credit-art-ccby-fixture-1');
    for (const field of [fixture.title, fixture.author, fixture.licence, fixture.changes]) await expect(row).toContainText(field);
    await expect(row.getByTestId('credit-art-source')).toHaveAttribute('href', fixture.sourceUrl);
    const licence = row.getByTestId('credit-art-licence');
    await expect(licence).toHaveAttribute('href', fixture.licenceUrl);
    // The engine canvas sits over the page, so the click is dispatched on the link itself.
    const [popup] = await Promise.all([context.waitForEvent('page'), licence.dispatchEvent('click')]);
    await popup.waitForLoadState();
    expect(popup.url()).toBe(fixture.licenceUrl);
  });
});
