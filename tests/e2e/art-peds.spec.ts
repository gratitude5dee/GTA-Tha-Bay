import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { waitForEngine } from './engine-helpers.ts';
import { crowdMax, LEDGER_NEAR_PED_CAP, LEDGER_PED_BODIES, streamAtPlan } from './ledger-helpers.ts';
import { bakeIdOf, bootWorld, frames, live, read, setSky, world, type W } from './markings-helpers.ts';

/**
 * M10d4 pedestrians in a real browser, on a `DV_WORLD=synth` QA build (the world half of the e2e legs):
 *
 *  - @art-peds    AC-8  per flat tier (`desktop`, `mobile-low`) with the QA crowd of 12: `world.peds().art` reports the kit (near and far),
 *                 its eight bodies and the atlas within the ped texture table, the refs drawn are the kit's (no `character/ped.ambient.*`,
 *                 no mannequin), the kit's assets were requested through the pack store, and the near figures stay within the cap;
 *                 `?art=0` keeps the mannequin; `@xr @art-peds`: the Quest tier is `legacy` with at most 8 near figures of the kit
 *  - @peds-ledger AC-9  `chromium-webgl2`: per profile, each pedestrian render object is one scene object (a near figure is one
 *                 `SkinnedMesh` with one material, a far body one `InstancedMesh`), so the kit adds 0 objects to the mannequin's count;
 *                 the frame of the ledger protocol (DL-758) is at or under the `after` of the latest merged ledger, and `mobile-low` stays
 *                 at or under 100 with its crowd. `DV_LOOK_WRITE=1` writes `docs/look/M10d4-render-ledger.json`.
 *
 * The pedestrian clips: no Library clip could be had (BD-M10d4-06), so every state keeps its placeholder clip, the milestone's fallback,
 * and the kit reports `clips: 'placeholder'`; the case checks the config names `anim/ped.moves` for the day the file exists.
 */
type PedArt = {
  bodies: number;
  near: 'kit' | 'mannequin';
  far: 'kit' | 'mannequin';
  clips: string;
  textureBytes: number;
  state: 'off' | 'loading' | 'ready' | 'failed';
  refs: string[];
};
type Peds = { near: number; far: number; objects: number; perBody: number[]; cap: number; nearCap: number; art: PedArt };

const peds = (page: Page): Promise<Peds | null> => world(page, (w) => w.peds() as unknown as Peds | null);

/** The ped texture table of the milestone (GPU MB) per look profile, and the profile of a tier. */
const TEXTURE_MB: Record<string, number> = { full: 8, lite: 3, min: 1, legacy: 3 };
const PROFILE: Record<string, string> = { desktop: 'full', 'desktop-ultra': 'full', mobile: 'lite', 'mobile-low': 'min', 'xr-quest': 'legacy' };

/** The QA crowd of the milestone (12 pedestrians 8 to 40 m around the player), then the kit loaded and near figures drawn. */
async function crowd(page: Page): Promise<void> {
  await expect
    .poll(async () => ((await world(page, (w) => w.call('state'))) as { topology?: boolean } | null)?.topology === true, { timeout: 180_000, intervals: [500, 1000, 2000] })
    .toBe(true);
  const placed = (await world(page, (w) => w.call('crowd', { n: 12 }))) as { placed: number } | null;
  expect(placed?.placed ?? 0, 'the QA crowd stands').toBeGreaterThan(3);
  await expect.poll(async () => (await peds(page))?.art.state ?? 'loading', { timeout: 300_000, intervals: [500, 1000] }).not.toBe('loading');
  await expect.poll(async () => (await peds(page))?.near ?? 0, { timeout: 180_000, intervals: [500, 1000, 2000] }).toBeGreaterThan(0);
}

