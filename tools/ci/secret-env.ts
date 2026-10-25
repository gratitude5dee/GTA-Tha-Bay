/**
 * Test runs never see a live secret (BD-FIX-SEC-01).
 *
 * Incident 2026-10-24/25: Builder shells in the cloud environment exported the owner's production values (Supabase service key, database
 * password, access token, play-token HMAC, quota salt, fal key, R2 keys). `check:workers` handed them to the Worker under test, whose
 * staging wrangler config names the production SUPABASE_URL as a var, so non-harness specs built a real Supabase client against
 * production (1,184 PostgREST requests; all 404 on the empty schema). A bare `unset` in one shell does not carry to the next.
 *
 * This module is the one source of truth for the names a test process must not inherit. Every test runner removes them from the
 * environment it hands on:
 *   - tools/ci/run.ts for `vitest` and `playwright` (`check:unit`, `check:e2e`, `check:e2e:xr`, every package `test` / `test:*` script);
 *   - tools/ci/check-workers.ts (`check:workers`), tools/ci/perf-check.ts (`check:perf`), tools/ci/check-db.ts (`check:db`, the local
 *     Supabase stack and its DataPort contract run; DV_DB_* pass, they name the local stack), services/pipeline/scripts/check-pipeline.ts;
 *   - as a second layer for a runner started directly: the root vitest.config.ts (at config load, before any worker forks, and again in
 *     each worker through the setup file tools/ci/vitest-secret-env.ts, before any spec is imported), services/edge/vitest.config.ts,
 *     services/edge/vitest.db.config.ts, services/pipeline/vitest.config.ts and playwright.config.ts (so its web server, `wrangler dev`,
 *     and its workers start without them).
 * Tools that need a secret on purpose are not test runners and are untouched: `names:lint`, `npc:lint`, `npc:eval` (DV_NAMES_REAL_JSON
 * in ci.yml), `db:push`, `deploy:*`, `test:staging` (talks to the deployed staging Worker over HTTP), the asset and map CLIs.
 *
 * Opt-in: `DV_ALLOW_LIVE_SECRETS=1` passes every name through, with a loud warning on stderr. No CI job sets it.
 * Output: one stderr line per process that removed something, naming (never valuing) what was removed.
 *
 * Env files (BD-FIX-SEC-02). wrangler and @cloudflare/vitest-plugin also load the Worker's secrets from the files beside its config:
 * services/edge/.dev.vars (or .dev.vars.<env>), else .env, .env.local, .env.<env> and .env.<env>.local. Removing names from the process
 * environment does not touch those, so:
 *   - the e2e web server (playwright.config.ts), the second Worker of tests/e2e/npc-builder.spec.ts and check:pipeline's
 *     getPlatformProxy load no env file at all (`--env-file` / `envFiles` set to NO_ENV_FILE), as on the CI runner;
 *   - check:workers (services/edge/vitest.config.ts; the plugin has no env-file option) and `pnpm dev` / `pnpm dev:edge` (tools/ci/dev.ts)
 *     bind every deny-listed name an env file holds to the empty string (Miniflare bindings, `--var NAME:`), with a loud stderr line
 *     naming the file and the names; every route treats an empty secret as absent. DV_ALLOW_LIVE_SECRETS=1 passes them through, with
 *     the warning.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { devNull } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The operator's explicit opt-in: exactly `1` lets live secrets reach the tests. */
export const ALLOW_LIVE_SECRETS_ENV = 'DV_ALLOW_LIVE_SECRETS';

/**
 * The secret names the local Worker loads from the process environment by itself: `secrets.required` of the top-level config in
 * services/edge/wrangler.jsonc (https://developers.cloudflare.com/workers/configuration/secrets/). playwright.config.ts passes these on
 * empty to `wrangler dev` whenever they are still set (only possible with the opt-in), BD-FIX-CI8-H02; tools/ci/test/workflows.test.ts
 * keeps the list equal to the config.
 */
export const WORKER_LOCAL_SECRETS = ['SUPABASE_SECRET_KEY', 'PLAY_TOKEN_HMAC', 'QUOTA_NET_SALT_SECRET', 'ANTHROPIC_API_KEY', 'OPENAI_MODERATION_API_KEY', 'ANTHROPIC_BUILDER_KEY'] as const;

/**
 * Exact names denied to tests: CLAUDE.md "Secrets" (deploy, optional and later keys), tools/ci/deploy.ts WORKER_SECRETS and
 * WORKER_LOCAL_SECRETS (both also covered by the prefixes below), and DV_NAMES_REAL_JSON (CI passes it only to names:lint, npc:lint and
 * npc:eval, which are not test runners; the specs that touch it pass their own fake list). CLOUDFLARE_* is matched by exact name because
 * the e2e config sets CLOUDFLARE_CF_FETCH_PATH (a file path, not a secret). OPS_TOKEN and ELEVENLABS_API_KEY are Worker secrets of
 * services/edge/src/env.ts; the AWS_* names are what S3-compatible SDKs read by default.
 */
