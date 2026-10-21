/** M04d AC-2: the golden store and its update guard. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkGolden, goldenPath, goldenText } from '../../src/qa/golden.ts';
import type { StateHashTrace } from '../../src/qa/runner.ts';
import { spec } from './helpers.ts';

const trace = (suite: string, hash = 'aaaa'): StateHashTrace => ({
  v: 1,
  spec: { ...spec(), suite },
  build: 'abc1234',
  checkpoints: [{ tick: 600, hash }],
  end: { tick: 811, hash, outcome: 'end' },
});

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});
const temp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'dv-golden-'));
  dirs.push(d);
  return d;
};

describe('golden store', () => {
  it('stores canonical JSON with the build field normalised', () => {
    const text = goldenText(trace('engine'));
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('"build":"golden"');
    expect(text).not.toContain(' ');
  });

  it('with CI unset and DV_UPDATE_GOLDEN=1 it rewrites only the golden of the run suite', () => {
    const root = temp();
    mkdirSync(join(root, 'other'), { recursive: true });
    writeFileSync(join(root, 'other', 'keep.json'), '{"keep":1}\n');
    mkdirSync(join(root, 'engine'), { recursive: true });
    writeFileSync(join(root, 'engine', 'neighbour.json'), '{"neighbour":1}\n');

    const r = checkGolden(trace('engine'), 'walk', { root, env: { DV_UPDATE_GOLDEN: '1' } });
    expect(r.state).toBe('written');
    expect(existsSync(goldenPath('engine', 'walk', root))).toBe(true);
    expect(readFileSync(join(root, 'other', 'keep.json'), 'utf8')).toBe('{"keep":1}\n');
    expect(readFileSync(join(root, 'engine', 'neighbour.json'), 'utf8')).toBe('{"neighbour":1}\n');

    expect(checkGolden(trace('engine'), 'walk', { root, env: {} }).state).toBe('matched');
    const diff = checkGolden(trace('engine', 'bbbb'), 'walk', { root, env: {} });
    expect(diff.state).toBe('differs');
    expect(diff.firstDiff).toContain('checkpoint 0');
    expect(checkGolden(trace('engine'), 'absent', { root, env: {} }).state).toBe('missing');
  });

  it('refuses to write when CI is set', () => {
    const root = temp();
    expect(() => checkGolden(trace('engine'), 'walk', { root, env: { CI: 'true', DV_UPDATE_GOLDEN: '1' } })).toThrow(/CI/);
    expect(existsSync(join(root, 'engine'))).toBe(false);
  });

  it('refuses ids that escape the golden root', () => {
    expect(() => goldenPath('..', 'x')).toThrow();
    expect(() => goldenPath('engine', '../x')).toThrow();
  });
});