/** The scene objects the pedestrians draw on the frame now: visible instanced bodies with instances, visible skinned near meshes. */
const sceneObjects = (page: Page): Promise<{ instanced: number; skinned: number; materials: number[]; nearTriangles: number[] }> =>
  page.evaluate(() => {
    type O = { visible: boolean; isInstancedMesh?: boolean; isSkinnedMesh?: boolean; count?: number; material: unknown; children: O[]; geometry?: { index: { count: number } | null } };
    const view = (window as unknown as W).__dvBridge.world.internals().view as unknown as { peds: { group: O } | null };
    const out = { instanced: 0, skinned: 0, materials: [] as number[], nearTriangles: [] as number[] };
    const walk = (o: O): void => {
      if (!o.visible) return;
      if (o.isInstancedMesh && (o.count ?? 0) > 0) out.instanced++;
      if (o.isSkinnedMesh) {
        out.skinned++;
        out.materials.push(Array.isArray(o.material) ? o.material.length : 1);
        out.nearTriangles.push((o.geometry?.index?.count ?? 0) / 3);
      }
      for (const c of o.children) walk(c);
    };
    if (view.peds) walk(view.peds.group);
    return out;
  });

test.describe('art peds @art-peds', () => {
  test.describe.configure({ timeout: 900_000 });

  for (const tier of ['desktop', 'mobile-low'] as const) {
    test(`${tier}: the pedestrians draw the people kit with the QA crowd @art-peds`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const requested = new Set<string>();
      page.on('request', (r) => {
        // characters are stored under `characters/<id>/model/`, the other kinds under `assets/<kind>/<id>/` (C07 object keys)
        const path = new URL(r.url()).pathname;
        const m = /\/assets\/((?:prop|texture)\/ped\.[a-z0-9._-]+)\//.exec(path) ?? /\/characters\/(ped\.[a-z0-9._-]+)\//.exec(path);
        if (m) requested.add(m[0].includes('/characters/') ? `character/${m[1] as string}` : (m[1] as string));
      });
      await bootWorld(page, tier);
      await crowd(page);
      const p = (await peds(page)) as Peds;
      expect(p.art).toMatchObject({ state: 'ready', near: 'kit', far: 'kit', bodies: LEDGER_PED_BODIES });
      expect(p.art.clips, 'no Library clip: the placeholder clips play (BD-M10d4-06)').toBe('placeholder');
      expect(p.art.textureBytes).toBeGreaterThan(0);
      expect(p.art.textureBytes / (1024 * 1024)).toBeLessThanOrEqual(TEXTURE_MB[PROFILE[tier] as string] as number);
      expect(p.art.refs.filter((r) => r.startsWith('character/ped.ambient') || r === 'mannequin'), 'no sim key and no mannequin is drawn').toEqual([]);
      expect(p.art.refs).toEqual(expect.arrayContaining(['character/ped.body.a', 'character/ped.outfit.01', 'prop/ped.far.a', 'texture/ped.atlas']));
      expect(p.nearCap).toBe(LEDGER_NEAR_PED_CAP[tier]);
      expect(p.near).toBeLessThanOrEqual(p.nearCap);
      // the kit came through the pack store: every body, far figure and outfit of the config, and the atlas
      for (const ref of ['character/ped.body.h', 'prop/ped.far.h', 'character/ped.outfit.20', 'texture/ped.atlas']) expect([...requested], ref).toContain(ref);
      const s = await sceneObjects(page);
      expect(s.skinned, 'one skinned mesh per near pedestrian').toBe((await peds(page))?.near);
      expect(s.materials.every((m) => m === 1), 'one material per near pedestrian').toBe(true);
      expect(s.nearTriangles.every((t) => t > 1000), `near figures are the kit's bodies (${s.nearTriangles.join(', ')} triangles)`).toBe(true);
      expect(errors).toEqual([]);
    });
  }

  test('a ?art=0 boot keeps the mannequin and requests no kit asset @art-peds', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (r) => {
      if (/\/(?:assets\/(?:prop|texture)|characters)\/ped\./.test(new URL(r.url()).pathname)) requested.push(r.url());
    });
    await bootWorld(page, 'mobile-low', '&art=0');
    await crowd(page);
    const p = (await peds(page)) as Peds;
    expect(p.art).toMatchObject({ state: 'off', near: 'mannequin', far: 'mannequin' });
    expect(requested).toEqual([]);
  });
});

test.describe('xr art peds @xr @art-peds', () => {
  test('the Quest tier draws the kit on the legacy profile with at most 8 near figures @xr @art-peds', async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 256, height: 144 });
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
    await crowd(page);
    const p = (await peds(page)) as Peds;
    expect(p.art).toMatchObject({ state: 'ready', near: 'kit', far: 'kit', bodies: LEDGER_PED_BODIES });
    expect(p.art.textureBytes / (1024 * 1024)).toBeLessThanOrEqual(TEXTURE_MB['legacy'] as number);
    expect(p.nearCap).toBe(8);
    expect(p.near).toBeLessThanOrEqual(8);
    const art = await world(page, (w) => w.art());
    expect(art?.profile, 'the XR look profile').toBe('legacy');
  });
});