export const SECRET_ENV_NAMES = [
  'FAL_KEY',
  'QUOTA_NET_SALT_SECRET',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_KEY',
  'DV_NAMES_REAL_JSON',
  // Worker secrets of services/edge/src/env.ts not covered by a prefix (BD-FIX-SEC-02): the staff bearer of the production admin routes and the
  // t2 voice key. tools/ci/test/secret-env.test.ts checks every secret-like field of env.ts against this list.
  'OPS_TOKEN',
  'ELEVENLABS_API_KEY',
  // The default credential names of S3-compatible SDKs (BD-FIX-SEC-02): R2 keys exported under them would reach an S3 client in a test.
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
] as const;

/**
 * Prefixes denied to tests. SUPABASE_ covers SUPABASE_SECRET_KEY, SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, SUPABASE_PROJECT_ID_*
 * and every other SUPABASE_* name: no spec reads a SUPABASE_* variable from the environment (the Worker's public SUPABASE_URL and
 * SUPABASE_ANON_KEY are wrangler vars, not environment), so none is kept. PLAY_TOKEN_HMAC covers PLAY_TOKEN_HMAC_PREV; ANTHROPIC_
 * covers the runtime, builder and evals keys; OPENAI_ the moderation key; ID_SIGNING_JWK_ the current and next signing keys; R2_ the
 * public and private bucket keys.
 */
export const SECRET_ENV_PREFIXES = ['SUPABASE_', 'PLAY_TOKEN_HMAC', 'ANTHROPIC_', 'OPENAI_', 'INTERNAL_HMAC', 'ID_SIGNING_JWK_', 'R2_'] as const;

/** True when `name` is denied to test processes. */
export function isSecretEnvName(name: string): boolean {
  return (SECRET_ENV_NAMES as readonly string[]).includes(name) || SECRET_ENV_PREFIXES.some((p) => name.startsWith(p));
}

/** The denied names that `env` holds (any defined value, the empty string included), sorted. */
export function secretNamesIn(env: Readonly<Record<string, string | undefined>>): string[] {
  return Object.keys(env)
    .filter((k) => env[k] !== undefined && isSecretEnvName(k))
    .sort();
}

/** True when the operator opted in with `DV_ALLOW_LIVE_SECRETS=1`. */
export function liveSecretsAllowed(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[ALLOW_LIVE_SECRETS_ENV] === '1';
}

export interface ScrubOptions {
  /** Who is scrubbing, for the stderr line (`run.ts`, `check:workers`, `vitest`, …). */
  label: string;
  /** Where the one line goes; default stderr. */
  log?: (line: string) => void;
  /** Remove the names even with the opt-in, and print nothing (a spec that starts its own Worker, for example). */
  force?: boolean;
}

/** The stderr line naming what was removed (names only). */
export function scrubLine(label: string, names: readonly string[]): string {
  return `${label}: removed ${names.length} deny-listed secret variable(s) from the test environment: ${names.join(', ')} (BD-FIX-SEC-01; ${ALLOW_LIVE_SECRETS_ENV}=1 passes them through)`;
}

/** The loud warning printed when the opt-in lets names through (names only). */
export function optInWarning(label: string, names: readonly string[]): string {
  return `${label}: WARNING ${ALLOW_LIVE_SECRETS_ENV}=1: ${names.length} live secret variable(s) reach the tests: ${names.join(', ')}. Tests can now call production services. Unset ${ALLOW_LIVE_SECRETS_ENV} unless you mean it.`;
}

/**
 * Prints the opt-in warning whenever the opt-in lets a name through. Every process prints it, nested runners included: no variable can
 * silence it (BD-FIX-SEC-02; an inherited "already warned" marker used to).
 */
function warnOptIn(label: string, names: readonly string[], log: (line: string) => void): void {
  if (names.length > 0) log(optInWarning(label, names));
}

const stderr = (line: string): void => void process.stderr.write(`${line}\n`);

/**
 * A copy of `env` without the denied names, unless the operator opted in (then a copy with a warning). Prints one line naming what was
 * removed when anything was. `env` itself is never changed.
 */
export function scrubbedEnv(env: Readonly<Record<string, string | undefined>>, opts: ScrubOptions): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  const names = secretNamesIn(env);
  const log = opts.log ?? stderr;
  if (!opts.force && liveSecretsAllowed(env)) {
    warnOptIn(opts.label, names, log);
    return out;
  }
  for (const k of names) delete out[k];
  if (names.length > 0 && !opts.force) log(scrubLine(opts.label, names));
  return out;
}

