import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';
import { crowdMax, streamAtPlan } from './ledger-helpers.ts';
import { bakeIdOf, bootWorld, live, read, setSky, world, type W } from './markings-helpers.ts';
import { veg } from './trees-helpers.ts';

/**
 * M02h4 AC-8 (@trees-ledger, `chromium-webgl2`): the render objects of the ledger frame (DL-758) per tier, and the trees' own delta: the
 * pools drawing (shadow passes counted) against the per-unit vegetation objects M02g2 would have drawn in the same frame. `mobile-low`
 * stays at or under 100 with its crowd and at or under 48 triangles a tree; the legacy look (`mobile-low` with `setLook(false)`) and the
 * Quest tier add no render object. `DV_LOOK_WRITE=1` writes `docs/look/M02h4-render-ledger.json`. A file of its own: a serial group makes
 * its whole file one scheduling unit of the duration-packed shards (BD-M02h4-08).
 */

const LEDGER = 'docs/look/M02h4-render-ledger.json';
/** The latest merged ledger first (its `after` is this one's baseline). */
const PRIORS = ['docs/look/M10d5-render-ledger.json', 'docs/look/M10d4-render-ledger.json', 'docs/look/M02h3-render-ledger.json', 'docs/look/M02h2-render-ledger.json'];
const LEDGER_TIERS = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'] as const;
/** The trees' delta allowed per row: `mobile-low` +2, `desktop` +40 (shadow passes counted), the legacy look and the Quest tier 0. */
const TREE_DELTA_MAX: Record<string, number> = { 'desktop-ultra': 40, desktop: 40, mobile: 40, 'mobile-low': 2, legacy: 0, xr: 0 };
interface TierRow {
  baseline: number;
  after: number;
  /** `trees`: the pools drawing (shadow passes counted) less the per-unit vegetation objects M02g2 would draw in the same frame. */
  perLayer: { trees: number };
  /** What the frame's trees are: pools drawing, casting pools, the per-unit objects they replace, triangles per tree on `low`. */
  trees: { pools: number; casting: number; perUnit: number; drawn: number; maxTrisPerTree: number };
}
interface Ledger {
  commit: string;
  bakeId: string;
  baselineFrom: string;
  drift?: { reason: string; measuredOff: Record<string, number> };
  tiers: Record<string, TierRow>;
  xr?: { baseline: number; after: number; perLayer: { trees: number } };
}
const write = process.env['DV_LOOK_WRITE'] === '1';
const commitOf = (): string => process.env['GITHUB_SHA'] ?? process.env['DV_COMMIT'] ?? 'local';

function prior(): { file: string; ledger: { tiers: Record<string, { after: number }>; xr?: { after: number } } } {
  for (const file of PRIORS) if (existsSync(file)) return { file, ledger: read(file) };
  throw new Error(`no ledger before M02h4 in docs/look (${PRIORS.join(', ')})`);
}

/**
 * The frame's trees: pools drawing (each one render object, and one more per shadow pass while it casts), and the per-unit vegetation
 * objects M02g2 would have drawn in it (each visible L0 unit whose trees are within drawM), so the delta is measured in one frame.
 */
async function treeFrame(page: Page): Promise<TierRow['trees'] & { delta: number }> {
  return page.evaluate(() => {
    type U = { level: string; hasTrees: boolean; vegShown: boolean; group: { visible: boolean } };
    type P = { mesh: { count: number; visible: boolean; castShadow: boolean }; data: { triangles: number } };
    const view = (window as unknown as W).__dvBridge.world.internals().view as unknown as {
      renderer: { units: Map<string, U>; vegetation: { pools: P[]; castNear: boolean; nearOf(id: string): boolean | null } };
      lookReport(): { shadowPasses?: number } | null;
    };
    const veg = view.renderer.vegetation;
    // M02g2's frame: one vegetation object per visible L0 unit whose trees are within drawM; the units near the focus cast while the layer is on
    let perUnit = 0, perUnitCast = 0;
    for (const [id, u] of view.renderer.units) {
      if (u.level !== 'l0' || !u.hasTrees || !u.vegShown || !u.group.visible) continue;
      perUnit++;
      if (veg.castNear && veg.nearOf(id) === true) perUnitCast++;
    }
    let pools = 0, casting = 0, drawn = 0, maxTris = 0;
    for (const p of veg.pools) {
      if (!p.mesh.visible || p.mesh.count <= 0) continue;
      pools++;
      drawn += p.mesh.count;
      if (p.mesh.castShadow) casting++;
      maxTris = Math.max(maxTris, p.data.triangles);
    }
    // every caster is drawn once more per shadow pass, then and now
    const passes = view.lookReport()?.shadowPasses ?? 0;
    return { pools, casting, perUnit, drawn, maxTrisPerTree: maxTris, delta: pools - perUnit + passes * (casting - perUnitCast) };
  });
}

