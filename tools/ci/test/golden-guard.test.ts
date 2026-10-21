import { describe, expect, it } from 'vitest';
import { changedPathsFromGit, guard, isGoldenPath, labelsFromEnv } from '../golden-guard.ts';

describe('golden-guard fixtures (AC-7)', () => {
  it('a change under tests/golden/world/x.json fails without the golden-update label', () => {
    const r = guard(['tests/golden/world/x.json', 'README.md'], []);
    expect(r.ok).toBe(false);
    expect(r.goldenPaths).toEqual(['tests/golden/world/x.json']);
    expect(r.message).toContain('golden-update');
  });

  it('passes with the label', () => {
    expect(guard(['tests/golden/world/x.json'], ['bug', 'golden-update']).ok).toBe(true);
  });

  it('a change outside golden paths passes without a label', () => {
    expect(guard(['packages/shared/src/index.ts', 'docs/golden-rules.md'], []).ok).toBe(true);
  });

  it('matches **/golden/** and **/*.golden.json at any depth', () => {
    expect(isGoldenPath('packages/shared/test/golden/vectors.json')).toBe(true);
    expect(isGoldenPath('golden/a.bin')).toBe(true);
    expect(isGoldenPath('tests/fighter/foo.golden.json')).toBe(true);
    expect(isGoldenPath('foo.golden.json')).toBe(true);
    expect(isGoldenPath('packages/golden-tools/a.ts')).toBe(false);
    expect(isGoldenPath('tests/golden')).toBe(false);
    expect(isGoldenPath('x.golden.jsonl')).toBe(false);
  });

  it('C05 rule 5 save goldens under __golden__ need golden-update (M04d, DL-659)', () => {
    const save = 'packages/engine/src/sim/save/__golden__/core/v1.json';
    expect(isGoldenPath(save)).toBe(true);
    const without = guard([save], []);
    expect(without.ok).toBe(false);
    expect(without.goldenPaths).toEqual([save]);
    expect(guard([save], ['golden-update']).ok).toBe(true);
    expect(isGoldenPath('packages/engine/src/sim/save/__golden__')).toBe(false);
  });

  it('reads labels from DV_PR_LABELS as a comma list', () => {
    expect(labelsFromEnv({ DV_PR_LABELS: 'a, golden-update ,b' })).toEqual(['a', 'golden-update', 'b']);
    expect(labelsFromEnv({})).toEqual([]);
  });
});

describe('golden-guard live check (AC-7, when GITHUB_BASE_REF is set)', () => {
  const paths = changedPathsFromGit();
  it.skipIf(paths === null)('the diff against origin/$GITHUB_BASE_REF passes with the labels of DV_PR_LABELS', () => {
    const r = guard(paths ?? [], labelsFromEnv());
    expect(r.message).toBeTruthy();
    expect(r.ok, r.message).toBe(true);
  });
});
