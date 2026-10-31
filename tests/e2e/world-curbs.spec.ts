import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { decodePng, type Rgba } from '../support/image-diff.ts';
import { FLICKER_BASELINE_FILE, FLICKER_FLOOR, flickerShare } from '../support/flicker.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';
import { crowdMax, streamAtPlan } from './ledger-helpers.ts';
import { captureShot, readBaseline } from './look-fixes-helpers.ts';
import { FLAT_TIERS, bakeIdOf, bootWorld, clearActors, frames, live, read, setSky, world, type W } from './markings-helpers.ts';

/**
 * M02h2 curbs, gutters and sidewalks in a real browser, on a `DV_WORLD=synth` QA build.
 *
 *  - @world-curbs   AC-5  per flat tier (desktop, mobile, mobile-low; Chromium and WebKit): `look().curbs` counts ribbons and ramps at
 *                   `curb-corner`; switching the `bump` layer changes the frame (mean |delta| >= 0.01 on `full`) and is no switch at all on
 *                   `min` (the frame stays the same); the `asphalt-low` pair at `mobile-low` stays within 1.1 x the M02g2 baseline (never
 *                   under the floor the M02g2 pairs use); a pedestrian on a curbed sidewalk is drawn with its feet within 0.05 m of the ribbon
 *                   top; no page error.
 *  - @curbs-ledger  AC-7  per tier on `chromium-webgl2`, the frame of DL-758: the sidewalks add no render object (the count equals the after
 *                   of the latest merged ledger, `PRIORS`), `mobile-low` stays at or under 100 with its crowd, and the triangles the curbs add
 *                   to an L0 chunk stay at or under 20,000 (`desktop`) and 4,000 (`mobile-low`); `DV_LOOK_WRITE=1` writes
 *                   `docs/look/M02h2-render-ledger.json`. `@xr`: the Quest tier holds its count.
 */
const LEDGER = 'docs/look/M02h2-render-ledger.json';
const PRIORS = ['docs/look/M10d5-render-ledger.json', 'docs/look/M10d4-render-ledger.json', 'docs/look/M02h1-render-ledger.json', 'docs/look/M10d1-render-ledger.json', 'docs/look/M10d0-render-ledger.json'];
const LOOK = read<{ tierProfile: Record<string, string>; layers: Record<string, string[]> }>('config/world/look.json');
const PROFILE: Record<(typeof FLAT_TIERS)[number], 'full' | 'lite' | 'min'> = { desktop: 'full', mobile: 'lite', 'mobile-low': 'min' };

const canvas = async (page: Page): Promise<Rgba> => {
  await frames(page, 3);
  return decodePng(await page.locator('#dv-engine-canvas').screenshot());
};

/** Mean absolute difference of two frames over the colour channels, 0..1. */
function meanDelta(a: Rgba, b: Rgba): number {
  let sum = 0;
  const n = Math.min(a.data.length, b.data.length);
  let k = 0;
  for (let i = 0; i < n; i += 4) {
    for (let c = 0; c < 3; c++) sum += Math.abs((a.data[i + c] as number) - (b.data[i + c] as number));
    k += 3;
  }
  return k > 0 ? sum / k / 255 : 0;
}

