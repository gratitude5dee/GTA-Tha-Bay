import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { QualityTierId } from '../../packages/shared/src/index.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';

/**
 * M10d1 vehicles and props in a real browser, on a `DV_WORLD=synth` QA build (the world half of the e2e legs).
 *
 *  - @art-city    AC-8  per flat tier (`desktop`, `mobile-low`): `world.art()` lists the final models, no gray-box ref that M10d1 owns, the
 *                 families and the material class of the profile, and every model arrived; `@xr @art-city`: the Quest tier is `legacy`
 *                 with one family
 *  - @art-ledger  AC-9  `chromium-webgl2`: the render-object and triangle ledger of `docs/look/M10d1-render-ledger.json` against the
 *                 gray-box baseline of the same state (`?art=0`), inside the table of the milestone; `@xr @art-ledger`: `legacy` adds 0
 *
 * `DV_LOOK_WRITE=1` writes the ledger.
 */
type W = { __dvBridge: { world: WorldBridge; platform: { perf: { live(): { renderObjects: number; triangles: number } } } } };

const read = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

/** A software-rendered frame costs seconds on the desktop tiers, so the shot tests boot small (the goldens of M10d0 do too). */
const TINY = { width: 256, height: 144 } as const;

async function bootWorld(page: Page, tier: QualityTierId, query = '', size: { width: number; height: number } = TINY): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/?tier=${tier}&debug=1${query}`);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 180_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 240_000 });
  await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(90_000));
}

const world = <T>(page: Page, fn: (w: WorldBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.world)`) as Promise<T>;

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
      const sky = (window as unknown as W).__dvBridge.world.sky();
      return !!sky && Math.abs(sky.hour - (h as number)) < 0.05 && sky.weather === w && sky.next === w;
    },
    [hour, weather] as const,
    { timeout: 120_000 },
  );
}

/** What the art of one tier looks like (the look profile, the traffic families, the material class). */
const EXPECTED: Record<string, { profile: string; families: number; kind: 'physical' | 'standard'; objects: number }> = {
  desktop: { profile: 'full', families: 4, kind: 'physical', objects: 8 },
  'mobile-low': { profile: 'min', families: 2, kind: 'standard', objects: 2 },
};

/** The gray-box refs the M10d1 rows own: `vehicle/graybox.*` but the race cars, `prop/graybox.*` but the capsule, the stages and the fighters. */
const OWNED_GRAYBOX = /^(vehicle\/graybox\.(?!kestrel-quill$|brackenridge-rasp$|aurelian-sorrel$|solenne-skip$|halcyon-cormorant$)|prop\/graybox\.(?!capsule$|stage-|fighter-))/;

/** Every model of the tier has arrived: the traffic families and the pool (nothing pending, nothing failed). */
const artSettled = (page: Page): Promise<unknown> =>
  page.waitForFunction(
    () => {
      const a = (window as unknown as W).__dvBridge.world.art();
      return !!a && a.loaded === a.families.length && a.pool.pending.length === 0;
    },
    undefined,
    { timeout: 300_000, polling: 500 },
  );

