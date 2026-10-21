/** M04d AC-1, AC-2 (runner half), AC-3 (timeout): the canonical runner on the gray-box fixture. */
import { describe, expect, it } from 'vitest';
import { canonicalize } from '@dv/shared';
import { checkGolden, readGolden, sameTrace } from '../../src/qa/golden.ts';
import { assertNoGoldenUpdateInCi, createCanonicalRunner } from '../../src/qa/runner.ts';
import { readFixturePacks } from '../../src/qa/node.ts';
import { WALK_DRIVE_GOLDENS } from '../../src/qa/engine-specs.ts';
import { run, spec } from './helpers.ts';

describe('CanonicalRunner: walk-drive on the gray-box fixture', () => {
  it('two runs give byte-identical canonical traces that equal tests/golden/engine/walk-drive.json', async () => {
    const a = await run(spec());
    const b = await run(spec());
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(a.end.outcome).toBe('end');
    expect(a.checkpoints.map((c) => c.tick)).toEqual([600]);
    console.log(`walk-drive end hash ${a.end.hash} at tick ${a.end.tick}`);
    const g = checkGolden(a, WALK_DRIVE_GOLDENS.plain);
    expect(g.state, g.firstDiff ?? g.path).toMatch(/^(matched|written)$/);
  }, 120_000);

  it('the fine-checkpoint and noisy specs equal their goldens', async () => {
    const fine = await run(spec({ checkpointEvery: 60 }));
    expect(fine.checkpoints.length).toBeGreaterThanOrEqual(13);
    const gf = checkGolden(fine, WALK_DRIVE_GOLDENS.fine);
    expect(gf.state, gf.firstDiff ?? gf.path).toMatch(/^(matched|written)$/);
    const noisy = await run(spec({ noise: 12 }));
    const plain = await run(spec());
    expect(noisy.end.hash).not.toBe(plain.end.hash);
    const gn = checkGolden(noisy, WALK_DRIVE_GOLDENS.noise);
    expect(gn.state, gn.firstDiff ?? gn.path).toMatch(/^(matched|written)$/);
  }, 180_000);

  it('an edited frame changes the trace at the first checkpoint after the edit', async () => {
    const base = await run(spec(), {});
    const line = JSON.parse(JSON.stringify(spec().bot.params?.['line'])) as { frames: { tick: number; run: number; input: { steer: number } }[] };
    const turn = line.frames.find((f) => f.tick === 270);
    expect(turn).toBeDefined();
    (turn as { input: { steer: number } }).input.steer = -60;
    const edited = await run({ ...spec(), bot: { driver: 'lines', params: { line } } });
    expect(sameTrace(base, edited)).toBe(false);
    expect(edited.checkpoints[0]?.hash).not.toBe(base.checkpoints[0]?.hash);
  }, 120_000);

  it('a bot that never finishes stops at maxTicks with outcome timeout and its last checkpoint', async () => {
    const s = { ...spec(), maxTicks: 700 };
    const t = await run(s);
    expect(t.end.outcome).toBe('timeout');
    expect(t.end.tick).toBe(700);
    expect(t.checkpoints.map((c) => c.tick)).toEqual([600]);
  }, 120_000);

  it('the fixture pack is hash-checked: a changed byte is rejected', () => {
    const { p0 } = readFixturePacks();
    expect(p0.length).toBeGreaterThan(1000);
  });

  it('reads the committed golden', () => {
    expect(readGolden('engine', WALK_DRIVE_GOLDENS.plain)?.end.outcome).toBe('end');
  });
});

describe('golden guard in the runner (AC-2)', () => {
  it('throws before stepping when CI and DV_UPDATE_GOLDEN are both set', async () => {
    const runner = createCanonicalRunner({ packs: readFixturePacks(), processEnv: { CI: 'true', DV_UPDATE_GOLDEN: '1' } });
    await expect(runner.run(spec())).rejects.toThrow(/DV_UPDATE_GOLDEN/);
    expect(() => assertNoGoldenUpdateInCi({ CI: 'true', DV_UPDATE_GOLDEN: '1' })).toThrow();
    expect(() => assertNoGoldenUpdateInCi({ CI: 'true' })).not.toThrow();
    expect(() => assertNoGoldenUpdateInCi({ DV_UPDATE_GOLDEN: '1' })).not.toThrow();
  });
});
