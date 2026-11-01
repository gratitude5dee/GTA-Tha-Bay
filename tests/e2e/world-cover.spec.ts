import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { decodePng, diffImages, encodePng, goldenFailures, identical, meanAbsDifference, type Rgba } from '../support/image-diff.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';
import { crowdMax, streamAtPlan } from './ledger-helpers.ts';
import { FLAT_TIERS, GOLDEN_VIEWPORT, HIDE, bakeIdOf, bootWorld, clearActors, frames, live, read, setSky, world, type W } from './markings-helpers.ts';

/**
 * M02h3 ground cover in a real browser, on a `DV_WORLD=synth` QA build.
 *
 *  - @world-cover   AC-6  per flat tier (desktop, mobile, mobile-low; both browsers): `look().cover.cells` is above 0 for all seven classes
 *                   across the `yard-street` and `hill-scrub` shots; the `cover` layer toggle changes the `yard-street` frame by a mean
 *                   |delta| of at least 0.02 and leaves the render objects as they were; no page error.
 *  - @look-golden   AC-7  both shots at `desktop` and `mobile-low` against `tests/e2e/golden/look/<tier>.<shot>.png` (chromium-webgl2), listed
 *                   in the look manifest (`city-look-golden.spec.ts` writes it); `DV_UPDATE_GOLDEN=1` (outside CI) writes them.
 *  - @cover-ledger  AC-8  per tier on `chromium-webgl2`, the frame of DL-758: the cover adds no render object and no triangle (on and off
 *                   read the same counts), `mobile-low` stays at or under 100 with its crowd, and the count is at or under the after of the
 *                   latest merged ledger; `DV_LOOK_WRITE=1` writes `docs/look/M02h3-render-ledger.json`. `@xr`: the Quest tier holds its count.
 *
 * A toggle of the layer re-meshes the resident L0 chunks nearest first (`WorldView.setCover`); the cases wait for the chunks around the
 * focus (`look().cover.pendingNear`) with the world's draw held, the way the ledgers wait for their plan (`streamAtPlan`), never on a
 * frame count.
 */
type CoverReport = { enabled: boolean; cells: Record<string, number>; pending: number; pendingNear: number };
const CLASSES = ['yard', 'dirt', 'mixed', 'driveway', 'vacant', 'scrub', 'park'] as const;
const GOLDEN_DIR = 'tests/e2e/golden/look';
const COVER_GOLDEN_SHOTS = ['yard-street', 'hill-scrub'] as const;
const COVER_GOLDEN_TIERS = ['desktop', 'mobile-low'] as const;

const cover = async (page: Page): Promise<CoverReport> => {
  const r = await world(page, (w) => (w.look() as unknown as { cover?: CoverReport } | null)?.cover ?? null);
  expect(r, 'look().cover is reported').not.toBeNull();
  return r as CoverReport;
};

/** What makes up the frame's render objects: the world units by level and the traffic. */
const parts = (page: Page): Promise<Record<string, unknown>> =>
  world(page, (w) => {
    const c = w.chunks();
    return { objects: c.objects, triangles: c.triangles, l0: c.resident.l0.length, l1: c.resident.l1.length, l2: c.resident.l2.length, masks: c.masks, traffic: w.traffic()?.objects ?? null };
  });

const setCover = (page: Page, on: boolean): Promise<boolean> => page.evaluate((o) => (window as unknown as W).__dvBridge.world.setLookLayer('cover', o), on);

/**
 * After a toggle: with the world's draw held (the hold of `streamAtPlan`), wait until every resident chunk with cover follows the layer
 * (`look().cover.pending`) and the stream is quiet (`settle`), then six frames. The render objects of a desktop frame move while the
 * stream fills (one unit a presented frame on software GL), so both counts are read at the plan.
 */
async function coverSettled(page: Page): Promise<void> {
  const r = await page.evaluate(async () => {
    const w = (window as unknown as W).__dvBridge.world;
    const host = (w.internals().view as unknown as { host: { holdWorld(kind: 'cover'): () => void } }).host;
    const release = host.holdWorld('cover');
    try {
      const t0 = performance.now();
      for (;;) {
        const c = (w.look() as unknown as { cover: CoverReport }).cover;
        if (c.pending === 0) break;
        if (performance.now() - t0 > 600_000) return { ok: false, c, settled: false };
        await new Promise((res) => setTimeout(res, 250));
      }
      const s = await w.settle(600_000);
      return { ok: true, c: (w.look() as unknown as { cover: CoverReport }).cover, settled: s.settled };
    } finally {
      release();
    }
  });
  expect(r.ok && r.settled, `every resident chunk follows the cover layer and the stream is quiet (${JSON.stringify(r)})`).toBe(true);
  await frames(page, 6);
}