test.describe('trees ledger @trees-ledger', () => {
  test.describe.configure({ timeout: 1_800_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the ledger is chromium-webgl2 only (the XR case runs on xr-quest3)');
  });
  const measured: Record<string, { objects: number; trees: TierRow['trees'] & { delta: number } }> = {};

  for (const row of [...LEDGER_TIERS, 'legacy'] as const) {
    test(`${row}: the trees' render objects against the per-unit objects they replace @trees-ledger`, async ({ page }) => {
      const tier = row === 'legacy' ? 'mobile-low' : row;
      await bootWorld(page, tier, '', SMALL_VIEWPORT);
      if (row === 'legacy') expect(await world(page, (w) => w.setLook(false)), 'the look switched off').toBe(true);
      await setSky(page, 13, 'clear');
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
      if (tier === 'mobile-low') await world(page, (w) => w.shot('fog-west'));
      await streamAtPlan(page);
      await world(page, (w) => w.hold(true));
      const on = await live(page);
      const trees = await treeFrame(page);
      await world(page, (w) => w.hold(false));
      measured[row] = { objects: on.renderObjects, trees };
      console.log(`trees ledger ${row}: ${on.renderObjects} render objects, ${on.triangles} triangles; trees ${JSON.stringify(trees)} (crowd max ${crowdMax(tier)})`);
      expect(trees.delta, `${row}: the trees' delta`).toBeLessThanOrEqual(TREE_DELTA_MAX[row] as number);
      if (tier === 'mobile-low') {
        expect(on.renderObjects + crowdMax(tier), `mobile-low ${on.renderObjects} + crowd max ${crowdMax(tier)}`).toBeLessThanOrEqual(100);
        expect(trees.maxTrisPerTree, 'at most 48 triangles per tree on low').toBeLessThanOrEqual(48);
      }
      if (row !== 'legacy') {
        const baseline = prior().ledger.tiers[tier]?.after;
        expect(baseline, `${prior().file} holds ${tier}`).toBeDefined();
        expect(on.renderObjects, `${tier}: render objects against the after (${baseline}) of ${prior().file} plus the trees' allowance`).toBeLessThanOrEqual((baseline ?? 0) + Math.max(0, TREE_DELTA_MAX[row] as number));
      }
    });
  }

  test('writes (DV_LOOK_WRITE=1) or checks the committed ledger @trees-ledger', () => {
    const base = prior();
    if (write) {
      const tiers: Record<string, TierRow> = {};
      const driftOff: Record<string, number> = {};
      for (const row of [...LEDGER_TIERS, 'legacy'] as const) {
        const m = measured[row];
        if (!m) continue;
        const baseline = row === 'legacy' ? m.objects - m.trees.delta : (base.ledger.tiers[row]?.after ?? m.objects);
        if (baseline + m.trees.delta !== m.objects) driftOff[row] = m.objects;
        const { delta, ...trees } = m.trees;
        tiers[row] = { baseline, after: m.objects, perLayer: { trees: delta }, trees };
      }
      const old = existsSync(LEDGER) ? read<Ledger>(LEDGER) : undefined;
      const out: Ledger = {
        commit: commitOf(),
        bakeId: bakeIdOf(),
        baselineFrom: base.file,
        ...(Object.keys(driftOff).length > 0
          ? { drift: { reason: `${base.file} was measured on the parent's synth bake (8 trees a chunk; this one has 16 and the tree forms) and scene; the rows in measuredOff are this checkout's render objects, the trees' own delta is perLayer.trees`, measuredOff: driftOff } }
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
      if (row !== 'legacy') expect(t.baseline, `${row} baseline is the after of ${base.file}`).toBe(base.ledger.tiers[row]?.after);
      expect(t.perLayer.trees, `${row} trees' delta`).toBeLessThanOrEqual(TREE_DELTA_MAX[row] as number);
      if (t.after !== t.baseline + t.perLayer.trees) expect(ledger.drift?.measuredOff[row], `${row}: after ${t.after} is not baseline + trees: the ledger says why`).toBe(t.after);
    }
    expect((ledger.tiers['mobile-low']?.after ?? 0) + crowdMax('mobile-low'), 'mobile-low after + crowd max').toBeLessThanOrEqual(100);
    expect(ledger.tiers['mobile-low']?.trees.maxTrisPerTree ?? 0).toBeLessThanOrEqual(48);
    if (ledger.xr) expect(ledger.xr.perLayer.trees).toBeLessThanOrEqual(0);
  });
});

test.describe('xr trees ledger @xr @trees-ledger', () => {
  test('the Quest tier draws the low set, no wind, and its trees add no render object @xr @trees-ledger', async ({ page }) => {
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
    const trees = await treeFrame(page);
    const v = await veg(page);
    await world(page, (w) => w.hold(false));
    expect(v.set).toBe('low');
    expect(v.pools).toBe(2);
    expect(v.wind).toBe(0);
    expect(trees.maxTrisPerTree).toBeLessThanOrEqual(48);
    console.log(`trees ledger xr: ${objects} render objects; trees ${JSON.stringify(trees)}`);
    expect(trees.delta, 'the Quest tier: the trees add no render object').toBeLessThanOrEqual(0);
    const priorXr = prior().ledger.xr?.after;
    if (write && existsSync(LEDGER)) {
      const l = read<Ledger>(LEDGER);
      l.xr = { baseline: priorXr ?? objects, after: objects, perLayer: { trees: trees.delta } };
      writeFileSync(LEDGER, `${JSON.stringify(l, null, 2)}\n`);
    }
    expect(errors).toEqual([]);
  });
});
