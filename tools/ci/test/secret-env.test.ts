import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripJsonc, WORKER_SECRETS } from '../deploy.ts';
import { DEV_EDGE_PORT, devPlan } from '../dev.ts';
import { repoRoot } from '../run.ts';
import {
  ALLOW_LIVE_SECRETS_ENV,
  envFileLine,
  envFileSecretOverrides,
  isSecretEnvName,
  isWorkerEnvFileName,
  liveSecretsAllowed,
  NO_ENV_FILE,
  scrubbedEnv,
  scrubLine,
  secretEnvFiles,
  secretNamesIn,
  secretNamesInDotenv,
  WORKER_LOCAL_SECRETS,
  wranglerVarArgs,
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
  'OPS_TOKEN',
  'ELEVENLABS_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
] as const;

const fakeEnv = (): Record<string, string> => Object.fromEntries(FAKE_NAMES.map((k) => [k, FAKE]));
const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
/** The parent's environment without the opt-in, so a developer's own DV_ALLOW_LIVE_SECRETS never changes what these specs prove. */
const baseEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env[ALLOW_LIVE_SECRETS_ENV];
  return env;
};

const EDGE_DIR = path.join(repoRoot, 'services/edge');

/**
 * The secret-like fields of the Worker's Env interface (services/edge/src/env.ts): a name ending in KEY, TOKEN, SECRET or PASSWORD or
 * holding a SECRET, HMAC, JWK or TOKEN segment, or a field whose doc comment calls it a secret (AUTH_PASSWORD_SIGNUP, an on/off switch,
 * is none of these).
 */
function envTsSecretFields(): string[] {
  const lines = readFileSync(path.join(EDGE_DIR, 'src/env.ts'), 'utf8').split('\n');
  const out: string[] = [];
  let doc = '';
  for (const line of lines) {
    if (/^\s*\/\*\*/.test(line)) doc = '';
    if (/^\s*(\/\*\*|\*)/.test(line)) doc += line;
    const m = /^\s{2}([A-Z][A-Z0-9_]*)\??:/.exec(line);
    if (!m) continue;
    const name = m[1] ?? '';
    const parts = name.split('_');
    const named = ['KEY', 'TOKEN', 'SECRET', 'PASSWORD'].includes(parts[parts.length - 1] ?? '') || parts.some((p) => ['SECRET', 'HMAC', 'JWK', 'TOKEN'].includes(p));
    if (named || /\bsecret\b/i.test(doc.replace(/not a secret|non-secret/gi, ''))) out.push(name);
    doc = '';
  }
  return out;
}

/** The env files in services/edge that a probe must not clobber or be shadowed by (the developer's own). */
const ownEdgeEnvFiles = (): string[] => readdirSync(EDGE_DIR).filter(isWorkerEnvFileName);

/** Writes `name` in services/edge with a fake value for every name of `names`, runs `fn`, and always removes the file again. */
function withEdgeEnvFile<T>(name: string, names: readonly string[], fn: () => T): T {
  const file = path.join(EDGE_DIR, name);
  if (existsSync(file)) throw new Error(`${file} exists; the probe never overwrites a developer's env file`);
  writeFileSync(file, `# BD-FIX-SEC-02 probe, removed by tools/ci/test/secret-env.test.ts\n${names.map((k) => `${k}=${FAKE}`).join('\n')}\n`);
  try {
    return fn();
  } finally {
    rmSync(file, { force: true });
  }
}

