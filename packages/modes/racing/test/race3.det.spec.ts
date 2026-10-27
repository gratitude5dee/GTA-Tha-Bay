/**
 * AC-8 (Node half): the 3-car `RunSpec` (the line bot and two AI rivals on the Embarcadero circuit, seed 0xC0FFEE, canonical
 * profile) gives the same `StateHashTrace` twice in Node, equal to `tests/golden/racing/race3.vs-circuit.json`; the replay it
 * records equals `tests/golden/racing/vs-circuit.dvreplay` byte for byte (the file M12e reuses). The Chromium and WebKit runs of
 * the same spec are `pnpm check:e2e -- --project=<p> --grep @racing-det`. Regenerate after a reviewed change with
 * `DV_UPDATE_GOLDEN=1` (a pull request labelled `golden-update`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCanonicalRunner } from '@dv/engine/qa';
import { checkGolden, sameTrace } from '@dv/engine/qa/golden';
import { RACE3_ID, RACE3_REPLAY, RACING_GOLDEN, race3Spec, registerRacingQa } from '../src/qa/index.ts';
import { runHeadless } from '../src/qa/headless.ts';

registerRacingQa();
const root = new URL('../../../../', import.meta.url);
const corridor = new Uint8Array(readFileSync(new URL(`content/races/${RACE3_ID}/corridor.bin`, root)));

describe('the 3-car circuit race', () => {
  it('two runs give the same trace, equal to the golden', async () => {
    const runner = createCanonicalRunner({ packs: { corridor }, processEnv: {} });
    const a = await runner.run(race3Spec());
    const b = await runner.run(race3Spec());
    expect(a.end.outcome).toBe('finish');
    expect(a.end.tick).toBeGreaterThan(10_000);
    expect(sameTrace(a, b)).toBe(true);
    const g = checkGolden(a, RACING_GOLDEN.race3);
    expect(g.ok, `${g.state} ${g.path} ${g.firstDiff ?? ''}`).toBe(true);
  }, 600_000);

  it('the recorded replay equals the committed file byte for byte', async () => {
    const run = await runHeadless(race3Spec(), corridor);
    const bytes = run.attempt!.run!.bytes;
    run.dispose();
    const path = new URL(RACE3_REPLAY, root);
    if (process.env['DV_UPDATE_GOLDEN'] === '1' && !process.env['CI']) {
      mkdirSync(dirname(path.pathname), { recursive: true });
      writeFileSync(path, bytes);
    }
    expect(existsSync(path), RACE3_REPLAY).toBe(true);
    const want = new Uint8Array(readFileSync(path));
    expect(Buffer.from(bytes).equals(Buffer.from(want))).toBe(true);
  }, 600_000);
});