test.describe('world curbs @world-curbs', () => {
  test.describe.configure({ timeout: 3_600_000 });

  for (const tier of FLAT_TIERS) {
    test(`${tier}: the sidewalks are counted, the bump layer switches as its profile says, the pair holds and the feet stand on the ribbon @world-curbs`, async ({ page }, testInfo: TestInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text());
      });
      await bootWorld(page, tier, '', SMALL_VIEWPORT);
      const look = await world(page, (w) => w.look());
      expect(look?.layers).toEqual(LOOK.layers[PROFILE[tier]]);
      await setSky(page, 13, 'clear');

      // the counts at curb-corner, read on a held frame
      await world(page, (w) => w.shot('curb-corner', { held: true }));
      await clearActors(page);
      await world(page, (w) => w.hold(true));
      const curbs = (await world(page, (w) => w.look()))?.curbs;
      expect(curbs?.ribbons ?? 0, `${tier}: ribbons`).toBeGreaterThan(0);
      expect(curbs?.rampCount ?? 0, `${tier}: ramps`).toBeGreaterThan(0);
      expect(curbs?.curbedM ?? 0).toBeGreaterThan(0);
      await world(page, (w) => w.hold(false));

      // the bump layer: a visible change on `full`, no layer at all on `min` (the frame is the same)
      if (testInfo.project.name !== 'chromium-webgpu') {
        await page.evaluate(() => (window as unknown as W).__dvBridge.engine.setPaused(true));
        const on = await canvas(page);
        const switched = await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('bump', false));
        const off = await canvas(page);
        await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('bump', true));
        await page.evaluate(() => (window as unknown as W).__dvBridge.engine.setPaused(false));
        const delta = meanDelta(on, off);
        console.log(`curbs ${testInfo.project.name} ${tier}: bump switch ${String(switched)}, mean |delta| ${delta.toFixed(4)}`);
        if (PROFILE[tier] === 'full') {
          expect(switched).toBe(true);
          expect(delta, `${tier}: the bump changes the curb-corner frame`).toBeGreaterThanOrEqual(0.01);
        }
        if (PROFILE[tier] === 'min') {
          expect(switched, 'mobile-low has no bump layer').toBe(false);
          expect(delta).toBe(0);
        }
      }

      // the drawn feet of the pedestrians on a curbed sidewalk: within 0.05 m of the ribbon top
      const feet = await expect
        .poll(async () => (await world(page, (w) => w.pedFeet(256))).filter((f) => f.lift > 0 && f.top !== null).length, { timeout: 300_000, intervals: [2000] })
        .toBeGreaterThan(0)
        .then(() => world(page, (w) => w.pedFeet(256)))
        .catch(() => world(page, (w) => w.pedFeet(256)));
      const onWalk = feet.filter((f) => f.lift > 0 && f.top !== null);
      console.log(`curbs ${testInfo.project.name} ${tier}: ${feet.length} feet, ${onWalk.length} on a curbed sidewalk, offsets ${onWalk.slice(0, 8).map((f) => (f.y - (f.top as number)).toFixed(3)).join(' ')}`);
      expect(onWalk.length, 'a pedestrian on a curbed sidewalk').toBeGreaterThan(0);
      const within = onWalk.filter((f) => Math.abs(f.y - (f.top as number)) <= 0.05);
      expect(within.length, `${tier}: feet within 0.05 m of the ribbon top`).toBeGreaterThan(0);

      // the asphalt-low pair at mobile-low, with the curbs and the bump on
      if (tier === 'mobile-low' && testInfo.project.name !== 'chromium-webgpu') {
        await page.setViewportSize({ width: 640, height: 360 });
        await page.evaluate(() => (window as unknown as W).__dvBridge.world.setLookLayer('markings', false));
        const a = await captureShot(page, 'asphalt-low', 'shot');
        const b = await captureShot(page, 'asphalt-low-b', 'move');
        const share = flickerShare(a, b);
        const base = readBaseline()?.baselines[testInfo.project.name]?.['asphalt-low'];
        expect(base, `${FLICKER_BASELINE_FILE} holds ${testInfo.project.name} / asphalt-low`).toBeDefined();
        console.log(`curbs ${testInfo.project.name}: asphalt-low flicker ${(share * 100).toFixed(3)} % against the M02g2 baseline ${((base ?? 0) * 100).toFixed(3)} %`);
        expect(share).toBeLessThanOrEqual(Math.max((base ?? 0) * 1.1, FLICKER_FLOOR));
      }
      expect(errors, 'no page error or console error').toEqual([]);
    });
  }
});

// ---- the ledger -------------------------------------------------------------------------------------------------------------------------

const TIERS = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'] as const;
interface TierRow {
  baseline: number;
  after: number;
  perLayer: { curbs: number };
  /** The most triangles the curbs, gutters and sidewalk ribbons add to one resident L0 chunk, and their sum over the resident chunks. */
  chunkTriangles: { maxDelta: number; sumOff: number; sumOn: number };
}
interface Ledger {
  commit: string;
  bakeId: string;
  baselineFrom: string;
  drift?: { reason: string; measuredOff: Record<string, number> };
  tiers: Record<string, TierRow>;
  xr?: { baseline: number; after: number };
}
const write = process.env['DV_LOOK_WRITE'] === '1';
const commitOf = (): string => process.env['GITHUB_SHA'] ?? process.env['DV_COMMIT'] ?? 'local';
const TRI_CAP: Record<string, number> = { 'desktop-ultra': 20_000, desktop: 20_000, mobile: 20_000, 'mobile-low': 4_000 };

function prior(): { file: string; ledger: { tiers: Record<string, { after: number }>; xr?: { after: number } } } {
  for (const file of PRIORS) if (existsSync(file)) return { file, ledger: read(file) };
  throw new Error(`no ledger before M02h2 in docs/look (${PRIORS.join(', ')})`);
}

/** The triangles of the resident L0 chunks at `tier`, curbs off and on, from the finished bake (a `tsx` process, as the M02h1 ledger does). */
function chunkTriangles(keys: readonly string[], tier: string): { maxDelta: number; sumOff: number; sumOn: number } {
  const out = execFileSync('pnpm', ['exec', 'tsx', 'tests/support/road-triangles.ts', '--curbs', `dist/world/${bakeIdOf()}/packs`, tier, ...keys], { encoding: 'utf8', maxBuffer: 1 << 24 });
  return JSON.parse(out.trim().split('\n').pop() as string) as { maxDelta: number; sumOff: number; sumOn: number };
}

