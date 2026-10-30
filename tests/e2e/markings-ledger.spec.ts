import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type TestInfo } from '@playwright/test';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';
import { bakeIdOf, bootWorld, frames, live, read, setSky, world, type W } from './markings-helpers.ts';

/**
 * M02h1 AC-6, `@markings-ledger`: the render-object ledger of `docs/look/M02h1-render-ledger.json` in M02g1's shape with `perLayer.markings`.
 * Per tier on `chromium-webgl2`: the objects of a held frame with the `markings` layer off and on (no object is added), and the triangles of
 * the resident roads objects with and without the markings geometry (the same chunks meshed again here, with the junction patches,
 * crosswalks and stop bars and the collinear-vertex merge, against the ribbons as M02g2 drew them). `@xr`: the Quest tier holds its count.
 * `baseline` is the `after` of the ledger named in `baselineFrom` (`PRIOR`, the newest merged one before this row), as the Look program
 * rules say (rule 5); `DV_LOOK_WRITE=1` writes the ledger.
 */
const LEDGER = 'docs/look/M02h1-render-ledger.json';
/** The ledgers that come before this row in the chain, newest first; the first one that exists is the baseline. */
const PRIORS = ['docs/look/M10d5-render-ledger.json', 'docs/look/M10d4-render-ledger.json', 'docs/look/M10d1-render-ledger.json', 'docs/look/M10d0-render-ledger.json', 'docs/look/M02g2-render-ledger.json', 'docs/look/M02g1-render-ledger.json'];
const TIERS = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'] as const;
interface TierRow {
  baseline: number;
  after: number;
  perLayer: { markings: number };
  roadTriangles: { baseline: number; after: number };
  triangles?: { baseline: number; after: number };
}
interface Ledger {
  commit: string;
  bakeId: string;
  baselineFrom: string;
  /** Present when a tier's baseline is not what this checkout measures with the layer off: the earlier ledger predates changes merged since. */
  drift?: { reason: string; measuredOff: Record<string, number> };
  tiers: Record<string, TierRow>;
  xr?: { baseline: number; after: number };
}
const write = process.env['DV_LOOK_WRITE'] === '1';
const commitOf = (): string => process.env['GITHUB_SHA'] ?? process.env['DV_COMMIT'] ?? 'local';

function prior(): { file: string; ledger: { tiers: Record<string, { after: number; triangles?: { after: number } }>; xr?: { after: number } } } {
  for (const file of PRIORS) if (existsSync(file)) return { file, ledger: read(file) };
  throw new Error(`no ledger before M02h1 in docs/look (${PRIORS.join(', ')})`);
}

/**
 * The triangles of the `roads` objects of `keys` meshed at `tier`, with and without the markings geometry, from the finished synth bake. A
 * separate `tsx` process (tests/support/road-triangles.ts): the mesher imports JSON config, which the Playwright loader does not accept.
 */
function roadTriangles(keys: readonly string[], tier: string): { baseline: number; after: number } {
  const out = execFileSync('pnpm', ['exec', 'tsx', 'tests/support/road-triangles.ts', `dist/world/${bakeIdOf()}/packs`, tier, ...keys], { encoding: 'utf8', maxBuffer: 1 << 24 });
  return JSON.parse(out.trim().split('\n').pop() as string) as { baseline: number; after: number };
}

