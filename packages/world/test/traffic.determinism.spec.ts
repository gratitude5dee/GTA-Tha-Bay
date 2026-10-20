/**
 * M03b1 AC-8: the `traffic-synth` determinism scenario in Node. The world module, the player standing at the City Hall arrival pose,
 * `canonical` profile, seed 0xC0FFEE, 10,000 ticks, hash every 600th tick. The golden stores the bake id; a golden from another bake
 * fails with a message that says to regenerate it (`DV_UPDATE_GOLDEN=1`, refused when `CI` is set; the PR needs the label
 * `golden-update`). The same run with replies arriving out of order gives the same hashes: arrival time never enters the state.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadBake } from './fixtures/bake.ts';
import { runTrafficSynth, type TrafficRunResult } from './fixtures/traffic-run.ts';

const GOLDEN = new URL('./golden/traffic-synth.json', import.meta.url);

interface Golden {
  scenario: 'traffic-synth';
  bakeId: string;
  seed: number;
  ticks: number;
  profile: 'canonical';
  physicsBuild: string;
  checkpointEvery: number;
  preload: string[];
  checkpoints: Record<string, string>;
  final: string;
}

const bake = loadBake('synth', 'traffic.determinism');
const suite = bake ? describe : describe.skip;

suite('AC-8: traffic-synth', () => {
  let a: TrafficRunResult;
  let b: TrafficRunResult;

  it('runs 10,000 canonical ticks with the residency rule held and never stalls', async () => {
    if (!bake) return;
    a = await runTrafficSynth({ bake, order: 'in-order' });
    expect(a.ticks).toBe(10_000);
    expect(Object.keys(a.checkpoints)).toHaveLength(Math.floor(10_000 / 600));
    expect(a.stallTicks).toBe(0);
    expect(a.preload.length).toBeGreaterThan(0);
    expect(a.agentsMax).toBeGreaterThan(20);
    expect(a.stats['wrecks'] ?? 0).toBeGreaterThanOrEqual(0);
  }, 180_000);

  it('replies arriving out of order give the same checkpoints and the same final hash', async () => {
    if (!bake) return;
    b = await runTrafficSynth({ bake, order: 'shuffled', shuffleSeed: 7 });
    expect(b.checkpoints).toEqual(a.checkpoints);
    expect(b.final).toBe(a.final);
    expect(b.preload).toEqual(a.preload);
  }, 180_000);

  it('matches the golden of this bake', () => {
    if (!bake) return;
    const data: Golden = {
      scenario: 'traffic-synth',
      bakeId: bake.bakeId,
      seed: a.seed,
      ticks: a.ticks,
      profile: 'canonical',
      physicsBuild: 'deterministic-compat',
      checkpointEvery: 600,
      preload: a.preload,
      checkpoints: a.checkpoints,
      final: a.final,
    };
    if (process.env['DV_UPDATE_GOLDEN'] === '1') {
      if (process.env['CI']) throw new Error('DV_UPDATE_GOLDEN=1 is refused when CI is set');
      writeFileSync(GOLDEN, `${JSON.stringify(data, null, 2)}\n`);
    } else if (!existsSync(GOLDEN)) {
      throw new Error('traffic-synth.json is missing; create it with DV_UPDATE_GOLDEN=1 and review the diff');
    }
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden;
    if (golden.bakeId !== bake.bakeId) {
      throw new Error(`world golden from bake ${golden.bakeId}, current bake ${bake.bakeId}: regenerate under golden-update`);
    }
    expect(golden).toEqual(data);
  });
});
