import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';
import { crowdMax, streamAtPlan } from './ledger-helpers.ts';
import { bakeIdOf, bootWorld, live, read, setSky, world, type W } from './markings-helpers.ts';
import { veg } from './trees-helpers.ts';

/**
 * M02h5 AC-8 (@scatter-ledger, `chromium-webgl2`; the XR case on `xr-quest3`): the render objects of the ledger frame (DL-758) per tier
 * against the `after` of the latest merged ledger, and the scatter's own delta: its pools drawing (understory and impostors; none casts).
 * Plan: `desktop` at most +4, `mobile` +3, `mobile-low` +1 (and at most 100 with its crowd), the legacy look (`mobile-low` with
 * `setLook(false)`) and the Quest tier +0. At `shot('park-forest')` the vegetation pools draw at most 1.2M / 250k / 60k triangles at
 * `desktop` / `mobile` / `mobile-low`. `DV_LOOK_WRITE=1` writes `docs/look/M02h5-render-ledger.json` (M02g1's shape). A file of its own:
 * a serial group makes its whole file one scheduling unit of the duration-packed shards (BD-M02h5-07).
 */

const LEDGER = 'docs/look/M02h5-render-ledger.json';
/** The latest merged ledger first (its `after` is this one's baseline). */
const PRIORS = ['docs/look/M10d5-render-ledger.json', 'docs/look/M10d4-render-ledger.json', 'docs/look/M02h4-render-ledger.json'];
const LEDGER_TIERS = ['desktop', 'mobile', 'mobile-low'] as const;
/** The scatter's object delta allowed per row. */
const SCATTER_DELTA_MAX: Record<string, number> = { desktop: 4, mobile: 3, 'mobile-low': 1, legacy: 0, xr: 0 };
/** The vegetation triangles allowed at `park-forest`. */
const PARK_TRIS_MAX: Record<string, number> = { desktop: 1_200_000, mobile: 250_000, 'mobile-low': 60_000 };

interface TierRow {
  baseline: number;
  after: number;
  /** `scatter`: the scatter's pools drawing in the ledger frame (none casts, so no shadow pass adds to it). */
  perLayer: { scatter: number };
  /** The scatter at the ledger frame and the vegetation triangles at `park-forest`. */
  scatter: { pools: number; impostors: number; shrubs: number; hedges: number; vegTriangles: number; parkForestTriangles?: number };
}
interface Ledger {
  commit: string;
  bakeId: string;
  baselineFrom: string;
  drift?: { reason: string; measuredOff: Record<string, number> };
  tiers: Record<string, TierRow>;
  xr?: { baseline: number; after: number; perLayer: { scatter: number } };
}
const write = process.env['DV_LOOK_WRITE'] === '1';
const commitOf = (): string => process.env['GITHUB_SHA'] ?? process.env['DV_COMMIT'] ?? 'local';

function prior(): { file: string; ledger: { tiers: Record<string, { after: number }>; xr?: { after: number } } } {
  for (const file of PRIORS) if (existsSync(file)) return { file, ledger: read(file) };
  throw new Error(`no ledger before M02h5 in docs/look (${PRIORS.join(', ')})`);
}

/** The scatter's pools drawing now (each one render object; none casts) and what they draw. */
async function scatterFrame(page: Page): Promise<{ pools: number; impostors: number; shrubs: number; hedges: number; vegTriangles: number }> {
  const v = await veg(page);
  const s = v.scatter as { impostors: number; shrubs: number; hedges: number };
  const pools = await page.evaluate(() => {
    type P = { extra: boolean; mesh: { count: number; visible: boolean; castShadow: boolean } };
    const view = (window as unknown as W).__dvBridge.world.internals().view as unknown as { renderer: { vegetation: { pools: P[] } } };
    let n = 0;
    for (const p of view.renderer.vegetation.pools) if (p.extra && p.mesh.visible && p.mesh.count > 0) n++;
    return n;
  });
  return { pools, impostors: s.impostors, shrubs: s.shrubs, hedges: s.hedges, vegTriangles: v.triangles ?? 0 };
}