/** The names a probe env file holds: the Worker's own secrets (what wrangler binds from a file) plus every secret-like Env field. */
const ENV_FILE_NAMES = [...new Set([...WORKER_LOCAL_SECRETS, ...envTsSecretFields()])].sort();

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

  it('covers every secret-like field of the Worker Env (services/edge/src/env.ts), OPS_TOKEN and ELEVENLABS_API_KEY included', () => {
    const fields = envTsSecretFields();
    for (const k of ['OPS_TOKEN', 'ELEVENLABS_API_KEY', 'SUPABASE_SECRET_KEY', 'FAL_KEY', 'PLAY_TOKEN_HMAC_PREV', 'ANTHROPIC_BUILDER_KEY']) expect(fields, k).toContain(k);
    for (const k of fields) expect(isSecretEnvName(k), k).toBe(true);
  });

  it('denies the default credential names of S3-compatible SDKs', () => {
    for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']) expect(isSecretEnvName(k), k).toBe(true);
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

  it('warns under the opt-in in every process: an inherited DV_LIVE_SECRETS_WARNED=1 does not silence it', () => {
    const input = { ...fakeEnv(), [ALLOW_LIVE_SECRETS_ENV]: '1', DV_LIVE_SECRETS_WARNED: '1' };
    const lines: string[] = [];
    scrubbedEnv(input, { label: 'a', log: (l) => lines.push(l) });
    scrubbedEnv(scrubbedEnv(input, { label: 'b', log: (l) => lines.push(l) }), { label: 'c', log: (l) => lines.push(l) });
    expect(lines.map((l) => l.split(':')[0])).toEqual(['a', 'b', 'c']);
    for (const l of lines) expect(l).toContain(`WARNING ${ALLOW_LIVE_SECRETS_ENV}=1`);
  });
});