// ---- the render-object ledger (AC-9) ------------------------------------------------------------------------------------------------

const LEDGER = 'docs/look/M10d4-render-ledger.json';
/** The latest merged ledger first: its `after` is this one's baseline (`_PLAN-3.md` Look program rule 5). */
const PRIORS = ['docs/look/M02h5-render-ledger.json', 'docs/look/M02h4-render-ledger.json', 'docs/look/M02h3-render-ledger.json', 'docs/look/M02h2-render-ledger.json'];
const LEDGER_TIERS = ['desktop', 'mobile', 'mobile-low'] as const;
interface TierRow {
  baseline: number;
  after: number;
  /** Render objects the kit adds over the mannequin (a near figure and a far body are one object either way). */
  perLayer: { peds: number };
  /** The QA crowd's frame: near figures, far bodies drawn, their render objects, the atlas bytes. */
  crowd: { near: number; farMeshes: number; objects: number; textureBytes: number };
}
interface Ledger {
  commit: string;
  bakeId: string;
  baselineFrom: string;
  drift?: { reason: string; measured: Record<string, number> };
  tiers: Record<string, TierRow>;
  xr?: { baseline: number; after: number; near: number };
}
const write = process.env['DV_LOOK_WRITE'] === '1';
const commitOf = (): string => process.env['GITHUB_SHA'] ?? process.env['DV_COMMIT'] ?? 'local';

function prior(): { file: string; ledger: { tiers: Record<string, { after: number }>; xr?: { after: number } } } {
  for (const file of PRIORS) if (existsSync(file)) return { file, ledger: read(file) };
  throw new Error(`no ledger before M10d4 in docs/look (${PRIORS.join(', ')})`);
}

/** The crowd's frame under the hold: the pedestrians' report and their scene objects, both of the frame shown. */
async function crowdFrame(page: Page): Promise<{ p: Peds; s: Awaited<ReturnType<typeof sceneObjects>> }> {
  await frames(page, 3);
  await world(page, (w) => w.hold(true));
  try {
    return { p: (await peds(page)) as Peds, s: await sceneObjects(page) };
  } finally {
    await world(page, (w) => w.hold(false));
  }
}

