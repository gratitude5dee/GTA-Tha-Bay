import { expect, test, type Page } from '@playwright/test';
import type { PerfReport, TeleportResult } from '../../packages/shared/src/index.ts';
import type { LandmarksReport } from '../../packages/world/src/client/chunks/landmark-layer.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { observe, SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M02d1 and M02d2 landmarks in a real browser, on a `DV_WORLD=synth` QA build. Everything goes through `__dvBridge.world`.
 *
 *  - @world-landmarks-swap  M02d2 AC-6  at `?tier=mobile-low` the camera follows `route-ferry-ocean-beach`: every skyline landmark inside the
 *                     draw distance is drawn on every sampled frame, no frame hides a proxy without a model drawn, every
 *                     `landmark.swap` commit is one upload and leaves a proxy or a model (the main-thread ms are printed, not asserted)
 *  - @world-landmarks  AC-6  at `?tier=mobile` the bridge teleports to `lm.coit-tower`: the landmark becomes resident, the chunks that
 *                     hold its proxies report a proxy mask and exactly one re-record request each, no frame uploads more than one
 *                     chunk; moving away restores the proxies, then evicts the landmark; 2 km away nothing is resident
 *  - the default scene: City Hall, where the player spawns, is resident without any call
 *  - every one of the 12 landmarks becomes resident at `?tier=desktop` and at `?tier=mobile-low`, within its object budget (AC-9 is the
 *    manual look at them: `docs/device-runs/M02d1/desktop/notes.json`)
 */
type W = { __dvBridge: { world: WorldBridge } };

const TWELVE = [
  'lm.city-hall', 'lm.golden-gate-bridge', 'lm.bay-bridge-ybi', 'lm.coit-tower', 'lm.ferry-building', 'lm.pyramid-tower',
  'lm.crown-tower', 'lm.sutro-tower', 'lm.palace-fine-arts', 'lm.alcatraz', 'lm.twin-peaks', 'lm.lombard-crooked',
] as const;

const SKYLINE = ['lm.golden-gate-bridge', 'lm.bay-bridge-ybi', 'lm.sutro-tower', 'lm.crown-tower', 'lm.pyramid-tower', 'lm.coit-tower', 'lm.ferry-building'] as const;
/** Rows 13 to 37 of 02-world-bake.md section 7 (M02d2). */
const REST = [
  'lm.painted-ladies', 'lm.china-basin-ballpark', 'lm.mission-bay-arena', 'lm.pier-39', 'lm.fort-point', 'lm.grace-cathedral', 'lm.dragon-gate',
  'lm.transit-center-park', 'lm.hunters-point-yard', 'lm.mount-davidson-cross', 'lm.dolores-park', 'lm.haight-ashbury', 'lm.flower-conservatory',
  'lm.park-bandshell', 'lm.cliff-house', 'lm.crissy-field', 'lm.powell-turntable', 'lm.lands-end-lookout', 'lm.candlestick-point',
  'lm.treasure-island', 'lm.un-plaza', 'lm.rail-terminus', 'lm.peace-pagoda', 'lm.opera-house', 'lm.saint-mary-cathedral',
] as const;

