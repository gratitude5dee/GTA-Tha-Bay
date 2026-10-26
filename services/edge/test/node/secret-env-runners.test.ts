import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../../../tools/ci/run.ts';
import { ALLOW_LIVE_SECRETS_ENV, envFileLine, isWorkerEnvFileName, scrubLine, WORKER_LOCAL_SECRETS } from '../../../../tools/ci/secret-env.ts';
import { baseEnv, FAKE, FAKE_NAMES, fakeEnv } from '../../../../tools/ci/test/secret-env-fixtures.ts';
import { useTempDirs } from '../../../../tools/ci/test-tmp.ts';
import { envTsSecretFields, wranglerVarNames } from '../../../../tools/ci/worker-secrets.ts';

/**
 * BD-FIX-SEC-01/02 nested-runner probes. Each case starts a real test runner (Vitest through run.ts, Vitest directly, check:workers with
 * workerd) with a fake value for every denied name, so the file is heavy; it runs in the check:workers CI job (tools/ci/check-workers.ts
 * runs services/edge/test/node/** in Node through vitest.node.config.ts after the workerd suites), not in `pnpm check:unit`. The fast,
 * pure cases stay in tools/ci/test/secret-env.test.ts.
 */
const tempDir = useTempDirs();

const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const EDGE_DIR = path.join(repoRoot, 'services/edge');

/**
 * The names a probe env file holds: the Worker's own secrets (what wrangler binds from a file) plus every secret-like Env field. The
 * config's vars (SUPABASE_ANON_KEY, public by design) are left out: an env file may override a var, and a var is not a secret, so the
 * Worker keeps the config's value rather than a blank.
 */
const ENV_FILE_NAMES = [
  ...new Set([
    ...WORKER_LOCAL_SECRETS,
    ...envTsSecretFields(readFileSync(path.join(EDGE_DIR, 'src/env.ts'), 'utf8'), wranglerVarNames(readFileSync(path.join(EDGE_DIR, 'wrangler.jsonc'), 'utf8'))),
  ]),
].sort();

/**
 * The first line of every env file this spec writes into services/edge. A file that carries it is this spec's own (left behind by a run
 * that was killed) and is removed or overwritten; any other env file there is a developer's, never touched.
 */
const PROBE_SENTINEL = '# dv-secret-env-probe: temporary file of services/edge/test/node/secret-env-runners.test.ts, safe to delete';

/** True when `file`'s first line is the sentinel (line endings normalised as wrangler's dotenv does). */
function isProbeFile(file: string): boolean {
  try {
    return readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').split('\n')[0] === PROBE_SENTINEL;
  } catch {
    return false;
  }
}

/** Removes every env file in services/edge that carries the sentinel; returns the env files left (the developer's own). */
function clearProbeFiles(): string[] {
  const left: string[] = [];
  for (const name of readdirSync(EDGE_DIR).filter(isWorkerEnvFileName)) {
    const file = path.join(EDGE_DIR, name);
    if (isProbeFile(file)) rmSync(file, { force: true });
    else left.push(name);
  }
  return left;
}

/**
 * Writes `name` in services/edge (sentinel first, then a fake value for every name of `names`, lines ended by `eol`), runs `fn`, and
 * always removes the file again. A file of that name that carries the sentinel is overwritten; any other is never touched.
 */
function withEdgeEnvFile<T>(name: string, names: readonly string[], fn: () => T, eol = '\n'): T {
  const file = path.join(EDGE_DIR, name);
  if (existsSync(file) && !isProbeFile(file)) throw new Error(`${file} exists and is not this probe's; the probe never overwrites a developer's env file`);
  writeFileSync(file, [PROBE_SENTINEL, ...names.map((k) => `${k}=${FAKE}`)].join(eol) + eol);
  try {
    return fn();
  } finally {
    if (isProbeFile(file)) rmSync(file, { force: true });
  }
}

/** The developer's own env files in services/edge (after this spec's leftovers are removed). In CI there must be none. */
const foreignEnvFiles = clearProbeFiles();
const IN_CI = Boolean(process.env['CI']);

/**
 * The nested runs start at low CPU priority where `nice` exists (BD-FIX-SEC-02): each is a Vitest, often with workerd. The exit status
 * is the probe's own.
 */
const NICE = process.platform !== 'win32' && existsSync('/usr/bin/nice') ? '/usr/bin/nice' : null;

/** Starts `cmd` with fake values for every denied name; the probe spec writes the names it saw to a file. */
function probe(cmd: string, argv: string[], extra: Record<string, string> = {}): { status: number | null; output: string; seen: string[] | null } {
  const out = path.join(tempDir('dv-secret-probe-'), 'seen.json');
  const r = spawnSync(NICE ?? cmd, NICE ? ['-n', '10', cmd, ...argv] : argv, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...baseEnv(), ...fakeEnv(), DV_SECRET_PROBE: '1', DV_SECRET_PROBE_OUT: out, ...extra },
    maxBuffer: 64 * 1024 * 1024,
  });
  const seen = existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as { seen: string[] }).seen : null;
  return { status: r.status, output: `${r.stdout}\n${r.stderr}`, seen };
}

const PROBE_SPEC = 'tools/ci/test/secret-env-probe';

