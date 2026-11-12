import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';
import { crowdMax, streamAtPlan } from './ledger-helpers.ts';
import { bakeIdOf, bootWorld, live, read, setSky, world, type W } from './markings-helpers.ts';

/**
 * M02h7 AC-6 (@facade-ledger, `chromium-webgl2`; the XR case on `xr-quest3`): the render objects of the ledger frame (DL-758) per tier
 * against the `after` of the latest merged ledger, and the facade kit's own delta: render objects `+0` on every profile (the kit is
 * emitted into each building's own `buildings` object, so a unit's object list is the same with and without it: `facade.kit.spec.ts`), and
 * building triangles at most +35 % at `desktop`, +20 % at `mobile` and +0 at `mobile-low` and on the legacy look (`mobile-low` with
 * `setLook(false)`): the resident L0 chunks' building triangles with the kit against the same less the kit's own (`look().facade`
 * `kitTriangles`, counted by the mesher per unit). The frame with the layer off is not re-meshed here: at `desktop` the re-mesh of every
 * resident unit through the upload gate (one unit per presented frame, seconds per frame on software GL) outlasts the case (BD-M02h7-08). `mobile-low` stays at or under 100 with its crowd; the Quest tier's `after` equals its baseline.
 * `DV_LOOK_WRITE=1` writes `docs/look/M02h7-render-ledger.json` (M02g1's shape with `perLayer.facade` and the building triangles). A file of
 * its own: a serial group makes its whole file one scheduling unit of the duration-packed shards (BD-M02h5-07).
 */

const LEDGER = 'docs/look/M02h7-render-ledger.json';
/** The latest merged ledger first (its `after` is this one's baseline). */
const PRIORS = ['docs/look/M02h6-render-ledger.json', 'docs/look/M10d5-render-ledger.json', 'docs/look/M02h5-render-ledger.json'];
const LEDGER_TIERS = ['desktop', 'mobile', 'mobile-low'] as const;
/** Building-triangle growth allowed per row (the M02h7 plan). */
const GROWTH_MAX: Record<string, number> = { desktop: 0.35, mobile: 0.2, 'mobile-low': 0, legacy: 0 };

interface Measure { objects: number; buildingTriangles: number; kitTriangles: number }
interface TierRow {
  baseline: number;
  after: number;
  /** The kit's render objects in the ledger frame (on minus off): always 0. */
  perLayer: { facade: number };
  /** Building triangles of the resident L0 chunks with the kit off and on, and the growth. */
  buildingTriangles: { off: number; on: number; growth: number };
  kit: { shopWalls: number; awnings: number; bays: number; cornices: number; kitTriangles: number };
}
interface Ledger {
  commit: string;
  bakeId: string;
  baselineFrom: string;
  drift?: { reason: string; measuredOff: Record<string, number> };
  tiers: Record<string, TierRow>;
  xr?: { baseline: number; after: number; perLayer: { facade: number }; drift?: string };
}
const write = process.env['DV_LOOK_WRITE'] === '1';
const commitOf = (): string => process.env['GITHUB_SHA'] ?? process.env['DV_COMMIT'] ?? 'local';

function prior(): { file: string; ledger: { tiers: Record<string, { after: number }>; xr?: { after: number } } } {
  for (const file of PRIORS) if (existsSync(file)) return { file, ledger: read(file) };
  throw new Error(`no ledger before M02h7 in docs/look (${PRIORS.join(', ')})`);
}

type Facade = { kit: boolean; shopWalls: number; awnings: number; bays: number; cornices: number; kitTriangles: number; buildingTriangles: number };
const facadeOf = async (page: Page): Promise<Facade> => (await world(page, (w) => w.look()?.facade ?? null)) as Facade;

/** The ledger frame's render objects, building triangles and the kit's own triangles (DL-758 protocol). */
async function measure(page: Page): Promise<Measure> {
  await streamAtPlan(page);
  await world(page, (w) => w.hold(true));
  const objects = (await live(page)).renderObjects;
  const f = await facadeOf(page);
  await world(page, (w) => w.hold(false));
  return { objects, buildingTriangles: f.buildingTriangles, kitTriangles: f.kitTriangles };
}