test.describe('scatter ledger @scatter-ledger', () => {
  test.describe.configure({ timeout: 1_800_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the ledger is chromium-webgl2 only (the XR case runs on xr-quest3)');
  });
  const measured: Record<string, { objects: number; scatter: TierRow['scatter'] }> = {};

  for (const row of [...LEDGER_TIERS, 'legacy'] as const) {
    test(`${row}: the scatter's render objects against the latest merged ledger, and park-forest's vegetation triangles @scatter-ledger`, async ({ page }) => {
      const tier = row === 'legacy' ? 'mobile-low' : row;
      // `&furniture=0` (DL-758): the later M02h6 row's street furniture and parked dressing stay out of this row's frame
      await bootWorld(page, tier, '&furniture=0', SMALL_VIEWPORT);
      if (row === 'legacy') expect(await world(page, (w) => w.setLook(false)), 'the look switched off').toBe(true);
      await setSky(page, 13, 'clear');
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
      if (tier === 'mobile-low') await world(page, (w) => w.shot('fog-west'));
      await streamAtPlan(page);
      await expect.poll(async () => ((await veg(page)).scatter as { bandWrites: { pending: number } }).bandWrites.pending, { timeout: 180_000, intervals: [500] }).toBe(0);
      await world(page, (w) => w.hold(true));
      const on = await live(page);
      const sc = await scatterFrame(page);
      await world(page, (w) => w.hold(false));
      let park: number | undefined;
      if (row !== 'legacy') {
        // park-forest: the vegetation triangles of the woods
        await world(page, (w) => w.shot('park-forest', { held: true }));
        await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(240_000));
        await expect.poll(async () => ((await veg(page)).scatter as { bandWrites: { pending: number } }).bandWrites.pending, { timeout: 180_000, intervals: [500] }).toBe(0);
        park = (await veg(page)).triangles ?? 0;
        expect(park, `${tier}: park-forest vegetation triangles`).toBeLessThanOrEqual(PARK_TRIS_MAX[tier] as number);
      }
      measured[row] = { objects: on.renderObjects, scatter: { ...sc, ...(park !== undefined ? { parkForestTriangles: park } : {}) } };
      console.log(`scatter ledger ${row}: ${on.renderObjects} render objects, ${on.triangles} triangles; scatter ${JSON.stringify(measured[row]?.scatter)} (crowd max ${crowdMax(tier)})`);
      expect(sc.pools, `${row}: the scatter's pools drawing`).toBeLessThanOrEqual(SCATTER_DELTA_MAX[row] as number);
      if (tier === 'mobile-low') expect(on.renderObjects + crowdMax(tier), `mobile-low ${on.renderObjects} + crowd max ${crowdMax(tier)}`).toBeLessThanOrEqual(100);
      if (row !== 'legacy') {
        const baseline = prior().ledger.tiers[tier]?.after;
        expect(baseline, `${prior().file} holds ${tier}`).toBeDefined();
        expect(on.renderObjects, `${tier}: render objects against the after (${baseline}) of ${prior().file} plus the scatter's allowance`).toBeLessThanOrEqual((baseline ?? 0) + (SCATTER_DELTA_MAX[row] as number));
      }
    });
  }

  test('writes (DV_LOOK_WRITE=1) or checks the committed ledger @scatter-ledger', () => {
    const base = prior();
    if (write) {
      const tiers: Record<string, TierRow> = {};
      const driftOff: Record<string, number> = {};
      for (const row of [...LEDGER_TIERS, 'legacy'] as const) {
        const m = measured[row];
        if (!m) continue;
        const baseline = row === 'legacy' ? m.objects - m.scatter.pools : (base.ledger.tiers[row]?.after ?? m.objects);
        if (baseline + m.scatter.pools !== m.objects) driftOff[row] = m.objects;
        tiers[row] = { baseline, after: m.objects, perLayer: { scatter: m.scatter.pools }, scatter: m.scatter };
      }
      const old = existsSync(LEDGER) ? read<Ledger>(LEDGER) : undefined;
      const out: Ledger = {
        commit: commitOf(),
        bakeId: bakeIdOf(),
        baselineFrom: base.file,
        ...(Object.keys(driftOff).length > 0
          ? { drift: { reason: `${base.file} was measured on the parent's synth bake (no scatter records) and scene; the rows in measuredOff are this checkout's render objects, the scatter's own delta is perLayer.scatter`, measuredOff: driftOff } }
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
    for (const row of [...LEDGER_TIERS, 'legacy'] as const) {
      const t = ledger.tiers[row];
      expect(t, `${row} is in the ledger`).toBeDefined();
      if (!t) continue;
      if (row !== 'legacy') {
        expect(t.baseline, `${row} baseline is the after of ${base.file}`).toBe(base.ledger.tiers[row]?.after);
        expect(t.after, `${row} after within the plan`).toBeLessThanOrEqual(t.baseline + (SCATTER_DELTA_MAX[row] as number));
        expect(t.scatter.parkForestTriangles ?? Infinity, `${row} park-forest triangles`).toBeLessThanOrEqual(PARK_TRIS_MAX[row] as number);
      }
      expect(t.perLayer.scatter, `${row} scatter delta`).toBeLessThanOrEqual(SCATTER_DELTA_MAX[row] as number);
      if (t.after !== t.baseline + t.perLayer.scatter) expect(ledger.drift?.measuredOff[row], `${row}: after ${t.after} is not baseline + scatter: the ledger says why`).toBe(t.after);
    }
    expect((ledger.tiers['mobile-low']?.after ?? 0) + crowdMax('mobile-low'), 'mobile-low after + crowd max').toBeLessThanOrEqual(100);
    if (ledger.xr) {
      expect(ledger.xr.perLayer.scatter).toBe(0);
      expect(ledger.xr.after).toBe(ledger.xr.baseline);
    }
  });
});

test.describe('xr scatter ledger @xr @scatter-ledger', () => {
  test('the Quest tier: no impostor or understory pool, its render objects equal its baseline @xr @scatter-ledger', async ({ page }) => {
    test.setTimeout(900_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // the protocol of the XR rows of the earlier ledgers: 256 x 144, traffic resident, the frame of the plan (DL-758)
    await page.setViewportSize({ width: 256, height: 144 });
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
    await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
    await streamAtPlan(page);
    await world(page, (w) => w.hold(true));
    const objects = (await live(page)).renderObjects;
    const sc = await scatterFrame(page);
    const v = await veg(page);
    await world(page, (w) => w.hold(false));
    const s = v.scatter as { impostorPools: number; understoryPools: number };
    expect(v.set).toBe('low');
    expect(v.pools).toBe(2);
    expect(s.impostorPools).toBe(0);
    expect(s.understoryPools).toBe(0);
    expect(sc.pools).toBe(0);
    const priorXr = prior().ledger.xr?.after;
    console.log(`scatter ledger xr: ${objects} render objects (baseline ${String(priorXr)}); scatter ${JSON.stringify(sc)}`);
    if (priorXr !== undefined) expect(objects, 'the Quest tier equals its baseline').toBeLessThanOrEqual(priorXr);
    if (write && existsSync(LEDGER)) {
      const l = read<Ledger>(LEDGER);
      l.xr = { baseline: priorXr ?? objects, after: objects, perLayer: { scatter: sc.pools } };
      writeFileSync(LEDGER, `${JSON.stringify(l, null, 2)}\n`);
    }
    expect(errors).toEqual([]);
  });
});