test.describe('world cover @world-cover', () => {
  test.describe.configure({ timeout: 1_800_000 });

  for (const tier of FLAT_TIERS) {
    test(`${tier}: all seven classes are resident across yard-street and hill-scrub, and the layer changes the frame and no render object @world-cover`, async ({ page }, testInfo: TestInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text());
      });
      // as world-markings.spec.ts (BD-REPAIR-M02h1-03): chromium-webgpu's desktop textures pass the 16 sampled textures of a stage
      const query = testInfo.project.name === 'chromium-webgpu' && tier === 'desktop' ? '&textures=0' : '';
      await bootWorld(page, tier, query, SMALL_VIEWPORT);
      expect((await cover(page)).enabled, 'world.cover is on by default').toBe(true);
      await page.addStyleTag({ content: HIDE });
      await clearActors(page);
      await world(page, (w) => w.shot('yard-street', { held: true }));
      await coverSettled(page);
      const atYard = await cover(page);
      // Casters are decided when a unit is committed, relative to the focus then (`ChunkRenderer.castsShadows`): the toggle re-commits every
      // resident chunk at the shot's focus, so the frame before it can hold casters of an earlier focus. The two frames compared are
      // therefore both re-committed ones: off, then on again.
      expect(await setCover(page, false)).toBe(true);
      await coverSettled(page);
      const offImg = decodePng(await page.locator('#dv-engine-canvas').screenshot());
      await world(page, (w) => w.hold(true));
      const offCount = await live(page);
      const offParts = await parts(page);
      const off = await cover(page);
      await world(page, (w) => w.hold(false));
      expect(off.enabled).toBe(false);
      expect(off.pending).toBe(0);

      expect(await setCover(page, true)).toBe(true);
      await coverSettled(page);
      const onImg = decodePng(await page.locator('#dv-engine-canvas').screenshot());
      await world(page, (w) => w.hold(true));
      const onCount = await live(page);
      const onParts = await parts(page);
      await world(page, (w) => w.hold(false));
      const delta = meanAbsDifference(onImg, offImg);
      if (process.env['DV_COVER_DEBUG'] === '1') {
        mkdirSync('test-results/cover', { recursive: true });
        writeFileSync(`test-results/cover/${testInfo.project.name}.${tier}.yard-street.on.png`, encodePng(onImg));
        writeFileSync(`test-results/cover/${testInfo.project.name}.${tier}.yard-street.off.png`, encodePng(offImg));
      }
      console.log(`world-cover ${testInfo.project.name} ${tier}: yard-street mean |delta| ${delta.toFixed(4)}; render objects on ${onCount.renderObjects} off ${offCount.renderObjects}; cells ${JSON.stringify(atYard.cells)}`);
      expect(delta, `${tier}: the cover layer changes the yard-street frame`).toBeGreaterThanOrEqual(0.02);
      expect(offCount.renderObjects, `${tier}: the cover adds no render object (on ${JSON.stringify(onParts)}, off ${JSON.stringify(offParts)})`).toBe(onCount.renderObjects);
      expect(offCount.triangles, `${tier}: the cover adds no triangle`).toBe(onCount.triangles);

      await world(page, (w) => w.shot('hill-scrub', { held: true }));
      const atHill = await cover(page);
      if (process.env['DV_COVER_DEBUG'] === '1') writeFileSync(`test-results/cover/${testInfo.project.name}.${tier}.hill-scrub.png`, await page.locator('#dv-engine-canvas').screenshot());
      console.log(`world-cover ${testInfo.project.name} ${tier}: hill-scrub cells ${JSON.stringify(atHill.cells)}`);
      for (const c of CLASSES) expect((atYard.cells[c] ?? 0) + (atHill.cells[c] ?? 0), `${tier}: ${c} cells across both shots`).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('cover goldens @look-golden', () => {
  test.describe.configure({ timeout: 1_800_000 });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'goldens are chromium-webgl2 only');
  });
  const update = process.env['DV_UPDATE_GOLDEN'] === '1' && !process.env['CI'];

  for (const tier of COVER_GOLDEN_TIERS) {
    for (const shot of COVER_GOLDEN_SHOTS) {
      test(`${tier} ${shot} is within the tolerance of its golden and a second capture is byte-identical @look-golden`, async ({ page }) => {
        const file = `${GOLDEN_DIR}/${tier}.${shot}.png`;
        await bootWorld(page, tier, '', GOLDEN_VIEWPORT);
        await page.addStyleTag({ content: HIDE });
        await clearActors(page);
        await world(page, (w) => w.shot(shot));
        await frames(page, 2);
        const first: Rgba = decodePng(await page.locator('#dv-engine-canvas').screenshot());
        await frames(page, 2);
        const second = decodePng(await page.locator('#dv-engine-canvas').screenshot());
        expect(identical(first, second), 'two consecutive captures differ').toBe(true);
        if (update) {
          mkdirSync(GOLDEN_DIR, { recursive: true });
          writeFileSync(file, encodePng(first));
          return;
        }
        expect(existsSync(file), `${file} is missing; DV_UPDATE_GOLDEN=1 writes it (outside CI, under the golden-update label)`).toBe(true);
        const diff = diffImages(first, decodePng(readFileSync(file)));
        expect(goldenFailures(diff), `${tier} ${shot}: ${JSON.stringify(diff)}`).toEqual([]);
      });
    }
  }
});

// ---- the ledger (AC-8) ------------------------------------------------------------------------------------------------------------------

const LEDGER = 'docs/look/M02h3-render-ledger.json';
/** The latest merged ledger first (its `after` is this one's baseline). */
const PRIORS = ['docs/look/M10d5-render-ledger.json', 'docs/look/M10d4-render-ledger.json', 'docs/look/M02h2-render-ledger.json', 'docs/look/M02h1-render-ledger.json', 'docs/look/M10d1-render-ledger.json'];
const LEDGER_TIERS = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'] as const;
interface TierRow {
  baseline: number;
  after: number;
  perLayer: { cover: number };
  /** Triangles of the frame with the cover off and on again, both re-committed at the focus (equal: the cover moves colours and surface ids, never geometry). */
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
      // the layer's own delta: off, then on again, both frames re-committed at this focus (casters are decided at commit, see @world-cover)
      const toggled = async (o: boolean): Promise<{ renderObjects: number; triangles: number }> => {
        expect(await setCover(page, o)).toBe(true);
        await coverSettled(page);
        await world(page, (w) => w.hold(true));
        const r = await live(page);
        await world(page, (w) => w.hold(false));
        return r;
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