test.describe('art city @art-city', () => {
  test.describe.configure({ timeout: 900_000 });

  for (const tier of ['desktop', 'mobile-low'] as const) {
    test(`${tier}: the traffic draws its final models on the ${EXPECTED[tier]?.profile} profile @art-city`, async ({ page }) => {
      const want = EXPECTED[tier] as NonNullable<(typeof EXPECTED)[string]>;
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const requested = new Set<string>();
      page.on('request', (r) => {
        const m = /\/assets\/((?:vehicle|prop)\/[a-z0-9._-]+)\//.exec(new URL(r.url()).pathname);
        if (m) requested.add(m[1] as string);
      });
      await bootWorld(page, tier);
      await world(page, (w) => w.shot('noon-street'));
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
      await artSettled(page);
      await frames(page, 6);
      const a = await world(page, (w) => w.art());
      expect(a, 'world.art()').toBeTruthy();
      if (!a) return;
      expect(a.profile).toBe(want.profile);
      expect(a.families).toHaveLength(want.families);
      expect(a.materialKind, 'physical paint only on the full profile').toBe(want.kind);
      expect(a.objects).toBe(want.objects);
      expect(a.loaded).toBe(want.families);
      expect(a.pool.failed).toEqual([]);
      expect(a.refs.every((r) => /^vehicle\//.test(r))).toBe(true);
      expect(a.refs.some((r) => r.includes('graybox'))).toBe(false);
      expect(a.renderKeys.filter((k) => OWNED_GRAYBOX.test(k)), 'no gray-box ref of an M10d1 row in the snapshot').toEqual([]);
      // the families' base models were requested through the pack store, at the variant of the profile
      for (const r of a.refs) expect([...requested], `${r} was requested`).toContain(r);
      expect(errors).toEqual([]);
      const t = await world(page, (w) => w.traffic());
      expect(t?.families).toBe(want.families);
      expect(t?.loaded).toBe(want.families);
      expect(t?.triangles ?? 0).toBeGreaterThan(0);
    });
  }

  test('a ?art=0 boot keeps the gray-box stand-ins: one legacy family and no model request @art-city', async ({ page }) => {
    const requested = new Set<string>();
    page.on('request', (r) => {
      if (/\/assets\/(?:vehicle|prop)\//.test(new URL(r.url()).pathname)) requested.add(r.url());
    });
    await bootWorld(page, 'desktop', '&art=0');
    await world(page, (w) => w.shot('noon-street'));
    await frames(page, 30);
    const a = await world(page, (w) => w.art());
    expect(a).toMatchObject({ profile: 'legacy', loaded: 0, materialKind: 'standard' });
    expect(a?.families).toHaveLength(1);
    expect([...requested]).toEqual([]);
  });
});

test.describe('xr art @xr @art-city', () => {
  test('the Quest tier is legacy with one family and standard paint @xr @art-city', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize(TINY);
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1');
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
    await artSettled(page);
    const a = await world(page, (w) => w.art());
    expect(a).toMatchObject({ profile: 'legacy', materialKind: 'standard', objects: 1 });
    expect(a?.families).toHaveLength(1);
    expect(a?.renderKeys.filter((k) => OWNED_GRAYBOX.test(k))).toEqual([]);
  });
});

// ---- the render-object ledger -----------------------------------------------------------------------------------------------

const LEDGER = 'docs/look/M10d1-render-ledger.json';
/** Objects the art may add per tier (the table of the milestone: `full` 14 + 9 casters, `lite` 4, `min` 2) and the triangles per instance. */
const TABLE: Record<string, { objects: number; trisPerInstance: number }> = {
  'desktop-ultra': { objects: 23, trisPerInstance: 3000 },
  desktop: { objects: 23, trisPerInstance: 3000 },
  mobile: { objects: 4, trisPerInstance: 800 },
  'mobile-low': { objects: 2, trisPerInstance: 800 },
};
interface TierRow {
  baseline: number;
  after: number;
  perLayer: { art: number };
  triangles: { baseline: number; after: number; traffic: number; instances: number };
}
interface Ledger {
  commit: string;
  bakeId: string;
  baselineFrom: string;
  /** Present when a tier's gray-box baseline measured here is not the `after` of `baselineFrom`: that ledger predates changes merged since. */
  drift?: { reason: string; previousAfter: Record<string, number> };
  tiers: Record<string, TierRow>;
  xr?: { baseline: number; after: number };
}
const write = process.env['DV_LOOK_WRITE'] === '1';
const commitOf = (): string => process.env['GITHUB_SHA'] ?? process.env['DV_COMMIT'] ?? 'local';
const bakeIdOf = (): string => read<{ bakeId: string }>('dist/world/latest-synth.json').bakeId;
const live = (page: Page): Promise<{ renderObjects: number; triangles: number }> => page.evaluate(() => (window as unknown as W).__dvBridge.platform.perf.live());

/** The `after` of the ledger of `docs/look` most recently merged: the baseline this row measures from (newest first, M10d1's own excluded). */
function previousLedger(): { file: string; after: Record<string, number> } | null {
  const candidates = [
    'docs/look/M02h8-render-ledger.json', 'docs/look/M02h7-render-ledger.json', 'docs/look/M02h6-render-ledger.json', 'docs/look/M02h5-render-ledger.json',
    'docs/look/M02h4-render-ledger.json', 'docs/look/M02h3-render-ledger.json', 'docs/look/M02h2-render-ledger.json', 'docs/look/M02h1-render-ledger.json',
    'docs/look/M10d0-render-ledger.json', 'docs/look/M02g2-render-ledger.json', 'docs/look/M02g1-render-ledger.json',
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const l = read<{ tiers: Record<string, { after: number }> }>(file);
    return { file, after: Object.fromEntries(Object.entries(l.tiers).map(([k, v]) => [k, v.after])) };
  }
  return null;
}

/** The state both measurements share (M02g1's): 480 x 270, 13:00 clear, the street shot, traffic resident, the sim held. */
async function measure(page: Page, tier: QualityTierId, art: boolean): Promise<{ objects: number; triangles: number; traffic: { triangles: number; instances: number; cap: number } }> {
  await bootWorld(page, tier, art ? '' : '&art=0', TINY);
  await setSky(page, 13, 'clear');
  await world(page, (w) => w.shot(tier === 'mobile-low' ? 'fog-west' : 'noon-street'));
  await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
  if (art) await artSettled(page);
  await frames(page, 6);
  await world(page, (w) => w.hold(true));
  await frames(page, 2);
  const l = await live(page);
  const t = await world(page, (w) => w.traffic());
  await world(page, (w) => w.hold(false));
  return { objects: l.renderObjects, triangles: l.triangles, traffic: { triangles: t?.triangles ?? 0, instances: t?.instances ?? 0, cap: t?.cap ?? 0 } };
}

test.describe('art ledger @art-ledger', () => {
  test.describe.configure({ timeout: 1_800_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the ledger is chromium-webgl2 only');
  });
  const measured: Record<string, TierRow> = {};

  for (const tier of ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'] as const) {
    test(`${tier}: the art adds objects and triangles inside the table @art-ledger`, async ({ page }) => {
      const base = await measure(page, tier, false);
      const after = await measure(page, tier, true);
      const row: TierRow = {
        baseline: base.objects,
        after: after.objects,
        perLayer: { art: after.objects - base.objects },
        triangles: { baseline: base.triangles, after: after.triangles, traffic: after.traffic.triangles, instances: after.traffic.instances },
      };
      measured[tier] = row;
      console.log(`art ledger ${tier}: ${JSON.stringify(row)}`);
      const bound = TABLE[tier] as NonNullable<(typeof TABLE)[string]>;
      expect(row.perLayer.art, `${tier}: render objects added by the art`).toBeLessThanOrEqual(bound.objects);
      expect(row.perLayer.art, `${tier}: the art cannot take objects away`).toBeGreaterThanOrEqual(0);
      expect(after.traffic.triangles, `${tier}: traffic triangles`).toBeLessThanOrEqual(after.traffic.cap * bound.trisPerInstance);
      if (tier === 'mobile-low') expect(row.after).toBeLessThanOrEqual(100);
    });
  }

  test('writes (DV_LOOK_WRITE=1) or checks the committed ledger @art-ledger', () => {
    if (write) {
      const prev = previousLedger();
      const out: Ledger = {
        commit: commitOf(),
        bakeId: bakeIdOf(),
        baselineFrom: prev?.file ?? 'none',
        ...(prev && Object.entries(measured).some(([k, v]) => prev.after[k] !== undefined && prev.after[k] !== v.baseline)
          ? {
              drift: {
                reason: `${prev.file} was measured before later milestones changed the scene; the gray-box baseline here is the same state measured with \`?art=0\` on this checkout, so the art is measured against what the scene draws now`,
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
      const bound = TABLE[tier] as NonNullable<(typeof TABLE)[string]>;
      expect(t.after - t.baseline, `${tier} object delta`).toBe(t.perLayer.art);
      expect(t.perLayer.art, `${tier} objects added`).toBeLessThanOrEqual(bound.objects);
      expect(t.triangles.traffic, `${tier} traffic triangles at ${t.triangles.instances} instances`).toBeLessThanOrEqual(Math.max(t.triangles.instances, 1) * bound.trisPerInstance);
      const base = prev?.after[tier];
      if (base !== undefined && t.baseline !== base) expect(ledger.drift?.previousAfter[tier], `${tier} baseline ${t.baseline} is not the after ${base} of ${prev?.file}: the ledger says why`).toBe(base);
    }
    expect(ledger.tiers['mobile-low']?.after ?? 0).toBeLessThanOrEqual(100);
    if (ledger.xr) expect(ledger.xr.after).toBe(ledger.xr.baseline);
  });
});

test.describe('xr art ledger @xr @art-ledger', () => {
  test('the Quest tier adds no render object over the gray-box baseline @xr @art-ledger', async ({ page }) => {
    test.setTimeout(600_000);
    const counts: number[] = [];
    for (const q of ['', '&art=0']) {
      await page.setViewportSize(TINY);
      await page.goto(`/?tier=xr-quest&xr-emulate=quest3&debug=1${q}`);
      await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
      if (q === '') await artSettled(page);
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
      await frames(page, 6);
      await world(page, (w) => w.hold(true));
      await frames(page, 2);
      counts.push((await live(page)).renderObjects);
      await world(page, (w) => w.hold(false));
    }
    const [after, baseline] = counts as [number, number];
    expect(after, 'xr after = baseline').toBe(baseline);
    if (write) {
      const prev = existsSync(LEDGER) ? read<Ledger>(LEDGER) : { commit: commitOf(), bakeId: bakeIdOf(), baselineFrom: previousLedger()?.file ?? 'none', tiers: {} };
      writeFileSync(LEDGER, `${JSON.stringify({ ...prev, xr: { baseline, after } }, null, 2)}\n`);
    }
  });
});
