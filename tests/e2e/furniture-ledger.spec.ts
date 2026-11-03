import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';
import { crowdMax, streamAtPlan } from './ledger-helpers.ts';
import { bakeIdOf, bootWorld, live, read, setSky, world, type W } from './markings-helpers.ts';

/**
 * M02h6 AC-7 (@furniture-ledger, `chromium-webgl2`; the XR case on `xr-quest3`): the render objects of the ledger frame (DL-758) per tier
 * against the `after` of the latest merged ledger, and the street furniture's own delta: its pools and the parked dressing's families,
 * read as the frame with the `furniture` and `parked` layers on minus the same held frame with both off (`platform.perf.live()`), at the
 * ledger frame and at the shots `noon-street` and `junction-noon` (13:00 clear). Plan: `desktop` at most +9 (`full`: five pools, four
 * families), `mobile` +6 (`lite`), `mobile-low` +3 (`min`: signal and post pools, the car family) and at most 100 with its crowd, the
 * legacy look (`mobile-low` with `setLook(false)`) and the Quest tier +0. `DV_LOOK_WRITE=1` writes `docs/look/M02h6-render-ledger.json`
 * (M02g1's shape). A file of its own: a serial group makes its whole file one scheduling unit of the duration-packed shards (BD-M02h5-07).
 */

const LEDGER = 'docs/look/M02h6-render-ledger.json';
/** The latest merged ledger first (its `after` is this one's baseline). */
const PRIORS = ['docs/look/M10d5-render-ledger.json', 'docs/look/M02h5-render-ledger.json', 'docs/look/M10d4-render-ledger.json'];
const LEDGER_TIERS = ['desktop', 'mobile', 'mobile-low'] as const;
const SHOTS = ['noon-street', 'junction-noon'] as const;
/** The furniture's object delta allowed per row (the M02h6 table). */
const DELTA_MAX: Record<string, number> = { desktop: 9, mobile: 6, 'mobile-low': 3, legacy: 0, xr: 0 };

interface Delta { off: number; on: number; furniture: number; parked: number }
interface TierRow {
  baseline: number;
  after: number;
  /** The pools' and the dressing's render objects in the ledger frame (on minus off, each layer alone). */
  perLayer: { furniture: number; parked: number };
  /** Per shot: the held frame with both layers off and on, and each layer's own delta. */
  shots: Record<string, Delta>;
  /** What `look().furniture` reported at the ledger frame. */
  furniture: { pools: Record<string, { instances: number; cap: number }>; parked: number; heads: number };
}
interface Ledger {
  commit: string;
  bakeId: string;
  baselineFrom: string;
  drift?: { reason: string; measuredOff: Record<string, number> };
  tiers: Record<string, TierRow>;
  xr?: { baseline: number; after: number; perLayer: { furniture: number; parked: number } };
}
const write = process.env['DV_LOOK_WRITE'] === '1';
const commitOf = (): string => process.env['GITHUB_SHA'] ?? process.env['DV_COMMIT'] ?? 'local';

function prior(): { file: string; ledger: { tiers: Record<string, { after: number }>; xr?: { after: number } } } {
  for (const file of PRIORS) if (existsSync(file)) return { file, ledger: read(file) };
  throw new Error(`no ledger before M02h6 in docs/look (${PRIORS.join(', ')})`);
}

const setLayer = (page: Page, id: 'furniture' | 'parked', on: boolean): Promise<boolean> =>
  page.evaluate(([i, o]) => (window as unknown as W).__dvBridge.world.setLookLayer(i as string, o as boolean), [id, on] as const);

/** On a held frame: both layers on, each alone, both off (render objects of `platform.perf.live()`); both on again afterwards. */
async function deltaOf(page: Page): Promise<Delta> {
  await world(page, (w) => w.hold(true));
  const on = (await live(page)).renderObjects;
  await setLayer(page, 'parked', false);
  const furnitureOnly = (await live(page)).renderObjects;
  await setLayer(page, 'furniture', false);
  const off = (await live(page)).renderObjects;
  await setLayer(page, 'furniture', true);
  await setLayer(page, 'parked', true);
  await world(page, (w) => w.hold(false));
  return { off, on, furniture: furnitureOnly - off, parked: on - furnitureOnly };
}

