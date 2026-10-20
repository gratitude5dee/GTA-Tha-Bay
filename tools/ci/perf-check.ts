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

/** Scenarios that show the ambient traffic (M03b1): their run also writes `perf.<scenario>.<project>.<tier>.traffic.json`. */
export const TRAFFIC_SCENARIOS: readonly string[] = ['downtown-rush'];

export function trafficPath(root: string, scenario: string, project: string, tier: string): string {
  return path.join(root, 'test-results', `perf.${scenario}.${project}.${tier}.traffic.json`);
}

/**
 * The traffic half of a traffic scenario (M03b1, AC-10): the instances drawn stay within `crowd.maxTrafficInstances` of the tier row of
 * `config/tier-budgets.json` (C13 `CrowdLimits`), the instanced draws within one mesh, and the traffic was really on
 * screen (at least one instance) so a build without it cannot pass. Returns the failure lines.
 */
export function verifyTraffic(file: string, tier: QualityTierId): string[] {
  const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'config', 'tier-budgets.json'), 'utf8')) as { tiers: Record<string, { crowd: { maxTrafficInstances: number } }> };
  const crowd = budgets.tiers[tier]?.crowd;
  const t = JSON.parse(readFileSync(file, 'utf8')) as { instancesMax: number; drawsMax: number; objectsMax: number; simAgents: number };
  const out: string[] = [];
  if (!crowd) return [`FAIL  no crowd row for tier ${tier} in config/tier-budgets.json`];
  if (t.instancesMax < 1) out.push('FAIL  no traffic instance was drawn during the run');
  if (t.instancesMax > crowd.maxTrafficInstances) out.push(`FAIL  traffic instances ${t.instancesMax} > crowd.maxTrafficInstances ${crowd.maxTrafficInstances}`);
  if (t.simAgents > crowd.maxTrafficInstances + 400) out.push(`FAIL  sim agents ${t.simAgents} are far over the instance cap ${crowd.maxTrafficInstances}`);
  if (t.drawsMax > TRAFFIC_DRAWS_MAX) out.push(`FAIL  traffic draws ${t.drawsMax} > ${TRAFFIC_DRAWS_MAX} (one instanced mesh)`);
  return out;
}

/** Skinned near-LOD pedestrians per tier (living part 4.5); `packages/world/src/sim/peds/density.ts` holds the same table (a unit test keeps them equal). */
export const NEAR_PED_CAP: Readonly<Record<string, number>> = { 'desktop-ultra': 24, desktop: 24, 'xr-visionpro': 16, mobile: 12, 'xr-quest': 8, 'mobile-low': 6 };

/** The far pedestrians draw as one instanced mesh per body (8) plus one draw per near figure. */
export const PED_FAR_DRAWS_MAX = 8;

/**
 * The pedestrian half of a traffic scenario (M03b2, AC-9): the instances drawn (far and near) stay within `crowd.maxPedInstances` of the
 * tier row, the skinned near figures within the tier's near cap, the sim population within the cap, the draws within one mesh per body
 * plus the near figures, and cars and buses together within `crowd.maxTrafficInstances` (buses share the traffic cap). At least one
 * pedestrian was on screen, so a build without them cannot pass. Returns the failure lines.
 */
export function verifyPeds(file: string, tier: QualityTierId): string[] {
  const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'config', 'tier-budgets.json'), 'utf8')) as { tiers: Record<string, { crowd: { maxPedInstances: number; maxTrafficInstances: number } }> };
  const crowd = budgets.tiers[tier]?.crowd;
  const t = (JSON.parse(readFileSync(file, 'utf8')) as { peds?: { instancesMax: number; nearMax: number; drawsMax: number; carsPlusBusesMax: number; simPeds: number } }).peds;
  if (!crowd) return [`FAIL  no crowd row for tier ${tier} in config/tier-budgets.json`];
  if (!t) return ['FAIL  the traffic report has no pedestrian block'];
  const out: string[] = [];
  const nearCap = NEAR_PED_CAP[tier] ?? 0;
  if (t.instancesMax < 1) out.push('FAIL  no pedestrian instance was drawn during the run');
  if (t.instancesMax > crowd.maxPedInstances) out.push(`FAIL  pedestrian instances ${t.instancesMax} > crowd.maxPedInstances ${crowd.maxPedInstances}`);
  if (t.nearMax > nearCap) out.push(`FAIL  near-LOD skinned pedestrians ${t.nearMax} > the ${tier} cap ${nearCap}`);
  if (t.simPeds > crowd.maxPedInstances) out.push(`FAIL  sim pedestrians ${t.simPeds} > crowd.maxPedInstances ${crowd.maxPedInstances}`);
  if (t.drawsMax > PED_FAR_DRAWS_MAX + nearCap) out.push(`FAIL  pedestrian draws ${t.drawsMax} > ${PED_FAR_DRAWS_MAX} far meshes + ${nearCap} near figures`);
  if (t.carsPlusBusesMax > crowd.maxTrafficInstances) out.push(`FAIL  cars and buses ${t.carsPlusBusesMax} > crowd.maxTrafficInstances ${crowd.maxTrafficInstances}`);
  return out;
}

/** One instanced mesh draws every archetype (compact, sedan, rideshare, robotaxi, van, truck, pickup, cruiser). */
export const TRAFFIC_DRAWS_MAX = 1;

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
        if (TRAFFIC_SCENARIOS.includes(scenario)) {
          const tf = trafficPath(root, scenario, project, tier);
          if (!existsSync(tf)) {
            missing += 1;
            ok = false;
            lines.push(`FAIL  ${label}: no traffic report at ${path.relative(root, tf)}`);
          } else {
            const bad = [...verifyTraffic(tf, tier), ...verifyPeds(tf, tier)];
            if (bad.length > 0) ok = false;
            for (const l of bad) lines.push(`        ${l}`);
          }
        }
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
      for (const project of PERF_PROJECTS) {
        for (const tier of FLAT_TIERS) {
          rmSync(reportPath(repoRoot, scenario, project, tier), { force: true });
          rmSync(trafficPath(repoRoot, scenario, project, tier), { force: true });
        }
      }
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
