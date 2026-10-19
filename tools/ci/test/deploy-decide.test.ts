import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectChanges, evaluate } from '../check-do-migrations.ts';
import { decideDoLifecycle, resolveBase, type DecideInputs, type GitRun } from '../deploy-decide.ts';
import { repoRoot } from '../run.ts';

const ZEROS = '0'.repeat(40);
const REAL = 'a'.repeat(40);

/** A fake git: `commits` are the refs that resolve, `tags` answer `git describe`, `shallow` answers rev-parse. */
function fakeGit(opts: { commits?: string[]; tag?: string; shallow?: boolean } = {}): GitRun & { calls: string[][] } {
  const commits = new Set(opts.commits ?? []);
  const calls: string[][] = [];
  const run = ((args: readonly string[]) => {
    calls.push([...args]);
    if (args[0] === 'cat-file') return { status: commits.has(String(args[2]).replace('^{commit}', '')) ? 0 : 1, out: '' };
    if (args[0] === 'describe') return opts.tag ? { status: 0, out: `${opts.tag}\n` } : { status: 128, out: '' };
    if (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') return { status: 0, out: opts.shallow ? 'true\n' : 'false\n' };
    return { status: 1, out: '' };
  }) as GitRun & { calls: string[][] };
  run.calls = calls;
  return run;
}

const push = (over: Partial<DecideInputs> = {}): DecideInputs => ({ explicit: false, auto: true, eventBefore: REAL, eventName: 'push', refType: 'branch', ...over });

describe('deploy path decision (push to main)', () => {
  it('a lifecycle change in before..HEAD takes the plain deploy path', () => {
    const seen: string[] = [];
    const d = decideDoLifecycle(push(), fakeGit({ commits: [REAL, 'HEAD^'] }), (base) => (seen.push(base), true));
    expect(d.doLifecycle).toBe(true);
    expect(seen).toEqual([REAL]);
    expect(d).toMatchObject({ base: REAL, source: 'event-before' });
  });

  it('no lifecycle change in the range keeps the versions upload', () => {
    const d = decideDoLifecycle(push(), fakeGit({ commits: [REAL, 'HEAD^'] }), () => false);
    expect(d.doLifecycle).toBe(false);
    expect(d.reason).toContain('versions upload');
  });

  it('a first push (all-zero before) compares with the parent', () => {
    const seen: string[] = [];
    const d = decideDoLifecycle(push({ eventBefore: ZEROS }), fakeGit({ commits: ['HEAD^'] }), (base) => (seen.push(base), true));
    expect(seen).toEqual(['HEAD^']);
    expect(d).toMatchObject({ doLifecycle: true, source: 'parent' });
  });

  it('a before sha that is not in the checkout (force push) compares with the parent', () => {
    expect(resolveBase(push(), fakeGit({ commits: ['HEAD^'] }))).toEqual({ base: 'HEAD^', source: 'parent' });
  });

  it('an empty before (manual run) compares with the parent', () => {
    expect(resolveBase(push({ eventBefore: '' }), fakeGit({ commits: ['HEAD^'] }))).toEqual({ base: 'HEAD^', source: 'parent' });
  });

  it('a lifecycle change mixed with runtime changes still needs wrangler deploy', () => {
    const changes = [
      { file: 'services/edge/wrangler.jsonc', before: '{"migrations":[]}', after: '{"migrations":[{"tag":"v1"}]}' },
      { file: 'services/edge/src/routes.ts', before: 'a', after: 'b' },
    ];
    const verdict = evaluate(changes);
    expect(verdict.ok).toBe(false);
    expect(decideDoLifecycle(push(), fakeGit({ commits: [REAL] }), () => verdict.lifecycle).doLifecycle).toBe(true);
  });
});

describe('deploy path decision (label, tag, manual, operator base)', () => {
  it('the pull-request label path is kept: explicit forces the plain deploy without looking at git', () => {
    const git = fakeGit();
    const d = decideDoLifecycle(push({ explicit: true, auto: false }), git, () => {
      throw new Error('must not be called');
    });
    expect(d.doLifecycle).toBe(true);
    expect(git.calls).toEqual([]);
  });

  it('without --auto-lifecycle nothing is detected (versions upload)', () => {
    const git = fakeGit();
    expect(decideDoLifecycle(push({ auto: false }), git, () => true).doLifecycle).toBe(false);
    expect(git.calls).toEqual([]);
  });

  it('a production tag compares with the previous v* tag', () => {
    const git = fakeGit({ commits: ['HEAD^'], tag: 'v0.4.0' });
    expect(resolveBase({ eventBefore: ZEROS, refType: 'tag', eventName: 'push' }, git)).toEqual({ base: 'v0.4.0', source: 'previous-tag' });
    expect(git.calls.find((c) => c[0] === 'describe')).toEqual(['describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD^']);
  });

  it('a production tag with no earlier tag falls back to the parent', () => {
    expect(resolveBase({ eventBefore: ZEROS, refType: 'tag' }, fakeGit({ commits: ['HEAD^'] }))).toEqual({ base: 'HEAD^', source: 'parent' });
  });

  it('a manual run takes the operator base first', () => {
    expect(resolveBase({ base: 'v0.3.0', eventName: 'workflow_dispatch' }, fakeGit({ commits: ['v0.3.0', 'HEAD^'], tag: 'v0.4.0' }))).toEqual({ base: 'v0.3.0', source: 'explicit' });
  });

  it('an operator base that is not in the checkout is an error, not a silent versions upload', () => {
    expect(() => resolveBase({ base: 'nope' }, fakeGit({ commits: ['HEAD^'] }))).toThrow(/not a commit/);
  });

  it('a root commit has no base: versions path, unless the checkout is shallow', () => {
    expect(decideDoLifecycle(push({ eventBefore: ZEROS }), fakeGit(), () => true)).toMatchObject({ doLifecycle: false, source: 'off' });
    expect(() => decideDoLifecycle(push({ eventBefore: ZEROS }), fakeGit({ shallow: true }), () => true)).toThrow(/fetch-depth: 0/);
  });
});

describe('deploy path decision on a real repository', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const makeRepo = (): { dir: string; git: GitRun; sh: (...a: string[]) => string } => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dv-decide-'));
    dirs.push(dir);
    const exec = (a: readonly string[]): { status: number; out: string } => {
      const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' });
      return { status: r.status ?? 1, out: r.stdout ?? '' };
    };
    exec(['init', '-q', '-b', 'main']);
    return { dir, git: (a) => exec(a), sh: (...a) => exec(a).out.trim() };
  };

  it('main: a push whose range holds a wrangler migrations change selects wrangler deploy; the next push selects versions upload', () => {
    const { dir, git, sh } = makeRepo();
    const cfg = path.join(dir, 'services/edge/wrangler.jsonc');
    mkdirSync(path.dirname(cfg), { recursive: true });
    writeFileSync(cfg, '{ "name": "tha-bay-web", "migrations": [] }\n');
    sh('add', '-A');
    sh('commit', '-q', '-m', 'base');
    const before = sh('rev-parse', 'HEAD');

    writeFileSync(cfg, '{ "name": "tha-bay-web", "migrations": [{ "tag": "v1", "new_sqlite_classes": ["X"] }] }\n');
    sh('add', '-A');
    sh('commit', '-q', '-m', 'lifecycle');
    const lifecycleIn = (base: string): boolean => evaluate(collectChanges(dir, base)).lifecycle;

    expect(decideDoLifecycle(push({ eventBefore: before }), git, lifecycleIn)).toMatchObject({ doLifecycle: true, source: 'event-before' });
    // first push of the branch: parent is the same range here
    expect(decideDoLifecycle(push({ eventBefore: ZEROS }), git, lifecycleIn)).toMatchObject({ doLifecycle: true, source: 'parent' });

    writeFileSync(path.join(dir, 'README.md'), 'x\n');
    sh('add', '-A');
    sh('commit', '-q', '-m', 'docs');
    const after = sh('rev-parse', 'HEAD^');
    expect(decideDoLifecycle(push({ eventBefore: after }), git, lifecycleIn)).toMatchObject({ doLifecycle: false });
    // a push of both commits at once still contains the lifecycle change
    expect(decideDoLifecycle(push({ eventBefore: before }), git, lifecycleIn).doLifecycle).toBe(true);
  });
});

describe('deploy.yml wiring', () => {
  const yml = readFileSync(path.join(repoRoot, '.github/workflows/deploy.yml'), 'utf8');
  it('both deploy jobs fetch full history and pass --auto-lifecycle with the push before sha', () => {
    expect(yml).toContain('pnpm deploy:prod -- --env staging --auto-lifecycle');
    expect(yml).toMatch(/run: pnpm deploy:prod -- --auto-lifecycle/);
    expect(yml.match(/fetch-depth: 0/g)?.length).toBe(2);
    expect(yml.match(/DV_EVENT_BEFORE: \$\{\{ github\.event\.before \}\}/g)?.length).toBe(2);
    expect(yml).toContain('DV_DEPLOY_BASE: ${{ inputs.base }}');
  });
});
