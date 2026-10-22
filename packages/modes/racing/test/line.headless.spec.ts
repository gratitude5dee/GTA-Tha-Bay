/**
 * AC-8 (Node half): driver `racing.line` on the sprint, seed 0xC0FFEE, canonical profile. The `CanonicalRunner` runs it twice in
 * Node; both traces equal `tests/golden/racing/line.ferry-ocean-beach.json`. The car finishes, and the gate ticks are strictly
 * increasing. The WebKit run of the same `RunSpec` is `pnpm check:e2e -- --project=webkit-webgl2 --grep @racing-det`.
 *
 * The ground is `content/races/<id>/corridor.bin` (BD-M07a1-04), so this runs without a bake. Regenerate the golden after a
 * reviewed change with `DV_UPDATE_GOLDEN=1` (a pull request labelled `golden-update`, 13-qa.md 3.4).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createCanonicalRunner, getBot, getScenarioLoader } from '@dv/engine/qa';
import { checkGolden, sameTrace } from '@dv/engine/qa/golden';
import { RACING_GOLDEN, racingSpec, registerRacingQa } from '../src/qa/index.ts';

registerRacingQa();
const corridor = new Uint8Array(readFileSync(new URL('../../../../content/races/sf.sprint.ferry-ocean-beach/corridor.bin', import.meta.url)));

describe('racing.line on the sprint', () => {
  it('finishes, with strictly increasing gate ticks and no damage', async () => {
    const spec = racingSpec();
    const loaded = await getScenarioLoader('racing')(spec, { packs: { corridor } });
    const bot = getBot('racing.line');
    bot.init({ observe: () => ({ ...loaded.observe(), tick: loaded.sim.tick }), rng: () => () => 0.5 }, spec.bot.params);
    const sess = (loaded as unknown as { session: { state(): { gateTicks: number[]; finishMs: number | null; outcome: string | null; damage: { body: number }; penaltyMs: number }; log: { t: string }[] } }).session;
    while (loaded.sim.tick < spec.maxTicks && !bot.done().done) loaded.sim.step(1, (t) => bot.frame(t));
    const st = sess.state();
    loaded.sim.dispose();
    expect(st.outcome).toBe('finish');
    expect(st.gateTicks.length).toBeGreaterThanOrEqual(50);
    for (let i = 1; i < st.gateTicks.length; i++) expect(st.gateTicks[i]!, `gate ${i}`).toBeGreaterThan(st.gateTicks[i - 1]!);
    expect(st.damage.body).toBe(1);
    expect(st.penaltyMs).toBe(0);
    expect(st.finishMs!).toBeGreaterThan(200_000);
    expect(st.finishMs!).toBeLessThan(480_000);
    expect(sess.log.some((e) => e.t === 'race.perfectstart')).toBe(true);
  }, 240_000);

  it('two runs give the same trace, equal to the golden', async () => {
    const runner = createCanonicalRunner({ packs: { corridor }, processEnv: {} });
    const a = await runner.run(racingSpec());
    const b = await runner.run(racingSpec());
    expect(a.end.outcome).toBe('finish');
    expect(sameTrace(a, b)).toBe(true);
    const g = checkGolden(a, RACING_GOLDEN.line);
    expect(g.ok, `${g.state} ${g.path} ${g.firstDiff ?? ''}`).toBe(true);
  }, 240_000);

  it('the seeded steer noise run is repeatable and equals its golden (the bot stream is the only random source)', async () => {
    const runner = createCanonicalRunner({ packs: { corridor }, processEnv: {} });
    const spec = racingSpec({ noise: 4, maxTicks: 3000 });
    const a = await runner.run(spec);
    const b = await runner.run(spec);
    expect(sameTrace(a, b)).toBe(true);
    const g = checkGolden(a, RACING_GOLDEN.noise);
    expect(g.ok, `${g.state} ${g.path} ${g.firstDiff ?? ''}`).toBe(true);
    const plain = await runner.run(racingSpec({ maxTicks: 3000 }));
    expect(sameTrace(a, plain)).toBe(false);
  }, 240_000);
});
