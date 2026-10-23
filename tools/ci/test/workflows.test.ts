import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../run.ts';

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

describe('ci.yml (AC-8)', () => {
  const jobs = jobsOf(wf('ci.yml'));

  it('static runs check:agents, check:telemetry, check:skills and check:rollout', () => {
    for (const s of ['check:agents', 'check:telemetry', 'check:skills', 'check:rollout']) expect(jobs['static'], s).toContain(`pnpm ${s}`);
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
  it('e2e-shard splits each project into shards; e2e keeps its name and matrix and reports all shards of its project; nightly e2e-full at least 90', () => {
    const minutes = (block: string | undefined): number => Number(/timeout-minutes: (\d+)/.exec(block ?? '')?.[1] ?? 0);
    const shard = jobs['e2e-shard'] ?? '';
    const agg = jobs['e2e'] ?? '';
    const shards = /^ {8}shard: \[([\d, ]+)\]$/m.exec(shard)?.[1]?.split(',').map((s) => Number(s.trim())) ?? [];
    const n = shards.length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(shards).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(shard).toContain('project: [chromium-webgpu, chromium-webgl2, webkit-webgl2, xr-quest3]');
    expect(shard).toContain('needs: build');
    expect(minutes(shard)).toBeGreaterThanOrEqual(45);
    // Both halves run the shard's share; each shard writes its outcome even after a failure and uploads it under its own name.
    const runs = stepsOf(shard).filter((s) => s.includes('pnpm check:e2e'));
    expect(runs).toHaveLength(2);
    for (const s of runs) expect(s).toContain(`--shard=\${{ matrix.shard }}/${n}`);
    const result = stepsOf(shard).find((s) => s.includes('name: Shard result')) ?? '';
    expect(result).toContain('if: always()');
    expect(result).toContain('echo "${{ job.status }}" > "e2e-result/${{ matrix.project }}-${{ matrix.shard }}.txt"');
    expect(shard).toMatch(/if: always\(\)\n\s+with:\n\s+name: e2e-result-\$\{\{ matrix\.project \}\}-\$\{\{ matrix\.shard \}\}/);
    // The aggregate: same name and matrix as the required checks, runs after every shard (also failed ones), reads only its project's results.
    // BD-FIX-CI3-D01: `build` is a need only so the log can say why the shards never ran; the verdict reads the shard results alone.
    expect(agg).toContain('needs: [build, e2e-shard]');
    expect(agg).toContain('if: ${{ !cancelled() }}');
    expect(agg).toContain('project: [chromium-webgpu, chromium-webgl2, webkit-webgl2, xr-quest3]');
    expect(agg).toContain('pattern: e2e-result-${{ matrix.project }}-*');
    expect(agg).toContain(`E2E_SHARDS: '${n}'`);
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
    const shards = Number(/E2E_SHARDS: '(\d+)'/.exec(step)?.[1] ?? 0);
    expect(shards).toBe(3);
    const run = (results: (string | null)[], build = 'success'): { code: number; out: string } => {
      const dir = mkdtempSync(path.join(tmpdir(), 'dv-e2e-agg-'));
      try {
        mkdirSync(path.join(dir, 'e2e-result'));
        results.forEach((r, i) => {
          if (r !== null) writeFileSync(path.join(dir, 'e2e-result', `chromium-webgl2-${i + 1}.txt`), `${r}\n`);
        });
        // Another project's results in the same folder never count.
        writeFileSync(path.join(dir, 'e2e-result', 'webkit-webgl2-1.txt'), 'failure\n');
        const res = spawnSync('bash', ['-e', '-c', script], {
          cwd: dir,
          encoding: 'utf8',
          env: { PATH: process.env['PATH'] ?? '', PROJECT: 'chromium-webgl2', E2E_SHARDS: String(shards), BUILD_RESULT: build, SHARDS_RESULT: 'success' },
        });
        return { code: res.status ?? -1, out: `${res.stdout}${res.stderr}` };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    expect(run(['success', 'success', 'success']).code).toBe(0);
    for (const bad of [
      ['success', 'failure', 'success'],
      ['success', 'success', 'cancelled'],
      ['success', null, 'success'],
      [null, null, null],
    ]) {
      const r = run(bad);
      expect(r.code, JSON.stringify(bad)).toBe(1);
      expect(r.out).not.toContain('::error::');
    }
    const skipped = run([null, null, null], 'failure');
    expect(skipped.code).toBe(1);
    expect(skipped.out).toContain('e2e chromium-webgl2 shard 3/3: missing');
    expect(skipped.out).toContain("::error::e2e chromium-webgl2: no shard result because the build job ended 'failure'");
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
    bakeBefore(ciJobs['perf'] ?? '', /pnpm check:perf/, 'perf');
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
    const perf = ciJobs['perf'] ?? '';
    const step = stepsOf(perf).find((s) => s.includes('pnpm check:perf')) ?? '';
    expect(step).toContain('run: pnpm check:perf\n');
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