test.describe('markings ledger @markings-ledger', () => {
  test.describe.configure({ timeout: 1_800_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the ledger is chromium-webgl2 only (the XR case runs on xr-quest3)');
  });
  const measured: Record<string, { off: number; on: number; roads: { baseline: number; after: number }; triangles: number }> = {};

  for (const tier of TIERS) {
    test(`${tier}: the markings layer adds no render object @markings-ledger`, async ({ page }) => {
      // The state of the ledgers before it (M02g1): 480 x 270, 13:00 clear, traffic resident, `fog-west` at `mobile-low`.
      await bootWorld(page, tier, '', SMALL_VIEWPORT);
      await setSky(page, 13, 'clear');
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
      if (tier === 'mobile-low') await world(page, (w) => w.shot('fog-west'));
      await frames(page, 6);
      await world(page, (w) => w.hold(true));
      const set = (on: boolean): Promise<boolean> => page.evaluate((o) => (window as unknown as W).__dvBridge.world.setLookLayer('markings', o as boolean), on);
      expect(await set(false)).toBe(true);
      const off = await live(page);
      expect(await set(true)).toBe(true);
      const on = await live(page);
      const keys = (await world(page, (w) => w.chunks())).resident.l0;
      await world(page, (w) => w.hold(false));
      expect(on.renderObjects - off.renderObjects, `${tier}: render objects added by the markings`).toBe(0);
      const roads = roadTriangles(keys, tier);
      expect(roads.baseline).toBeGreaterThan(0);
      expect(roads.after / roads.baseline, `${tier}: road triangles ${roads.after} against ${roads.baseline}`).toBeLessThanOrEqual(1.1);
      measured[tier] = { off: off.renderObjects, on: on.renderObjects, roads, triangles: on.triangles };
      console.log(`markings ledger ${tier}: ${JSON.stringify(measured[tier])}`);
    });
  }

  test('writes (DV_LOOK_WRITE=1) or checks the committed ledger @markings-ledger', () => {
    const base = prior();
    if (write) {
      const tiers: Record<string, TierRow> = {};
      const driftOff: Record<string, number> = {};
      for (const tier of TIERS) {
        const m = measured[tier];
        if (!m) continue;
        const baseline = base.ledger.tiers[tier]?.after ?? m.off;
        if (baseline !== m.off) driftOff[tier] = m.off;
        tiers[tier] = {
          baseline,
          after: m.on,
          perLayer: { markings: m.on - m.off },
          roadTriangles: m.roads,
          ...(tier === 'mobile-low' ? { triangles: { baseline: base.ledger.tiers[tier]?.triangles?.after ?? m.triangles, after: m.triangles } } : {}),
        };
      }
      const old = existsSync(LEDGER) ? read<Ledger>(LEDGER) : undefined;
      if (old?.drift?.measuredOff['xr'] !== undefined) driftOff['xr'] = old.drift.measuredOff['xr'];
      const out: Ledger = {
        commit: commitOf(),
        bakeId: bakeIdOf(),
        baselineFrom: base.file,
        ...(Object.keys(driftOff).length > 0
          ? { drift: { reason: `${base.file} was measured before later milestones changed the scene; this checkout reads the render objects in measuredOff with the markings layer off, and the layer adds none`, measuredOff: driftOff } }
          : {}),
        tiers,
        ...(existsSync(LEDGER) && read<Ledger>(LEDGER).xr ? { xr: (read<Ledger>(LEDGER) as Ledger).xr as { baseline: number; after: number } } : {}),
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
      expect(t.perLayer.markings, `${tier} objects added by the markings layer`).toBe(0);
      if (t.after !== t.baseline) expect(ledger.drift?.measuredOff[tier], `${tier}: after ${t.after} is not the baseline ${t.baseline}: the ledger says why`).toBe(t.after);
      expect(t.roadTriangles.after / t.roadTriangles.baseline, `${tier} road triangles`).toBeLessThanOrEqual(1.1);
    }
    expect(ledger.tiers['mobile-low']?.after ?? 0).toBeLessThanOrEqual(100);
    if (ledger.xr) {
      expect(ledger.xr.after).toBe(ledger.xr.baseline);
      const priorXr = base.ledger.xr?.after;
      if (priorXr !== undefined && ledger.xr.baseline !== priorXr) expect(ledger.drift?.measuredOff['xr'], `xr baseline ${ledger.xr.baseline} is not the after ${priorXr} of ${base.file}: the ledger says why`).toBe(ledger.xr.baseline);
    }
  });
});

test.describe('xr markings ledger @xr @markings-ledger', () => {
  test('the Quest tier holds its render objects on a held frame, with the flat paint on and off @xr @markings-ledger', async ({ page }) => {
    test.setTimeout(480_000);
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
    await frames(page, 4);
    await world(page, (w) => w.hold(true));
    const set = (on: boolean): Promise<boolean> => page.evaluate((o) => (window as unknown as W).__dvBridge.world.setLookLayer('markings', o as boolean), on);
    expect(await set(false)).toBe(true);
    const off = await live(page);
    expect(await set(true)).toBe(true);
    const on = await live(page);
    await world(page, (w) => w.hold(false));
    const base = prior();
    expect(on.renderObjects, 'xr after = the objects with the paint off').toBe(off.renderObjects);
    if (write) {
      const prev: Ledger = existsSync(LEDGER) ? read<Ledger>(LEDGER) : { commit: commitOf(), bakeId: bakeIdOf(), baselineFrom: base.file, tiers: {} };
      const priorXr = base.ledger.xr?.after;
      const drift = priorXr !== undefined && priorXr !== off.renderObjects
        ? { reason: `${base.file} was measured before later milestones changed the scene; this checkout reads the render objects in measuredOff with the markings layer off, and the layer adds none`, ...prev.drift, measuredOff: { ...prev.drift?.measuredOff, xr: off.renderObjects } }
        : prev.drift;
      mkdirSync(dirname(LEDGER), { recursive: true });
      writeFileSync(LEDGER, `${JSON.stringify({ ...prev, ...(drift ? { drift } : {}), xr: { baseline: off.renderObjects, after: on.renderObjects } }, null, 2)}\n`);
    }
    // the absolute count moves with the streaming of the held frame (94 to 101 across runs), so it is recorded in the ledger and not compared; the paint's own delta is
    // what the case proves
  });
});
