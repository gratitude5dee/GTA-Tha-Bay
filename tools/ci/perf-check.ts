/**
 * check:perf (11-platform-perf.md section 5, M01c). CPU-side budget checks on canned scenarios:
 *
 *   tsx tools/ci/perf-check.ts [--scenario <id>] [--fail] [--skip-run] [--duration <s>] [--warmup <s>]
 *
 * It runs tests/perf (Playwright) on `chromium-webgl2` and `webkit-webgl2` for each flat tier, once per selected scenario, which
 * writes `test-results/perf.<scenario>.<project>.<tier>.json`, then runs `perf-verify --counts-only` on every report. The default
 * selection is `PERF_SCENARIOS`, the ids in `config/perf/scenarios.json` (M02b1); `--scenario <id>` selects one of them or
 * `graybox-walk` (a build without `DV_WORLD`), and an unknown id exits non-zero. Before a run the selected scenarios' reports are
 * deleted, so a stale file never passes for a fresh one. SwiftShader frame times
 * are never asserted. Without `--fail` a miss is a warning and the exit code is 0 (PR mode); with `--fail` it is an error
 * (nightly mode) and a missing report counts as a miss. `--skip-run` verifies the reports already on disk.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { QualityTierId } from '../../packages/shared/src/index.ts';
import { args, repoRoot } from './run.ts';
import { isMain } from './lib/common.ts';
import { verifyFile } from './perf-verify.ts';

export const PERF_PROJECTS = ['chromium-webgl2', 'webkit-webgl2'] as const;
export const FLAT_TIERS: readonly QualityTierId[] = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'];

/** Scenario ids a flat-tier `tests/perf` run registers; adding one is a one-line edit of the data file (M02b1, DL-656). */
export const PERF_SCENARIOS: readonly string[] = JSON.parse(readFileSync(path.join(repoRoot, 'config', 'perf', 'scenarios.json'), 'utf8')) as string[];

/** Selectable by name without being in the default selection: the gray-box walk of a build without `DV_WORLD`. */
export const EXTRA_SCENARIOS: readonly string[] = ['graybox-walk'];

export function reportPath(root: string, scenario: string, project: string, tier: string): string {
  return path.join(root, 'test-results', `perf.${scenario}.${project}.${tier}.json`);
}

/** The scenarios a `--scenario` argument selects: that one id (when known), or the registered list. */
export function selectScenarios(arg: string | undefined): string[] | null {
  if (arg === undefined) return [...PERF_SCENARIOS];
  return [...PERF_SCENARIOS, ...EXTRA_SCENARIOS].includes(arg) ? [arg] : null;
}

export interface CheckResult {
  ok: boolean;
  lines: string[];
  checked: number;
  missing: number;
}

/** Verifies the scenarios x 2 x 4 reports under `root/test-results` with counts-only assertions. */
export function checkReports(root: string, scenarios: readonly string[] = PERF_SCENARIOS): CheckResult {
  const lines: string[] = [];
  let ok = true;
  let checked = 0;
  let missing = 0;
  for (const scenario of scenarios) {
    for (const project of PERF_PROJECTS) {
      for (const tier of FLAT_TIERS) {
        const file = reportPath(root, scenario, project, tier);
        const label = `${scenario} ${project} ${tier}`;
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
  const scenarios = selectScenarios(flag('--scenario'));
  if (!scenarios) {
    console.error(`check:perf: unknown scenario "${String(flag('--scenario'))}"; known: ${[...PERF_SCENARIOS, ...EXTRA_SCENARIOS].join(', ')}`);
    process.exit(1);
  }
  if (!argv.includes('--skip-run')) {
    const bin = path.join(repoRoot, 'node_modules', '.bin', 'playwright');
    for (const scenario of scenarios) {
      for (const project of PERF_PROJECTS) for (const tier of FLAT_TIERS) rmSync(reportPath(repoRoot, scenario, project, tier), { force: true });
    }
    for (const scenario of scenarios) {
      const env = {
        ...process.env,
        DV_PERF_SCENARIO: scenario,
        ...(flag('--duration') ? { DV_PERF_DURATION_S: flag('--duration') as string } : {}),
        ...(flag('--warmup') ? { DV_PERF_WARMUP_S: flag('--warmup') as string } : {}),
      };
      console.log(`check:perf running ${scenario} on ${PERF_PROJECTS.join(' and ')} for ${FLAT_TIERS.join(', ')}`);
      const res = spawnSync(bin, ['test', '--config', 'playwright.perf.config.ts'], { stdio: 'inherit', cwd: repoRoot, env });
      if (res.error || (res.status ?? 1) !== 0) {
        console.error(`check:perf: the Playwright run for ${scenario} ${res.error ? `could not start (${res.error.message})` : `exited ${String(res.status)}`}`);
        process.exit(1);
      }
    }
  }
  const result = checkReports(repoRoot, scenarios);
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
