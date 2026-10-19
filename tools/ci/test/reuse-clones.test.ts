/** M00f AC-5 (clone half). */
import { afterAll, describe, expect, it } from 'vitest';
import { formatFinding } from '../../../packages/shared/src/assets/gates/types.ts';
import { scanClones, tokenize } from '../reuse-clones.ts';
import { toolsRoot } from '../lib/common.ts';
import { buildCase, cleanupCases } from './third-party-fixtures.ts';

afterAll(cleanupCases);

describe('reuse:clones (M00f)', () => {
  it('ported-no-header fails with file and line pairs, printing no matched text', () => {
    const c = buildCase('ported-no-header');
    const r = scanClones(c.root);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.file).toBe('packages/app/src/copy.ts');
    const text = formatFinding(r.findings[0]!);
    expect(text).toMatch(/\d+~\d+/);
    expect(text).not.toContain('stepFrame');
    expect(text).not.toContain('bounceX');
  });

  it('ported-in-tools-ci-no-header fails too', () => {
    const r = scanClones(buildCase('ported-in-tools-ci-no-header').root);
    expect(r.findings.map((f) => f.file)).toEqual(['tools/ci/copy.ts']);
  });

  it('ported-with-header passes', () => {
    expect(scanClones(buildCase('ported-with-header').root).findings).toEqual([]);
  });

  it('clean (nothing ported) passes and so does the repository, vendored or not', () => {
    expect(scanClones(buildCase('clean').root).findings).toEqual([]);
    expect(scanClones(toolsRoot).findings).toEqual([]);
  });

  it('a reformatted copy with other comments still matches', () => {
    const t = tokenize('const a = "x"; // note\n/* block */ const b = 2;');
    expect(t.map((x) => x.text)).toEqual(['const', 'a', '=', 'STR', ';', 'const', 'b', '=', '2', ';']);
  });
});
