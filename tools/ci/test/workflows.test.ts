import { readFileSync } from 'node:fs';
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

  it('has a content job (M02a1) that restores .cache/map, checks the graybox fixture and bakes the civic-excerpt twice; unit no longer runs map:fixture', () => {
    const job = jobs['content'] ?? '';
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