const world = <T>(page: Page, fn: (w: WorldBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.world)`) as Promise<T>;

async function boot(page: Page, tier: string, extra = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto(`/?debug=1&tier=${tier}${extra}`);
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 180_000 });
  // the world services exist once the sim module has the index
  await expect
    .poll(async () => ((await world(page, (w) => w.call('state'))) as { topology?: boolean } | null)?.topology === true, { timeout: 120_000, intervals: [500, 1000, 2000] })
    .toBe(true);
  return errors;
}

const shown = (r: LandmarksReport | null): string[] => (r?.resident ?? []).filter((e) => e.phase === 'shown').map((e) => e.id).sort();

async function teleport(page: Page, id: string): Promise<TeleportResult> {
  const result = (await page.evaluate((lm) => (window as unknown as W).__dvBridge.world.teleport(lm), id)) as TeleportResult | null;
  expect(result, id).not.toBeNull();
  return result as TeleportResult;
}

test.describe('landmarks @world', () => {
  test.describe.configure({ timeout: 1_200_000 });

  test('the default scene shows City Hall as a model, not as extrusions @world-landmarks', async ({ page }) => {
    const errors = await boot(page, 'mobile');
    await expect.poll(async () => shown(await world(page, (w) => w.landmarks())), { timeout: 120_000, intervals: [500, 1000, 2000] }).toContain('lm.city-hall');
    const r = (await world(page, (w) => w.landmarks()))!;
    console.log(`world-landmarks default: ${JSON.stringify(r.resident.map((e) => ({ id: e.id, fid: e.fidelity, objects: e.objects, tris: e.triangles, chunks: e.chunks.length })))}`);
    expect(r.cap).toBe(4);
    expect(r.swapM).toBe(500);
    expect(r.failed).toEqual([]);
    // the model is a mid-fidelity one on `mobile`
    expect(r.resident.find((e) => e.id === 'lm.city-hall')?.fidelity).toBe('mid');
    await world(page, (w) => w.settle(60_000));
    await page.setViewportSize({ width: 960, height: 540 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/world-landmarks/default-scene-mobile.png' });
    expect(errors).toEqual([]);
  });

  test('at mobile the bridge teleports to lm.palace-fine-arts (not in the skyline set): resident, its proxy chunks masked with one re-record each; away restores them @m02d2 @world-landmarks', async ({ page }) => {
    const errors = await boot(page, 'mobile');
    const result = await teleport(page, 'lm.palace-fine-arts');
    console.log(`world-landmarks teleport palace: ${JSON.stringify(result)}`);
    expect(result.ok).toBe(true);
    await expect.poll(async () => shown(await world(page, (w) => w.landmarks())), { timeout: 180_000, intervals: [500, 1000, 2000] }).toContain('lm.palace-fine-arts');

    // the chunks that hold its proxies are meshed again with the proxy left out
    await expect
      .poll(
        async () => {
          const e = (await world(page, (w) => w.landmarks()))!.resident.find((x) => x.id === 'lm.palace-fine-arts');
          return e !== undefined && e.chunks.length > 0 && e.chunks.every((c) => c.masked);
        },
        { timeout: 180_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);
    await world(page, (w) => w.settle(60_000));
    const up = (await world(page, (w) => w.landmarks()))!;
    const palace = up.resident.find((x) => x.id === 'lm.palace-fine-arts')!;
    console.log(`world-landmarks palace up: ${JSON.stringify(palace)}`);
    expect(palace.fidelity).toBe('mid');
    expect(palace.objects).toBeLessThanOrEqual(3);
    expect(palace.chunks.length).toBeGreaterThanOrEqual(1);
    // at most one re-record request per chunk: a chunk that is already up when the swap commits is replaced once by its masked mesh; a
    // chunk that streams in after the commit arrives masked (0 re-records)
    for (const c of palace.chunks) {
      expect(c.masked, c.key).toBe(true);
      expect(c.bundleRerecords, c.key).toBeLessThanOrEqual(1);
    }
    expect(up.resident.length).toBeLessThanOrEqual(up.cap);
    expect(up.maxResident).toBeLessThanOrEqual(up.cap);
    expect(up.failed).toEqual([]);
    // nothing in the stream uploaded more than one chunk in a frame, the remeshes included
    const chunks = await world(page, (w) => w.chunks());
    expect(chunks.uploads.perFrameMax).toBeLessThanOrEqual(1);
    expect(chunks.uploads.oversize).toBe(0);
    await page.setViewportSize({ width: 960, height: 540 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/world-landmarks/palace-fine-arts-mobile.png' });
    await page.setViewportSize(SMALL_VIEWPORT);

    // 700 m away: beyond swapM x 1.05 (525 m) but inside the keep ring of the L0 chunks, so the proxies can be seen coming back
    const at = (await observe(page)).player!.pos;
    const focusAt = (x: number, z: number): Promise<unknown> => page.evaluate(([fx, fz]) => (window as unknown as W).__dvBridge.world.focus(fx as number, fz as number), [x, z]);
    await focusAt(at[0] + 700, at[2]);
    await expect
      .poll(async () => (await world(page, (w) => w.landmarks()))!.resident.find((x) => x.id === 'lm.palace-fine-arts'), { timeout: 120_000, intervals: [250, 500, 1000] })
      .toBeUndefined();
    await world(page, (w) => w.settle(60_000));
    const back = await world(page, (w) => {
      const c = w.chunks();
      return { masks: c.bundleRerecords };
    });
    // every chunk that held a proxy of the landmark has been replaced once more: meshed back
    for (const c of palace.chunks) expect(back.masks[`l0:${c.key}`], c.key).toBe(c.bundleRerecords + 1);

    // 2 km from the landmark nothing of it is resident or loading
    await focusAt(at[0] + 2000, at[2]);
    await world(page, (w) => w.settle(60_000));
    const far = (await world(page, (w) => w.landmarks()))!;
    expect(far.resident.find((x) => x.id === 'lm.palace-fine-arts')).toBeUndefined();
    expect(far.failed).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('at mobile a skyline landmark (lm.coit-tower) comes up over its skyline instance: one re-record per chunk at most, and the proxies stay masked when it leaves @m02d2 @world-landmarks', async ({ page }) => {
    const errors = await boot(page, 'mobile');
    const result = await teleport(page, 'lm.coit-tower');
    expect(result.ok).toBe(true);
    await expect.poll(async () => shown(await world(page, (w) => w.landmarks())), { timeout: 180_000, intervals: [500, 1000, 2000] }).toContain('lm.coit-tower');
    await expect
      .poll(
        async () => {
          const e = (await world(page, (w) => w.landmarks()))!.resident.find((x) => x.id === 'lm.coit-tower');
          return e !== undefined && e.chunks.length > 0 && e.chunks.every((c) => c.masked);
        },
        { timeout: 180_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);
    await world(page, (w) => w.settle(60_000));
    const up = (await world(page, (w) => w.landmarks()))!;
    const coit = up.resident.find((x) => x.id === 'lm.coit-tower')!;
    const sky = up.skyline.entries.find((x) => x.id === 'lm.coit-tower')!;
    console.log(`world-landmarks coit up: ${JSON.stringify(coit)}; skyline entry ${JSON.stringify(sky)}`);
    // one visible model: the skyline instance is under the full one
    expect(sky.visible).toBe(false);
    expect(sky.hiddenBy).toBe('full');
    // the proxies were meshed out once (by the skyline or by the swap): no chunk is replaced twice
    for (const c of coit.chunks) expect(c.bundleRerecords, c.key).toBeLessThanOrEqual(1);
    expect(up.frames.holes).toBe(0);
    // 700 m away: the full model goes, the skyline instance is drawn again in the same step and the proxies stay out
    const at = (await observe(page)).player!.pos;
    await page.evaluate(([fx, fz]) => (window as unknown as W).__dvBridge.world.focus(fx as number, fz as number), [at[0] + 700, at[2]]);
    await expect
      .poll(async () => (await world(page, (w) => w.landmarks()))!.resident.find((x) => x.id === 'lm.coit-tower'), { timeout: 120_000, intervals: [250, 500, 1000] })
      .toBeUndefined();
    await world(page, (w) => w.settle(60_000));
    const back = (await world(page, (w) => w.landmarks()))!;
    const sky2 = back.skyline.entries.find((x) => x.id === 'lm.coit-tower')!;
    expect(sky2.visible).toBe(true);
    expect(back.frames.holes).toBe(0);
    for (const c of coit.chunks) expect((await world(page, (w) => w.chunks())).bundleRerecords[`l0:${c.key}`], c.key).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  for (const tier of ['desktop', 'mobile-low'] as const) {
    test(`each of the twelve landmarks becomes resident at ${tier}, within its triangle budget @world-landmarks`, async ({ page }) => {
      const errors = await boot(page, tier);
      const cap = tier === 'desktop' ? 8 : 3;
      // BD-FIX-CI8-H01: no settle() between landmarks. Every assertion below reads the landmark layer, which is up once the model
      // is shown; settle() waited for the whole chunk ring of the tier to upload (one chunk per frame, M02b1), and at desktop on
      // SwiftShader that ring alone took 17 to 53 s per landmark (often the full 45 s, 45 chunks still queued), about half of the
      // test. The cap holds over the whole run (`maxResident`, below), not only at the twelve sampled moments.
      for (const id of TWELVE) {
        const result = await teleport(page, id);
        expect(result.ok, `${id}: ${JSON.stringify(result)}`).toBe(true);
        await expect
          .poll(async () => shown(await world(page, (w) => w.landmarks())), { timeout: 180_000, intervals: [500, 1000, 2000], message: id })
          .toContain(id);
        const r = (await world(page, (w) => w.landmarks()))!;
        const e = r.resident.find((x) => x.id === id)!;
        console.log(`world-landmarks ${tier} ${id}: ${e.fidelity} ${e.objects} objects ${e.triangles} tris, ${e.chunks.length} proxy chunks, ${e.chunks.filter((c) => c.masked).length} masked, ${Math.round(e.distM)} m`);
        expect(e.fidelity).toBe(tier === 'desktop' ? 'hi' : 'lo');
        expect(e.objects).toBeLessThanOrEqual(tier === 'desktop' ? 3 : 2);
        expect(r.resident.length).toBeLessThanOrEqual(cap);
        expect(r.failed).toEqual([]);
      }
      const end = (await world(page, (w) => w.landmarks()))!;
      expect(end.maxResident).toBeLessThanOrEqual(cap);
      expect(end.failed).toEqual([]);
      const chunks = await world(page, (w) => w.chunks());
      expect(chunks.uploads.perFrameMax).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    });
  }

  // ---- M02d2: the 25 remaining landmarks, the skyline and the swap along the route ---------------------------------------------------------

  test('the skyline is up in the default scene at desktop: all seven far silhouettes are drawn as lo models, outside the cap @m02d2 @world-landmarks', async ({ page }) => {
    const errors = await boot(page, 'desktop');
    await expect
      .poll(async () => ((await world(page, (w) => w.landmarks()))?.skyline.entries ?? []).filter((e) => e.visible).length, { timeout: 180_000, intervals: [500, 1000, 2000] })
      .toBe(7);
    await world(page, (w) => w.settle(60_000));
    const r = (await world(page, (w) => w.landmarks()))!;
    console.log(`world-landmarks skyline desktop: ${JSON.stringify(r.skyline.entries.map((e) => ({ id: e.id, d: Math.round(e.distM), fid: e.fidelity, tris: e.triangles, visible: e.visible })))}`);
    expect(r.skyline.entries.map((e) => e.id)).toEqual([...SKYLINE].sort());
    for (const e of r.skyline.entries) {
      expect(e.fidelity, e.id).toBe('lo');
      expect(e.phase, e.id).toBe('shown');
      expect(e.hiddenBy, e.id).toBeNull();
      expect(e.distM, e.id).toBeLessThanOrEqual(r.skyline.rangeM);
    }
    // City Hall, the spawn, is a full-fidelity landmark; the skyline is not counted against the cap
    expect(shown(r)).toContain('lm.city-hall');
    expect(r.resident.length).toBeLessThanOrEqual(r.cap);
    expect(r.failed).toEqual([]);
    await page.setViewportSize({ width: 960, height: 540 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/world-landmarks/skyline-default-desktop.png' });
    await page.keyboard.press('F4');
    await page.keyboard.down('Shift');
    await page.keyboard.down('Space');
    await page.waitForTimeout(1500);
    await page.keyboard.up('Space');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'test-results/world-landmarks/skyline-city-hall-free-cam-desktop.png' });
    await page.keyboard.press('F4');
    // and from Twin Peaks, the overlook: the whole skyline is in front of the camera
    const tp = await teleport(page, 'lm.twin-peaks');
    expect(tp.ok).toBe(true);
    await expect.poll(async () => shown(await world(page, (w) => w.landmarks())), { timeout: 180_000, intervals: [500, 1000, 2000] }).toContain('lm.twin-peaks');
    await world(page, (w) => w.settle(60_000));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/world-landmarks/skyline-twin-peaks-desktop.png' });
    // the free camera (F4) lifts the view above the roofs: the picture the owner looks at (see packages/world/README.md)
    await page.keyboard.press('F4');
    await page.keyboard.down('Shift');
    await page.keyboard.down('Space');
    await page.waitForTimeout(1500);
    await page.keyboard.up('Space');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'test-results/world-landmarks/skyline-twin-peaks-free-cam-desktop.png' });
    await page.keyboard.press('F4');
    const tr = (await world(page, (w) => w.landmarks()))!;
    expect(tr.skyline.entries.filter((e) => e.distM <= tr.skyline.rangeM).every((e) => e.visible || e.hiddenBy === 'full')).toBe(true);
    expect(tr.frames.holes).toBe(0);
    expect(errors).toEqual([]);
  });

  test('a skyline landmark that becomes resident at full fidelity hides its skyline instance: one visible model per landmark @m02d2 @world-landmarks', async ({ page }) => {
    const errors = await boot(page, 'mobile-low');
    const result = await teleport(page, 'lm.ferry-building');
    expect(result.ok).toBe(true);
    await expect.poll(async () => shown(await world(page, (w) => w.landmarks())), { timeout: 180_000, intervals: [500, 1000, 2000] }).toContain('lm.ferry-building');
    // the other skyline landmarks inside the mount ring come up a moment after a teleport: wait for them
    await expect
      .poll(
        async () => {
          const x = (await world(page, (w) => w.landmarks()))!;
          return x.skyline.entries.filter((e) => e.distM <= x.skyline.mountM).every((e) => e.visible || e.hiddenBy === 'full');
        },
        { timeout: 180_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);
    await world(page, (w) => w.settle(60_000));
    const r = (await world(page, (w) => w.landmarks()))!;
    const ferry = r.skyline.entries.find((e) => e.id === 'lm.ferry-building');
    console.log(`world-landmarks ferry skyline entry: ${JSON.stringify(ferry)}; others drawn: ${r.skyline.entries.filter((e) => e.visible).map((e) => e.id).join(', ')}`);
    expect(ferry?.visible).toBe(false);
    expect(ferry?.hiddenBy).toBe('full');
    expect(r.resident.find((e) => e.id === 'lm.ferry-building')?.fidelity).toBe('lo');
    // every skyline landmark inside the draw distance has exactly one drawn model
    for (const e of r.skyline.entries.filter((x) => x.distM <= r.skyline.rangeM)) {
      const full = r.resident.some((f) => f.id === e.id && f.phase === 'shown');
      expect(e.visible || full, e.id).toBe(true);
      expect(e.visible && full, `${e.id} drawn twice`).toBe(false);
    }
    expect(r.frames.holes).toBe(0);
    expect(errors).toEqual([]);
  });

  // The 25 new landmarks at mobile-low (the `lo` fidelity: at most two objects), in three tests so the workers share them.
  const GROUPS = [REST.slice(0, 9), REST.slice(9, 18), REST.slice(18)];
  for (const [g, group] of GROUPS.entries()) {
    test(`landmarks of rows 13 to 37, part ${g + 1} of 3 (${group.length}): each becomes resident at mobile-low within its object budget @world-landmarks @m02d2`, async ({ page }) => {
      const errors = await boot(page, 'mobile-low');
      for (const id of group) {
        const result = await teleport(page, id);
        expect(result.ok, `${id}: ${JSON.stringify(result)}`).toBe(true);
        await expect
          .poll(async () => shown(await world(page, (w) => w.landmarks())), { timeout: 180_000, intervals: [500, 1000, 2000], message: id })
          .toContain(id);
        const r = (await world(page, (w) => w.landmarks()))!;
        const e = r.resident.find((x) => x.id === id)!;
        console.log(`world-landmarks mobile-low ${id}: ${e.fidelity} ${e.objects} objects ${e.triangles} tris, ${e.chunks.length} proxy chunks, ${Math.round(e.distM)} m`);
        expect(e.fidelity).toBe('lo');
        expect(e.objects).toBeLessThanOrEqual(2);
        expect(r.resident.length).toBeLessThanOrEqual(3);
        expect(r.failed).toEqual([]);
        expect(r.frames.holes, `${id} holes`).toBe(0);
      }
      await world(page, (w) => w.settle(90_000));
      const chunks = await world(page, (w) => w.chunks());
      expect(chunks.uploads.perFrameMax).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    });
  }

  test('five of the new landmarks at desktop: hi models within their class budget, the cap of eight holds @m02d2 @world-landmarks', async ({ page }) => {
    const errors = await boot(page, 'desktop');
    for (const id of ['lm.painted-ladies', 'lm.fort-point', 'lm.hunters-point-yard', 'lm.flower-conservatory', 'lm.saint-mary-cathedral']) {
      const result = await teleport(page, id);
      expect(result.ok, `${id}: ${JSON.stringify(result)}`).toBe(true);
      await expect
        .poll(async () => shown(await world(page, (w) => w.landmarks())), { timeout: 180_000, intervals: [500, 1000, 2000], message: id })
        .toContain(id);
      const r = (await world(page, (w) => w.landmarks()))!;
      const e = r.resident.find((x) => x.id === id)!;
      console.log(`world-landmarks desktop ${id}: ${e.fidelity} ${e.objects} objects ${e.triangles} tris`);
      expect(e.fidelity).toBe('hi');
      expect(e.objects).toBeLessThanOrEqual(3);
      expect(r.resident.length).toBeLessThanOrEqual(8);
      expect(r.failed).toEqual([]);
    }
    expect(errors).toEqual([]);
  });

  /**
   * @world-landmarks-swap  AC-6  at ?tier=mobile-low the camera follows `route-ferry-ocean-beach` (the Ferry Building toward City Hall, the
   * first 40 s): every skyline landmark inside the draw distance is drawn on every sampled frame, no frame hides a proxy without a model
   * drawn, every swap commit is one upload and leaves a proxy or a model, and the main-thread milliseconds of each commit are printed
   * (information only: SwiftShader is not the device, `08-test-and-ci.md` section 1 rule 3; the 50 ms bound is AC-9, DL-686).
   */
  test('route-ferry-ocean-beach at mobile-low: skyline always drawn, no hole, one upload per commit @world-landmarks-swap @m02d2', async ({ page }) => {
    const errors = await boot(page, 'mobile-low', '&perf=1');
    const result = await teleport(page, 'lm.ferry-building');
    expect(result.ok).toBe(true);
    await expect.poll(async () => shown(await world(page, (w) => w.landmarks())), { timeout: 180_000, intervals: [500, 1000, 2000] }).toContain('lm.ferry-building');
    // warm up: every skyline landmark inside the mount ring is drawn (or hidden under its full model)
    await expect
      .poll(
        async () => {
          const r = (await world(page, (w) => w.landmarks()))!;
          return r.skyline.entries.filter((e) => e.distM <= r.skyline.mountM).every((e) => e.visible || e.hiddenBy === 'full');
        },
        { timeout: 180_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);
    await world(page, (w) => w.settle(90_000));
    await world(page, (w) => w.resetLandmarkStats());

    const report = (await page.evaluate(`window.__dvBridge.platform.perf.run('route-ferry-ocean-beach', { durationS: 40, warmupS: 2 })`)) as PerfReport;
    expect(report.tier).toBe('mobile-low');
    expect(report.errors.gpuLost).toBe(0);
    await world(page, (w) => w.settle(120_000));

    const r = (await world(page, (w) => w.landmarks()))!;
    const swaps = r.swaps;
    const models = swaps.filter((e) => e.step !== 'chunk');
    const ms = swaps.map((e) => e.ms);
    console.log(
      `world-landmarks-swap route: ${r.frames.sampled} frames sampled, holes ${r.frames.holes}, double draws ${r.frames.doubles}, skylineMissing ${r.frames.skylineMissing}; ` +
        `${models.length} model commits and ${swaps.length - models.length} chunk commits; main-thread ms per commit: max ${Math.max(0, ...ms).toFixed(1)}, ` +
        `values ${JSON.stringify(swaps.map((e) => ({ id: e.id, step: e.step, frame: e.frame, ms: Math.round(e.ms * 10) / 10, uploads: e.uploads })))}`,
    );
    expect(r.frames.sampled).toBeGreaterThan(60);
    expect(r.frames.holes).toBe(0);
    expect(r.frames.skylineMissing).toBe(0);
    expect(models.length).toBeGreaterThanOrEqual(1);
    for (const e of swaps) {
      expect(e.uploads, `${e.id} ${e.step} at frame ${e.frame}`).toBeLessThanOrEqual(1);
      expect(e.model || e.proxy, `${e.id} ${e.step} at frame ${e.frame} left neither a proxy nor a model`).toBe(true);
    }
    // two commits never share a frame
    const frames = swaps.map((e) => e.frame);
    expect(new Set(frames).size).toBe(frames.length);
    const chunks = await world(page, (w) => w.chunks());
    expect(chunks.uploads.perFrameMax).toBeLessThanOrEqual(1);
    expect(chunks.uploads.oversize).toBe(0);
    expect(r.failed).toEqual([]);
    expect(r.resident.length).toBeLessThanOrEqual(r.cap);
    expect(errors).toEqual([]);
  });
});
