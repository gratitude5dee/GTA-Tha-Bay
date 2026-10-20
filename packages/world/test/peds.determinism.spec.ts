/**
 * M03b2 AC-7: the `traffic-peds-synth` determinism scenario in Node. The world module with the pedestrians and transit on, the player
 * standing at the City Hall arrival pose, `canonical` profile, seed 0xC0FFEE, 10,000 ticks, a hash at every 600th tick. The golden
 * stores the bake id; a golden from another bake fails with a message that says to regenerate it (`DV_UPDATE_GOLDEN=1`, refused when
 * `CI` is set; the PR needs the label `golden-update`, DL-657). The same run with replies arriving out of order gives the same hashes.
 * `traffic-synth.json` of M03b1 still matches with the pedestrians off (`traffic.determinism.spec.ts`).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadBake } from './fixtures/bake.ts';
import { runTrafficSynth, TRAFFIC_PEDS_SYNTH, type TrafficRunResult } from './fixtures/traffic-run.ts';
import { TRANSIT_CONFIG } from '../src/sim/transit/components.ts';

const GOLDEN = new URL('./golden/traffic-peds-synth.json', import.meta.url);

interface Golden {
  scenario: 'traffic-peds-synth';
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

const bake = loadBake('synth', 'peds.determinism');
const suite = bake ? describe : describe.skip;

suite('AC-7: traffic-peds-synth', () => {
  let a: TrafficRunResult;
  let b: TrafficRunResult;

  it('runs 10,000 canonical ticks with the residency rule held and never stalls; pedestrians and transit are live', async () => {
    if (!bake) return;
    a = await runTrafficSynth({ bake, order: 'in-order', ambient: TRAFFIC_PEDS_SYNTH.ambient });
    expect(a.ticks).toBe(10_000);
    expect(Object.keys(a.checkpoints)).toHaveLength(Math.floor(10_000 / 600));
    expect(a.stallTicks).toBe(0);
    expect(a.agentsMax).toBeGreaterThan(20);
    expect(a.pedsMax).toBeGreaterThan(10);
    const t = a.transit as { counts: Record<string, number> } | null;
    expect(t).toBeTruthy();
    if (t) {
      expect(t.counts['bus']).toBe(TRANSIT_CONFIG.counts.bus['mobile-low']);
      expect(t.counts['metro']).toBe(TRANSIT_CONFIG.counts.metro['mobile-low']);
      expect(t.counts['ferry']).toBe(TRANSIT_CONFIG.counts.ferry['mobile-low']);
      expect(t.counts['air']).toBe(TRANSIT_CONFIG.counts.air['mobile-low']);
    }
  }, 300_000);

  it('replies arriving out of order give the same checkpoints and the same final hash', async () => {
    if (!bake) return;
    b = await runTrafficSynth({ bake, order: 'shuffled', shuffleSeed: 7, ambient: TRAFFIC_PEDS_SYNTH.ambient });
    expect(b.checkpoints).toEqual(a.checkpoints);
    expect(b.final).toBe(a.final);
    expect(b.preload).toEqual(a.preload);
    expect(b.pedsMax).toBe(a.pedsMax);
  }, 300_000);

  it('differs from the traffic-only run (the pedestrians and transit are in the hash)', async () => {
    if (!bake) return;
    const traffic = JSON.parse(readFileSync(new URL('./golden/traffic-synth.json', import.meta.url), 'utf8')) as { final: string; bakeId: string };
    expect(traffic.bakeId).toBe(bake.bakeId);
    expect(a.final).not.toBe(traffic.final);
  });

  it('matches the golden of this bake', () => {
    if (!bake) return;
    const data: Golden = {
      scenario: 'traffic-peds-synth',
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
      throw new Error('traffic-peds-synth.json is missing; create it with DV_UPDATE_GOLDEN=1 and review the diff');
    }
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden;
    if (golden.bakeId !== bake.bakeId) {
      throw new Error(`world golden from bake ${golden.bakeId}, current bake ${bake.bakeId}: regenerate under golden-update`);
    }
    expect(golden).toEqual(data);
  });
});
