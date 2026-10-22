import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../run.ts';

/** DL-250: root Vitest collects **\/*.{test,spec}.{ts,tsx} except tests/e2e, tests/perf, services/*\/test and build output. */
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.claude', '.git', '.wrangler', 'test-results', 'playwright-report']);
const TEST_RE = /\.(?:test|spec)\.tsx?$/;

function globTests(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    if (EXCLUDED_DIRS.has(name)) continue;
    const full = path.join(dir, r);
    if (statSync(full).isDirectory()) out.push(...globTests(dir, r));
    else if (TEST_RE.test(name)) out.push(r);
  }
  return out;
}

// M05d: tests/staging runs against a deployed Worker (pnpm test:staging), not in the unit job.
const excluded = (f: string): boolean => /^tests\/(e2e|perf|staging)\//.test(f) || /^services\/[^/]+\/test\//.test(f);

describe('unit-collect (AC-11, DL-250)', () => {
  const found = globTests(repoRoot).filter((f) => !excluded(f));

  it('finds both suffixes, including tools/*/test/*.spec.ts', () => {
    expect(found.some((f) => f.endsWith('.test.ts'))).toBe(true);
    expect(found.some((f) => f.endsWith('.spec.ts'))).toBe(true);
    expect(found).toContain('tools/ci/test/perf-verify.spec.ts');
  });

  it('every test file outside the excludes is in the list Vitest collects (vitest list --filesOnly --json)', () => {
    const res = spawnSync('pnpm', ['exec', 'tsx', 'tools/ci/run.ts', 'vitest', 'list', '--filesOnly', '--json'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(res.status, res.stderr).toBe(0);
    const start = res.stdout.indexOf('[');
    const collected = (JSON.parse(res.stdout.slice(start)) as ({ file: string } | string)[]).map((e) => path.relative(repoRoot, typeof e === 'string' ? e : e.file).split(path.sep).join('/'));
    const set = new Set(collected);
    expect(found.filter((f) => !set.has(f))).toEqual([]);
    expect(set.has('tools/ci/test/perf-verify.spec.ts')).toBe(true);
  }, 120_000);
});
