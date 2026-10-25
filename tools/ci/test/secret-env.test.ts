import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripJsonc, WORKER_SECRETS } from '../deploy.ts';
import { repoRoot } from '../run.ts';
import {
  ALLOW_LIVE_SECRETS_ENV,
  isSecretEnvName,
  liveSecretsAllowed,
  scrubbedEnv,
  scrubLine,
  secretNamesIn,
  WORKER_LOCAL_SECRETS,
} from '../secret-env.ts';
import { useTempDirs } from '../test-tmp.ts';

// BD-FIX-SEC-01: no test run sees a live secret unless DV_ALLOW_LIVE_SECRETS=1.
const tempDir = useTempDirs();

/** An obviously fake value; never a real secret. */
const FAKE = 'test-not-a-secret';

/** Every name the incident, CLAUDE.md "Secrets", deploy.ts and the workflows name (plus a few of each prefix). */
const FAKE_NAMES = [
  'FAL_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_DB_PASSWORD_STAGING',
  'SUPABASE_PROJECT_ID',
  'SUPABASE_PROJECT_ID_PRODUCTION',
  'SUPABASE_PROJECT_ID_STAGING',
  'SUPABASE_URL',
  'PLAY_TOKEN_HMAC',
  'PLAY_TOKEN_HMAC_PREV',
  'QUOTA_NET_SALT_SECRET',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BUILDER_KEY',
  'ANTHROPIC_EVALS_KEY',
  'OPENAI_MODERATION_API_KEY',
  'INTERNAL_HMAC',
  'ID_SIGNING_JWK_CURRENT',
  'ID_SIGNING_JWK_NEXT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_PRIVATE_ACCESS_KEY_ID',
  'R2_PRIVATE_SECRET_ACCESS_KEY',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'DV_NAMES_REAL_JSON',
] as const;

const fakeEnv = (): Record<string, string> => Object.fromEntries(FAKE_NAMES.map((k) => [k, FAKE]));
const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
/** The parent's environment without the opt-in, so a developer's own DV_ALLOW_LIVE_SECRETS never changes what these specs prove. */
const baseEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env[ALLOW_LIVE_SECRETS_ENV];
  delete env['DV_LIVE_SECRETS_WARNED'];
  return env;
};

describe('the deny-list', () => {
  it('covers every fake name, every deploy.ts WORKER_SECRETS name and every secrets.required name of the edge config', () => {
    const cfg = JSON.parse(stripJsonc(readFileSync(path.join(repoRoot, 'services/edge/wrangler.jsonc'), 'utf8'))) as {
      secrets?: { required?: string[] };
      env?: Record<string, { secrets?: { required?: string[] } }>;
    };
    const required = [...(cfg.secrets?.required ?? []), ...Object.values(cfg.env ?? {}).flatMap((e) => e.secrets?.required ?? [])];
    expect(required.length).toBeGreaterThan(0);
    for (const k of [...FAKE_NAMES, ...WORKER_SECRETS, ...WORKER_LOCAL_SECRETS, ...required]) expect(isSecretEnvName(k), k).toBe(true);
    expect([...WORKER_LOCAL_SECRETS].sort()).toEqual([...(cfg.secrets?.required ?? [])].sort());
  });

  it('keeps what the runners and the local harnesses need', () => {
    for (const k of ['PATH', 'HOME', 'CI', 'TMPDIR', 'DV_TEST_TMP_ROOT', 'CLOUDFLARE_CF_FETCH_PATH', 'WRANGLER_SEND_METRICS', 'DV_DB_API_URL', 'DV_DB_SECRET_KEY', 'DV_DB_URL', 'DV_E2E_PORT', ALLOW_LIVE_SECRETS_ENV]) {
      expect(isSecretEnvName(k), k).toBe(false);
    }
  });

  it('no workflow sets the opt-in', () => {
    const dir = path.join(repoRoot, '.github', 'workflows');
    for (const f of readdirSync(dir)) expect(readFileSync(path.join(dir, f), 'utf8'), f).not.toContain(ALLOW_LIVE_SECRETS_ENV);
  });

  it('the ci.yml steps that pass DV_NAMES_REAL_JSON run tools, not test runners', () => {
    const lines = readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8').split('\n');
    const steps = lines.flatMap((l, i) => (l.includes('DV_NAMES_REAL_JSON: ${{') ? [lines.slice(Math.max(0, i - 3), i).join('\n')] : []));
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(s).not.toMatch(/check:(unit|e2e|perf|workers|db|pipeline)|vitest|playwright/);
  });
});

describe('scrubbedEnv', () => {
  it('removes every denied name, keeps the rest, never changes its input and prints one line of names only', () => {
    const input = { ...fakeEnv(), PATH: '/usr/bin', DV_DB_SECRET_KEY: 'local-stack' };
    const lines: string[] = [];
    const out = scrubbedEnv(input, { label: 't', log: (l) => lines.push(l) });
    expect(secretNamesIn(out)).toEqual([]);
    expect(out['PATH']).toBe('/usr/bin');
    expect(out['DV_DB_SECRET_KEY']).toBe('local-stack');
    expect(secretNamesIn(input)).toEqual([...FAKE_NAMES].sort());
    expect(lines).toEqual([scrubLine('t', [...FAKE_NAMES].sort())]);
    expect(lines[0]).not.toContain(FAKE);
  });

  it('prints nothing when there is nothing to remove', () => {
    const lines: string[] = [];
    scrubbedEnv({ PATH: '/usr/bin' }, { label: 't', log: (l) => lines.push(l) });
    expect(lines).toEqual([]);
  });

  it('passes everything through with a loud warning under DV_ALLOW_LIVE_SECRETS=1, unless forced', () => {
    const input = { ...fakeEnv(), [ALLOW_LIVE_SECRETS_ENV]: '1' };
    expect(liveSecretsAllowed(input)).toBe(true);
    expect(liveSecretsAllowed({ [ALLOW_LIVE_SECRETS_ENV]: 'true' })).toBe(false);
    const lines: string[] = [];
    const out = scrubbedEnv(input, { label: 't', log: (l) => lines.push(l) });
    expect(secretNamesIn(out)).toEqual([...FAKE_NAMES].sort());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`WARNING ${ALLOW_LIVE_SECRETS_ENV}=1`);
    expect(lines[0]).not.toContain(FAKE);
    const forced = scrubbedEnv(input, { label: 't', force: true, log: (l) => lines.push(l) });
    expect(secretNamesIn(forced)).toEqual([]);
  });
});

/** Starts `cmd` with fake values for every denied name; the probe spec writes the names it saw to a file. */
function probe(cmd: string, argv: string[], extra: Record<string, string> = {}): { status: number | null; output: string; seen: string[] | null } {
  const out = path.join(tempDir('dv-secret-probe-'), 'seen.json');
  const r = spawnSync(cmd, argv, {
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
    const r = probe(tsx, ['tools/ci/run.ts', 'vitest', 'run', PROBE_SPEC], { DV_SECRET_PROBE_EXPECT: 'all', [ALLOW_LIVE_SECRETS_ENV]: '1' });
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
});
