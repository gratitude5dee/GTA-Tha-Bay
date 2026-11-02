import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { decodePng, diffImages, encodePng, goldenFailures, identical, type Rgba } from '../support/image-diff.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';
import { crowdMax, streamAtPlan } from './ledger-helpers.ts';
import { FLAT_TIERS, GOLDEN_VIEWPORT, HIDE, bakeIdOf, bootWorld, clearActors, frames, live, read, setSky, world, type W } from './markings-helpers.ts';

/**
 * M02h4 street-tree forms in a real browser, on a `DV_WORLD=synth` QA build.
 *
 *  - @world-trees (AC-5) per flat tier on `chromium-webgl2` and `webkit-webgl2`: `look().vegetation` reports the `full` / `lite` / `low`
 *    set with 10 / 5 / 2 pools and all five forms resident, the wind above 0 at `desktop` only, and after a 2 km teleport and back the
 *    drawn instances are the resident units' within `tree.drawM` (each unit shown within `drawM`, hidden beyond `drawM` x 1.1, nothing
 *    pending); `?treeForms=0` (the QA twin of `world.treeForms: false`) reports one cone pool.
 *  - @look-golden (AC-6, `chromium-webgl2`): `trees-street` at `desktop` and `mobile-low` against `tests/e2e/golden/look/<tier>.trees-street.png`,
 *    two captures byte-identical (the wind clock is the look clock, which `shot()` freezes). `DV_UPDATE_GOLDEN=1` writes them.
 *  - @trees-ledger (AC-8, `chromium-webgl2`): the render objects of the ledger frame (DL-758) per tier and the trees' own delta, the pools
 *    drawing against what M02g2's per-unit vegetation objects would have been in the same frame; `DV_LOOK_WRITE=1` writes
 *    `docs/look/M02h4-render-ledger.json`. `@xr @trees-ledger` measures the Quest tier.
 */

type Veg = {
  shown: number; hidden: number; farthestM: number; drawM: number; crossings: number; set: string; pools: number; drawnPools: number;
  forms: { form: string; instances: number; drawn: number; tris: number }[]; wind: number; drawnInstances: number; pendingCrossings: number;
};
const veg = async (page: Page): Promise<Veg> => {
  const v = await world(page, (w) => (w.look() as unknown as { vegetation?: unknown } | null)?.vegetation ?? null);
  expect(v, 'look().vegetation is reported').not.toBeNull();
  return v as Veg;
};
const SET: Record<string, { set: string; pools: number }> = { desktop: { set: 'full', pools: 10 }, mobile: { set: 'lite', pools: 5 }, 'mobile-low': { set: 'low', pools: 2 } };

/**
 * The trees of the resident L0 units as the renderer holds them: per unit its instances, whether they are drawn and its distance (the
 * nearest edge of its square, in plan) from the camera of the last visibility pass.
 */
async function residentTrees(page: Page): Promise<{ id: string; n: number; shown: boolean; distM: number }[]> {
  return page.evaluate(() => {
    type U = { level: string; hasTrees: boolean; vegShown: boolean; mesh: { trees: Float32Array; originX: number; originZ: number } };
    const r = (window as unknown as W).__dvBridge.world.internals().view as unknown as { renderer: { units: Map<string, U>; camPos: [number, number, number] | null } };
    const cam = r.renderer.camPos ?? [0, 0, 0];
    const out: { id: string; n: number; shown: boolean; distM: number }[] = [];
    for (const [id, u] of r.renderer.units) {
      if (u.level !== 'l0' || !u.hasTrees) continue;
      const dx = Math.max(0, Math.abs(u.mesh.originX + 128 - cam[0]) - 128);
      const dz = Math.max(0, Math.abs(u.mesh.originZ + 128 - cam[2]) - 128);
      out.push({ id, n: u.mesh.trees.length / 6, shown: u.vegShown, distM: Math.hypot(dx, dz) });
    }
    return out;
  });
}

const cameraXZ = (page: Page): Promise<{ x: number; z: number }> =>
  page.evaluate(() => {
    const v = (window as unknown as W).__dvBridge.world.internals().view as unknown as { host: { camera: { position: { x: number; z: number } } } };
    return { x: v.host.camera.position.x, z: v.host.camera.position.z };
  });

/** The stream quiet and the pools' crossing queue empty: the drawn prefix follows the units. */
async function treesSettled(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(240_000));
  await expect.poll(async () => (await veg(page)).pendingCrossings, { timeout: 180_000, intervals: [500] }).toBe(0);
  // one visibility pass after the settle (every 8 frames), so every unit has its drawM state for this camera
  await frames(page, 10);
  await expect.poll(async () => (await veg(page)).pendingCrossings, { timeout: 180_000, intervals: [500] }).toBe(0);
}

