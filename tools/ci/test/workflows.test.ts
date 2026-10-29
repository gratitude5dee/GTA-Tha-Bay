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
    // Equal to the e2e-shard matrix (BD-FIX-CI8-S01 went from three shards to four, BD-INTEG-M02g1-01 to six, BD-FIX-CI-SHARD8-01 to eight).
    const matrix = /^ {8}shard: \[([\d, ]+)\]$/m.exec(jobs['e2e-shard'] ?? '')?.[1]?.split(',').length ?? 0;
    expect(shards).toBe(8);
    expect(shards).toBe(matrix);
    const all = (r: string | null): (string | null)[] => Array.from({ length: shards }, () => r);
    const withAt = (i: number, r: string | null): (string | null)[] => all('success').map((v, j) => (j === i ? r : v));
    const run = (results: (string | null)[], build = 'success'): { code: number; out: string } => {
      const dir = tempDir('dv-e2e-agg-');
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
    expect(run(all('success')).code).toBe(0);
    for (const bad of [withAt(1, 'failure'), withAt(shards - 1, 'cancelled'), withAt(1, null), all(null)]) {
      const r = run(bad);
      expect(r.code, JSON.stringify(bad)).toBe(1);
      expect(r.out).not.toContain('::error::');
    }
    const skipped = run(all(null), 'failure');
    expect(skipped.code).toBe(1);
    expect(skipped.out).toContain(`e2e chromium-webgl2 shard ${shards}/${shards}: missing`);
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
    // the racing scenarios add about 50 minutes to the run (BD-M11a1-14)
    expect(Number(/timeout-minutes: (\d+)/.exec(perf)?.[1] ?? 0)).toBeGreaterThanOrEqual(90);
    expect(step).not.toContain('continue-on-error');
    const prPerf = jobsOf(wf('ci.yml'))['perf'] ?? '';
    const prStep = stepsOf(prPerf).find((s) => s.includes('pnpm check:perf')) ?? '';
    expect(prStep).not.toContain('--fail');
    expect(prStep).toContain('run: pnpm check:perf\n');
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
  /** Evaluates a DV_PW_BROWSERS value for one matrix leg (the expressions hold only ==, &&, || and literals). */
  const evalSet = (expr: string, leg: { project: string; shard?: number }): string => {
    const m = /^\$\{\{ (.*) \}\}$/.exec(expr);
    if (!m) return expr.replace(/^'(.*)'$/, '$1');
    const js = (m[1] as string)
      .replace(/matrix\.project/g, JSON.stringify(leg.project))
      .replace(/matrix\.shard/g, String(leg.shard ?? 0))
      .replace(/==/g, '===');
    expect(js, 'only literals and operators remain').toMatch(/^[\s'"a-z0-9=&|-]+$/);
    return String(new Function(`return (${js});`)());
  };
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
      ['ci perf', ci['perf']],
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
