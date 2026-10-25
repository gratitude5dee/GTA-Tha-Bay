import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../run.ts';
import { checkSpecFiles, retiredUIds, wordCount, type FindingKind } from '../spec-files.ts';
import { useTempDirs } from '../test-tmp.ts';

// BD-FIX-TMP-01: temp folders made here are removed after the last test of this file.
const tempDir = useTempDirs();

const okRoot = path.join(repoRoot, 'tools', 'ci', 'fixtures', 'spec-files', 'ok');

function variant(edit: (dir: string) => void): ReturnType<typeof checkSpecFiles> {
  const dir = tempDir('dv-spec-');
  cpSync(okRoot, dir, { recursive: true });
  edit(dir);
  return checkSpecFiles({ root: dir, strict: true });
}
const kinds = (r: ReturnType<typeof checkSpecFiles>): FindingKind[] => r.failures.map((f) => f.kind);

describe('spec-files fixtures (AC-5)', () => {
  it('the ok fixture passes strict', () => {
    const r = checkSpecFiles({ root: okRoot, strict: true });
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('a 6,001-word spec file is one too-long failure', () => {
    const r = variant((d) => writeFileSync(path.join(d, 'spec', '12-glossary.md'), `${'word '.repeat(6001)}\n`));
    expect(kinds(r)).toEqual(['too-long']);
    expect(r.failures[0]?.message).toContain('6001');
    expect(wordCount('a b  c\nd')).toBe(4);
  });

  it('a U-row without a verifying milestone present in _PLAN.md is one failure', () => {
    const r = variant((d) => {
      const f = path.join(d, 'spec', '99-open-questions.md');
      writeFileSync(f, readFileSync(f, 'utf8').replace('M90 AC-1', 'M77 AC-1'));
    });
    expect(kinds(r)).toEqual(['u-row']);
  });

  it('a U-row without a default is one failure', () => {
    const r = variant((d) => {
      const f = path.join(d, 'spec', '99-open-questions.md');
      writeFileSync(f, readFileSync(f, 'utf8').replace('a default', ' '));
    });
    expect(kinds(r)).toEqual(['u-row']);
  });

  it('a kickoff list missing one _PLAN id is one failure naming it', () => {
    const r = variant((d) => {
      const f = path.join(d, 'prompt-pack', '04-SONNET-KICKOFF.md');
      writeFileSync(f, readFileSync(f, 'utf8').replace('2. M91 · fx · 0.5 · M90 · none\n', ''));
    });
    expect(kinds(r)).toEqual(['kickoff']);
    expect(r.failures[0]?.message).toContain('M91');
  });

  it('a kickoff session count that differs from _PLAN.md is one failure', () => {
    const r = variant((d) => {
      const f = path.join(d, 'prompt-pack', '04-SONNET-KICKOFF.md');
      writeFileSync(f, readFileSync(f, 'utf8').replace('M91 · fx · 0.5', 'M91 · fx · 1'));
    });
    expect(kinds(r)).toEqual(['kickoff']);
  });

  it('a READY milestone fixture citing a retired U-id is one failure; a started or frozen file only warns (DL-539)', () => {
    const cite = (d: string, status: string): void => {
      writeFileSync(path.join(d, 'spec', '07-milestones', 'M91-fx.md'), '# M91 — fx\n\n## Goal\nRecords U-ENG-7 as if live.\n');
      const readme = path.join(d, 'spec', '07-milestones', 'README.md');
      writeFileSync(readme, readFileSync(readme, 'utf8').replace('| 0.5 | M90 | READY |', `| 0.5 | M90 | ${status} |`));
    };
    const ready = variant((d) => cite(d, 'READY'));
    expect(kinds(ready)).toEqual(['retired-u']);
    const frozen = variant((d) => cite(d, 'READY · frozen (executing)'));
    expect(frozen.failures).toEqual([]);
    expect(frozen.warnings.map((w) => w.kind)).toEqual(['retired-u']);
    const done = variant((d) => cite(d, 'DONE'));
    expect(done.failures).toEqual([]);
  });

  it('a missing section A file is one failure naming it', () => {
    const r = variant((d) => rmSync(path.join(d, 'spec', '09-risk-register.md')));
    expect(kinds(r)).toEqual(['missing-file']);
    expect(r.failures[0]?.message).toContain('spec/09-risk-register.md');
  });

  it('parses the old ids of the Merged U-ids line only', () => {
    expect(retiredUIds('- **Merged U-ids** (old → kept): U-ENG-7, U-NPC-10 → U-AST-1 · U-AST-6 → U-BE-3 · U-TYC-5 closed by DL-139.')).toEqual(['U-ENG-7', 'U-NPC-10', 'U-AST-6']);
  });
});

describe('spec-files over the repository (AC-5)', () => {
  const r = checkSpecFiles({ root: repoRoot, out: path.join(repoRoot, 'tests', 'reports') });

  it('without strict it writes tests/reports/spec-files.json and does not fail', () => {
    expect(r.ok).toBe(true);
    const json = JSON.parse(readFileSync(path.join(repoRoot, 'tests', 'reports', 'spec-files.json'), 'utf8')) as { failures: unknown[]; warnings: unknown[] };
    expect(Array.isArray(json.failures)).toBe(true);
  });

  it('the repository has all section A files; word-ceiling overruns are reported for the Architect, not failed', () => {
    expect(r.failures.filter((f) => f.kind === 'missing-file')).toEqual([]);
    for (const f of r.failures.filter((x) => x.kind === 'too-long')) expect(f.message).toMatch(/has \d+ words \(limit 6000\)/);
  });

  it('the kickoff list matches _PLAN.md section 1', () => {
    expect(r.failures.filter((f) => f.kind === 'kickoff')).toEqual([]);
  });
});