test.describe('peds ledger @peds-ledger', () => {
  test.describe.configure({ timeout: 1_800_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the ledger is chromium-webgl2 only (the XR case runs on xr-quest3)');
  });
  const measured: Record<string, TierRow> = {};

  for (const tier of LEDGER_TIERS) {
    test(`${tier}: the kit adds no render object and the frame holds its count @peds-ledger`, async ({ page }) => {
      await bootWorld(page, tier);
      await setSky(page, 13, 'clear');
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
      await crowd(page);
      const { p, s } = await crowdFrame(page);
      expect(p.art.near).toBe('kit');
      const farMeshes = p.perBody.filter((n) => n > 0).length;
      expect(farMeshes).toBeLessThanOrEqual(LEDGER_PED_BODIES);
      // every pedestrian render object is one scene object: what the mannequin costs (near + far bodies drawn), so the kit adds 0
      expect(s.skinned, 'near figures').toBe(p.near);
      expect(s.instanced, 'far bodies drawn').toBe(farMeshes);
      expect(s.materials.every((m) => m === 1)).toBe(true);
      expect(p.objects, 'the renderer counts near + far meshes').toBe(p.near + farMeshes);
      const pedsAdded = s.skinned + s.instanced - p.objects;
      expect(pedsAdded).toBe(0);
      expect(p.art.textureBytes / (1024 * 1024)).toBeLessThanOrEqual(TEXTURE_MB[PROFILE[tier] as string] as number);
      // the frame of the ledger protocol (DL-758): the plan resident, the crowd hidden, read on a held frame
      if (tier === 'mobile-low') await world(page, (w) => w.shot('fog-west'));
      await streamAtPlan(page);
      await world(page, (w) => w.hold(true));
      const after = (await live(page)).renderObjects;
      await world(page, (w) => w.hold(false));
      const baseline = prior().ledger.tiers[tier]?.after;
      expect(baseline, `${prior().file} holds ${tier}`).toBeDefined();
      expect(after, `${tier}: render objects against the after (${baseline}) of ${prior().file}`).toBeLessThanOrEqual(baseline ?? 0);
      if (tier === 'mobile-low') expect(after + crowdMax(tier), `mobile-low after ${after} + crowd max ${crowdMax(tier)}`).toBeLessThanOrEqual(100);
      measured[tier] = {
        baseline: baseline ?? after,
        after,
        perLayer: { peds: pedsAdded },
        crowd: { near: p.near, farMeshes, objects: p.objects, textureBytes: p.art.textureBytes },
      };
      console.log(`peds ledger ${tier}: ${JSON.stringify(measured[tier])} (crowd max ${crowdMax(tier)})`);
    });
  }

  test('writes (DV_LOOK_WRITE=1) or checks the committed ledger @peds-ledger', () => {
    const base = prior();
    if (write) {
      const drift: Record<string, number> = {};
      for (const tier of LEDGER_TIERS) {
        const m = measured[tier];
        if (m && m.after !== m.baseline) drift[tier] = m.after;
      }
      const old = existsSync(LEDGER) ? read<Ledger>(LEDGER) : undefined;
      const out: Ledger = {
        commit: commitOf(),
        bakeId: bakeIdOf(),
        baselineFrom: base.file,
        ...(Object.keys(drift).length > 0
          ? { drift: { reason: `${base.file} was measured on a scene later rows changed; this checkout reads the render objects in measured, and the people kit adds none`, measured: drift } }
          : {}),
        tiers: Object.fromEntries(LEDGER_TIERS.filter((t) => measured[t]).map((t) => [t, measured[t] as TierRow])),
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
      expect(t.perLayer.peds, `${tier} objects added by the kit`).toBe(0);
      expect(t.crowd.near).toBeLessThanOrEqual(LEDGER_NEAR_PED_CAP[tier]);
      expect(t.crowd.farMeshes).toBeLessThanOrEqual(LEDGER_PED_BODIES);
      expect(t.crowd.textureBytes / (1024 * 1024)).toBeLessThanOrEqual(TEXTURE_MB[PROFILE[tier] as string] as number);
      if (t.after !== t.baseline) expect(ledger.drift?.measured[tier], `${tier}: after ${t.after} is not the baseline ${t.baseline}: the ledger says why`).toBe(t.after);
    }
    expect((ledger.tiers['mobile-low']?.after ?? 0) + crowdMax('mobile-low'), 'mobile-low after + crowd max').toBeLessThanOrEqual(100);
    if (ledger.xr) {
      expect(ledger.xr.after).toBeLessThanOrEqual(ledger.xr.baseline);
      expect(ledger.xr.near).toBeLessThanOrEqual(8);
    }
  });
});

test.describe('xr peds ledger @xr @peds-ledger', () => {
  test('the Quest tier draws the kit within its near cap and holds its count @xr @peds-ledger', async ({ page }) => {
    test.setTimeout(900_000);
    await page.setViewportSize({ width: 256, height: 144 });
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
    await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
    await crowd(page);
    const { p, s } = await crowdFrame(page);
    expect(p.art.near).toBe('kit');
    expect(p.near).toBeLessThanOrEqual(8);
    expect(s.skinned + s.instanced).toBe(p.objects);
    await streamAtPlan(page);
    await world(page, (w) => w.hold(true));
    const objects = (await live(page)).renderObjects;
    await world(page, (w) => w.hold(false));
    const priorXr = prior().ledger.xr?.after;
    console.log(`peds ledger xr: ${objects} render objects, ${p.near} near (prior after ${String(priorXr)})`);
    if (priorXr !== undefined) expect(objects, 'the Quest count against the prior ledger').toBeLessThanOrEqual(priorXr);
    if (write && existsSync(LEDGER)) {
      const l = read<Ledger>(LEDGER);
      l.xr = { baseline: priorXr ?? objects, after: objects, near: p.near };
      writeFileSync(LEDGER, `${JSON.stringify(l, null, 2)}\n`);
    }
  });
});