describe('env files beside the Worker config (BD-FIX-SEC-02)', () => {
  it('knows the file names wrangler reads, and never an example', () => {
    for (const f of ['.dev.vars', '.dev.vars.staging', '.env', '.env.local', '.env.staging', '.env.staging.local']) expect(isWorkerEnvFileName(f), f).toBe(true);
    for (const f of ['.dev.vars.example', '.env.example', 'dev.vars', 'wrangler.jsonc', '.envrc']) expect(isWorkerEnvFileName(f), f).toBe(false);
  });

  it('reads deny-listed names with a value from dotenv text, never a value, and skips empty ones and the rest', () => {
    const text = [
      '# SUPABASE_SECRET_KEY=commented',
      'SUPABASE_SECRET_KEY=sb_secret_x',
      'export OPS_TOKEN = "abc"',
      'PLAY_TOKEN_HMAC=',
      'FAL_KEY=""',
      "ANTHROPIC_API_KEY=''",
      'QUOTA_NET_SALT_SECRET= # empty, then a comment',
      'FLAGS_JSON={"npc.dialogue":true}',
      'AWS_SECRET_ACCESS_KEY: yaml-style',
    ].join('\n');
    expect(secretNamesInDotenv(text)).toEqual(['AWS_SECRET_ACCESS_KEY', 'OPS_TOKEN', 'SUPABASE_SECRET_KEY']);
  });

  it('finds every env file that holds a name, blanks the names with a loud line (names only), and passes them under the opt-in', () => {
    const dir = tempDir('dv-envfiles-');
    writeFileSync(path.join(dir, '.dev.vars'), `SUPABASE_SECRET_KEY=${FAKE}\nFLAGS_JSON={}\n`);
    writeFileSync(path.join(dir, '.env.staging'), `OPS_TOKEN=${FAKE}\n`);
    writeFileSync(path.join(dir, '.dev.vars.example'), `FAL_KEY=${FAKE}\n`);
    writeFileSync(path.join(dir, '.env.local'), 'SUPABASE_SECRET_KEY=\n');
    const hits = secretEnvFiles(dir);
    expect(hits.map((h) => [path.basename(h.file), h.names])).toEqual([
      ['.dev.vars', ['SUPABASE_SECRET_KEY']],
      ['.env.staging', ['OPS_TOKEN']],
    ]);
    const lines: string[] = [];
    const saved = process.env[ALLOW_LIVE_SECRETS_ENV];
    try {
      delete process.env[ALLOW_LIVE_SECRETS_ENV];
      expect(envFileSecretOverrides(dir, { label: 't', log: (l) => lines.push(l) })).toEqual({ SUPABASE_SECRET_KEY: '', OPS_TOKEN: '' });
      expect(lines).toEqual(hits.map((h) => envFileLine('t', h, true)));
      for (const l of lines) expect(l).not.toContain(FAKE);
      process.env[ALLOW_LIVE_SECRETS_ENV] = '1';
      lines.length = 0;
      expect(envFileSecretOverrides(dir, { label: 't', log: (l) => lines.push(l) })).toEqual({});
      expect(lines).toEqual(hits.map((h) => envFileLine('t', h, false)));
      expect(lines[0]).toContain(`WARNING ${ALLOW_LIVE_SECRETS_ENV}=1`);
    } finally {
      if (saved === undefined) delete process.env[ALLOW_LIVE_SECRETS_ENV];
      else process.env[ALLOW_LIVE_SECRETS_ENV] = saved;
    }
    expect(envFileSecretOverrides(tempDir('dv-envfiles-empty-'), { label: 't', log: (l) => lines.push(l) })).toEqual({});
    expect(wranglerVarArgs({ SUPABASE_SECRET_KEY: '', OPS_TOKEN: '' })).toEqual(['--var', 'OPS_TOKEN:', '--var', 'SUPABASE_SECRET_KEY:']);
  });

  it('NO_ENV_FILE as the only env file: wrangler loads neither .dev.vars nor .env (and does without it, so the probe is not vacuous)', () => {
    const wrangler = createRequire(path.join(EDGE_DIR, 'package.json'))('wrangler') as {
      unstable_getVarsForDev: (configPath: string, envFiles: string[] | undefined, vars: Record<string, string>, env: string | undefined, silent: boolean, secrets: { required: string[] }) => Record<string, { value?: unknown }>;
    };
    const fakeIn = (vars: Record<string, { value?: unknown }>): string[] => Object.keys(vars).filter((k) => vars[k]?.value === FAKE).sort();
    for (const file of ['.dev.vars', '.dev.vars.staging', '.env', '.env.staging']) {
      const dir = tempDir('dv-envfile-probe-');
      writeFileSync(path.join(dir, file), ENV_FILE_NAMES.map((k) => `${k}=${FAKE}`).join('\n'));
      const configPath = path.join(dir, 'wrangler.jsonc');
      const secrets = { required: [...WORKER_LOCAL_SECRETS] };
      expect(fakeIn(wrangler.unstable_getVarsForDev(configPath, undefined, {}, 'staging', true, secrets)), file).toEqual([...WORKER_LOCAL_SECRETS].sort());
      expect(fakeIn(wrangler.unstable_getVarsForDev(configPath, [NO_ENV_FILE], {}, 'staging', true, secrets)), file).toEqual([]);
    }
  });

  it('the e2e web server reads no env file, never reuses a server, and stays off the pnpm dev port', async () => {
    const mod = (await import(path.join(repoRoot, 'playwright.config.ts'))) as {
      default: { webServer?: { command?: string; reuseExistingServer?: boolean; url?: string } };
      E2E_DEFAULT_PORT: number;
    };
    const ws = mod.default.webServer;
    expect(ws?.command).toContain(`wrangler dev --local --port `);
    expect(ws?.command).toContain(` --env-file ${NO_ENV_FILE}`);
    expect(ws?.reuseExistingServer).toBe(false);
    expect(mod.E2E_DEFAULT_PORT).not.toBe(DEV_EDGE_PORT);
    const spec = readFileSync(path.join(repoRoot, 'tests/e2e/npc-builder.spec.ts'), 'utf8');
    expect(spec).toContain(`'--env-file', NO_ENV_FILE`);
    for (const f of ['tests/e2e/npc-builder.spec.ts', 'tests/e2e/ui/hud.spec.ts']) expect(readFileSync(path.join(repoRoot, f), 'utf8'), f).not.toContain('8788');
    expect(readFileSync(path.join(repoRoot, 'services/pipeline/scripts/check-pipeline.ts'), 'utf8')).toContain('envFiles: [NO_ENV_FILE]');
    expect(readFileSync(path.join(repoRoot, 'services/pipeline/test/gate.prompt-lint.test.ts'), 'utf8')).toContain('envFiles: [devNull]');
  });

  it('pnpm dev and pnpm dev:edge: no deny-listed name from the shell, and every one an env file holds is passed on empty', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['dev']).toBe('tsx tools/ci/dev.ts');
    expect(pkg.scripts['dev:edge']).toBe('tsx tools/ci/dev.ts --edge');
    const dir = tempDir('dv-dev-plan-');
    writeFileSync(path.join(dir, '.dev.vars'), `SUPABASE_SECRET_KEY=${FAKE}\nPLAY_TOKEN_HMAC=${FAKE}\nFLAGS_JSON={}\n`);
    writeFileSync(path.join(dir, '.env'), `OPS_TOKEN=${FAKE}\n`);
    for (const edgeOnly of [false, true]) {
      const lines: string[] = [];
      const plan = devPlan({ edgeOnly, env: { ...fakeEnv(), PATH: '/usr/bin' }, edgeDir: dir, log: (l) => lines.push(l) });
      expect(secretNamesIn(plan.env)).toEqual([]);
      expect(plan.env['PATH']).toBe('/usr/bin');
      expect(plan.wrangler.slice(0, 4)).toEqual(['dev', '--local', '--port', String(DEV_EDGE_PORT)]);
      expect(plan.wrangler.join(' ')).toContain('--var OPS_TOKEN: --var PLAY_TOKEN_HMAC: --var SUPABASE_SECRET_KEY:');
      expect(plan.wrangler.includes('ANTHROPIC_MODE:fixture')).toBe(!edgeOnly);
      expect(lines.join('\n')).not.toContain(FAKE);
      expect(lines).toHaveLength(3); // the scrub line and one line per env file
    }
    const lines: string[] = [];
    const saved = process.env[ALLOW_LIVE_SECRETS_ENV];
    try {
      process.env[ALLOW_LIVE_SECRETS_ENV] = '1';
      const plan = devPlan({ edgeOnly: true, env: { ...fakeEnv(), [ALLOW_LIVE_SECRETS_ENV]: '1' }, edgeDir: dir, log: (l) => lines.push(l) });
      expect(secretNamesIn(plan.env)).toEqual([...FAKE_NAMES].sort());
      expect(plan.wrangler.join(' ')).not.toContain('--var');
      expect(lines.every((l) => l.includes(`WARNING ${ALLOW_LIVE_SECRETS_ENV}=1`))).toBe(true);
    } finally {
      if (saved === undefined) delete process.env[ALLOW_LIVE_SECRETS_ENV];
      else process.env[ALLOW_LIVE_SECRETS_ENV] = saved;
    }
  });
});

/**
 * The nested runs start at low CPU priority where `nice` exists (BD-FIX-SEC-02): each is a Vitest, often with workerd, beside the rest of
 * the suite, and load-sensitive specs (the tycoon self-tests) share the 2-vCPU runner. The exit status is the probe's own.
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
  // temporary file there (never over a developer's own, which would also shadow it; the run then skips) and removes it at once.
  it.skipIf(ownEdgeEnvFiles().length > 0)(
    'check-workers.ts <probe> with a temporary services/edge/.dev.vars, then .env: the Worker gets every name empty (and the file leaks under the opt-in)',
    () => {
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
      withEdgeEnvFile('.env', ENV_FILE_NAMES, () => {
        const r = probe(tsx, ['tools/ci/check-workers.ts', 'secret-env-probe']);
        expect(r.status, r.output).toBe(0);
        expect(r.output).toContain(envFileLine('check:workers vitest', { file: 'services/edge/.env', names: ENV_FILE_NAMES }, true));
        expect(r.output).toMatch(/Test Files\s+1 passed/);
      });
      expect(ownEdgeEnvFiles()).toEqual([]);
    },
    600_000,
  );
});