test.describe('facade ledger @facade-ledger', () => {
  test.describe.configure({ timeout: 1_800_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the ledger is chromium-webgl2 only (the XR case runs on xr-quest3)');
  });
  const measured: Record<string, { on: Measure; off: Measure; kit: TierRow['kit'] }> = {};

  for (const row of [...LEDGER_TIERS, 'legacy'] as const) {
    test(`${row}: the facade kit adds no render object and stays within its building-triangle growth @facade-ledger`, async ({ page }) => {
      const tier = row === 'legacy' ? 'mobile-low' : row;
      await bootWorld(page, tier, '', SMALL_VIEWPORT);
      if (row === 'legacy') expect(await world(page, (w) => w.setLook(false)), 'the look switched off').toBe(true);
      await setSky(page, 13, 'clear');
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
      if (tier === 'mobile-low') await world(page, (w) => w.shot('fog-west'));
      const on = await measure(page);
      const f = await facadeOf(page);
      // the frame without the kit: the same units and objects, the kit's triangles taken away
      const off: Measure = { objects: on.objects, buildingTriangles: on.buildingTriangles - on.kitTriangles, kitTriangles: 0 };
      measured[row] = { on, off, kit: { shopWalls: f.shopWalls, awnings: f.awnings, bays: f.bays, cornices: f.cornices, kitTriangles: f.kitTriangles } };
      const growth = off.buildingTriangles > 0 ? (on.buildingTriangles - off.buildingTriangles) / off.buildingTriangles : 0;
      console.log(`facade ledger ${row}: ${on.objects} render objects (off ${off.objects}; crowd max ${crowdMax(tier)}); building triangles ${off.buildingTriangles} -> ${on.buildingTriangles} (${(growth * 100).toFixed(1)} %); kit ${JSON.stringify(measured[row]?.kit)}`);
      expect(on.objects - off.objects, `${row}: the kit's render objects`).toBe(0);
      expect(growth, `${row}: building-triangle growth`).toBeLessThanOrEqual(GROWTH_MAX[row] as number);
      if (row === 'desktop' || row === 'mobile') expect(on.kitTriangles).toBeGreaterThan(0);
      else expect(on.kitTriangles).toBe(0);
      if (tier === 'mobile-low') expect(on.objects + crowdMax(tier), `mobile-low ${on.objects} + crowd max ${crowdMax(tier)}`).toBeLessThanOrEqual(100);
      if (row !== 'legacy') {
        const baseline = prior().ledger.tiers[tier]?.after;
        expect(baseline, `${prior().file} holds ${tier}`).toBeDefined();
        expect(on.objects, `${tier}: render objects against the after (${baseline}) of ${prior().file}`).toBeLessThanOrEqual(baseline ?? 0);
      }
    });
  }

  test('writes (DV_LOOK_WRITE=1) or checks the committed ledger @facade-ledger', () => {
    const base = prior();
    if (write) {
      const tiers: Record<string, TierRow> = {};
      const driftOff: Record<string, number> = {};
      for (const row of [...LEDGER_TIERS, 'legacy'] as const) {
        const m = measured[row];
        if (!m) continue;
        const baseline = row === 'legacy' ? m.off.objects : (base.ledger.tiers[row]?.after ?? m.off.objects);
        if (baseline !== m.on.objects) driftOff[row] = m.on.objects;
        const growth = m.off.buildingTriangles > 0 ? Number(((m.on.buildingTriangles - m.off.buildingTriangles) / m.off.buildingTriangles).toFixed(4)) : 0;
        tiers[row] = { baseline, after: m.on.objects, perLayer: { facade: m.on.objects - m.off.objects }, buildingTriangles: { off: m.off.buildingTriangles, on: m.on.buildingTriangles, growth }, kit: m.kit };
      }
      const old = existsSync(LEDGER) ? read<Ledger>(LEDGER) : undefined;
      const out: Ledger = {
        commit: commitOf(),
        bakeId: bakeIdOf(),
        baselineFrom: base.file,
        ...(Object.keys(driftOff).length > 0
          ? { drift: { reason: `${base.file} was measured on its own scene; the rows in measuredOff are this checkout's render objects with the kit on, whose own delta is perLayer.facade (0)`, measuredOff: driftOff } }
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
      expect(t.perLayer.facade, `${row}: the kit adds no render object`).toBe(0);
      expect(t.buildingTriangles.growth, `${row}: building-triangle growth`).toBeLessThanOrEqual(GROWTH_MAX[row] as number);
      if (row !== 'legacy') {
        expect(t.baseline, `${row} baseline is the after of ${base.file}`).toBe(base.ledger.tiers[row]?.after);
        expect(t.after, `${row} after at or under its baseline`).toBeLessThanOrEqual(t.baseline);
      }
      if (t.after !== t.baseline) expect(ledger.drift?.measuredOff[row], `${row}: after ${t.after} is not the baseline: the ledger says why`).toBe(t.after);
    }
    expect((ledger.tiers['mobile-low']?.after ?? 0) + crowdMax('mobile-low'), 'mobile-low after + crowd max').toBeLessThanOrEqual(100);
    if (ledger.xr) {
      expect(ledger.xr.perLayer.facade).toBe(0);
      if (ledger.xr.after !== ledger.xr.baseline) expect(ledger.xr.drift, 'the XR row says why its total moved').toBeDefined();
    }
  });
});

test.describe('xr facade ledger @xr @facade-ledger', () => {
  test('the Quest tier: no facade kit (its look has no facade layer), its render objects equal to its baseline @xr @facade-ledger', async ({ page }) => {
    test.setTimeout(900_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // the protocol of the XR rows of the earlier ledgers: 256 x 144, traffic resident, the frame of the plan (DL-758)
    await page.setViewportSize({ width: 256, height: 144 });
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __dvBridge: { engine: { observe(): { bodies?: { player?: { drawn?: string } | null } | null } } } }).__dvBridge.engine.observe().bodies?.player?.drawn ?? 'none'), { timeout: 300_000, intervals: [500, 1000, 2000] })
      .toBe('body');
    await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
    await streamAtPlan(page);
    await world(page, (w) => w.hold(true));
    // M02h8: the Quest tier draws the `xr` look, whose one render object is the blob mesh (the `@look-xr-ledger` row of
    // `world-xr-look.spec.ts`); this row is the frame M02h7 measured, so the count is taken with that layer off. On a `legacy` Quest tier
    // (the data fallback) there is no such layer and the call answers false.
    await world(page, (w) => w.setLookLayer('blob', false));
    const objects = (await live(page)).renderObjects;
    const f = await facadeOf(page);
    await world(page, (w) => w.setLookLayer('blob', true));
    await world(page, (w) => w.hold(false));
    expect(f.kit, 'the Quest tier meshes no kit').toBe(false);
    expect(f.kitTriangles).toBe(0);
    expect(await world(page, (w) => w.setLookLayer('facade', false)), 'no facade layer on the Quest tier (the xr look has none, nor has legacy)').toBe(false);
    const priorXr = prior().ledger.xr?.after;
    console.log(`facade ledger xr: ${objects} render objects (baseline ${String(priorXr)}); facade ${JSON.stringify(f)}`);
    if (priorXr !== undefined) expect(objects, `xr after against the baseline ${priorXr}`).toBeLessThanOrEqual(priorXr);
    if (write && existsSync(LEDGER)) {
      const l = read<Ledger>(LEDGER);
      l.xr = { baseline: priorXr ?? objects, after: objects, perLayer: { facade: 0 }, ...(priorXr !== undefined && objects !== priorXr ? { drift: `${objects} on this tree with no kit on the legacy look, against the recorded ${priorXr}` } : {}) };
      writeFileSync(LEDGER, `${JSON.stringify(l, null, 2)}\n`);
    }
    expect(errors).toEqual([]);
  });
});
