import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARCHIVES } from '../pw-install.ts';
import { repoRoot } from '../run.ts';
import { useTempDirs } from '../test-tmp.ts';

// BD-FIX-TMP-01: temp folders made here are removed after the last test of this file.
const tempDir = useTempDirs();

const wf = (name: string): string => readFileSync(path.join(repoRoot, '.github', 'workflows', name), 'utf8');

/** `jobs:` children of a workflow as { name -> block text }; the files use 2-space indentation and no anchors. */
function jobsOf(text: string): Record<string, string> {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === 'jobs:');
  const jobs: Record<string, string[]> = {};
  let cur: string | null = null;
  for (const l of lines.slice(start + 1)) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (m) {
      cur = m[1] as string;
      jobs[cur] = [];
    } else if (cur) (jobs[cur] as string[]).push(l);
  }
  return Object.fromEntries(Object.entries(jobs).map(([k, v]) => [k, v.join('\n')]));
}

/** The four e2e projects (playwright.config.ts), as the `e2e` job's matrix lists them. */
const E2E_PROJECTS = ['chromium-webgpu', 'chromium-webgl2', 'webkit-webgl2', 'xr-quest3'] as const;
/** BD-FIX-CI-PLAN-02: the shard count of each project (24 e2e-shard jobs). A change here is a change of the matrix, the plan and the aggregate. */
const E2E_SHARD_COUNTS: Record<(typeof E2E_PROJECTS)[number], number> = { 'chromium-webgl2': 14, 'webkit-webgl2': 4, 'chromium-webgpu': 5, 'xr-quest3': 1 };

/** The rows of the e2e-shard matrix (its `include:` list), in file order. */
function shardRows(job: string): { project: string; shard: number; shards: number }[] {
  return [...job.matchAll(/^ {10}- \{ project: ([a-z0-9-]+), shard: (\d+), shards: (\d+) \}$/gm)].map((m) => ({ project: m[1] as string, shard: Number(m[2]), shards: Number(m[3]) }));
}

/** The `e2e` job's E2E_SHARDS for one project: the expression of the step's env, evaluated as GitHub would for that matrix leg. */
function aggregateShards(agg: string, project: string): number {
  const expr = /^ {10}E2E_SHARDS: (\$\{\{ .* \}\})$/m.exec(agg)?.[1] ?? '';
  expect(expr, 'E2E_SHARDS is an expression on matrix.project').toContain('matrix.project');
  return Number(evalSet(expr, { project }));
}