test.describe('furniture ledger @furniture-ledger', () => {
  test.describe.configure({ timeout: 1_800_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the ledger is chromium-webgl2 only (the XR case runs on xr-quest3)');
  });
  const measured: Record<string, { objects: number; frame: Delta; shots: Record<string, Delta>; furniture: TierRow['furniture'] }> = {};

  for (const row of [...LEDGER_TIERS, 'legacy'] as const) {
    test(`${row}: the furniture's render objects against the latest merged ledger, and its delta at noon-street and junction-noon @furniture-ledger`, async ({ page }) => {
      const tier = row === 'legacy' ? 'mobile-low' : row;
      await bootWorld(page, tier, '', SMALL_VIEWPORT);
      if (row === 'legacy') expect(await world(page, (w) => w.setLook(false)), 'the look switched off').toBe(true);
      await setSky(page, 13, 'clear');
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
      if (tier === 'mobile-low') await world(page, (w) => w.shot('fog-west'));
      await streamAtPlan(page);
      const frame = await deltaOf(page);
      const f = (await world(page, (w) => w.look()?.furniture ?? null)) as { pools: Record<string, { instances: number; cap: number }>; parked: { instances: number }; heads: { total: number } } | null;
      const shots: Record<string, Delta> = {};
      if (row !== 'legacy') {
        for (const shot of SHOTS) {
          await page.evaluate((id) => (window as unknown as W).__dvBridge.world.shot(id, { held: true }), shot);
          shots[shot] = await deltaOf(page);
          await world(page, (w) => w.clearShot());
        }
      }
      measured[row] = { objects: frame.on, frame, shots, furniture: { pools: f?.pools ?? {}, parked: f?.parked.instances ?? 0, heads: f?.heads.total ?? 0 } };
      console.log(`furniture ledger ${row}: ${frame.on} render objects (off ${frame.off}; crowd max ${crowdMax(tier)}); shots ${JSON.stringify(shots)}; furniture ${JSON.stringify(measured[row]?.furniture)}`);
      const max = DELTA_MAX[row] as number;
      expect(frame.furniture + frame.parked, `${row}: the furniture's delta at the ledger frame`).toBeLessThanOrEqual(max);
      for (const [shot, d] of Object.entries(shots)) {
        expect(d.on - d.off, `${row} ${shot}: the furniture's delta`).toBeLessThanOrEqual(max);
        expect(d.furniture, `${row} ${shot}: the pools draw`).toBeGreaterThan(0);
      }
      if (row !== 'legacy') expect(shots['junction-noon']?.parked ?? 0, `${row} junction-noon: the dressing draws`).toBeGreaterThan(0);
      if (tier === 'mobile-low') expect(frame.on + crowdMax(tier), `mobile-low ${frame.on} + crowd max ${crowdMax(tier)}`).toBeLessThanOrEqual(100);
      if (row !== 'legacy') {
        const baseline = prior().ledger.tiers[tier]?.after;
        expect(baseline, `${prior().file} holds ${tier}`).toBeDefined();
        expect(frame.on, `${tier}: render objects against the after (${baseline}) of ${prior().file} plus the furniture's allowance`).toBeLessThanOrEqual((baseline ?? 0) + max);
      } else {
        expect(frame.on - frame.off, 'the legacy look: the furniture adds nothing').toBe(0);
      }
    });
  }

  test('writes (DV_LOOK_WRITE=1) or checks the committed ledger @furniture-ledger', () => {
    const base = prior();
    if (write) {
      const tiers: Record<string, TierRow> = {};
      const driftOff: Record<string, number> = {};
      for (const row of [...LEDGER_TIERS, 'legacy'] as const) {
        const m = measured[row];
        if (!m) continue;
        const own = m.frame.furniture + m.frame.parked;
        const baseline = row === 'legacy' ? m.frame.off : (base.ledger.tiers[row]?.after ?? m.frame.off);
        if (baseline + own !== m.objects) driftOff[row] = m.objects;
        tiers[row] = { baseline, after: m.objects, perLayer: { furniture: m.frame.furniture, parked: m.frame.parked }, shots: m.shots, furniture: m.furniture };
      }
      const old = existsSync(LEDGER) ? read<Ledger>(LEDGER) : undefined;
      const out: Ledger = {
        commit: commitOf(),
        bakeId: bakeIdOf(),
        baselineFrom: base.file,
        ...(Object.keys(driftOff).length > 0
          ? { drift: { reason: `${base.file} was measured on the parent's scene; the rows in measuredOff are this checkout's render objects with the furniture on, its own delta is perLayer.furniture + perLayer.parked`, measuredOff: driftOff } }
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
      const max = DELTA_MAX[row] as number;
      const own = t.perLayer.furniture + t.perLayer.parked;
      expect(own, `${row} furniture delta`).toBeLessThanOrEqual(max);
      for (const [shot, d] of Object.entries(t.shots)) expect(d.on - d.off, `${row} ${shot} delta`).toBeLessThanOrEqual(max);
      if (row !== 'legacy') {
        expect(t.baseline, `${row} baseline is the after of ${base.file}`).toBe(base.ledger.tiers[row]?.after);
        expect(t.after, `${row} after within the plan`).toBeLessThanOrEqual(t.baseline + max);
        expect(Object.keys(t.shots).sort()).toEqual([...SHOTS].sort());
      }
      if (t.after !== t.baseline + own) expect(ledger.drift?.measuredOff[row], `${row}: after ${t.after} is not baseline + furniture: the ledger says why`).toBe(t.after);
    }
    expect((ledger.tiers['mobile-low']?.after ?? 0) + crowdMax('mobile-low'), 'mobile-low after + crowd max').toBeLessThanOrEqual(100);
    if (ledger.xr) {
      expect(ledger.xr.perLayer.furniture + ledger.xr.perLayer.parked).toBe(0);
      expect(ledger.xr.after).toBeLessThanOrEqual(ledger.xr.baseline);
    }
  });
});

test.describe('xr furniture ledger @xr @furniture-ledger', () => {
  test('the Quest tier: no furniture pool and no parked dressing, its render objects at or under its baseline @xr @furniture-ledger', async ({ page }) => {
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
    const f = (await world(page, (w) => w.look()?.furniture ?? null)) as { profile: string; objects: number; pools: Record<string, unknown>; parked: { instances: number } } | null;
    await world(page, (w) => w.hold(false));
    expect(await world(page, (w) => w.setLookLayer('furniture', false))).toBe(false);
    expect(await world(page, (w) => w.setLookLayer('parked', false))).toBe(false);
    const priorXr = prior().ledger.xr?.after;
    console.log(`furniture ledger xr: ${objects} render objects (baseline ${String(priorXr)}); furniture ${JSON.stringify(f)}`);
    expect(f?.objects ?? 0).toBe(0);
    expect(Object.keys(f?.pools ?? {})).toEqual([]);
    expect(f?.parked.instances ?? 0).toBe(0);
    if (priorXr !== undefined) expect(objects, 'the Quest tier at or under its baseline').toBeLessThanOrEqual(priorXr);
    if (write && existsSync(LEDGER)) {
      const l = read<Ledger>(LEDGER);
      l.xr = { baseline: priorXr ?? objects, after: objects, perLayer: { furniture: 0, parked: 0 } };
      writeFileSync(LEDGER, `${JSON.stringify(l, null, 2)}\n`);
    }
    expect(errors).toEqual([]);
  });
});
