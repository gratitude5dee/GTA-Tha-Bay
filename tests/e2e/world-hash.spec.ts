import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * M03b1 AC-9 and M03b2 AC-8, @world-hash: the `traffic-synth` and `traffic-peds-synth` scenarios in sim.worker of a real browser, on a
 * `DV_WORLD=synth` QA build. The QA page `/qa/world-hash.html` runs each scenario's 10,000 canonical ticks one after the other with the
 * residency rule of DL-678 (the `p0` set around the start is requested, received and pinned before tick 0; a batch of ticks starts
 * only when nothing is pending; pack replies arrive out of order after a seeded 0 to 5 ms) and publishes the hash at every 600th tick
 * and at tick 10,000 on `window.__dvBridge.world.qa.hashes[<scenario>]`. They are the Node runner's hashes
 * (`packages/world/test/golden/<scenario>.json`), on Chromium (WebGL2) and on WebKit. The second scenario runs the pedestrians and
 * transit (buses, Metro, ferries, airliners, Bay Rail entrances) together with the traffic, so the cross-browser hash covers them.
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
  pedsMax: number;
  out: { requests: number; maxInFlight: number };
  runMs: number;
}

const goldenOf = (id: string): Golden => JSON.parse(readFileSync(new URL(`../../packages/world/test/golden/${id}.json`, import.meta.url), 'utf8')) as Golden;

test.setTimeout(1_080_000);

test('@world-hash both scenarios: hashes in sim.worker equal the Node goldens', async ({ page, browserName }) => {
  test.skip(process.env['DV_WORLD'] !== 'synth', 'needs a QA build with DV_WORLD=synth');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/qa/world-hash.html');
  await page.waitForFunction(() => document.documentElement.dataset['dvWorldHash'] !== undefined, undefined, { timeout: 1_000_000, polling: 1000 });
  const state = await page.evaluate(() => document.documentElement.dataset['dvWorldHash']);
  const bridge = await page.evaluate(() => (window as unknown as { __dvBridge: { world: { qa: { hashes?: Record<string, unknown>; hash?: unknown; error?: string | null } } } }).__dvBridge.world.qa);
  expect(bridge.error ?? null, 'the page reported an error').toBeNull();
  expect(state).toBe('done');
  const all = bridge.hashes as Record<string, Result>;

  for (const id of ['traffic-synth', 'traffic-peds-synth']) {
    const golden = goldenOf(id);
    const r = all[id];
    expect(r, `the page ran ${id}`).toBeTruthy();
    if (!r) continue;
    if (golden.bakeId !== r.bakeId) throw new Error(`${id}: world golden from bake ${golden.bakeId}, current bake ${r.bakeId}: regenerate under golden-update`);
    // residency before tick 0: the whole set is resident and pinned, nothing pending
    expect(r.preload.wanted, id).toBe(golden.preload.length);
    expect(r.preload.resident, id).toBe(golden.preload.length);
    expect(r.preload.pending, id).toBe(0);
    expect(r.preload.atTick, id).toBe(0);
    expect(r.seed, id).toBe(golden.seed);
    expect(r.ticks, id).toBe(golden.ticks);
    expect(r.physicsBuild, id).toBe(golden.physicsBuild);
    expect(Object.keys(r.checkpoints), id).toHaveLength(Object.keys(golden.checkpoints).length);
    expect(r.checkpoints, id).toEqual(golden.checkpoints);
    expect(r.final, id).toBe(golden.final);
    // the packs (one per tile, not per chunk) came through the delayed channel
    expect(r.out.requests, id).toBeGreaterThanOrEqual(2);
    expect(r.agentsMax, id).toBeGreaterThan(20);
    if (id === 'traffic-peds-synth') expect(r.pedsMax, id).toBeGreaterThan(10);
    else expect(r.pedsMax, id).toBe(0);
    console.log(`world-hash ${browserName} ${id}: ${Object.keys(r.checkpoints).length} checkpoints equal, final ${r.final}, ${r.runMs.toFixed(0)} ms, ${r.out.requests} pack requests, max in flight ${r.out.maxInFlight}, stalls ${r.stallTicks}, peds ${r.pedsMax}`);
  }
  expect(errors).toEqual([]);
});
