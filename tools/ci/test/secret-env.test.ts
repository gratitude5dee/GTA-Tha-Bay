import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripJsonc, WORKER_SECRETS } from '../deploy.ts';
import { DEV_EDGE_PORT, devPlan } from '../dev.ts';
import { repoRoot } from '../run.ts';
import {
  ALLOW_LIVE_SECRETS_ENV,
  envFileLine,
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
import { envTsSecretFields, workerSecretBlanks, workerSecretNames, workerSecretSources, wranglerRequiredSecrets, wranglerVarNames } from '../worker-secrets.ts';
import { FAKE, FAKE_NAMES, fakeEnv } from './secret-env-fixtures.ts';

// BD-FIX-SEC-01: no test run sees a live secret unless DV_ALLOW_LIVE_SECRETS=1. The fast, pure cases live here (`check:unit`); the
// nested-runner probes (run.ts vitest, a direct vitest, check:workers with workerd, temporary services/edge env files) are in
// services/edge/test/node/secret-env-runners.test.ts, which the check:workers job runs (K2-R1).
const tempDir = useTempDirs();

const EDGE_DIR = path.join(repoRoot, 'services/edge');
const edgeConfigText = (): string => readFileSync(path.join(EDGE_DIR, 'wrangler.jsonc'), 'utf8');
const envTsText = (): string => readFileSync(path.join(EDGE_DIR, 'src/env.ts'), 'utf8');

/** The names a probe env file holds: the Worker's own secrets (what wrangler binds from a file) plus every secret-like Env field (no var). */
const ENV_FILE_NAMES = [...new Set([...WORKER_LOCAL_SECRETS, ...envTsSecretFields(envTsText(), wranglerVarNames(edgeConfigText()))])].sort();

/** Runs `fn` with DV_ALLOW_LIVE_SECRETS set to `value` (or unset) in this process, and restores it. */
function withOptIn<T>(value: string | undefined, fn: () => T): T {
  const saved = process.env[ALLOW_LIVE_SECRETS_ENV];
  try {
    if (value === undefined) delete process.env[ALLOW_LIVE_SECRETS_ENV];
    else process.env[ALLOW_LIVE_SECRETS_ENV] = value;
    return fn();
  } finally {
    if (saved === undefined) delete process.env[ALLOW_LIVE_SECRETS_ENV];
    else process.env[ALLOW_LIVE_SECRETS_ENV] = saved;
  }
}

describe('the deny-list', () => {
  it('covers every fake name, every deploy.ts WORKER_SECRETS name and every secrets.required name of the edge config', () => {
    const cfg = JSON.parse(stripJsonc(edgeConfigText())) as {
      secrets?: { required?: string[] };
      env?: Record<string, { secrets?: { required?: string[] } }>;
    };
    const required = [...(cfg.secrets?.required ?? []), ...Object.values(cfg.env ?? {}).flatMap((e) => e.secrets?.required ?? [])];
    expect(required.length).toBeGreaterThan(0);
    for (const k of [...FAKE_NAMES, ...WORKER_SECRETS, ...WORKER_LOCAL_SECRETS, ...required]) expect(isSecretEnvName(k), k).toBe(true);
    expect([...WORKER_LOCAL_SECRETS].sort()).toEqual([...(cfg.secrets?.required ?? [])].sort());
  });

  it('covers every secret-like field of the Worker Env (services/edge/src/env.ts), OPS_TOKEN and ELEVENLABS_API_KEY included', () => {
    const fields = envTsSecretFields(envTsText());
    for (const k of ['OPS_TOKEN', 'ELEVENLABS_API_KEY', 'SUPABASE_SECRET_KEY', 'FAL_KEY', 'PLAY_TOKEN_HMAC_PREV', 'ANTHROPIC_BUILDER_KEY']) expect(fields, k).toContain(k);
    for (const k of fields) expect(isSecretEnvName(k), k).toBe(true);
  });

  it('denies the default credential names of S3-compatible SDKs and the GitHub tokens', () => {
    for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) expect(isSecretEnvName(k), k).toBe(true);
    const out = scrubbedEnv({ GH_TOKEN: FAKE, GITHUB_TOKEN: FAKE, PATH: '/usr/bin' }, { label: 't', log: () => undefined });
    expect(out).toEqual({ PATH: '/usr/bin' });
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

  // K2-R1: GH_TOKEN / GITHUB_TOKEN are set only as the env of a single step that runs a deploy tool or the gh CLI, never at the workflow
  // or job level (where every step, test runners included, would inherit it). Checked in every workflow (ci.yml, preview.yml, nightly.yml…).
  it('every workflow passes GH_TOKEN and GITHUB_TOKEN only to deploy tools and gh steps, never to a test runner', () => {
    const dir = path.join(repoRoot, '.github', 'workflows');
    let seen = 0;
    for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
      const lines = readFileSync(path.join(dir, f), 'utf8').split('\n');
      lines.forEach((l, i) => {
        const m = /^( *)(GH_TOKEN|GITHUB_TOKEN):/.exec(l);
        if (!m) return;
        seen++;
        const where = `${f}:${i + 1}`;
        // Step-level env entries sit at 10 spaces (`      - ` steps, `        env:`); job-level at 6, workflow-level at 2.
        expect(m[1]?.length, `${where}: ${m[2]} only in a step's env`).toBe(10);
        let start = i;
        while (start > 0 && !/^ {6}- /.test(lines[start] ?? '')) start--;
        let end = i + 1;
        while (end < lines.length && !/^ {6}- /.test(lines[end] ?? '') && !/^ {0,5}\S/.test(lines[end] ?? '')) end++;
        const step = lines.slice(start, end).filter((s) => !s.trimStart().startsWith('#')).join('\n');
        expect(step, `${where}: the step runs a deploy tool or gh`).toMatch(/pnpm deploy:|^\s+gh |\bgh pr /m);
        expect(step, `${where}: never a test runner`).not.toMatch(/check:|vitest|playwright|test:/);
      });
    }
    expect(seen).toBeGreaterThan(0);
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

describe('the known Worker secret names (tools/ci/worker-secrets.ts, BD-FIX-SEC-02)', () => {
  it('are the union of deploy.ts WORKER_SECRETS, every secrets.required list and the secret-like env.ts fields, all deny-listed', () => {
    const names = workerSecretNames();
    const src = workerSecretSources();
    expect(src.required).toEqual(wranglerRequiredSecrets(edgeConfigText()));
    expect(names).toEqual([...new Set([...WORKER_SECRETS, ...src.required, ...src.envTs])].sort());
    for (const k of [...WORKER_SECRETS, ...WORKER_LOCAL_SECRETS, 'OPS_TOKEN', 'ELEVENLABS_API_KEY', 'FAL_KEY', 'PLAY_TOKEN_HMAC_PREV']) expect(names, k).toContain(k);
    for (const k of names) expect(isSecretEnvName(k), k).toBe(true);
  });

  it('read both secrets.required lists (top level and staging) and leave out what the config sets as a var', () => {
    const cfg = JSON.parse(stripJsonc(edgeConfigText())) as { secrets: { required: string[] }; env: { staging: { secrets: { required: string[] } } } };
    const required = wranglerRequiredSecrets(edgeConfigText());
    for (const k of [...cfg.secrets.required, ...cfg.env.staging.secrets.required]) expect(required, k).toContain(k);
    const vars = wranglerVarNames(edgeConfigText());
    for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ENVIRONMENT']) expect(vars, k).toContain(k);
    const names = workerSecretNames();
    for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'AUTH_PASSWORD_SIGNUP', 'LEGAL_CONTACT', 'ANTHROPIC_MODE', 'FLAGS_JSON']) expect(names, k).not.toContain(k);
  });

  it('are computed, not copied: a new secret in any one source is picked up', () => {
    const dir = tempDir('dv-worker-secrets-');
    mkdirSync(path.join(dir, 'src'));
    const cfg = edgeConfigText().replace('"secrets": { "required": [', '"secrets": { "required": ["DV_NEW_REQUIRED_SECRET", ');
    expect(cfg).not.toBe(edgeConfigText());
    writeFileSync(path.join(dir, 'wrangler.jsonc'), cfg);
    writeFileSync(path.join(dir, 'src/env.ts'), envTsText().replace('export interface Env {\n', 'export interface Env {\n  /** A new Worker secret. */\n  NEW_WEBHOOK_SECRET?: string | undefined;\n'));
    const names = workerSecretNames(dir);
    expect(names).toContain('DV_NEW_REQUIRED_SECRET');
    expect(names).toContain('NEW_WEBHOOK_SECRET');
    for (const k of workerSecretNames()) expect(names, k).toContain(k);
  });
});

describe('env files beside the Worker config (BD-FIX-SEC-02)', () => {
  it('knows the file names wrangler reads, and never an example', () => {
    for (const f of ['.dev.vars', '.dev.vars.staging', '.env', '.env.local', '.env.staging', '.env.staging.local']) expect(isWorkerEnvFileName(f), f).toBe(true);
    for (const f of ['.dev.vars.example', '.env.example', 'dev.vars', 'wrangler.jsonc', '.envrc']) expect(isWorkerEnvFileName(f), f).toBe(false);
  });

  it('reads deny-listed names with a value from dotenv text, never a value, and skips empty ones and the rest', () => {
    const lines = [
      '# SUPABASE_SECRET_KEY=commented',
      'SUPABASE_SECRET_KEY=sb_secret_x',
      'export OPS_TOKEN = "abc"',
      'PLAY_TOKEN_HMAC=',
      'FAL_KEY=""',
      "ANTHROPIC_API_KEY=''",
      'QUOTA_NET_SALT_SECRET= # empty, then a comment',
      'FLAGS_JSON={"npc.dialogue":true}',
      'AWS_SECRET_ACCESS_KEY: yaml-style',
    ];
    const want = ['AWS_SECRET_ACCESS_KEY', 'OPS_TOKEN', 'SUPABASE_SECRET_KEY'];
    expect(secretNamesInDotenv(lines.join('\n'))).toEqual(want);
    // Line endings as wrangler's dotenv normalises them: \r\n, and a bare \r (K2-R1; split on \r?\n saw one line and no name).
    expect(secretNamesInDotenv(lines.join('\r\n'))).toEqual(want);
    expect(secretNamesInDotenv(lines.join('\r'))).toEqual(want);
    expect(secretNamesInDotenv(`SUPABASE_SECRET_KEY=${FAKE}\rOPS_TOKEN=${FAKE}\r`)).toEqual(['OPS_TOKEN', 'SUPABASE_SECRET_KEY']);
  });

  it('finds every env file that holds a name for the warning line (bare-CR files included), names only', () => {
    const dir = tempDir('dv-envfiles-');
    writeFileSync(path.join(dir, '.dev.vars'), `SUPABASE_SECRET_KEY=${FAKE}\nFLAGS_JSON={}\n`);
    writeFileSync(path.join(dir, '.dev.vars.staging'), `# bare CR\rPLAY_TOKEN_HMAC=${FAKE}\rANTHROPIC_API_KEY=${FAKE}\r`);
    writeFileSync(path.join(dir, '.env.staging'), `OPS_TOKEN=${FAKE}\r\n`);
    writeFileSync(path.join(dir, '.dev.vars.example'), `FAL_KEY=${FAKE}\n`);
    writeFileSync(path.join(dir, '.env.local'), 'SUPABASE_SECRET_KEY=\n');
    expect(secretEnvFiles(dir).map((h) => [path.basename(h.file), h.names])).toEqual([
      ['.dev.vars', ['SUPABASE_SECRET_KEY']],
      ['.dev.vars.staging', ['ANTHROPIC_API_KEY', 'PLAY_TOKEN_HMAC']],
      ['.env.staging', ['OPS_TOKEN']],
    ]);
  });

  it('workerSecretBlanks binds every known secret empty whatever the env files hold, warns per file, and only the exact opt-in skips it', () => {
    const all = Object.fromEntries(workerSecretNames().map((k) => [k, '']));
    expect(Object.keys(all).length).toBeGreaterThan(5);
    const empty = tempDir('dv-envfiles-none-');
    const lines: string[] = [];
    const log = (l: string): void => void lines.push(l);
    withOptIn(undefined, () => {
      // No env file at all: still every name, and no line.
      expect(workerSecretBlanks({ label: 't', envFileDir: empty, log })).toEqual(all);
      expect(lines).toEqual([]);
      // A file with one name, a bare-CR file with others: the bindings do not change; one loud line per file, names only.
      const dir = tempDir('dv-envfiles-');
      writeFileSync(path.join(dir, '.dev.vars'), `SUPABASE_SECRET_KEY=${FAKE}\n`);
      writeFileSync(path.join(dir, '.env'), `OPS_TOKEN=${FAKE}\rFAL_KEY=${FAKE}\r`);
      expect(workerSecretBlanks({ label: 't', envFileDir: dir, log })).toEqual(all);
      const hits = secretEnvFiles(dir);
      expect(hits.map((h) => h.names)).toEqual([['SUPABASE_SECRET_KEY'], ['FAL_KEY', 'OPS_TOKEN']]);
      expect(lines).toEqual(hits.map((h) => envFileLine('t', h, true)));
      for (const l of lines) expect(l).not.toContain(FAKE);
      // A file that wrangler would read but no scan understands (no deny-listed name found): still every name.
      writeFileSync(path.join(empty, '.dev.vars'), ` SUPABASE_SECRET_KEY${' '}=${FAKE}\n`);
      expect(workerSecretBlanks({ label: 't', envFileDir: empty, log: () => undefined })).toEqual(all);
      // Anything but exactly `1` is not the opt-in.
      expect(workerSecretBlanks({ label: 't', envFileDir: dir, log: () => undefined, env: { [ALLOW_LIVE_SECRETS_ENV]: 'true' } })).toEqual(all);
      // The opt-in: nothing is blanked, and every file line is the warning.
      lines.length = 0;
      expect(workerSecretBlanks({ label: 't', envFileDir: dir, log, env: { [ALLOW_LIVE_SECRETS_ENV]: '1' } })).toEqual({});
      expect(lines).toEqual(hits.map((h) => envFileLine('t', h, false)));
      expect(lines[0]).toContain(`WARNING ${ALLOW_LIVE_SECRETS_ENV}=1`);
      // `force` blanks even under the opt-in.
      expect(workerSecretBlanks({ label: 't', envFileDir: dir, log: () => undefined, env: { [ALLOW_LIVE_SECRETS_ENV]: '1' }, force: true })).toEqual(all);
    });
    // The default environment is process.env.
    withOptIn('1', () => expect(workerSecretBlanks({ label: 't', envFileDir: empty, log: () => undefined })).toEqual({}));
    expect(wranglerVarArgs({ SUPABASE_SECRET_KEY: '', OPS_TOKEN: '' })).toEqual(['--var', 'OPS_TOKEN:', '--var', 'SUPABASE_SECRET_KEY:']);
  });

  it('check:workers (services/edge/vitest.config.ts) binds workerSecretBlanks, not a list of its own', () => {
    const text = readFileSync(path.join(EDGE_DIR, 'vitest.config.ts'), 'utf8');
    expect(text).toContain("const secretBlanks = workerSecretBlanks({ label: 'check:workers vitest' });");
    expect(text).toContain('miniflare: { bindings: secretBlanks }');
    expect(text).toContain("exclude: ['test/db/**', 'test/node/**']");
  });

  it('NO_ENV_FILE as the only env file: wrangler loads neither .dev.vars nor .env (and does without it, so the probe is not vacuous)', () => {
    const wrangler = createRequire(path.join(EDGE_DIR, 'package.json'))('wrangler') as {
      unstable_getVarsForDev: (configPath: string, envFiles: string[] | undefined, vars: Record<string, string>, env: string | undefined, silent: boolean, secrets: { required: string[] }) => Record<string, { value?: unknown }>;
    };
    const fakeIn = (vars: Record<string, { value?: unknown }>): string[] => Object.keys(vars).filter((k) => vars[k]?.value === FAKE).sort();
    for (const [file, eol] of [['.dev.vars', '\n'], ['.dev.vars', '\r'], ['.dev.vars.staging', '\n'], ['.env', '\n'], ['.env', '\r'], ['.env.staging', '\n']] as const) {
      const dir = tempDir('dv-envfile-probe-');
      writeFileSync(path.join(dir, file), ENV_FILE_NAMES.map((k) => `${k}=${FAKE}`).join(eol));
      const configPath = path.join(dir, 'wrangler.jsonc');
      const secrets = { required: [...WORKER_LOCAL_SECRETS] };
      const label = `${file} ${JSON.stringify(eol)}`;
      expect(fakeIn(wrangler.unstable_getVarsForDev(configPath, undefined, {}, 'staging', true, secrets)), label).toEqual([...WORKER_LOCAL_SECRETS].sort());
      expect(fakeIn(wrangler.unstable_getVarsForDev(configPath, [NO_ENV_FILE], {}, 'staging', true, secrets)), label).toEqual([]);
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

  it('pnpm dev and pnpm dev:edge: no deny-listed name from the shell, and every known Worker secret is passed on empty, env file or not', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['dev']).toBe('tsx tools/ci/dev.ts');
    expect(pkg.scripts['dev:edge']).toBe('tsx tools/ci/dev.ts --edge');
    const blanks = wranglerVarArgs(Object.fromEntries(workerSecretNames().map((k) => [k, '']))).join(' ');
    expect(blanks).toContain('--var OPS_TOKEN: --var PLAY_TOKEN_HMAC: --var PLAY_TOKEN_HMAC_PREV: --var QUOTA_NET_SALT_SECRET: --var SUPABASE_SECRET_KEY:');
    const dir = tempDir('dv-dev-plan-');
    writeFileSync(path.join(dir, '.dev.vars'), `SUPABASE_SECRET_KEY=${FAKE}\rPLAY_TOKEN_HMAC=${FAKE}\rFLAGS_JSON={}\r`);
    writeFileSync(path.join(dir, '.env'), `OPS_TOKEN=${FAKE}\n`);
    for (const [envFileDir, fileLines] of [[dir, 2], [tempDir('dv-dev-plan-none-'), 0]] as const) {
      for (const edgeOnly of [false, true]) {
        const lines: string[] = [];
        const plan = devPlan({ edgeOnly, env: { ...fakeEnv(), PATH: '/usr/bin' }, envFileDir, log: (l) => lines.push(l) });
        expect(secretNamesIn(plan.env)).toEqual([]);
        expect(plan.env['PATH']).toBe('/usr/bin');
        expect(plan.wrangler.slice(0, 4)).toEqual(['dev', '--local', '--port', String(DEV_EDGE_PORT)]);
        expect(plan.wrangler.join(' ')).toContain(blanks);
        expect(plan.wrangler.includes('ANTHROPIC_MODE:fixture')).toBe(!edgeOnly);
        expect(lines.join('\n')).not.toContain(FAKE);
        expect(lines).toHaveLength(1 + fileLines); // the scrub line and one line per env file
      }
    }
    const lines: string[] = [];
    // The opt-in comes from the env the plan is given (process.env in `pnpm dev`).
    withOptIn(undefined, () => {
      const plan = devPlan({ edgeOnly: true, env: { ...fakeEnv(), [ALLOW_LIVE_SECRETS_ENV]: '1' }, envFileDir: dir, log: (l) => lines.push(l) });
      expect(secretNamesIn(plan.env)).toEqual([...FAKE_NAMES].sort());
      expect(plan.wrangler.join(' ')).not.toContain('--var');
      expect(lines.length).toBe(3);
      expect(lines.every((l) => l.includes(`WARNING ${ALLOW_LIVE_SECRETS_ENV}=1`))).toBe(true);
    });
  });
});
