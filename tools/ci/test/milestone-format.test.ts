import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MILESTONE_HEADINGS } from '../../../packages/shared/src/contracts/c15-milestone.ts';
import { L7_FILE_EXCEPTIONS, lintMilestones, writeReport } from '../milestone-lint.ts';
import { inferOracle, parseMilestone, parsePnpmPiece } from '../md-parse.ts';
import { repoRoot } from '../run.ts';

const specDir = path.join(repoRoot, 'spec', '07-milestones');
const fixDir = path.join(repoRoot, 'tools', 'ci', 'fixtures', 'milestones');

describe('C15 milestone lint over the repository (AC-2)', () => {
  const res = lintMilestones(specDir);

  it('every enforced (READY or later) file passes L1-L7 with zero errors', () => {
    expect(res.errors.map((f) => `${f.file}:${f.line} ${f.rule} ${f.message}`)).toEqual([]);
    const enforced = res.reports.filter((r) => r.enforced);
    expect(enforced.length).toBeGreaterThanOrEqual(119);
  });

  it('parses every acceptance criterion of every file', () => {
    for (const r of res.reports) {
      const text = readFileSync(path.join(specDir, r.file), 'utf8');
      const declared = (text.match(/^- AC-\d+ Given\b/gm) ?? []).length;
      expect(parseMilestone(text).acs.length, r.file).toBe(declared);
    }
  });

  it('writes tests/reports/milestones.json with {file, status, enforced, errors, warnings}', () => {
    const out = path.join(repoRoot, 'tests', 'reports', 'milestones.json');
    writeReport(res.reports, out);
    const json = JSON.parse(readFileSync(out, 'utf8')) as { file: string; status: string; enforced: boolean; errors: string[]; warnings: string[] }[];
    expect(json.length).toBe(res.reports.length);
    expect(Object.keys(json[0] as object).sort()).toEqual(['enforced', 'errors', 'file', 'status', 'warnings']);
  });

  it('holds the M00 file-count exception as the only entry', () => {
    expect(L7_FILE_EXCEPTIONS).toEqual({ M00: 45 });
  });
});

describe('C15 lint fixtures (AC-3)', () => {
  const res = lintMilestones(fixDir);
  const rulesOf = (file: string): string[] => res.findings.filter((f) => f.file === file && res.errors.includes(f)).map((f) => f.rule);

  it('good-ready.md passes', () => {
    expect(rulesOf('good-ready.md')).toEqual([]);
  });
  it.each([
    ['bad-missing-heading.md', 'L1'],
    ['bad-ac-no-proof.md', 'L2'],
    ['bad-unverified-in-ac.md', 'L4'],
    ['bad-unknown-script.md', 'L5'],
  ])('%s fails with exactly %s', (file, rule) => {
    expect(rulesOf(file)).toEqual([rule]);
  });

  it('a PENDING file reports its errors as warnings that keep the rule id and does not fail', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dv-ms-'));
    cpSync(fixDir, dir, { recursive: true });
    const readme = readFileSync(path.join(dir, 'README.md'), 'utf8').replace('| bad-ac-no-proof | READY |', '| bad-ac-no-proof | PENDING |');
    writeFileSync(path.join(dir, 'README.md'), readme);
    const r = lintMilestones(dir);
    const rep = r.reports.find((x) => x.file === 'bad-ac-no-proof.md');
    expect(rep).toMatchObject({ status: 'PENDING', enforced: false, errors: [] });
    expect(rep?.warnings.some((w) => w.includes(' L2 '))).toBe(true);
    expect(r.errors.map((e) => e.file)).not.toContain('bad-ac-no-proof.md');
  });
});

describe('proof grammar (13-qa section 4.2)', () => {
  it('splits env prefixes and chains', () => {
    const p = parsePnpmPiece('env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID pnpm deploy:preview -- --sweep-closed');
    expect(p).toMatchObject({ script: 'deploy:preview', unset: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] });
    expect(parsePnpmPiece('DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2')).toMatchObject({ script: 'check:e2e' });
    expect(parsePnpmPiece('pnpm --filter @dv/shared test -- world')).toMatchObject({ filter: '@dv/shared', script: 'test', args: '-- world' });
    expect(parsePnpmPiece('node x.js')).toBeNull();
  });

  it('infers the oracle from the script (first match)', () => {
    const o = (s: string): string => inferOracle(parsePnpmPiece(s) as NonNullable<ReturnType<typeof parsePnpmPiece>>);
    expect(o('pnpm check:unit -- tools/ci')).toBe('unit');
    expect(o('pnpm check:unit -- packages/shared/test/golden')).toBe('golden');
    expect(o('pnpm --filter @dv/engine test:determinism')).toBe('state-hash');
    expect(o('pnpm check:e2e -- --project=chromium-webgl2 --grep @world-hash')).toBe('state-hash');
    expect(o('pnpm check:e2e -- --project=chromium-webgl2 --grep @pwa')).toBe('e2e');
    expect(o('pnpm check:workers -- geo-gate')).toBe('workers');
    expect(o('pnpm check:perf -- --fail')).toBe('perf-cpu');
    expect(o('pnpm perf:verify -- perf.json --tier mobile-low')).toBe('device-perf');
    expect(o('pnpm check:missions')).toBe('bot-run');
    expect(o('pnpm provenance:check')).toBe('static-gate');
  });

  it('the C15 heading list has the 13 verbatim headings', () => {
    expect(MILESTONE_HEADINGS.length).toBe(13);
  });
});