/** Evaluates a workflow expression for one matrix leg (the expressions hold only ==, &&, || and literals). */
function evalSet(expr: string, leg: { project: string; shard?: number }): string {
  const m = /^\$\{\{ (.*) \}\}$/.exec(expr);
  if (!m) return expr.replace(/^'(.*)'$/, '$1');
  const js = (m[1] as string)
    .replace(/matrix\.project/g, JSON.stringify(leg.project))
    .replace(/matrix\.shard/g, String(leg.shard ?? 0))
    .replace(/==/g, '===');
  expect(js, 'only literals and operators remain').toMatch(/^[\s'"a-z0-9=&|-]+$/);
  return String(new Function(`return (${js});`)());
}

describe('ci.yml (AC-8)', () => {
  const jobs = jobsOf(wf('ci.yml'));

  it('static runs check:agents, check:telemetry, check:skills and check:rollout', () => {
    for (const s of ['check:agents', 'check:telemetry', 'check:skills', 'check:rollout']) expect(jobs['static'], s).toContain(`pnpm ${s}`);
  });

  it('static runs check:assets --release-strict only on pull requests into main (BD-FIX-REL-02)', () => {
    const step = stepsOf(jobs['static'] ?? '').find((s) => s.includes('--release-strict')) ?? '';
    expect(step).toContain('run: pnpm check:assets -- --release-strict');
    expect(step).toContain("if: github.event_name == 'pull_request' && github.base_ref == 'main'");
    // integration jobs keep the warning-only form
    expect(jobs['ip']).toMatch(/run: pnpm check:assets\n/);
  });

  it('has a device-runs job filtered to docs/device-runs/** and docs/device-spike/** that judges reports with perf:verify --auto', () => {
    const job = jobs['device-runs'];
    expect(job).toBeDefined();
    expect(job).toContain("'docs/device-runs/**/perf.json'");
    expect(job).toContain("'docs/device-spike/**/perf.json'");
    expect(job).toContain('perf:verify -- "$f" --auto');
  });

  it('unit passes DV_PR_LABELS, fetches full history for the golden guard and uploads tests/reports', () => {
    expect(jobs['unit']).toContain("DV_PR_LABELS: ${{ join(github.event.pull_request.labels.*.name, ',') }}");
    expect(jobs['unit']).toContain('fetch-depth: 0');
    expect(jobs['unit']).toContain('--outputFile.json=tests/reports/vitest.json');
    expect(jobs['unit']).toMatch(/upload-artifact[\s\S]*path: tests\/reports/);
  });

  it('unit passes DV_PR_REASON for the verifier lock and content runs check:balance (M04d)', () => {
    expect(jobs['unit']).toContain('DV_PR_REASON: ${{ github.event.pull_request.body }}');
    expect(jobs['content']).toContain('pnpm check:balance');
  });

  it('the content job restores or builds the world bakes before it runs pnpm check:missions; the nightly runs it too (M05a2 AC-10)', () => {
    const job = jobs['content'] ?? '';
    const cache = job.search(/uses: actions\/cache@[0-9a-f]{40}\n\s+with:\n\s+path: \|\n\s+\.cache\/map\n\s+dist\/world\n\s+key: world-bakes-/);
    const bake = job.indexOf('run: pnpm map:build -- --area synth && pnpm map:build -- --area civic-excerpt');
    const missions = job.indexOf('run: pnpm check:missions');
    expect(cache, 'cache step').toBeGreaterThan(-1);
    expect(bake, 'map:build on a miss').toBeGreaterThan(cache);
    expect(missions, 'check:missions').toBeGreaterThan(bake);
    expect(job).toContain("if: steps.bake-cache.outputs.cache-hit != 'true'");
    expect(wf('nightly.yml')).toContain('pnpm check:missions');
  });

  it('has a world-content job (M02a1) that restores .cache/map, checks the graybox fixture and bakes the civic-excerpt twice; unit no longer runs map:fixture', () => {
    const job = jobs['world-content'] ?? '';
    expect(job).toContain('pnpm map:fixture graybox --check');
    expect(job).toContain('pnpm map:build -- --area civic-excerpt --repro');
    expect(job).toMatch(/uses: actions\/cache@[0-9a-f]{40}/);
    expect(job).toContain('path: .cache/map');
    expect(job).toContain("hashFiles('tools/map/**', 'config/world/**', 'content/world/**')");
    expect(job).toContain('pnpm install --frozen-lockfile');
    expect(jobs['unit']).not.toContain('map:fixture');
  });

  it('every job sets timeout-minutes', () => {
    for (const [name, block] of Object.entries(jobs)) expect(block, name).toMatch(/timeout-minutes: \d+/);
  });

  // BD-FIX-CI-03: the DV_WORLD=synth step alone outlasted 30 min on chromium-webgl2 (run 39517892975). BD-FIX-CI2-04: one job then
  // took 1.1 h of its 75 minutes (e72e1fc), so the tests run as Playwright shards in e2e-shard; the job `e2e` keeps the names of the
  // required checks (`e2e (<project>)`, the same four-project matrix) and is green only when every shard of its project passed.
  // BD-FIX-CI-PLAN-02: each project has its own shard count. The matrix is a list of rows { project, shard, shards }; for every project
  // the rows are shards 1..n with `shards` n in each, the plan step packs with that `shards`, and the aggregate waits for the same n.
  it('e2e-shard splits each project into its own count of shards; e2e keeps its name and matrix and reports all shards of its project; nightly e2e-full at least 90', () => {
    const minutes = (block: string | undefined): number => Number(/timeout-minutes: (\d+)/.exec(block ?? '')?.[1] ?? 0);
    const shard = jobs['e2e-shard'] ?? '';
    const agg = jobs['e2e'] ?? '';
    const rows = shardRows(shard);
    // The matrix is the include list alone (no project x shard product beside it), and every line under `include:` is a row read here.
    expect(shard).toMatch(/^ {6}matrix:\n(?: {8}#.*\n)* {8}include:\n/m);
    expect(shard).not.toMatch(/^ {8}(?:project|shard|shards|exclude): /m);
    const listed = (/^ {8}include:\n((?: {10}.*\n)+)/m.exec(shard)?.[1] ?? '').trimEnd().split('\n');
    expect(listed).toHaveLength(rows.length);
    expect([...new Set(rows.map((r) => r.project))].sort()).toEqual([...E2E_PROJECTS].sort());
    for (const project of E2E_PROJECTS) {
      const n = E2E_SHARD_COUNTS[project];
      const mine = rows.filter((r) => r.project === project);
      expect(mine.map((r) => r.shard), `${project}: shards 1..${n}, each once`).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      for (const r of mine) expect(r.shards, `${project} shard ${r.shard}: its plan is cut into ${n}`).toBe(n);
      // the aggregate waits for exactly the shards the matrix runs
      expect(aggregateShards(agg, project), `${project}: E2E_SHARDS of the e2e job`).toBe(n);
    }
    expect(rows).toHaveLength(24);
    expect(E2E_SHARD_COUNTS['chromium-webgl2']).toBeGreaterThanOrEqual(2);
    // chromium-webgl2, the longest legs, is listed first
    expect(rows.slice(0, E2E_SHARD_COUNTS['chromium-webgl2']).every((r) => r.project === 'chromium-webgl2')).toBe(true);
    expect(shard).toContain('needs: [build, scope]');
    expect(minutes(shard)).toBe(60);
    // Both halves run the shard's share; each shard writes its outcome even after a failure and uploads it under its own name.
    const runs = stepsOf(shard).filter((s) => s.includes('pnpm check:e2e'));
    expect(runs).toHaveLength(2);
    // BD-FIX-CI-DURSHARD-01: the shard's share is the test list tools/ci/e2e-plan.ts packs by measured minutes, planned before both runs.
    const steps = stepsOf(shard);
    const plan = steps.findIndex((s) => s.includes('tools/ci/e2e-plan.ts plan'));
    expect(plan).toBeGreaterThanOrEqual(0);
    expect(steps[plan]).toContain('--project ${{ matrix.project }} --shards ${{ matrix.shards }} --shard ${{ matrix.shard }} --out "$RUNNER_TEMP/e2e-tests.txt"');
    for (const s of runs) {
      expect(s).toContain('--test-list "$RUNNER_TEMP/e2e-tests.txt"');
      expect(s).not.toContain('--shard=');
      expect(steps.indexOf(s)).toBeGreaterThan(plan);
    }
    const result = stepsOf(shard).find((s) => s.includes('name: Shard result')) ?? '';
    expect(result).toContain('if: always()');
    expect(result).toContain('echo "${{ job.status }}" > "e2e-result/${{ matrix.project }}-${{ matrix.shard }}.txt"');
    expect(shard).toMatch(/if: always\(\)\n\s+with:\n\s+name: e2e-result-\$\{\{ matrix\.project \}\}-\$\{\{ matrix\.shard \}\}/);
    // The aggregate: same name and matrix as the required checks, runs after every shard (also failed ones), reads only its project's results.
    // BD-FIX-CI3-D01: `build` is a need only so the log can say why the shards never ran; the verdict reads the shard results alone.
    expect(agg).toContain('needs: [build, scope, e2e-shard]');
    expect(agg).toContain('if: ${{ !cancelled() }}');
    expect(agg).toContain('project: [chromium-webgpu, chromium-webgl2, webkit-webgl2, xr-quest3]');
    expect(agg).toContain('pattern: e2e-result-${{ matrix.project }}-*');
    expect(agg).toContain('echo "e2e ${PROJECT} shard ${n}/${E2E_SHARDS}: ${r}"');
    expect(agg).toContain('[ "$r" = "success" ] || status=1');
    expect(agg).not.toContain('pnpm check:e2e');
    // Advisory projects stay advisory in both jobs.
    const advisory = "continue-on-error: ${{ matrix.project != 'chromium-webgl2' && matrix.project != 'webkit-webgl2' }}";
    expect(shard).toContain(advisory);
    expect(agg).toContain(advisory);
    expect(minutes(jobsOf(wf('nightly.yml'))['e2e-full'])).toBeGreaterThanOrEqual(90);
  });

  // BD-FIX-CI3-D01: from c03f671 the build job failed (verify:dist), e2e-shard was skipped as a whole, no e2e-result-* artifact existed
  // and the four aggregates printed "shard n/3: missing" with no cause (run 39862711522). The step script itself is run here under
  // `bash -e` (the runner's default shell) for each case: green only when every shard wrote `success`; a failed, skipped or missing
  // shard is red, and a missing result after a failed build names the build job.
  // BD-FIX-CI-PLAN-02: run for each project with its own shard count (one shard for xr-quest3).
  it('e2e aggregate step: green exactly when every shard of the project wrote success; names a failed build', () => {
    const agg = jobs['e2e'] ?? '';
    const step = stepsOf(agg).find((s) => s.includes('name: Every shard of the project passed')) ?? '';
    const lines = step.split('\n');
    const at = lines.findIndex((l) => /^ {8}run: \|$/.test(l));
    expect(at).toBeGreaterThan(-1);
    const body = lines.slice(at + 1).filter((l) => l.startsWith(' '.repeat(10)) || l.trim() === '');
    const script = body.map((l) => l.slice(10)).join('\n');
    expect(script).not.toContain('${{');
    expect(step).toContain('BUILD_RESULT: ${{ needs.build.result }}');
    expect(step).toContain('SHARDS_RESULT: ${{ needs.e2e-shard.result }}');
    // Equal to the e2e-shard matrix (BD-FIX-CI8-S01 went from three shards to four, BD-INTEG-M02g1-01 to six, BD-FIX-CI-SHARD8-01 to eight, BD-REPAIR-M02g2-03 to nine,
    // BD-FIX-CI-SHARD12-01 to twelve, BD-FIX-CI-SHARD14-01 to fourteen; BD-FIX-CI-PLAN-02 gave each project its own count: 14, 5, 4 and 1).
    expect(aggregateShards(agg, 'chromium-webgl2')).toBe(14);
    const matrix = shardRows(jobs['e2e-shard'] ?? '');
    for (const project of E2E_PROJECTS) {
      const shards = aggregateShards(agg, project);
      expect(shards, project).toBe(matrix.filter((r) => r.project === project).length);
      expect(shards, project).toBe(E2E_SHARD_COUNTS[project]);
      const other = project === 'webkit-webgl2' ? 'chromium-webgl2' : 'webkit-webgl2';
      const all = (r: string | null): (string | null)[] => Array.from({ length: shards }, () => r);
      const withAt = (i: number, r: string | null): (string | null)[] => all('success').map((v, j) => (j === i ? r : v));
      const run = (results: (string | null)[], build = 'success'): { code: number; out: string } => {
        const dir = tempDir('dv-e2e-agg-');
        try {
          mkdirSync(path.join(dir, 'e2e-result'));
          results.forEach((r, i) => {
            if (r !== null) writeFileSync(path.join(dir, 'e2e-result', `${project}-${i + 1}.txt`), `${r}\n`);
          });
          // Another project's results in the same folder never count.
          writeFileSync(path.join(dir, 'e2e-result', `${other}-1.txt`), 'failure\n');
          const res = spawnSync('bash', ['-e', '-c', script], {
            cwd: dir,
            encoding: 'utf8',
            env: { PATH: process.env['PATH'] ?? '', PROJECT: project, E2E_SHARDS: String(shards), BUILD_RESULT: build, SHARDS_RESULT: 'success' },
          });
          return { code: res.status ?? -1, out: `${res.stdout}${res.stderr}` };
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      };
      const green = run(all('success'));
      expect(green.code, project).toBe(0);
      expect(green.out, project).toContain(`e2e ${project} shard ${shards}/${shards}: success`);
      // a failed first shard, a cancelled last one, a missing last one, no result at all
      for (const bad of [withAt(0, 'failure'), withAt(shards - 1, 'cancelled'), withAt(shards - 1, null), all(null)]) {
        const r = run(bad);
        expect(r.code, `${project} ${JSON.stringify(bad)}`).toBe(1);
        expect(r.out).not.toContain('::error::');
      }
      const skipped = run(all(null), 'failure');
      expect(skipped.code).toBe(1);
      expect(skipped.out).toContain(`e2e ${project} shard ${shards}/${shards}: missing`);
      expect(skipped.out).toContain(`::error::e2e ${project}: no shard result because the build job ended 'failure'`);
    }
  });
});

/** The shell script of a step's `run: |` block, as the runner hands it to `bash -e`. */
function scriptOf(step: string): string {
  const lines = step.split('\n');
  const at = lines.findIndex((l) => /^ {8}run: \|$/.test(l));
  expect(at, 'the step has a run block').toBeGreaterThan(-1);
  return lines.slice(at + 1).filter((l) => l.startsWith(' '.repeat(10)) || l.trim() === '').map((l) => l.slice(10)).join('\n');
}

// BD-FIX-CI-PLAN-03 (the Architect's decision of 2026-11-12): on a push to claude/build whose head commit already has a completed,
// successful push run of ci on a merge candidate or on main, the e2e shards and the perf groups are skipped and their checks pass with a
// line naming that run. tools/ci/test/ci-scope.test.ts covers the decision; this covers its wiring in ci.yml.
describe('ci.yml scope: no second full run on claude/build for a commit that is already green (BD-FIX-CI-PLAN-03)', () => {
  const text = wf('ci.yml');
  const jobs = jobsOf(text);
  const scope = jobs['scope'] ?? '';
  const ON_BUILD = "if: github.event_name == 'push' && github.ref == 'refs/heads/claude/build'";
  const HEAVY_IF = "    if: needs.scope.outputs.heavy != 'false'";
  const URL = 'https://github.com/owner/repo/actions/runs/41574550973';
  const bash = (script: string, env: Record<string, string>, cwd: string): { code: number; out: string } => {
    const res = spawnSync('bash', ['-e', '-c', script], { cwd, encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', ...env } });
    return { code: res.status ?? -1, out: `${res.stdout}${res.stderr}` };
  };

  it('the triggers are unchanged: pull requests, and pushes to main, claude/build and claude/integ-**', () => {
    expect(text).toMatch(/^on:\n {2}pull_request:\n {2}push:\n(?: {4}#.*\n)* {4}branches: \[main, claude\/build, 'claude\/integ-\*\*'\]\n/m);
  });

  it('the scope job may read the runs (actions: read), exposes heavy and run-url, and looks up only on a push to claude/build', () => {
    expect(scope).toMatch(/^ {4}permissions:\n {6}contents: read\n {6}actions: read\n/m);
    expect(scope).toContain('heavy: ${{ steps.decide.outputs.heavy }}');
    expect(scope).toContain('run-url: ${{ steps.decide.outputs.run-url }}');
    // no other job, and not the workflow, gets the wider token
    expect(text.split('\njobs:')[0]).toMatch(/^permissions:\n {2}contents: read\n\n/m);
    const code = (job: string): string => job.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
    for (const [name, job] of Object.entries(jobs)) if (name !== 'scope') expect(code(job), name).not.toMatch(/actions: (read|write)/);
    const steps = stepsOf(scope);
    const decide = steps.findIndex((s) => s.includes('id: decide'));
    expect(decide).toBe(steps.length - 1);
    expect(decide).toBeGreaterThanOrEqual(2);
    // every step before the decision runs only on a push to claude/build and never fails the job
    for (const s of steps.slice(0, decide)) {
      expect(s).toContain(ON_BUILD);
      expect(s).toContain('continue-on-error: true');
    }
    const lookup = steps.find((s) => s.includes('id: runs')) ?? '';
    expect(lookup).toContain('GH_TOKEN: ${{ github.token }}');
    // spec/03 section 6: "List workflow runs for a workflow", by file name, for the head commit, push runs only
    expect(lookup).toContain('gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${GITHUB_SHA}&event=push&per_page=100" > "$RUNNER_TEMP/ci-runs.json"');
    expect(steps.filter((s) => s.includes('GH_TOKEN'))).toHaveLength(1);
    expect(steps[decide]).toContain('if: always()');
    expect(steps[decide]).toContain('LOOKUP: ${{ steps.runs.outcome }}');
    expect(steps[decide]).toContain('pnpm exec tsx tools/ci/ci-scope.ts --runs "$RUNNER_TEMP/ci-runs.json"');
  });

  it('the decision step writes the full run unless the lookup succeeded and the tool answered', () => {
    const script = scriptOf(stepsOf(scope).find((s) => s.includes('id: decide')) ?? '');
    expect(script).not.toContain('${{');
    const run = (lookup: string, pnpm: string): { code: number; out: string; written: string } => {
      const dir = tempDir('dv-ci-scope-step-');
      const bin = path.join(dir, 'bin');
      mkdirSync(bin);
      // a stand-in for `pnpm exec tsx tools/ci/ci-scope.ts`: it records that it ran, then does what the case says
      writeFileSync(path.join(bin, 'pnpm'), `#!/bin/sh\necho "$@" >> "${dir}/pnpm-calls.txt"\n${pnpm}\n`, { mode: 0o755 });
      const output = path.join(dir, 'github-output.txt');
      writeFileSync(output, '');
      const r = bash(script, { PATH: `${bin}:${process.env['PATH'] ?? ''}`, LOOKUP: lookup, RUNNER_TEMP: dir, GITHUB_OUTPUT: output }, dir);
      const calls = (() => {
        try {
          return readFileSync(path.join(dir, 'pnpm-calls.txt'), 'utf8');
        } catch {
          return '';
        }
      })();
      return { ...r, written: readFileSync(output, 'utf8'), out: `${r.out}${calls ? `\ncalls: ${calls}` : ''}` };
    };
    const FULL = 'heavy=true\nrun-url=\n';
    // pull requests, pushes to main and to claude/integ-*: the lookup was skipped, the tool is never started
    for (const lookup of ['skipped', 'failure', 'cancelled', '']) {
      const r = run(lookup, 'exit 0');
      expect(r.code, r.out).toBe(0);
      expect(r.written, lookup).toBe(FULL);
      expect(r.out).not.toContain('calls:');
    }
    // the lookup succeeded but the tool fails or cannot start: the full run
    for (const pnpm of ['exit 1', 'exit 127']) {
      const r = run('success', pnpm);
      expect(r.code, r.out).toBe(0);
      expect(r.written, pnpm).toBe(FULL);
      expect(r.out).toContain('calls: exec tsx tools/ci/ci-scope.ts --runs');
    }
    // the tool answered: its lines stand alone
    const light = run('success', `printf 'heavy=false\\nrun-url=${URL}\\n' >> "$GITHUB_OUTPUT"`);
    expect(light.code, light.out).toBe(0);
    expect(light.written).toBe(`heavy=false\nrun-url=${URL}\n`);
    expect(light.out).toContain('calls: exec tsx tools/ci/ci-scope.ts --runs');
  });

  it('e2e-shard and perf-group are the only jobs the answer skips; perf-group still starts without the build', () => {
    for (const name of ['e2e-shard', 'perf-group']) expect(`\n${jobs[name] ?? ''}`, name).toContain(`\n${HEAVY_IF}\n`);
    expect(jobs['e2e-shard']).toContain('needs: [build, scope]');
    expect(jobs['perf-group']).toMatch(/^ {4}needs: scope$/m);
    expect(jobs['perf-group']).not.toMatch(/^ {4}needs: .*build/m);
    const code = (job: string): string => job.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
    for (const [name, job] of Object.entries(jobs)) {
      if (['scope', 'e2e-shard', 'perf-group', 'e2e', 'perf'].includes(name)) continue;
      expect(code(job), `${name} does not depend on the scope`).not.toMatch(/needs\.scope|needs: .*scope/);
    }
    // the aggregates run whatever was skipped, and read the answer
    for (const name of ['e2e', 'perf']) {
      expect(jobs[name], name).toContain('if: ${{ !cancelled() }}');
      expect(jobs[name], name).toContain('HEAVY: ${{ needs.scope.outputs.heavy }}');
      expect(jobs[name], name).toContain('GREEN_RUN: ${{ needs.scope.outputs.run-url }}');
    }
  });

  it('e2e aggregate: passes without shard results only for a commit that is already green, and names the run', () => {
    const script = scriptOf(stepsOf(jobs['e2e'] ?? '').find((s) => s.includes('name: Every shard of the project passed')) ?? '');
    const green = { HEAVY: 'false', GREEN_RUN: URL, SHARDS_RESULT: 'skipped', BUILD_RESULT: 'success', SCOPE_RESULT: 'success' };
    for (const project of E2E_PROJECTS) {
      const run = (env: Record<string, string>): { code: number; out: string } => {
        const dir = tempDir('dv-e2e-green-');
        mkdirSync(path.join(dir, 'e2e-result'));
        return bash(script, { PROJECT: project, E2E_SHARDS: String(E2E_SHARD_COUNTS[project]), ...env }, dir);
      };
      const light = run(green);
      expect(light.code, light.out).toBe(0);
      expect(light.out).toContain(`e2e ${project}: not run again on claude/build: this commit already passed the full ci in ${URL} (BD-FIX-CI-PLAN-03)`);
      expect(light.out).not.toContain('missing');
      // each condition alone is not enough: with no shard result the check is red
      for (const weaker of [
        { HEAVY: 'true' },
        { HEAVY: '' },
        { HEAVY: 'False' },
        { GREEN_RUN: '' },
        { SHARDS_RESULT: 'failure' },
        { SHARDS_RESULT: 'cancelled' },
        { SHARDS_RESULT: 'success' },
        { BUILD_RESULT: 'failure' },
        { BUILD_RESULT: 'skipped' },
      ]) {
        const r = run({ ...green, ...weaker });
        expect(r.code, `${project} ${JSON.stringify(weaker)}: ${r.out}`).toBe(1);
        expect(r.out).toContain(`e2e ${project} shard 1/${E2E_SHARD_COUNTS[project]}: missing`);
        expect(r.out).not.toContain('not run again');
      }
    }
  });

  it('perf aggregate: green when every group passed, or for a commit that is already green with the groups skipped', () => {
    const job = jobs['perf'] ?? '';
    const script = scriptOf(stepsOf(job).find((s) => s.includes('name: Every perf group passed')) ?? '');
    expect(script).not.toContain('${{');
    const run = (env: Record<string, string>): { code: number; out: string } => bash(script, { SCOPE_RESULT: 'success', ...env }, tempDir('dv-perf-agg-'));
    expect(run({ GROUPS_RESULT: 'success', HEAVY: 'true', GREEN_RUN: '' }).code).toBe(0);
    expect(run({ GROUPS_RESULT: 'success' }).code).toBe(0);
    for (const bad of ['failure', 'cancelled', 'skipped', '']) {
      expect(run({ GROUPS_RESULT: bad, HEAVY: 'true', GREEN_RUN: '' }).code, bad).toBe(1);
      expect(run({ GROUPS_RESULT: bad }).code, bad).toBe(1);
    }
    const light = run({ GROUPS_RESULT: 'skipped', HEAVY: 'false', GREEN_RUN: URL });
    expect(light.code, light.out).toBe(0);
    expect(light.out).toContain(`perf: not run again on claude/build: this commit already passed the full ci in ${URL} (BD-FIX-CI-PLAN-03)`);
    // a skip that the scope did not ask for, an answer with no run, or groups that ran and failed
    expect(run({ GROUPS_RESULT: 'skipped', HEAVY: 'false', GREEN_RUN: '' }).code).toBe(1);
    expect(run({ GROUPS_RESULT: 'skipped', HEAVY: '', GREEN_RUN: URL }).code).toBe(1);
    expect(run({ GROUPS_RESULT: 'failure', HEAVY: 'false', GREEN_RUN: URL }).code).toBe(1);
    expect(run({ GROUPS_RESULT: 'cancelled', HEAVY: 'false', GREEN_RUN: URL }).code).toBe(1);
  });
});

// BD-FIX-CI-02: the local Worker's `request.cf` comes from a file the config writes, never from the runner's egress location.
describe('playwright.config.ts webServer country', () => {
  it('passes CLOUDFLARE_CF_FETCH_PATH to wrangler dev, and the file names US unless DV_E2E_COUNTRY says otherwise', async () => {
    const mod = (await import(path.join(repoRoot, 'playwright.config.ts'))) as {
      default: { webServer?: { env?: Record<string, string> } };
      E2E_COUNTRY: string;
      E2E_CF_PATH: string;
    };
    const cfPath = mod.default.webServer?.env?.['CLOUDFLARE_CF_FETCH_PATH'];
    expect(cfPath).toBe(mod.E2E_CF_PATH);
    expect(path.isAbsolute(cfPath ?? '')).toBe(true);
    const cf = JSON.parse(readFileSync(cfPath ?? '', 'utf8')) as { country?: string };
    expect(cf.country).toBe(mod.E2E_COUNTRY);
    if (process.env.DV_E2E_COUNTRY === undefined) expect(mod.E2E_COUNTRY).toBe('US');
  });

  // BD-FIX-CI8-H02: wrangler dev loads `secrets.required` from the process environment; the e2e Worker never inherits the shell's.
  it('passes every secrets.required name the shell holds on empty, and leaves the others unset', async () => {
    const mod = (await import(path.join(repoRoot, 'playwright.config.ts'))) as {
      default: { webServer?: { env?: Record<string, string> } };
      E2E_UNSET_SECRETS: readonly string[];
    };
    const { stripJsonc } = await import('../deploy.ts');
    const cfg = JSON.parse(stripJsonc(readFileSync(path.join(repoRoot, 'services/edge/wrangler.jsonc'), 'utf8'))) as { secrets?: { required?: string[] } };
    expect([...mod.E2E_UNSET_SECRETS].sort()).toEqual([...(cfg.secrets?.required ?? [])].sort());
    const env = mod.default.webServer?.env ?? {};
    for (const k of mod.E2E_UNSET_SECRETS) expect(env[k], k).toBe(process.env[k] === undefined ? undefined : '');
  });
});

describe('nightly.yml (AC-8)', () => {
  const text = wf('nightly.yml');
  const jobs = jobsOf(text);

  it('keeps the M00b cron', () => {
    expect(text).toContain("cron: '17 10 * * *'");
  });

  it('runs the determinism grep on chromium-webgl2 and webkit-webgl2', () => {
    const job = jobs['determinism'] ?? '';
    expect(job).toContain('chromium-webgl2, webkit-webgl2');
    expect(job).toContain('--grep "@determinism|@racing-det|@fighter-hash|@world-hash|@tycoon-det"');
  });

  it('runs the full e2e matrix with @quarantine included, check:perf -- --fail and the Preview sweep', () => {
    expect(jobs['e2e-full']).toContain('DV_E2E_QUARANTINE');
    expect(jobs['e2e-full']).toContain('chromium-webgpu, chromium-webgl2, webkit-webgl2, xr-quest3');
    expect(jobs['perf']).toContain('pnpm check:perf -- --fail');
    expect(jobs['sweep-previews']).toContain('pnpm deploy:preview -- --sweep-closed');
  });

  it('the check:perf -- --fail step and its job have no continue-on-error, and the PR perf job still only warns (M11a1 AC-8)', () => {
    const perf = jobs['perf'] ?? '';
    const code = (t: string): string => t.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    // (the apt-cache save steps of the job carry their own continue-on-error; the job and the perf step must not)
    expect(code(perf)).not.toMatch(/^ {4}continue-on-error:/m);
    const step = stepsOf(perf).find((s) => s.includes('pnpm check:perf -- --fail')) ?? '';
    // a racing leg runs about 25 minutes of tests (BD-M11a1-17)
    expect(Number(/timeout-minutes: (\d+)/.exec(perf)?.[1] ?? 0)).toBeGreaterThanOrEqual(45);
    expect(step).toContain('--scenario "$PERF_SCENARIO_SET"');
    expect(step).not.toContain('continue-on-error');
    // BD-FIX-CI-PERFSPLIT-01: the PR side runs the scenarios in `perf-group` legs; `perf` only reports their verdict.
    const prPerf = jobsOf(wf('ci.yml'))['perf-group'] ?? '';
    const prStep = stepsOf(prPerf).find((s) => s.includes('pnpm check:perf')) ?? '';
    expect(prStep).not.toContain('--fail');
    expect(prStep).toContain('run: pnpm check:perf -- --scenario "$PERF_SCENARIO_SET"\n');
    expect(code(prPerf)).not.toContain('--fail');
    expect(code(prPerf)).not.toMatch(/^ {4}continue-on-error:/m);
  });

  it('has the informational macos-probe job on macos-15 with continue-on-error', () => {
    expect(jobs['macos-probe']).toContain('runs-on: macos-15');
    expect(jobs['macos-probe']).toContain('continue-on-error: true');
  });

  it('pins every action by commit SHA', () => {
    for (const f of ['ci.yml', 'nightly.yml']) {
      for (const m of wf(f).matchAll(/uses:\s*(\S+)/g)) expect(m[1], `${f} ${m[1]}`).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

describe('Playwright system packages: mirror-resilient install, one apt cache per package set (BD-FIX-CI10-P01, BD-FU-B05)', () => {
  // The key has an ISO week part computed in the step (`date -u +%GW%V`), so the archive refreshes once a week (BD-FU-B05).
  const KEY = '- id: pw-key\n        name: Apt cache key of this package set and ISO week\n        run: pnpm exec tsx tools/ci/pw-install.ts --cache-key --week "$(date -u +%GW%V)" $DV_PW_BROWSERS';
  const RESTORE =
    /- id: pw-apt\n\s+uses: actions\/cache\/restore@[0-9a-f]{40}\n\s+with:\n\s+path: ~\/\.cache\/dv-pw-apt\/\*\.deb\n\s+key: \$\{\{ steps\.pw-key\.outputs\.key \}\}\n\s+restore-keys: \|\n\s+\$\{\{ steps\.pw-key\.outputs\.key \}\}-\n\s+\$\{\{ steps\.pw-key\.outputs\.version \}\}\n\s+\$\{\{ steps\.pw-key\.outputs\.base \}\}\n/;
  const INSTALL = '- id: pw-install\n        name: Playwright browsers and their system packages\n        run: pnpm exec tsx tools/ci/pw-install.ts $DV_PW_BROWSERS';
  const COUNT = '- id: pw-apt-new\n        name: New apt archives since the restore\n        if: always()\n        run: pnpm exec tsx tools/ci/pw-install.ts --count-new';
  // The complete set: once per key, only after a successful install and when the restore was not an exact hit.
  const SAVE =
    /- name: Save the complete package set \(once per key\)\n\s+if: always\(\) && steps\.pw-install\.outcome == 'success' && steps\.pw-apt\.outputs\.cache-hit != 'true' && fromJSON\(steps\.pw-apt-new\.outputs\.new \|\| '0'\) > 0\n\s+continue-on-error: true\n\s+uses: actions\/cache\/save@[0-9a-f]{40}\n\s+with:\n\s+path: ~\/\.cache\/dv-pw-apt\/\*\.deb\n\s+key: \$\{\{ steps\.pw-apt\.outputs\.cache-primary-key \}\}\n/;
  // What a failed or cancelled install downloaded, under a per-job key below the stable one (the restore's first prefix).
  const PARTIAL =
    /- name: Save the downloads of a failed or cancelled install\n\s+if: always\(\) && \(steps\.pw-install\.outcome == 'failure' \|\| steps\.pw-install\.outcome == 'cancelled'\) && fromJSON\(steps\.pw-apt-new\.outputs\.new \|\| '0'\) > 0\n\s+continue-on-error: true\n\s+uses: actions\/cache\/save@[0-9a-f]{40}\n\s+with:\n\s+path: ~\/\.cache\/dv-pw-apt\/\*\.deb\n\s+key: \$\{\{ steps\.pw-apt\.outputs\.cache-primary-key \}\}-partial-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}-\$\{\{ github\.job \}\}-\$\{\{ strategy\.job-index \}\}\n/;
  /** The job-level DV_PW_BROWSERS value (an expression or a quoted literal). */
  const browsersOf = (job: string): string | undefined => /^ {4}env:\n(?: {6}.*\n)*? {6}DV_PW_BROWSERS: (.*)$/m.exec(job)?.[1];
  /** playwright.config.ts: webkit-webgl2 runs on WebKit, every other project on Chromium. */
  const engine = (project: string): string => (project === 'webkit-webgl2' ? 'webkit' : 'chromium');

  it('pw-install.ts keeps its archives where the workflows cache them', () => {
    expect(ARCHIVES.endsWith(path.join('.cache', 'dv-pw-apt'))).toBe(true);
  });

  for (const f of ['ci.yml', 'nightly.yml', 'preview.yml']) {
    it(`${f}: every Playwright install keys its package set, restores, installs through pw-install.ts, counts and saves once per key`, () => {
      const text = wf(f);
      const code = text.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
      expect(code, `${f}: playwright install --with-deps runs only inside pw-install.ts`).not.toContain('playwright install --with-deps');
      let installs = 0;
      for (const [name, job] of Object.entries(jobsOf(text))) {
        if (!job.includes('tools/ci/pw-install.ts $DV_PW_BROWSERS')) continue;
        installs++;
        const steps = stepsOf(job);
        const at = (pred: (s: string) => boolean): number => steps.findIndex(pred);
        const key = at((s) => s.includes(KEY));
        expect(key, `${f} ${name}: key`).toBeGreaterThan(-1);
        expect(at((s) => RESTORE.test(`${s}\n`)), `${f} ${name}: restore right after the key`).toBe(key + 1);
        expect(at((s) => s.includes(INSTALL)), `${f} ${name}: install right after the restore`).toBe(key + 2);
        expect(at((s) => s.includes(COUNT)), `${f} ${name}: count right after the install`).toBe(key + 3);
        expect(at((s) => SAVE.test(`${s}\n`)), `${f} ${name}: save of the complete set after the count`).toBe(key + 4);
        expect(at((s) => PARTIAL.test(`${s}\n`)), `${f} ${name}: save of a failed install's downloads last`).toBe(key + 5);
        expect(browsersOf(job), `${f} ${name}: DV_PW_BROWSERS`).toBeDefined();
        // the stable key carries nothing of one run, attempt or job, nor the lockfile (the 10 GB repository limit, BD-FU-B05)
        expect(steps[key + 1] ?? '', `${f} ${name}: restore key`).not.toMatch(/github\.run_id|github\.run_attempt|github\.job|strategy\.job-index|hashFiles/);
        // the week comes from the step's clock, not from the run (one save per key and week)
        expect(steps[key] ?? '', `${f} ${name}: weekly key`).not.toMatch(/github\.run_id|github\.run_attempt|github\.job|strategy\.job-index|hashFiles/);
      }
      expect(installs, f).toBeGreaterThan(0);
    });
  }

  it('each job installs the engines it launches, and only those', () => {
    const ci = jobsOf(wf('ci.yml'));
    const nightly = jobsOf(wf('nightly.yml'));
    const shardSet = browsersOf(ci['e2e-shard'] ?? '') ?? '';
    for (const project of ['chromium-webgpu', 'chromium-webgl2', 'webkit-webgl2', 'xr-quest3']) {
      for (const shard of [1, 2, 3, 4, 5, 6]) {
        // chromium-webgl2 shard 1 also runs check:coi, which launches Chromium and WebKit (tools/ci/check-dist.ts checkCoi).
        const want = project === 'chromium-webgl2' && shard === 1 ? 'chromium webkit' : engine(project);
        expect(evalSet(shardSet, { project, shard }), `ci e2e-shard ${project} ${shard}`).toBe(want);
      }
      for (const job of ['e2e-full', 'determinism']) {
        if (job === 'determinism' && (project === 'chromium-webgpu' || project === 'xr-quest3')) continue;
        expect(evalSet(browsersOf(nightly[job] ?? '') ?? '', { project }), `nightly ${job} ${project}`).toBe(engine(project));
      }
    }
    expect(ci['e2e-shard']).toContain("if: matrix.project == 'chromium-webgl2' && matrix.shard == 1");
    expect(nightly['e2e-full']).not.toContain('check:coi');
    // check:perf runs chromium-webgl2 and webkit-webgl2 (tools/ci/perf-check.ts PERF_PROJECTS); the preview job runs check:coi.
    const both = [
      ['ci perf-group', ci['perf-group']],
      ['nightly perf', nightly['perf']],
      ['preview', jobsOf(wf('preview.yml'))['preview']],
    ] as const;
    for (const [label, job] of both) expect(browsersOf(job ?? ''), label).toBe("'chromium webkit'");
  });
});

/** The step blocks of one job: each from its `- ` line to the next one. */
function stepsOf(job: string): string[] {
  const out: string[] = [];
  let cur: string[] | null = null;
  for (const l of job.split('\n')) {
    if (/^ {6}- /.test(l)) {
      if (cur) out.push(cur.join('\n'));
      cur = [l];
    } else if (cur) cur.push(l);
  }
  if (cur) out.push(cur.join('\n'));
  return out;
}

const grayboxGrep = readFileSync(path.join(repoRoot, 'tests', 'e2e', 'graybox-grep.txt'), 'utf8').trim();
/** A workflow-level `env:` entry (2-space indent, before `jobs:`). */
const topEnv = (text: string, name: string): string | undefined => new RegExp(`^ {2}${name}: '(.*)'$`, 'm').exec(text.split('\njobs:')[0] ?? '')?.[1];
/** A job-level `env:` (4-space indent) that sets DV_SKIP_BUILD. */
const JOB_LEVEL_SKIP = /^ {4}env:\n(?: {6}.*\n)*? {6}DV_SKIP_BUILD/m;

describe('world builds in CI (M02b1 AC-12)', () => {
  const ci = wf('ci.yml');
  const nightly = wf('nightly.yml');
  const ciJobs = jobsOf(ci);
  const nightlyJobs = jobsOf(nightly);

  it('both files define the same GRAYBOX_GREP, equal to the trimmed content of tests/e2e/graybox-grep.txt', () => {
    expect(grayboxGrep).toMatch(/^@graybox\|@pack-\|@touch\|/);
    expect(grayboxGrep.includes('\n')).toBe(false);
    expect(topEnv(ci, 'GRAYBOX_GREP')).toBe(grayboxGrep);
    expect(topEnv(nightly, 'GRAYBOX_GREP')).toBe(grayboxGrep);
  });

  const BAKE_CACHE = /uses: actions\/cache@[0-9a-f]{40}\n\s+with:\n\s+path: \|\n\s+\.cache\/map\n\s+dist\/world\n\s+key: world-bakes-\$\{\{ hashFiles\('tools\/map\/\*\*', 'config\/world\/\*\*', 'content\/world\/\*\*'\) \}\}/;
  const BAKE_RUN = 'run: pnpm map:build -- --area synth && pnpm map:build -- --area civic-excerpt';

  function bakeBefore(job: string, testStep: RegExp, label: string): void {
    const bake = job.search(BAKE_CACHE);
    const run = job.indexOf(BAKE_RUN);
    const test = job.search(testStep);
    expect(bake, `${label}: cache step`).toBeGreaterThan(-1);
    expect(run, `${label}: map:build on a miss`).toBeGreaterThan(bake);
    expect(test, `${label}: test step`).toBeGreaterThan(run);
    expect(job, label).toContain("if: steps.bake-cache.outputs.cache-hit != 'true'");
  }

  it('ci.yml: unit, e2e and perf restore or build the bakes before their test step; unit requires them', () => {
    bakeBefore(ciJobs['unit'] ?? '', /pnpm check:unit/, 'unit');
    bakeBefore(ciJobs['e2e-shard'] ?? '', /pnpm check:e2e/, 'e2e-shard');
    bakeBefore(ciJobs['perf-group'] ?? '', /pnpm check:perf/, 'perf-group');
    expect(ciJobs['unit']).toContain("DV_REQUIRE_BAKE: '1'");
  });

  it('ci.yml e2e-shard: the gray-box step has its own DV_SKIP_BUILD, the world step builds with DV_WORLD=synth, no job env defines DV_SKIP_BUILD', () => {
    const text = ciJobs['e2e-shard'] ?? '';
    const steps = stepsOf(text);
    const gray = steps.find((s) => s.includes('--grep "$GRAYBOX_GREP"')) ?? '';
    const world = steps.find((s) => s.includes('--grep-invert "$GRAYBOX_GREP"')) ?? '';
    expect(gray).toContain("DV_SKIP_BUILD: '1'");
    expect(world).toContain('DV_WORLD: synth');
    expect(world).toContain("DV_SKIP_BUILD: ''");
    // The world step comes after the gray-box step and after the header checks that read the artifact.
    expect(text.indexOf('--grep-invert')).toBeGreaterThan(text.indexOf('--grep "$GRAYBOX_GREP"'));
    expect(text.indexOf('--grep-invert')).toBeGreaterThan(text.indexOf('pnpm check:coi'));
    expect(text).not.toMatch(JOB_LEVEL_SKIP);
    expect(ci.split('\njobs:')[0]).not.toContain('DV_SKIP_BUILD');
  });

  it('ci.yml perf: DV_WORLD=synth with DV_SKIP_BUILD empty on the check:perf step, warnings only, not in the e2e legs', () => {
    const perf = ciJobs['perf-group'] ?? '';
    const step = stepsOf(perf).find((s) => s.includes('pnpm check:perf')) ?? '';
    // BD-FIX-CI-PERFSPLIT-01: each leg runs its scenario group.
    expect(step).toContain('run: pnpm check:perf -- --scenario "$PERF_SCENARIO_SET"\n');
    expect(step).toContain('PERF_SCENARIO_SET: ${{ matrix.scenarios }}');
    expect(step).toContain('DV_WORLD: synth');
    expect(step).toContain("DV_SKIP_BUILD: ''");
    expect(step).not.toContain('--fail');
    expect(perf).not.toMatch(JOB_LEVEL_SKIP);
    for (const j of ['e2e', 'e2e-shard']) expect((ciJobs[j] ?? '').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n'), j).not.toContain('check:perf');
  });

  it('nightly.yml: bakes before the e2e, determinism and perf steps; the e2e matrix is split; determinism and perf run on DV_WORLD=synth', () => {
    bakeBefore(nightlyJobs['e2e-full'] ?? '', /pnpm check:e2e/, 'e2e-full');
    bakeBefore(nightlyJobs['determinism'] ?? '', /pnpm check:e2e/, 'determinism');
    bakeBefore(nightlyJobs['perf'] ?? '', /pnpm check:perf/, 'perf');
    const e2e = stepsOf(nightlyJobs['e2e-full'] ?? '');
    expect(e2e.some((s) => s.includes('--grep "$GRAYBOX_GREP"'))).toBe(true);
    const world = e2e.find((s) => s.includes('--grep-invert "$GRAYBOX_GREP"')) ?? '';
    expect(world).toContain('DV_WORLD: synth');
    expect(world).toContain("DV_SKIP_BUILD: ''");
    const det = stepsOf(nightlyJobs['determinism'] ?? '').find((s) => s.includes('@determinism')) ?? '';
    expect(det).toContain('DV_WORLD: synth');
    expect(det).toContain("DV_SKIP_BUILD: ''");
    const perf = stepsOf(nightlyJobs['perf'] ?? '').find((s) => s.includes('check:perf')) ?? '';
    expect(perf).toContain('pnpm check:perf -- --fail');
    expect(perf).toContain('DV_WORLD: synth');
    expect(perf).toContain("DV_SKIP_BUILD: ''");
    for (const [name, block] of Object.entries(nightlyJobs)) expect(block, `nightly ${name}`).not.toMatch(JOB_LEVEL_SKIP);
    expect(nightly.split('\njobs:')[0]).not.toContain('DV_SKIP_BUILD');
  });
});

/** The `scenarios:` list of a job's matrix: one entry per leg, each a comma-separated set of scenario ids. */
function scenarioGroups(job: string): string[] {
  const m = /^ {8}scenarios:\n((?: {10}- .*\n)+)/m.exec(job);
  return m ? (m[1] as string).trim().split('\n').map((l) => l.trim().replace(/^- /, '')) : [];
}

describe('perf scenario groups (BD-FIX-CI-PERFSPLIT-01)', () => {
  const ciJobs = jobsOf(wf('ci.yml'));
  const nightlyJobs = jobsOf(wf('nightly.yml'));
  const registered = JSON.parse(readFileSync(path.join(repoRoot, 'config', 'perf', 'scenarios.json'), 'utf8')) as string[];

  it('ci.yml and nightly.yml run the same groups, which cover every registered scenario exactly once', () => {
    const ci = scenarioGroups(ciJobs['perf-group'] ?? '');
    expect(ci.length).toBeGreaterThan(1);
    expect(scenarioGroups(nightlyJobs['perf'] ?? '')).toEqual(ci);
    const ids = ci.flatMap((g) => g.split(','));
    expect([...ids].sort()).toEqual([...registered].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each leg uploads its reports under its own name', () => {
    expect(ciJobs['perf-group']).toContain('name: perf-reports-${{ strategy.job-index }}');
    expect(nightlyJobs['perf']).toContain('name: perf-reports-${{ strategy.job-index }}');
    expect(stepsOf(nightlyJobs['perf'] ?? '').find((s) => s.includes('check:perf'))).toContain('--scenario "$PERF_SCENARIO_SET"');
  });

  it('ci.yml keeps one `perf` check that passes only when every group passed', () => {
    const job = ciJobs['perf'] ?? '';
    expect(job).toContain('needs: [scope, perf-group]');
    expect(job).toContain('if: ${{ !cancelled() }}');
    expect(job).toContain('GROUPS_RESULT: ${{ needs.perf-group.result }}');
    expect(job).toContain('test "${GROUPS_RESULT}" = success');
  });
});

describe('preview.yml bakes the synth world into the Preview build (BD-PW-01)', () => {
  const text = wf('preview.yml');
  const job = jobsOf(text)['preview'] ?? '';
  const steps = stepsOf(job);
  const build = steps.find((s) => s.includes('run: pnpm build')) ?? '';
  const at = (needle: string): number => steps.findIndex((s) => s.includes(needle));

  it('restores or bakes the synth world with the ci.yml cache key before the build', () => {
    const cache = steps.findIndex((s) => /uses: actions\/cache@[0-9a-f]{40}/.test(s));
    const bake = at('run: pnpm map:build -- --area synth');
    expect(cache).toBeGreaterThan(-1);
    expect(bake).toBeGreaterThan(cache);
    expect(steps.indexOf(build)).toBeGreaterThan(bake);
    expect(steps[cache]).toMatch(/path: \|\n\s+\.cache\/map\n\s+dist\/world/);
    expect(steps[cache]).toContain("key: world-bakes-${{ hashFiles('tools/map/**', 'config/world/**', 'content/world/**') }}");
    expect(steps[cache]).toContain('id: bake-cache');
    expect(steps[bake]).toContain("if: steps.bake-cache.outputs.cache-hit != 'true'");
  });

  it('builds a QA build with DV_WORLD=synth, checks the Workers limits and the world before deploying', () => {
    expect(build).toContain("VITE_DV_QA: '1'");
    expect(build).toContain('DV_WORLD: synth');
    expect(at('check-dist.ts limits')).toBeGreaterThan(steps.indexOf(build));
    expect(at('"data/world-index"')).toBeGreaterThan(steps.indexOf(build));
    expect(at('pnpm deploy:preview')).toBeGreaterThan(at('check-dist.ts limits'));
    expect(at('pnpm deploy:preview')).toBeGreaterThan(at('"data/world-index"'));
  });

  it('deploy.yml (staging, production) builds without DV_WORLD and without a QA build', () => {
    const deploy = wf('deploy.yml');
    expect(deploy).not.toContain('DV_WORLD');
    expect(deploy).not.toContain('VITE_DV_QA');
  });
});

describe('generation stays on the mock in every workflow (M10a1 AC-11, DL-OWN-01)', () => {
  const files = ['ci.yml', 'deploy.yml', 'nightly.yml', 'preview.yml', 'weekly.yml'];

  /** The `env:` mapping at the top level of a workflow (before `jobs:`), or '' when it has none. */
  const topEnv = (text: string): string => {
    const head = text.slice(0, text.indexOf('\njobs:'));
    const m = /^env:\n((?: {2}.*\n|\s*\n)*)/m.exec(head);
    return m?.[1] ?? '';
  };

  it('every workflow sets FAL_MODE: mock for all its jobs, at the top level or in each job', () => {
    for (const f of files) {
      const text = wf(f);
      if (/^ {2}FAL_MODE: mock\s*$/m.test(topEnv(text))) continue;
      const jobs = jobsOf(text);
      for (const [name, body] of Object.entries(jobs)) expect(body, `${f} job ${name}`).toMatch(/\n {6}FAL_MODE: mock\s*(\n|$)/);
    }
  });

  it('no workflow mentions FAL_KEY or sets FAL_MODE to anything else', () => {
    for (const f of files) {
      const text = wf(f);
      expect(text, f).not.toContain('FAL_KEY');
      for (const m of text.matchAll(/FAL_MODE:\s*(\S+)/g)) expect(m[1], f).toBe('mock');
    }
  });

  it('lists every workflow file of the repository, so a new one cannot skip the rule', () => {
    const dir = path.join(repoRoot, '.github', 'workflows');
    const names = readdirSync(dir).filter((n) => n.endsWith('.yml')).sort();
    expect(names).toEqual([...files].sort());
  });
});
