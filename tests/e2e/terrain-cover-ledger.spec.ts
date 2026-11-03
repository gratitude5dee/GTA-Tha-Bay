import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type TestInfo } from '@playwright/test';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';
import { cover, coverSettled, setCover } from './cover-helpers.ts';
import { crowdMax, streamAtPlan } from './ledger-helpers.ts';
import { bakeIdOf, bootWorld, live, read, setSky, world, type W } from './markings-helpers.ts';

/**
 * M02h3 AC-8 (@cover-ledger) per tier on `chromium-webgl2`, the frame of DL-758: the cover adds no render object and no triangle (the layer
 * off and on again, both re-committed at the focus), `mobile-low` stays at or under 100 with its crowd, and the count is at or under the
 * after of the latest merged ledger; `DV_LOOK_WRITE=1` writes `docs/look/M02h3-render-ledger.json`. `@xr`: the Quest tier holds its count.
 */
// ---- the ledger (AC-8) ------------------------------------------------------------------------------------------------------------------

const LEDGER = 'docs/look/M02h3-render-ledger.json';
/** The latest merged ledger first (its `after` is this one's baseline). */
const PRIORS = ['docs/look/M02h2-render-ledger.json', 'docs/look/M02h1-render-ledger.json', 'docs/look/M10d1-render-ledger.json'];
const LEDGER_TIERS = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'] as const;
interface TierRow {
  baseline: number;
  after: number;
  perLayer: { cover: number };
  /** Triangles of the world units with the cover off and on again, both re-committed at the focus (equal: the cover moves colours and surface ids, never geometry). */
  triangles: { off: number; on: number };
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

function prior(): { file: string; ledger: { tiers: Record<string, { after: number }>; xr?: { after: number } } } {
  for (const file of PRIORS) if (existsSync(file)) return { file, ledger: read(file) };
  throw new Error(`no ledger before M02h3 in docs/look (${PRIORS.join(', ')})`);
}

test.describe('cover ledger @cover-ledger', () => {
  test.describe.configure({ timeout: 1_800_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the ledger is chromium-webgl2 only (the XR case runs on xr-quest3)');
  });
  type Count = { renderObjects: number; triangles: number };
  /** `on`: the frame of the ledger protocol (DL-758); `off` and `again`: the layer off, then on, both re-committed at the same focus. */
  const measured: Record<string, { on: Count; off: Count; again: Count }> = {};

  for (const tier of LEDGER_TIERS) {
    test(`${tier}: the cover adds no render object and no triangle @cover-ledger`, async ({ page }) => {
      await bootWorld(page, tier, '', SMALL_VIEWPORT);
      await setSky(page, 13, 'clear');
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
      if (tier === 'mobile-low') await world(page, (w) => w.shot('fog-west'));
      await streamAtPlan(page);
      await world(page, (w) => w.hold(true));
      const on = await live(page);
      await world(page, (w) => w.hold(false));
      // the layer's own delta: off, then on again, both frames re-committed at this focus (casters are decided at commit, see @world-cover).
      // The triangles compared are the world units' (`chunks().triangles`): the traffic stays in the ledger frame and its instances move.
      const toggled = async (o: boolean): Promise<{ renderObjects: number; triangles: number }> => {
        expect(await setCover(page, o)).toBe(true);
        await coverSettled(page);
        await world(page, (w) => w.hold(true));
        const r = await live(page);
        const tris = await world(page, (w) => w.chunks().triangles);
        await world(page, (w) => w.hold(false));
        return { renderObjects: r.renderObjects, triangles: tris };
      };
      const off = await toggled(false);
      const again = await toggled(true);
      expect(again.renderObjects - off.renderObjects, `${tier}: render objects added by the cover`).toBe(0);
      expect(again.triangles - off.triangles, `${tier}: triangles added by the cover`).toBe(0);
      if (tier === 'mobile-low') expect(on.renderObjects + crowdMax(tier), `mobile-low after ${on.renderObjects} + crowd max ${crowdMax(tier)}`).toBeLessThanOrEqual(100);
      const baseline = prior().ledger.tiers[tier]?.after;
      expect(baseline, `${prior().file} holds ${tier}`).toBeDefined();
      expect(on.renderObjects, `${tier}: render objects against the after (${baseline}) of ${prior().file}`).toBeLessThanOrEqual(baseline ?? 0);
      measured[tier] = { on, off, again };
      console.log(`cover ledger ${tier}: ${JSON.stringify(measured[tier])} (crowd max ${crowdMax(tier)})`);
    });
  }

  test('writes (DV_LOOK_WRITE=1) or checks the committed ledger @cover-ledger', () => {
    const base = prior();
    if (write) {
      const tiers: Record<string, TierRow> = {};
      const driftOff: Record<string, number> = {};
      for (const tier of LEDGER_TIERS) {
        const m = measured[tier];
        if (!m) continue;
        const baseline = base.ledger.tiers[tier]?.after ?? m.on.renderObjects;
        if (baseline !== m.on.renderObjects) driftOff[tier] = m.on.renderObjects;
        tiers[tier] = { baseline, after: m.on.renderObjects, perLayer: { cover: m.again.renderObjects - m.off.renderObjects }, triangles: { off: m.off.triangles, on: m.again.triangles } };
      }
      const old = existsSync(LEDGER) ? read<Ledger>(LEDGER) : undefined;
      const out: Ledger = {
        commit: commitOf(),
        bakeId: bakeIdOf(),
        baselineFrom: base.file,
        ...(Object.keys(driftOff).length > 0
          ? { drift: { reason: `${base.file} was measured on a scene later rows changed; this checkout reads the render objects in measuredOff, and the cover adds none`, measuredOff: driftOff } }
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
    for (const tier of LEDGER_TIERS) {
      const t = ledger.tiers[tier];
      expect(t, `${tier} is in the ledger`).toBeDefined();
      if (!t) continue;
      expect(t.baseline, `${tier} baseline is the after of ${base.file}`).toBe(base.ledger.tiers[tier]?.after);
      expect(t.perLayer.cover, `${tier} objects added by the cover`).toBe(0);
      expect(t.triangles.on, `${tier} triangles added by the cover`).toBe(t.triangles.off);
      if (t.after !== t.baseline) expect(ledger.drift?.measuredOff[tier], `${tier}: after ${t.after} is not the baseline ${t.baseline}: the ledger says why`).toBe(t.after);
    }
    expect((ledger.tiers['mobile-low']?.after ?? 0) + crowdMax('mobile-low'), 'mobile-low after + crowd max').toBeLessThanOrEqual(100);
    if (ledger.xr) expect(ledger.xr.after).toBe(ledger.xr.baseline);
  });
});

test.describe('xr cover ledger @xr @cover-ledger', () => {
  test('the Quest tier draws its cover and keeps its render objects @xr @cover-ledger', async ({ page }) => {
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
    const c = await cover(page);
    await world(page, (w) => w.hold(false));
    expect(c.enabled).toBe(true);
    expect(Object.entries(c.cells).filter(([k]) => k !== 'none').reduce((n, [, v]) => n + v, 0), 'the Quest tier (legacy look) meshes the cover').toBeGreaterThan(0);
    const priorXr = prior().ledger.xr?.after;
    console.log(`cover ledger xr: ${objects} render objects (prior after ${String(priorXr)})`);
    if (priorXr !== undefined) expect(objects, 'the Quest count against the prior ledger').toBeLessThanOrEqual(priorXr);
    if (write && existsSync(LEDGER)) {
      const l = read<Ledger>(LEDGER);
      l.xr = { baseline: priorXr ?? objects, after: objects };
      writeFileSync(LEDGER, `${JSON.stringify(l, null, 2)}\n`);
    }
    expect(errors).toEqual([]);
  });
});
