/**
 * check:perf (11-platform-perf.md section 5, M01c). CPU-side budget checks on canned scenarios:
 *
 *   tsx tools/ci/perf-check.ts [--scenario <id>] [--fail] [--skip-run] [--duration <s>] [--warmup <s>]
 *
 * It runs tests/perf (Playwright) on `chromium-webgl2` and `webkit-webgl2` for each flat tier, which writes
 * `test-results/perf.<project>.<tier>.json`, then runs `perf-verify --counts-only` on every report. SwiftShader frame times
 * are never asserted. Without `--fail` a miss is a warning and the exit code is 0 (PR mode); with `--fail` it is an error
 * (nightly mode) and a missing report counts as a miss. `--skip-run` verifies the reports already on disk.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { QualityTierId } from '../../packages/shared/src/index.ts';
import { args, repoRoot } from './run.ts';
import { isMain } from './lib/common.ts';
import { verifyFile } from './perf-verify.ts';

export const PERF_PROJECTS = ['chromium-webgl2', 'webkit-webgl2'] as const;
export const FLAT_TIERS: readonly QualityTierId[] = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'];

export function reportPath(root: string, project: string, tier: string): string {
  return path.join(root, 'test-results', `perf.${project}.${tier}.json`);
}

export interface CheckResult {
  ok: boolean;
  lines: string[];
  checked: number;
  missing: number;
}

/** Verifies the 2 x 4 reports under `root/test-results` with counts-only assertions. */
export function checkReports(root: string): CheckResult {
  const lines: string[] = [];
  let ok = true;
  let checked = 0;
  let missing = 0;
  for (const project of PERF_PROJECTS) {
    for (const tier of FLAT_TIERS) {
      const file = reportPath(root, project, tier);
      const label = `${project} ${tier}`;
      if (!existsSync(file)) {
        missing += 1;
        ok = false;
        lines.push(`FAIL  ${label}: no report at ${path.relative(root, file)}`);
        continue;
      }
      checked += 1;
      const r = verifyFile(file, { tier, countsOnly: true });
      if (!r.ok) ok = false;
      lines.push(`${r.ok ? 'PASS' : 'FAIL'}  ${label}`);
      for (const l of r.lines.filter((x) => x.startsWith('FAIL'))) lines.push(`        ${l}`);
    }
  }
  return { ok, lines, checked, missing };
}

function main(): void {
  const argv = args();
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const fail = argv.includes('--fail');
  const scenario = flag('--scenario') ?? 'graybox-walk';
  if (!argv.includes('--skip-run')) {
    const env = {
      ...process.env,
      DV_PERF_SCENARIO: scenario,
      ...(flag('--duration') ? { DV_PERF_DURATION_S: flag('--duration') as string } : {}),
      ...(flag('--warmup') ? { DV_PERF_WARMUP_S: flag('--warmup') as string } : {}),
    };
    const bin = path.join(repoRoot, 'node_modules', '.bin', 'playwright');
    console.log(`check:perf running ${scenario} on ${PERF_PROJECTS.join(' and ')} for ${FLAT_TIERS.join(', ')}`);
    const res = spawnSync(bin, ['test', '--config', 'playwright.perf.config.ts'], { stdio: 'inherit', cwd: repoRoot, env });
    if (res.error || (res.status ?? 1) !== 0) {
      console.error(`check:perf: the Playwright run ${res.error ? `could not start (${res.error.message})` : `exited ${String(res.status)}`}`);
      process.exit(1);
    }
  }
  const result = checkReports(repoRoot);
  console.log('check:perf counts-only verification');
  for (const l of result.lines) console.log(`  ${l}`);
  if (result.ok) {
    console.log(`check:perf passed (${result.checked} reports)`);
    return;
  }
  if (fail) {
    console.error('check:perf failed');
    process.exit(1);
  }
  console.warn('check:perf: warnings only (pass --fail to turn them into errors)');
}

if (isMain(import.meta.url)) main();
