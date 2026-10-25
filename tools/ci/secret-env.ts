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
 */

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
 * the e2e config sets CLOUDFLARE_CF_FETCH_PATH (a file path, not a secret).
 */
export const SECRET_ENV_NAMES = ['FAL_KEY', 'QUOTA_NET_SALT_SECRET', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_KEY', 'DV_NAMES_REAL_JSON'] as const;

/**
 * Prefixes denied to tests. SUPABASE_ covers SUPABASE_SECRET_KEY, SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, SUPABASE_PROJECT_ID_*
 * and every other SUPABASE_* name: no spec reads a SUPABASE_* variable from the environment (the Worker's public SUPABASE_URL and
 * SUPABASE_ANON_KEY are wrangler vars, not environment), so none is kept. PLAY_TOKEN_HMAC covers PLAY_TOKEN_HMAC_PREV; ANTHROPIC_
 * covers the runtime, builder and evals keys; OPENAI_ the moderation key; ID_SIGNING_JWK_ the current and next signing keys; R2_ the
 * public and private bucket keys.
 */
export const SECRET_ENV_PREFIXES = ['SUPABASE_', 'PLAY_TOKEN_HMAC', 'ANTHROPIC_', 'OPENAI_', 'INTERNAL_HMAC', 'ID_SIGNING_JWK_', 'R2_'] as const;

/** Set (to `1`) once a process printed the opt-in warning, so the runners it starts do not repeat it. */
const WARNED_ENV = 'DV_LIVE_SECRETS_WARNED';

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

function warnOnce(env: Record<string, string | undefined>, label: string, names: readonly string[], log: (line: string) => void): void {
  if (names.length === 0 || env[WARNED_ENV] === '1') return;
  log(optInWarning(label, names));
  env[WARNED_ENV] = '1';
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
    warnOnce(out, opts.label, names, log);
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
    warnOnce(process.env, opts.label, names, log);
    return [];
  }
  for (const k of names) delete process.env[k];
  if (names.length > 0 && !opts.force) log(scrubLine(opts.label, names));
  return names;
}
