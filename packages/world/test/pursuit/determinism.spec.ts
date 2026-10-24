/**
 * M03c AC-8 (second half): two runs of the line `pursuit-escape` give identical hashes, equal to `golden/pursuit-escape.json`. The golden
 * stores its source `bakeId`: a golden from another bake fails with the regenerate message (`DV_UPDATE_GOLDEN=1`, refused when `CI` is set;
 * the PR needs the label `golden-update`; DL-657). The second run answers the pack requests out of order: arrival time never enters
 * the state (the residency rule of DL-678 holds in both).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadBake } from '../fixtures/bake.ts';
import { loadLine, playPursuit, type PursuitRunResult } from '../fixtures/pursuit-run.ts';

const GOLDEN = new URL('../golden/pursuit-escape.json', import.meta.url);

interface Golden {
  scenario: 'pursuit-escape';
  bakeId: string;
  seed: number;
  ticks: number;
  profile: 'canonical';
  physicsBuild: string;
  checkpointEvery: number;
  preload: string[];
  checkpoints: Record<string, string>;
  final: string;
  escapedAt: number;
}

const bake = loadBake('synth', 'pursuit.determinism');
const suite = bake ? describe : describe.skip;

suite('AC-8: pursuit-escape determinism', () => {
  let a: PursuitRunResult;
  let b: PursuitRunResult;

  it('runs the line twice, the second time with replies out of order, and the hashes are identical', async () => {
    if (!bake) return;
    a = await playPursuit({ bake, order: 'in-order' });
    b = await playPursuit({ bake, order: 'shuffled', shuffleSeed: 9 });
    expect(Object.keys(a.checkpoints).length).toBe(Math.floor(a.ticks / loadLine().every));
    expect(b.checkpoints).toEqual(a.checkpoints);
    expect(b.final).toBe(a.final);
    expect(b.preload).toEqual(a.preload);
    expect(b.escapedAt).toBe(a.escapedAt);
    expect(b.trace).toEqual(a.trace);
  }, 360_000);

  it('matches the golden of this bake', () => {
    if (!bake) return;
    const line = loadLine();
    const data: Golden = {
      scenario: 'pursuit-escape',
      bakeId: bake.bakeId,
      seed: line.seed,
      ticks: line.ticks,
      profile: 'canonical',
      physicsBuild: 'deterministic-compat',
      checkpointEvery: line.every,
      preload: a.preload,
      checkpoints: a.checkpoints,
      final: a.final,
      escapedAt: a.escapedAt,
    };
    if (process.env['DV_UPDATE_GOLDEN'] === '1') {
      if (process.env['CI']) throw new Error('DV_UPDATE_GOLDEN=1 is refused when CI is set');
      writeFileSync(GOLDEN, `${JSON.stringify(data, null, 2)}\n`);
    } else if (!existsSync(GOLDEN)) {
      throw new Error('pursuit-escape.json is missing; create it with DV_UPDATE_GOLDEN=1 and review the diff');
    }
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden;
    if (golden.bakeId !== bake.bakeId) {
      throw new Error(`world golden from bake ${golden.bakeId}, current bake ${bake.bakeId}: regenerate under golden-update`);
    }
    expect(golden).toEqual(data);
  });
});
