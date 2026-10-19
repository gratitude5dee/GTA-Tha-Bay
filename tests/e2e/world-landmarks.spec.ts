import { expect, test, type Page } from '@playwright/test';
import type { TeleportResult } from '../../packages/shared/src/index.ts';
import type { LandmarksReport } from '../../packages/world/src/client/chunks/landmark-layer.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { observe, SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M02d1 landmarks in a real browser, on a `DV_WORLD=synth` QA build. Everything goes through `__dvBridge.world`.
 *
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

const world = <T>(page: Page, fn: (w: WorldBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.world)`) as Promise<T>;

async function boot(page: Page, tier: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto(`/?debug=1&tier=${tier}`);
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

  test('at mobile the bridge teleports to lm.coit-tower: resident, its proxy chunks masked with one re-record each; away restores them @world-landmarks', async ({ page }) => {
    const errors = await boot(page, 'mobile');
    const result = await teleport(page, 'lm.coit-tower');
    console.log(`world-landmarks teleport coit: ${JSON.stringify(result)}`);
    expect(result.ok).toBe(true);
    await expect.poll(async () => shown(await world(page, (w) => w.landmarks())), { timeout: 180_000, intervals: [500, 1000, 2000] }).toContain('lm.coit-tower');

    // the chunks that hold its proxies are meshed again with the proxy left out
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
    console.log(`world-landmarks coit up: ${JSON.stringify(coit)}`);
    expect(coit.fidelity).toBe('mid');
    expect(coit.objects).toBeLessThanOrEqual(3);
    expect(coit.chunks.length).toBeGreaterThanOrEqual(1);
    // one re-record request per chunk: the first upload recorded the bundle, the masked mesh replaced it once
    for (const c of coit.chunks) {
      expect(c.masked, c.key).toBe(true);
      expect(c.bundleRerecords, c.key).toBe(1);
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
    await page.screenshot({ path: 'test-results/world-landmarks/coit-tower-mobile.png' });
    await page.setViewportSize(SMALL_VIEWPORT);

    // 700 m away: beyond swapM x 1.05 (525 m) but inside the keep ring of the L0 chunks, so the proxies can be seen coming back
    const at = (await observe(page)).player!.pos;
    const focusAt = (x: number, z: number): Promise<unknown> => page.evaluate(([fx, fz]) => (window as unknown as W).__dvBridge.world.focus(fx as number, fz as number), [x, z]);
    await focusAt(at[0] + 700, at[2]);
    await expect
      .poll(async () => (await world(page, (w) => w.landmarks()))!.resident.find((x) => x.id === 'lm.coit-tower'), { timeout: 120_000, intervals: [250, 500, 1000] })
      .toBeUndefined();
    await world(page, (w) => w.settle(60_000));
    const back = await world(page, (w) => {
      const c = w.chunks();
      return { masks: c.bundleRerecords };
    });
    // every chunk that held a proxy of the landmark has been replaced twice: masked, then meshed back
    for (const c of coit.chunks) expect(back.masks[`l0:${c.key}`], c.key).toBe(2);

    // 2 km from the landmark nothing of it is resident or loading
    await focusAt(at[0] + 2000, at[2]);
    await world(page, (w) => w.settle(60_000));
    const far = (await world(page, (w) => w.landmarks()))!;
    expect(far.resident.find((x) => x.id === 'lm.coit-tower')).toBeUndefined();
    expect(far.failed).toEqual([]);
    expect(errors).toEqual([]);
  });

  for (const tier of ['desktop', 'mobile-low'] as const) {
    test(`each of the twelve landmarks becomes resident at ${tier}, within its triangle budget @world-landmarks`, async ({ page }) => {
      const errors = await boot(page, tier);
      const cap = tier === 'desktop' ? 8 : 3;
      for (const id of TWELVE) {
        const result = await teleport(page, id);
        expect(result.ok, `${id}: ${JSON.stringify(result)}`).toBe(true);
        await expect
          .poll(async () => shown(await world(page, (w) => w.landmarks())), { timeout: 180_000, intervals: [500, 1000, 2000], message: id })
          .toContain(id);
        await world(page, (w) => w.settle(45_000));
        const r = (await world(page, (w) => w.landmarks()))!;
        const e = r.resident.find((x) => x.id === id)!;
        console.log(`world-landmarks ${tier} ${id}: ${e.fidelity} ${e.objects} objects ${e.triangles} tris, ${e.chunks.length} proxy chunks, ${e.chunks.filter((c) => c.masked).length} masked, ${Math.round(e.distM)} m`);
        expect(e.fidelity).toBe(tier === 'desktop' ? 'hi' : 'lo');
        expect(e.objects).toBeLessThanOrEqual(tier === 'desktop' ? 3 : 2);
        expect(r.resident.length).toBeLessThanOrEqual(cap);
        expect(r.failed).toEqual([]);
      }
      const chunks = await world(page, (w) => w.chunks());
      expect(chunks.uploads.perFrameMax).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    });
  }
});