test.describe('world trees @world-trees', () => {
  test.describe.configure({ timeout: 1_800_000 });

  for (const tier of FLAT_TIERS) {
    test(`${tier}: the set, its pools and all five forms; wind on desktop only; drawn trees follow a 2 km teleport and back @world-trees`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text());
      });
      await bootWorld(page, tier, '', SMALL_VIEWPORT);
      const want = SET[tier] as { set: string; pools: number };
      const v0 = await veg(page);
      expect(v0.set).toBe(want.set);
      expect(v0.pools).toBe(want.pools);
      expect(v0.drawnPools).toBeLessThanOrEqual(want.pools);
      // all five forms among the resident trees
      await expect.poll(async () => (await veg(page)).forms.filter((f) => f.instances > 0).length, { timeout: 180_000, intervals: [500] }).toBe(5);
      // the wind: above 0 at desktop (the sky's frame sets it), 0 elsewhere, and the layer only on desktop
      if (tier === 'desktop') {
        await expect.poll(async () => (await veg(page)).wind, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
        expect(await world(page, (w) => w.setLookLayer('wind', false))).toBe(true);
        expect((await veg(page)).wind).toBe(0);
        expect(await world(page, (w) => w.setLookLayer('wind', true))).toBe(true);
      } else {
        await frames(page, 4);
        expect((await veg(page)).wind).toBe(0);
        expect(await world(page, (w) => w.setLookLayer('wind', true))).toBe(false);
      }

      // a 2 km teleport and back
      const home = await cameraXZ(page);
      let away = false;
      for (const [dx, dz] of [[2000, 0], [-2000, 0], [0, 2000], [0, -2000]] as const) {
        await page.evaluate((p) => (window as unknown as W).__dvBridge.world.teleport({ x: p.x, z: p.z }), { x: home.x + dx, z: home.z + dz });
        await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(240_000));
        const at = await cameraXZ(page);
        if (Math.hypot(at.x - home.x, at.z - home.z) > 1500) {
          away = true;
          break;
        }
      }
      expect(away, 'the player teleported 2 km away').toBe(true);
      await treesSettled(page);
      await page.evaluate((p) => (window as unknown as W).__dvBridge.world.teleport({ x: p.x, z: p.z }), home);
      await treesSettled(page);
      const back = await cameraXZ(page);
      expect(Math.hypot(back.x - home.x, back.z - home.z), 'back home').toBeLessThan(50);

      const units = await residentTrees(page);
      const v = await veg(page);
      const drawnByUnits = units.filter((u) => u.shown).reduce((n, u) => n + u.n, 0);
      console.log(`world-trees ${tier}: set ${v.set}, pools ${v.pools} (${v.drawnPools} drawing), forms ${JSON.stringify(v.forms)}, wind ${v.wind}, drawn ${v.drawnInstances} of ${units.reduce((n, u) => n + u.n, 0)} resident in ${units.length} units, crossings ${v.crossings}`);
      expect(units.length).toBeGreaterThan(0);
      expect(v.drawnInstances, 'the pools draw the instances of the units within drawM').toBe(drawnByUnits);
      expect(v.forms.reduce((n, f) => n + f.drawn, 0)).toBe(drawnByUnits);
      for (const u of units) {
        if (u.distM <= v.drawM) expect(u.shown, `${u.id} at ${u.distM.toFixed(0)} m is within drawM ${v.drawM}`).toBe(true);
        if (u.distM > v.drawM * 1.1) expect(u.shown, `${u.id} at ${u.distM.toFixed(0)} m is beyond drawM x 1.1`).toBe(false);
      }
      expect(errors).toEqual([]);
    });
  }

  test('mobile-low: world.treeForms off (?treeForms=0) draws one cone pool @world-trees', async ({ page }) => {
    await bootWorld(page, 'mobile-low', '&treeForms=0', SMALL_VIEWPORT);
    const v = await veg(page);
    expect(v.set).toBe('cone');
    expect(v.pools).toBe(1);
    expect(v.drawnPools).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await veg(page)).drawnInstances, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
  });
});

// ---- the goldens (AC-6) --------------------------------------------------------------------------------------------------------

const GOLDEN_DIR = 'tests/e2e/golden/look';
const TREE_GOLDEN_TIERS = ['desktop', 'mobile-low'] as const;

test.describe('tree goldens @look-golden', () => {
  test.describe.configure({ timeout: 1_800_000 });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'goldens are chromium-webgl2 only');
  });
  const update = process.env['DV_UPDATE_GOLDEN'] === '1' && !process.env['CI'];

  for (const tier of TREE_GOLDEN_TIERS) {
    test(`${tier} trees-street is within the tolerance of its golden and a second capture is byte-identical @look-golden`, async ({ page }) => {
      const file = `${GOLDEN_DIR}/${tier}.trees-street.png`;
      await bootWorld(page, tier, '', GOLDEN_VIEWPORT);
      await page.addStyleTag({ content: HIDE });
      await clearActors(page);
      await page.evaluate(() => (window as unknown as W).__dvBridge.world.shot('trees-street', { held: true }));
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
      if (goldenFailures(diff).length > 0) {
        mkdirSync('test-results/trees-golden', { recursive: true });
        writeFileSync(`test-results/trees-golden/${tier}.trees-street.actual.png`, encodePng(first));
      }
      expect(goldenFailures(diff), `${tier} trees-street: ${JSON.stringify(diff)}`).toEqual([]);
    });
  }
});

// ---- the ledger (AC-8) ---------------------------------------------------------------------------------------------------------

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
