import { expect, type Page } from '@playwright/test';
import type { TeleportResult } from '../../packages/shared/src/index.ts';
import type { LandmarksReport } from '../../packages/world/src/client/chunks/landmark-layer.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * The code `world-landmarks.spec.ts` and `tour-landmarks-desktop.spec.ts` share (BD-FIX-CI-SHARD8-02: the desktop landmark cases moved to a
 * file of their own so a shard does not hold all of them).
 */
export type W = { __dvBridge: { world: WorldBridge } };

export const TWELVE = [
  'lm.city-hall', 'lm.golden-gate-bridge', 'lm.bay-bridge-ybi', 'lm.coit-tower', 'lm.ferry-building', 'lm.pyramid-tower',
  'lm.crown-tower', 'lm.sutro-tower', 'lm.palace-fine-arts', 'lm.alcatraz', 'lm.twin-peaks', 'lm.lombard-crooked',
] as const;

export const SKYLINE = ['lm.golden-gate-bridge', 'lm.bay-bridge-ybi', 'lm.sutro-tower', 'lm.crown-tower', 'lm.pyramid-tower', 'lm.coit-tower', 'lm.ferry-building'] as const;
/** Rows 13 to 37 of 02-world-bake.md section 7 (M02d2). */
export const REST = [
  'lm.painted-ladies', 'lm.china-basin-ballpark', 'lm.mission-bay-arena', 'lm.pier-39', 'lm.fort-point', 'lm.grace-cathedral', 'lm.dragon-gate',
  'lm.transit-center-park', 'lm.hunters-point-yard', 'lm.mount-davidson-cross', 'lm.dolores-park', 'lm.haight-ashbury', 'lm.flower-conservatory',
  'lm.park-bandshell', 'lm.cliff-house', 'lm.crissy-field', 'lm.powell-turntable', 'lm.lands-end-lookout', 'lm.candlestick-point',
  'lm.treasure-island', 'lm.un-plaza', 'lm.rail-terminus', 'lm.peace-pagoda', 'lm.opera-house', 'lm.saint-mary-cathedral',
] as const;

export const world = <T>(page: Page, fn: (w: WorldBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.world)`) as Promise<T>;

export async function boot(page: Page, tier: string, extra = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A sim worker restart drops the call in flight (a teleport then times out after 60 s with no other trace), so the CI log names it.
  page.on('console', (m) => {
    if (/^sim worker (stalled|error)|^sim: /.test(m.text())) console.log(`world-landmarks page ${m.type()}: ${m.text().slice(0, 200)}`);
  });
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

export const shown = (r: LandmarksReport | null): string[] => (r?.resident ?? []).filter((e) => e.phase === 'shown').map((e) => e.id).sort();

export async function teleport(page: Page, id: string): Promise<TeleportResult> {
  const t0 = Date.now();
  const f0 = await world(page, (w) => w.chunks().frame);
  const result = (await page.evaluate((lm) => (window as unknown as W).__dvBridge.world.teleport(lm), id)) as TeleportResult | null;
  const f1 = await world(page, (w) => w.chunks().frame);
  console.log(`world-landmarks teleport ${id}: ${((Date.now() - t0) / 1000).toFixed(1)} s, ${f1 - f0} frames, ${JSON.stringify(result)?.slice(0, 120)}`);
  expect(result, id).not.toBeNull();
  return result as TeleportResult;
}

/** Every one of the twelve landmarks becomes resident at `tier`, within its object budget and the tier's cap. */
export async function twelveResident(page: Page, tier: 'desktop' | 'mobile-low'): Promise<void> {
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
}
