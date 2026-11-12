import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_REF, decideScope, isGreenSource, outputLines } from '../ci-scope.ts';
import { repoRoot } from '../run.ts';
import { useTempDirs } from '../test-tmp.ts';

// BD-FIX-CI-PLAN-03: a push to claude/build skips the e2e shards and the perf groups only when the exact head commit already has a
// completed, successful push run of ci on a merge candidate (claude/integ-*) or on main. Any doubt is the full run.

const tempDir = useTempDirs();

const SHA = '9e4b1fff00000000000000000000000000000001';
const OTHER = '23e7316e00000000000000000000000000000002';
const URL = 'https://github.com/owner/repo/actions/runs/41574550973';

/** A run object with the fields the decision reads (GitHub's "List workflow runs for a workflow"). */
const run = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 41574550973,
  name: 'ci',
  path: '.github/workflows/ci.yml',
  head_branch: 'claude/integ-m02h8',
  head_sha: SHA,
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  html_url: URL,
  ...over,
});
const list = (...runs: unknown[]): unknown => ({ total_count: runs.length, workflow_runs: runs });
const onBuild = (runs: unknown): ReturnType<typeof decideScope> => decideScope({ eventName: 'push', ref: BUILD_REF, sha: SHA, runs });
const fullRun = (runs: unknown): void => {
  const s = onBuild(runs);
  expect(s.heavy, s.reason).toBe(true);
  expect(s.runUrl).toBe('');
};