test.describe('curbs ledger @curbs-ledger', () => {
  test.describe.configure({ timeout: 1_800_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the ledger is chromium-webgl2 only (the XR case runs on xr-quest3)');
  });
  const measured: Record<string, { off: number; on: number; tris: { maxDelta: number; sumOff: number; sumOn: number } }> = {};

  for (const tier of TIERS) {
    test(`${tier}: the sidewalks add no render object and stay within the triangle budget @curbs-ledger`, async ({ page }) => {
      await bootWorld(page, tier, '', SMALL_VIEWPORT);
      await setSky(page, 13, 'clear');
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
      if (tier === 'mobile-low') await world(page, (w) => w.shot('fog-west'));
      await streamAtPlan(page);
      await world(page, (w) => w.hold(true));
      const set = (on: boolean): Promise<boolean> => page.evaluate((o) => (window as unknown as W).__dvBridge.world.setLookLayer('curbs', o as boolean), on);
      expect(await set(false)).toBe(true);
      const off = await live(page);
      expect(await set(true)).toBe(true);
      const on = await live(page);
      const keys = (await world(page, (w) => w.chunks())).resident.l0;
      await world(page, (w) => w.hold(false));
      expect(on.renderObjects - off.renderObjects, `${tier}: render objects added by the curbs layer`).toBe(0);
      if (tier === 'mobile-low') expect(on.renderObjects + crowdMax(tier), `mobile-low after ${on.renderObjects} + crowd max ${crowdMax(tier)}`).toBeLessThanOrEqual(100);
      const baseline = prior().ledger.tiers[tier]?.after;
      expect(baseline, `${prior().file} holds ${tier}`).toBeDefined();
      expect(on.renderObjects, `${tier}: render objects against the after (${baseline}) of ${prior().file}`).toBeLessThanOrEqual(baseline ?? 0);
      const tris = chunkTriangles(keys, tier);
      expect(tris.sumOff).toBeGreaterThan(0);
      expect(tris.maxDelta, `${tier}: triangles the curbs add to one L0 chunk`).toBeLessThanOrEqual(TRI_CAP[tier] as number);
      measured[tier] = { off: off.renderObjects, on: on.renderObjects, tris };
      console.log(`curbs ledger ${tier}: ${JSON.stringify(measured[tier])} (crowd max ${crowdMax(tier)})`);
    });
  }

  test('writes (DV_LOOK_WRITE=1) or checks the committed ledger @curbs-ledger', () => {
    const base = prior();
    if (write) {
      const tiers: Record<string, TierRow> = {};
      const driftOff: Record<string, number> = {};
      for (const tier of TIERS) {
        const m = measured[tier];
        if (!m) continue;
        const baseline = base.ledger.tiers[tier]?.after ?? m.on;
        if (baseline !== m.on) driftOff[tier] = m.on;
        tiers[tier] = { baseline, after: m.on, perLayer: { curbs: m.on - m.off }, chunkTriangles: m.tris };
      }
      const old = existsSync(LEDGER) ? read<Ledger>(LEDGER) : undefined;
      const out: Ledger = {
        commit: commitOf(),
        bakeId: bakeIdOf(),
        baselineFrom: base.file,
        ...(Object.keys(driftOff).length > 0
          ? { drift: { reason: `${base.file} was measured on a scene later rows changed; this checkout reads the render objects in measuredOff, and the curbs add none`, measuredOff: driftOff } }
          : {}),
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
    for (const tier of TIERS) {
      const t = ledger.tiers[tier];
      expect(t, `${tier} is in the ledger`).toBeDefined();
      if (!t) continue;
      expect(t.baseline, `${tier} baseline is the after of ${base.file}`).toBe(base.ledger.tiers[tier]?.after);
      expect(t.perLayer.curbs, `${tier} objects added by the curbs`).toBe(0);
      if (t.after !== t.baseline) expect(ledger.drift?.measuredOff[tier], `${tier}: after ${t.after} is not the baseline ${t.baseline}: the ledger says why`).toBe(t.after);
      expect(t.chunkTriangles.maxDelta, `${tier} triangles per L0 chunk`).toBeLessThanOrEqual(TRI_CAP[tier] as number);
    }
    expect((ledger.tiers['mobile-low']?.after ?? 0) + crowdMax('mobile-low'), 'mobile-low after + crowd max').toBeLessThanOrEqual(100);
    if (ledger.xr) expect(ledger.xr.after).toBe(ledger.xr.baseline);
  });
});

test.describe('xr curbs ledger @xr @curbs-ledger', () => {
  test('the Quest tier draws its curbs and keeps its render objects @xr @curbs-ledger', async ({ page }) => {
    test.setTimeout(900_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
    await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(120_000));
    await frames(page, 4);
    const look = await world(page, (w) => w.look());
    expect(look?.curbs.ribbons ?? 0, 'the Quest tier (mobile mesher profile) has its sidewalk ribbons').toBeGreaterThan(0);
    const objects = (await live(page)).renderObjects;
    const priorXr = prior().ledger.xr?.after;
    console.log(`curbs ledger xr: ${objects} render objects (prior after ${String(priorXr)})`);
    if (priorXr !== undefined) expect(objects, 'the Quest count against the prior ledger').toBeLessThanOrEqual(priorXr);
    if (write && existsSync(LEDGER)) {
      const l = read<Ledger>(LEDGER);
      l.xr = { baseline: priorXr ?? objects, after: objects };
      writeFileSync(LEDGER, `${JSON.stringify(l, null, 2)}\n`);
    }
    expect(errors).toEqual([]);
  });
});
