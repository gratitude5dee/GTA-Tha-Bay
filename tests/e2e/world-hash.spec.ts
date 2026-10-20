import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * M03b1 AC-9, @world-hash: the `traffic-synth` scenario in sim.worker of a real browser, on a `DV_WORLD=synth` QA build. The QA page
 * `/qa/world-hash.html` runs the 10,000 canonical ticks with the residency rule of DL-678 (the `p0` set around the start is requested,
 * received and pinned before tick 0; a batch of ticks starts only when nothing is pending; pack replies arrive out of order after a
 * seeded 0 to 5 ms) and publishes the hash at every 600th tick and at tick 10,000 on `window.__dvBridge.world.qa.hash`. They are the
 * Node runner's hashes (`packages/world/test/golden/traffic-synth.json`), on Chromium (WebGL2) and on WebKit.
 */
interface Golden {
  bakeId: string;
  seed: number;
  ticks: number;
  physicsBuild: string;
  preload: string[];
  checkpoints: Record<string, string>;
  final: string;
}

interface Result {
  scenario: string;
  bakeId: string;
  seed: number;
  ticks: number;
  physicsBuild: string;
  checkpoints: Record<string, string>;
  final: string;
  stallTicks: number;
  preload: { wanted: number; resident: number; pending: number; atTick: number };
  agentsMax: number;
  out: { requests: number; maxInFlight: number };
  runMs: number;
}

const golden = JSON.parse(readFileSync(new URL('../../packages/world/test/golden/traffic-synth.json', import.meta.url), 'utf8')) as Golden;

test.setTimeout(540_000);

test('@world-hash traffic-synth hashes in sim.worker equal the Node golden', async ({ page, browserName }) => {
  test.skip(process.env['DV_WORLD'] !== 'synth', 'needs a QA build with DV_WORLD=synth');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/qa/world-hash.html');
  await page.waitForFunction(() => document.documentElement.dataset['dvWorldHash'] !== undefined, undefined, { timeout: 480_000, polling: 1000 });
  const state = await page.evaluate(() => document.documentElement.dataset['dvWorldHash']);
  const bridge = await page.evaluate(() => (window as unknown as { __dvBridge: { world: { qa: { hash?: unknown; error?: string | null } } } }).__dvBridge.world.qa);
  expect(bridge.error ?? null, 'the page reported an error').toBeNull();
  expect(state).toBe('done');
  const r = bridge.hash as Result;

  if (golden.bakeId !== r.bakeId) throw new Error(`world golden from bake ${golden.bakeId}, current bake ${r.bakeId}: regenerate under golden-update`);
  // residency before tick 0: the whole set is resident and pinned, nothing pending
  expect(r.preload.wanted).toBe(golden.preload.length);
  expect(r.preload.resident).toBe(golden.preload.length);
  expect(r.preload.pending).toBe(0);
  expect(r.preload.atTick).toBe(0);
  expect(r.seed).toBe(golden.seed);
  expect(r.ticks).toBe(golden.ticks);
  expect(r.physicsBuild).toBe(golden.physicsBuild);
  expect(Object.keys(r.checkpoints)).toHaveLength(Object.keys(golden.checkpoints).length);
  expect(r.checkpoints).toEqual(golden.checkpoints);
  expect(r.final).toBe(golden.final);
  // the packs (one per tile, not per chunk) came through the delayed channel
  expect(r.out.requests).toBeGreaterThanOrEqual(2);
  expect(r.agentsMax).toBeGreaterThan(20);
  expect(errors).toEqual([]);
  console.log(`world-hash ${browserName}: ${Object.keys(r.checkpoints).length} checkpoints equal, final ${r.final}, ${r.runMs.toFixed(0)} ms, ${r.out.requests} pack requests, max in flight ${r.out.maxInFlight}, stalls ${r.stallTicks}`);
});