describe('ci-scope: no second full run on claude/build for a commit that is already green (BD-FIX-CI-PLAN-03)', () => {
  it('the same commit green on a push to claude/integ-x: light, and the run is named', () => {
    const s = onBuild(list(run()));
    expect(s).toEqual({ heavy: false, runUrl: URL, reason: `${SHA} already passed ci on a push to claude/integ-m02h8: ${URL}` });
    expect(outputLines(s)).toBe(`heavy=false\nrun-url=${URL}\n`);
  });

  it('the same commit green on a push to main: light', () => {
    const s = onBuild(list(run({ head_branch: 'main', html_url: 'https://github.com/owner/repo/actions/runs/7' })));
    expect(s.heavy).toBe(false);
    expect(s.runUrl).toBe('https://github.com/owner/repo/actions/runs/7');
  });

  it('a green pull_request run only: full (it tested the merge ref, not this commit)', () => {
    fullRun(list(run({ event: 'pull_request' })));
    fullRun(list(run({ event: 'pull_request', head_branch: 'main' })));
  });

  it('a green run of another commit: full', () => {
    fullRun(list(run({ head_sha: OTHER })));
  });

  it('a failed, a cancelled or a timed-out run of this commit: full', () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', null]) fullRun(list(run({ conclusion })));
  });

  it('a run of this commit that is still going: full', () => {
    for (const status of ['in_progress', 'queued', 'requested', 'waiting', 'pending']) fullRun(list(run({ status, conclusion: null })));
    // a conclusion without `completed` never counts either
    fullRun(list(run({ status: 'in_progress', conclusion: 'success' })));
  });

  it('an API error or no list: full', () => {
    for (const runs of [null, undefined, '', 'Not Found', [], { message: 'Not Found', status: '404' }, { workflow_runs: null }, { workflow_runs: 'x' }]) fullRun(runs);
    // an empty list is a clean answer with no run to rely on
    const none = onBuild(list());
    expect(none.heavy).toBe(true);
    expect(none.reason).toContain('0 runs');
  });

  it('a push to main, to claude/integ-*, to any other ref, a tag: full, whatever the list holds', () => {
    for (const ref of ['refs/heads/main', 'refs/heads/claude/integ-m02h8', 'refs/heads/claude/build-fix', 'refs/heads/claude/build/x', 'refs/tags/claude/build', 'claude/build', '']) {
      const s = decideScope({ eventName: 'push', ref, sha: SHA, runs: list(run()) });
      expect(s.heavy, ref).toBe(true);
      expect(s.runUrl, ref).toBe('');
    }
  });

  it('a pull request (also one whose ref text is claude/build), a manual or a scheduled run: full', () => {
    for (const eventName of ['pull_request', 'pull_request_target', 'workflow_dispatch', 'schedule', 'merge_group', '']) {
      const s = decideScope({ eventName, ref: BUILD_REF, sha: SHA, runs: list(run()) });
      expect(s.heavy, eventName).toBe(true);
    }
  });

  it('a green push run on a branch that is neither a merge candidate nor main: full', () => {
    for (const head_branch of ['claude/build', 'claude/build-fix-ci-plan', 'claude/release/pr15', 'claude/integ-', 'xclaude/integ-a', 'main2', 'release/main', null, 7]) fullRun(list(run({ head_branch })));
    expect(isGreenSource('claude/integ-sync-main')).toBe(true);
    expect(isGreenSource('claude/integ-a/b')).toBe(true);
    expect(isGreenSource('main')).toBe(true);
  });

  it('a run of another workflow, or one with no usable URL: full', () => {
    fullRun(list(run({ path: '.github/workflows/nightly.yml' })));
    for (const html_url of [undefined, null, '', 'http://github.com/owner/repo/actions/runs/1', 'https://github.com/owner/repo/actions/runs/1\nheavy=false', 'https://github.com/owner/repo/pull/1']) fullRun(list(run({ html_url })));
    // the `path@ref` form of a run's path is the same workflow
    expect(onBuild(list(run({ path: '.github/workflows/ci.yml@refs/heads/claude/integ-m02h8' }))).heavy).toBe(false);
  });

  it('needs a full commit SHA', () => {
    for (const sha of ['', '9e4b1fff', `${SHA}0`, SHA.toUpperCase()]) expect(decideScope({ eventName: 'push', ref: BUILD_REF, sha, runs: list(run({ head_sha: sha })) }).heavy, sha).toBe(true);
  });

  it('finds the green candidate among the other runs of the commit, and skips entries that are not runs', () => {
    const s = onBuild(
      list(
        null,
        'x',
        run({ head_branch: 'claude/build', html_url: 'https://github.com/owner/repo/actions/runs/1' }),
        run({ event: 'pull_request', html_url: 'https://github.com/owner/repo/actions/runs/2' }),
        run({ conclusion: 'failure', html_url: 'https://github.com/owner/repo/actions/runs/3' }),
        run({ head_branch: 'claude/integ-sync-main', html_url: 'https://github.com/owner/repo/actions/runs/4' }),
        run({ html_url: 'https://github.com/owner/repo/actions/runs/5' }),
      ),
    );
    expect(s.heavy).toBe(false);
    expect(s.runUrl).toBe('https://github.com/owner/repo/actions/runs/4');
  });

  it('a full run writes heavy=true and an empty run-url', () => {
    expect(outputLines(onBuild(list()))).toBe('heavy=true\nrun-url=\n');
    expect(outputLines({ heavy: true, runUrl: URL, reason: 'x' })).toBe('heavy=true\nrun-url=\n');
  });

  it('the command reads the event, the ref and the commit from the environment and appends its outputs to $GITHUB_OUTPUT', () => {
    const dir = tempDir('dv-ci-scope-');
    const runs = path.join(dir, 'runs.json');
    writeFileSync(runs, JSON.stringify(list(run())));
    let calls = 0;
    const call = (env: Record<string, string>, a: string[]): { code: number; out: string; written: string } => {
      const output = path.join(dir, `github-output-${++calls}.txt`);
      writeFileSync(output, '');
      const res = spawnSync(path.join(repoRoot, 'node_modules', '.bin', 'tsx'), ['tools/ci/ci-scope.ts', ...a], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '', GITHUB_OUTPUT: output, ...env },
      });
      return { code: res.status ?? -1, out: `${res.stdout}${res.stderr}`, written: readFileSync(output, 'utf8') };
    };
    const build = { GITHUB_EVENT_NAME: 'push', GITHUB_REF: BUILD_REF, GITHUB_SHA: SHA };
    const light = call(build, ['--runs', runs]);
    expect(light.code, light.out).toBe(0);
    expect(light.written).toBe(`heavy=false\nrun-url=${URL}\n`);
    expect(light.out).toContain('ci-scope: heavy=false');
    // no file, a missing file, a file that is not JSON, another event: the full run, exit 0
    writeFileSync(path.join(dir, 'broken.json'), '{"workflow_runs": [');
    for (const [env, a] of [
      [build, []],
      [build, ['--runs', path.join(dir, 'absent.json')]],
      [build, ['--runs', path.join(dir, 'broken.json')]],
      [{ ...build, GITHUB_EVENT_NAME: 'pull_request' }, ['--runs', runs]],
      [{ ...build, GITHUB_REF: 'refs/heads/main' }, ['--runs', runs]],
      [{}, ['--runs', runs]],
    ] as [Record<string, string>, string[]][]) {
      const r = call(env, a);
      expect(r.code, r.out).toBe(0);
      expect(r.written, JSON.stringify([env, a])).toBe('heavy=true\nrun-url=\n');
      expect(r.out).toContain('ci-scope: heavy=true');
    }
  });
});