/**
 * Removes the denied names from `process.env` in place (unless the operator opted in), so that this process and every process it starts
 * from now on runs without them. Returns the removed names.
 */
export function scrubProcessEnv(opts: ScrubOptions): string[] {
  const names = secretNamesIn(process.env);
  const log = opts.log ?? stderr;
  if (!opts.force && liveSecretsAllowed(process.env)) {
    warnOptIn(opts.label, names, log);
    return [];
  }
  for (const k of names) delete process.env[k];
  if (names.length > 0 && !opts.force) log(scrubLine(opts.label, names));
  return names;
}

/**
 * The env file that is no file: passed as wrangler's only `--env-file` (or getPlatformProxy's only `envFiles` entry), it stops wrangler
 * from reading .dev.vars, .dev.vars.<env> and every default .env file (BD-FIX-SEC-02). The process environment is still read, and it is
 * scrubbed.
 */
export const NO_ENV_FILE = devNull;

/** True for the file names wrangler may read local secrets from: `.dev.vars`, `.dev.vars.<env>`, `.env`, `.env.<anything>`; never `*.example`. */
export function isWorkerEnvFileName(name: string): boolean {
  return /^\.(dev\.vars|env)(\..+)?$/.test(name) && !name.endsWith('.example');
}

/**
 * The deny-listed names that a dotenv text assigns a non-empty value to (names only; values are never returned). Over-matching is safe:
 * every name found is only ever blanked.
 */
export function secretNamesInDotenv(text: string): string[] {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*[=:]\s*(.*)$/.exec(line);
    if (!m || !isSecretEnvName(m[1] ?? '')) continue;
    const value = (m[2] ?? '').trim();
    if (value === '' || value === '""' || value === "''" || value.startsWith('#')) continue;
    names.add(m[1] ?? '');
  }
  return [...names].sort();
}

export interface EnvFileSecrets {
  /** The file, relative to the repository root when it lies under it. */
  file: string;
  /** The deny-listed names it holds, sorted. */
  names: string[];
}

/** Every env file in `dir` (a Worker's config folder) that holds a deny-listed name with a value, sorted by file name. */
export function secretEnvFiles(dir: string): EnvFileSecrets[] {
  if (!existsSync(dir)) return [];
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const out: EnvFileSecrets[] = [];
  for (const name of readdirSync(dir).filter(isWorkerEnvFileName).sort()) {
    const full = path.join(dir, name);
    let text: string;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue; // a directory or an unreadable file: wrangler cannot read it either
    }
    const names = secretNamesInDotenv(text);
    if (names.length > 0) out.push({ file: full.startsWith(`${root}${path.sep}`) ? path.relative(root, full) : full, names });
  }
  return out;
}

/** The loud stderr line for an env file whose deny-listed names are blanked (names only). */
export function envFileLine(label: string, hit: EnvFileSecrets, blanked: boolean): string {
  return blanked
    ? `${label}: WARNING ${hit.file} holds ${hit.names.length} deny-listed secret name(s): ${hit.names.join(', ')}. The Worker gets them empty (BD-FIX-SEC-02). Never put production values in that file; ${ALLOW_LIVE_SECRETS_ENV}=1 passes them through.`
    : `${label}: WARNING ${ALLOW_LIVE_SECRETS_ENV}=1: ${hit.file} holds ${hit.names.length} live secret name(s) that reach the Worker: ${hit.names.join(', ')}. Tests and local Workers can now call production services.`;
}

/**
 * The bindings that blank every deny-listed name an env file in `dir` holds: `{ NAME: '' }` per name, merged over the bindings wrangler
 * loads. Empty when no file holds one, and under the opt-in (then with the warning). Prints one loud line per file that holds names.
 */
export function envFileSecretOverrides(dir: string, opts: ScrubOptions): Record<string, string> {
  const log = opts.log ?? stderr;
  const hits = secretEnvFiles(dir);
  const allowed = !opts.force && liveSecretsAllowed(process.env);
  if (!opts.force) for (const hit of hits) log(envFileLine(opts.label, hit, !allowed));
  if (allowed) return {};
  return Object.fromEntries(hits.flatMap((h) => h.names).map((k) => [k, '']));
}

/** wrangler `--var NAME:` arguments for `overrides` (each value is empty, so `NAME:` binds the empty string). */
export function wranglerVarArgs(overrides: Readonly<Record<string, string>>): string[] {
  return Object.keys(overrides)
    .sort()
    .flatMap((k) => ['--var', `${k}:${overrides[k] ?? ''}`]);
}
