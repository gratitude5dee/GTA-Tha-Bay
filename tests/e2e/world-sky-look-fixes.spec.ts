import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';
import { BASELINE_MODE, bootWorld, frames, MESHER, read, readBaseline, registerFlickerPair, setSky, world, WRITE, writeBaseline, type W } from './look-fixes-helpers.ts';

/**
 * M02g2 look fixes in a real browser, on a `DV_WORLD=synth` QA build (the world half of the e2e legs).
 *
 *  - @look-fixes    AC-6  the three shot pairs (`junction-graze` and `civic-hall-graze` at `desktop`, `asphalt-low` at `mobile-low`) flicker at
 *                   most half as much as the committed baselines of the parent commit; the trees beyond `tree.drawM` are hidden
 *                   (`look().vegetation.farthestM`); `look().envMap` is on at `desktop` on Chromium and off on WebKit
 *  - @fixes-ledger  AC-9  the render-object ledger of `docs/look/M02g2-render-ledger.json` per tier, the `mobile-low` triangle delta, and
 *                   (`@xr`, `xr-quest3`) the Quest tier's count
 *
 * The two `desktop` pairs are `street-look-fixes-junction.spec.ts` and `look-fixes-civic.spec.ts` (BD-REPAIR-M02g2-03: each is the longest case of
 * the suite, and a shard is cut out of the sorted file names by test count, so the two files sit in different shards); the code the three
 * files share is `look-fixes-helpers.ts`. `DV_LOOK_WRITE=1` writes the ledger. `DV_FIXES_BASELINE=1` measures instead of asserting (see
 * the helpers).
 */

// ---- @look-fixes --------------------------------------------------------------------------------------------------------

registerFlickerPair('asphalt-low');

test.describe('look fixes @look-fixes', () => {
  // the timeout of the describe this case shared with the pairs before they moved out (a desktop boot on software GL takes minutes)
  test.describe.configure({ timeout: 3_600_000 });

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
      // the protocol of M02g1's ledger: no `perf=1` (a held frame must not change), traffic resident, `mobile-low` at the `fog-west` shot.
      // `&art=0` (M10d1's QA switch, BD-REPAIR-M10d1-01): this row measures M02g2's own change against M10d0's `after`, so the art of later rows stays out of the frame, as the flicker pairs keep the textures out with `&textures=0`
      await bootWorld(page, tier, SMALL_VIEWPORT, '&art=0');
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
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1&art=0');
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
