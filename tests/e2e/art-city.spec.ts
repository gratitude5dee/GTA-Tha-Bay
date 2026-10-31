import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { QualityTierId } from '../../packages/shared/src/index.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { crowdMax, streamAtPlan } from './ledger-helpers.ts';

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
  await page.waitForFunction((t) => (window as unknown as W).__dvBridge.world.chunks().frame >= t, f0 + n, { timeout: 900_000, polling: 250 });
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
      // A shot with the traffic drawn costs minutes per frame on the desktop tiers in software GL: only the cheap tier takes one.
      if (tier === 'mobile-low') await world(page, (w) => w.shot('noon-street'));
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
      await artSettled(page);
      await frames(page, 3);
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

  test('a spawned car and a spawned prop draw their final models through the object pool @art-city', async ({ page }) => {
    type E = { __dvBridge: { engine: { spawn(prefab: string, at: [number, number, number], yaw?: number): Promise<unknown>; observe(): { player: { pos: [number, number, number] } | null } } } };
    await bootWorld(page, 'mobile-low');
    const me = await page.evaluate(() => (window as unknown as E).__dvBridge.engine.observe().player?.pos ?? null);
    expect(me, 'the player is in the world').not.toBeNull();
    const at = me as [number, number, number];
    await page.evaluate(([x, y, z]) => (window as unknown as E).__dvBridge.engine.spawn('vehicle.sedan', [x as number + 5, y as number + 1.5, z as number], 0), at);
    await page.evaluate(([x, y, z]) => (window as unknown as E).__dvBridge.engine.spawn('prop.cone', [x as number - 5, y as number + 1, z as number], 0), at);
    await page.waitForFunction(
      () => {
        const a = (window as unknown as W).__dvBridge.world.art();
        return !!a && a.pool.loaded.includes('vehicle/traffic.sedan') && a.pool.loaded.includes('prop/cone') && a.pool.pending.length === 0;
      },
      undefined,
      { timeout: 300_000, polling: 500 },
    );
    const a = await world(page, (w) => w.art());
    expect(a?.pool.failed).toEqual([]);
    expect(a?.pool.variant).toBe('mobile-low');
    expect(a?.renderKeys.filter((k) => OWNED_GRAYBOX.test(k))).toEqual([]);
    expect(a?.renderKeys).toEqual(expect.arrayContaining(['vehicle/traffic.sedan', 'prop/cone']));
  });

  test('a ?art=0 boot keeps the gray-box stand-ins: one legacy family and no model request @art-city', async ({ page }) => {
    const requested = new Set<string>();
    page.on('request', (r) => {
      if (/\/assets\/(?:vehicle|prop)\//.test(new URL(r.url()).pathname)) requested.add(r.url());
    });
    await bootWorld(page, 'mobile-low', '&art=0');
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

/**
 * One boot, measured with the art on: the frame's render objects and triangles, and the traffic's own share of them. The baseline is what
 * the same frame costs with the gray-box traffic, which was one instanced mesh (one render object, plus one per shadow pass when it casts)
 * wherever a car is drawn: the frame minus the traffic's meshes (each with its casters) plus that one. Everything else in the frame is the
 * same by construction (the sim is held), so the delta does not move with the traffic of another boot.
 */
async function measure(page: Page, tier: QualityTierId): Promise<{
  after: number; baseline: number; trianglesAfter: number; trianglesBaseline: number;
  traffic: { triangles: number; instances: number; cap: number; drawn: number; casters: number; passes: number };
}> {
  await bootWorld(page, tier, '', TINY);
  await setSky(page, 13, 'clear');
  if (tier === 'mobile-low') await world(page, (w) => w.shot('fog-west'));
  await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
  await artSettled(page);
  // the frame of the whole plan, six frames after it (DL-758)
  await streamAtPlan(page);
  await world(page, (w) => w.hold(true));
  const l = await live(page);
  const t = await world(page, (w) => w.traffic());
  const passes = (await world(page, (w) => w.look()))?.shadowPasses ?? 0;
  await world(page, (w) => w.hold(false));
  const drawn = t?.drawn ?? 0, casters = t?.casters ?? 0, instances = t?.instances ?? 0;
  const mine = drawn + casters * passes;
  const old = instances > 0 ? 1 + (casters > 0 ? passes : 0) : 0;
  const trisNow = t?.triangles ?? 0;
  // the gray-box car was 22 triangles (a body box, a cabin box and a skirt): 12 + 12 + 12 = 36
  const trisOld = instances * 36;
  return {
    after: l.renderObjects, baseline: l.renderObjects - mine + old, trianglesAfter: l.triangles, trianglesBaseline: l.triangles - trisNow + trisOld,
    traffic: { triangles: trisNow, instances, cap: t?.cap ?? 0, drawn, casters, passes },
  };
}

test.describe('art ledger @art-ledger', () => {
  test.describe.configure({ timeout: 1_800_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the ledger is chromium-webgl2 only');
  });
  const measured: Record<string, TierRow> = {};

  for (const tier of ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'] as const) {
    test(`${tier}: the art adds objects and triangles inside the table @art-ledger`, async ({ page }) => {
      const m = await measure(page, tier);
      const after = m;
      const row: TierRow = {
        baseline: m.baseline,
        after: m.after,
        perLayer: { art: m.after - m.baseline },
        triangles: { baseline: m.trianglesBaseline, after: m.trianglesAfter, traffic: m.traffic.triangles, instances: m.traffic.instances },
      };
      measured[tier] = row;
      console.log(`art ledger ${tier}: ${JSON.stringify(row)} (crowd max ${crowdMax(tier)})`);
      const bound = TABLE[tier] as NonNullable<(typeof TABLE)[string]>;
      expect(row.perLayer.art, `${tier}: render objects added by the art`).toBeLessThanOrEqual(bound.objects);
      expect(row.perLayer.art, `${tier}: the art cannot take objects away`).toBeGreaterThanOrEqual(0);
      expect(after.traffic.triangles, `${tier}: traffic triangles`).toBeLessThanOrEqual(after.traffic.cap * bound.trisPerInstance);
      // the crowd is hidden in the count and added back at its most in the ceiling (BD-FIX-LEDGER-SETTLED-01)
      if (tier === 'mobile-low') expect(row.after + crowdMax(tier), `mobile-low after ${row.after} + crowd max ${crowdMax(tier)}`).toBeLessThanOrEqual(100);
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
                reason: `${prev.file} was measured before later milestones changed the scene; the baseline here is the same frame with the gray-box traffic mesh (one render object, one more per shadow pass) in place of the art's meshes, so the art is measured against what the scene draws now`,
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
    expect((ledger.tiers['mobile-low']?.after ?? 0) + crowdMax('mobile-low'), 'mobile-low after + crowd max').toBeLessThanOrEqual(100);
    if (ledger.xr) expect(ledger.xr.after).toBe(ledger.xr.baseline);
  });
});

test.describe('xr art ledger @xr @art-ledger', () => {
  test('the Quest tier adds no render object over the gray-box baseline @xr @art-ledger', async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize(TINY);
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1');
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
    await artSettled(page);
    await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
    // the frame of the whole plan, six frames after it (DL-758)
    await streamAtPlan(page);
    await world(page, (w) => w.hold(true));
    const after = (await live(page)).renderObjects;
    const t = await world(page, (w) => w.traffic());
    const passes = (await world(page, (w) => w.look()))?.shadowPasses ?? 0;
    await world(page, (w) => w.hold(false));
    // the same arithmetic as the flat tiers: the frame minus the traffic's meshes (with their casters) plus the one gray-box mesh
    const mine = (t?.drawn ?? 0) + (t?.casters ?? 0) * passes;
    const old = (t?.instances ?? 0) > 0 ? 1 + ((t?.casters ?? 0) > 0 ? passes : 0) : 0;
    const baseline = after - mine + old;
    expect(t?.families, 'one family on legacy').toBe(1);
    expect(after, 'xr after = baseline').toBe(baseline);
    if (write) {
      const prev = existsSync(LEDGER) ? read<Ledger>(LEDGER) : { commit: commitOf(), bakeId: bakeIdOf(), baselineFrom: previousLedger()?.file ?? 'none', tiers: {} };
      writeFileSync(LEDGER, `${JSON.stringify({ ...prev, xr: { baseline, after } }, null, 2)}\n`);
    }
  });
});