describe('the test runners (spawned with a fake value for every denied name)', () => {
  it('tsx tools/ci/run.ts vitest run <probe>: the probe sees none, and the scrub line names them', () => {
    const r = probe(tsx, ['tools/ci/run.ts', 'vitest', 'run', PROBE_SPEC], { DV_SECRET_PROBE_EXPECT: 'none' });
    expect(r.status, r.output).toBe(0);
    expect(r.seen).toEqual([]);
    expect(r.output).toContain(scrubLine('run.ts', [...FAKE_NAMES].sort()));
    expect(r.output).not.toContain(FAKE);
  }, 180_000);

  it('vitest started directly (no run.ts): the root config and setup file still scrub', () => {
    const r = probe(path.join(repoRoot, 'node_modules', '.bin', 'vitest'), ['run', PROBE_SPEC], { DV_SECRET_PROBE_EXPECT: 'none' });
    expect(r.status, r.output).toBe(0);
    expect(r.seen).toEqual([]);
    expect(r.output).toContain(scrubLine('vitest', [...FAKE_NAMES].sort()));
  }, 180_000);

  it('DV_ALLOW_LIVE_SECRETS=1 passes every name through, with the warning', () => {
    const r = probe(tsx, ['tools/ci/run.ts', 'vitest', 'run', PROBE_SPEC], { DV_SECRET_PROBE_EXPECT: 'all', [ALLOW_LIVE_SECRETS_ENV]: '1', DV_LIVE_SECRETS_WARNED: '1' });
    expect(r.status, r.output).toBe(0);
    expect(r.seen).toEqual([...FAKE_NAMES].sort());
    expect(r.output).toContain(`run.ts: WARNING ${ALLOW_LIVE_SECRETS_ENV}=1`);
    expect(r.output).not.toContain(FAKE);
  }, 180_000);

  it('tsx tools/ci/check-workers.ts <probe>: no Worker binding carries a shell value (and the probe catches one under the opt-in)', () => {
    const r = probe(tsx, ['tools/ci/check-workers.ts', 'secret-env-probe']);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain(scrubLine('check:workers', [...FAKE_NAMES].sort()));
    expect(r.output).toMatch(/Test Files\s+1 passed/);
    // Proof that the probe is not vacuous: with the opt-in, wrangler loads `secrets.required` from the shell and the probe fails.
    const leak = probe(tsx, ['tools/ci/check-workers.ts', 'secret-env-probe'], { [ALLOW_LIVE_SECRETS_ENV]: '1' });
    expect(leak.status, leak.output).not.toBe(0);
    expect(leak.output).toContain(`check:workers: WARNING ${ALLOW_LIVE_SECRETS_ENV}=1`);
  }, 300_000);

  // BD-FIX-SEC-02: wrangler also loads `secrets.required` from services/edge/.dev.vars, or (without one) from .env. The probe writes a
  // temporary file there, sentinel first, and removes it at once. A developer's own env file there (no sentinel) would shadow the probe
  // file: locally the case then skips; in CI (CI set) it fails, because no such file may exist on a runner.
  (foreignEnvFiles.length > 0 && !IN_CI ? it.skip : it)(
    'check-workers.ts <probe> with a temporary services/edge/.dev.vars (\\n, then bare \\r line endings), then .env: the Worker gets every name empty (and the file leaks under the opt-in)',
    () => {
      if (foreignEnvFiles.length > 0) throw new Error(`CI is set and services/edge holds env file(s) this probe did not write: ${foreignEnvFiles.join(', ')}`);
      withEdgeEnvFile('.dev.vars', ENV_FILE_NAMES, () => {
        const r = probe(tsx, ['tools/ci/check-workers.ts', 'secret-env-probe']);
        expect(r.status, r.output).toBe(0);
        expect(r.output).toContain(envFileLine('check:workers vitest', { file: 'services/edge/.dev.vars', names: ENV_FILE_NAMES }, true));
        expect(r.output).toMatch(/Test Files\s+1 passed/);
        expect(r.output).not.toContain(FAKE);
        // Not vacuous: under the opt-in the file's values reach the Worker and the probe fails.
        const leak = probe(tsx, ['tools/ci/check-workers.ts', 'secret-env-probe'], { [ALLOW_LIVE_SECRETS_ENV]: '1' });
        expect(leak.status, leak.output).not.toBe(0);
        expect(leak.output).toContain(envFileLine('check:workers vitest', { file: 'services/edge/.dev.vars', names: ENV_FILE_NAMES }, false));
      });
      // K2-R1: bare carriage returns. wrangler's dotenv ends a line at `\r`; the blanking never depended on reading the file.
      withEdgeEnvFile(
        '.dev.vars',
        ENV_FILE_NAMES,
        () => {
          const r = probe(tsx, ['tools/ci/check-workers.ts', 'secret-env-probe']);
          expect(r.status, r.output).toBe(0);
          expect(r.output).toContain(envFileLine('check:workers vitest', { file: 'services/edge/.dev.vars', names: ENV_FILE_NAMES }, true));
          expect(r.output).toMatch(/Test Files\s+1 passed/);
          const leak = probe(tsx, ['tools/ci/check-workers.ts', 'secret-env-probe'], { [ALLOW_LIVE_SECRETS_ENV]: '1' });
          expect(leak.status, leak.output).not.toBe(0);
        },
        '\r',
      );
      withEdgeEnvFile('.env', ENV_FILE_NAMES, () => {
        const r = probe(tsx, ['tools/ci/check-workers.ts', 'secret-env-probe']);
        expect(r.status, r.output).toBe(0);
        expect(r.output).toContain(envFileLine('check:workers vitest', { file: 'services/edge/.env', names: ENV_FILE_NAMES }, true));
        expect(r.output).toMatch(/Test Files\s+1 passed/);
      });
      expect(clearProbeFiles()).toEqual([]);
    },
    900_000,
  );
});
