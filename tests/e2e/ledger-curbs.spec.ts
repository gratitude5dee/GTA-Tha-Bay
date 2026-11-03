import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type TestInfo } from '@playwright/test';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';
import { crowdMax, streamAtPlan } from './ledger-helpers.ts';
import { bakeIdOf, bootWorld, live, read, setSky, world, type W } from './markings-helpers.ts';

/**
 * M02h2 AC-7 (@curbs-ledger), split out of `world-curbs.spec.ts` (BD-REPAIR-M02h2-04): Playwright cuts the shards by test count over the
 * sorted file names, and the ledger's four boots (two of them desktop, about 6 minutes each on software GL) with the three `@world-curbs`
 * boots in one file put chromium-webgl2 shard 8 (the `world-` files) over its 60 minutes in run 41204371272; under this name the ledger
 * sorts into a lighter shard.
 *
 *  - @curbs-ledger  per tier on `chromium-webgl2`, the frame of DL-758: the sidewalks add no render object (the count equals the after
 *                   of the latest merged ledger, `PRIORS`), `mobile-low` stays at or under 100 with its crowd, and the triangles the curbs add
 *                   to an L0 chunk stay at or under 20,000 (`desktop`) and 4,000 (`mobile-low`); `DV_LOOK_WRITE=1` writes
 *                   `docs/look/M02h2-render-ledger.json`. `@xr`: the Quest tier holds its count.
 */
const LEDGER = 'docs/look/M02h2-render-ledger.json';
const PRIORS = ['docs/look/M10d5-render-ledger.json', 'docs/look/M02h1-render-ledger.json', 'docs/look/M10d1-render-ledger.json', 'docs/look/M10d0-render-ledger.json'];

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
      // `&furniture=0` (DL-758): the later M02h6 row's street furniture and parked dressing stay out of this row's frame
      await bootWorld(page, tier, '&furniture=0', SMALL_VIEWPORT);
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
    // the protocol of the XR rows of the earlier ledgers (M10d1 `@xr @art-ledger`): 256 x 144, traffic resident, the frame of the plan (DL-758)
    await page.setViewportSize({ width: 256, height: 144 });
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
    await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
    await streamAtPlan(page);
    await world(page, (w) => w.hold(true));
    const objects = (await live(page)).renderObjects;
    const look = await world(page, (w) => w.look());
    await world(page, (w) => w.hold(false));
    expect(look?.curbs.ribbons ?? 0, 'the Quest tier (mobile mesher profile) has its sidewalk ribbons').toBeGreaterThan(0);
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
