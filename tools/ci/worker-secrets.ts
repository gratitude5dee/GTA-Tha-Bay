/**
 * The Worker's secret names, computed from their sources (BD-FIX-SEC-02).
 *
 * A Worker started by a test runner or by `pnpm dev` binds every one of these names to the empty string, always, whatever the env files
 * beside its config hold: services/edge/vitest.config.ts (`check:workers`, Miniflare bindings) and tools/ci/dev.ts (`pnpm dev`,
 * `pnpm dev:edge`, `--var NAME:`). Every route treats an empty secret as absent. Only the exact opt-in `DV_ALLOW_LIVE_SECRETS=1` skips
 * the blanking (with the warning).
 *
 * The list is the union of
 *   - WORKER_SECRETS of tools/ci/deploy.ts (what a deploy uploads),
 *   - every `secrets.required` list of services/edge/wrangler.jsonc (top level and each environment, previews included),
 *   - the secret-like fields of the Worker's Env interface in services/edge/src/env.ts (a name ending in KEY, TOKEN, SECRET or PASSWORD,
 *     or holding a SECRET, HMAC, JWK or TOKEN segment, or a field whose doc comment calls it a secret), less every name the config sets as
 *     a var (a var is public by definition: SUPABASE_URL, SUPABASE_ANON_KEY).
 * Nothing here is a hand-kept copy: a new secret in any of the three sources is blanked from then on.
 *
 * The env files are read only to print a warning line naming the file and the deny-listed names it holds (never a value); they decide
 * nothing (tools/ci/secret-env.ts secretEnvFiles).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsonc, WORKER_SECRETS } from './deploy.ts';
import { envFileLine, liveSecretsAllowed, secretEnvFiles, type ScrubOptions } from './secret-env.ts';

/** The edge Worker's config folder (services/edge). */
export const EDGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'services', 'edge');

type Json = unknown;

/** Walks a parsed wrangler config and calls `fn(key, value)` for every object member at any depth (top level, `env.*`, `previews`, …). */
function walk(node: Json, fn: (key: string, value: Json) => void): void {
  if (Array.isArray(node)) {
    for (const v of node) walk(v, fn);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node as Record<string, Json>)) {
    fn(k, v);
    walk(v, fn);
  }
}

/** Every name of every `secrets.required` list in a wrangler config text (JSONC), sorted and unique. */
export function wranglerRequiredSecrets(configText: string): string[] {
  const out = new Set<string>();
  walk(JSON.parse(stripJsonc(configText)) as Json, (k, v) => {
    if (k !== 'secrets' || v === null || typeof v !== 'object') return;
    const req = (v as { required?: unknown }).required;
    if (Array.isArray(req)) for (const n of req) if (typeof n === 'string') out.add(n);
  });
  return [...out].sort();
}

/** Every name a wrangler config text sets as a var (any `vars` object at any depth), sorted and unique. */
export function wranglerVarNames(configText: string): string[] {
  const out = new Set<string>();
  walk(JSON.parse(stripJsonc(configText)) as Json, (k, v) => {
    if (k === 'vars' && v !== null && typeof v === 'object' && !Array.isArray(v)) for (const n of Object.keys(v)) out.add(n);
  });
  return [...out].sort();
}

/**
 * The secret-like fields of the Env interface in an env.ts text: a name ending in KEY, TOKEN, SECRET or PASSWORD or holding a SECRET,
 * HMAC, JWK or TOKEN segment, or a field whose doc comment calls it a secret ("not a secret", "non-secret" and "public by design" do not
 * count). AUTH_PASSWORD_SIGNUP, an on/off switch, is none of these. Names in `exclude` (the config's vars) are left out.
 */
export function envTsSecretFields(envTsText: string, exclude: readonly string[] = []): string[] {
  const out: string[] = [];
  let doc = '';
  for (const line of envTsText.split('\n')) {
    if (/^\s*\/\*\*/.test(line)) doc = '';
    if (/^\s*(\/\*\*|\*)/.test(line)) doc += line;
    const m = /^\s{2}([A-Z][A-Z0-9_]*)\??:/.exec(line);
    if (!m) continue;
    const name = m[1] ?? '';
    const parts = name.split('_');
    const named = ['KEY', 'TOKEN', 'SECRET', 'PASSWORD'].includes(parts[parts.length - 1] ?? '') || parts.some((p) => ['SECRET', 'HMAC', 'JWK', 'TOKEN'].includes(p));
    const docSays = /\bsecret\b/i.test(doc.replace(/not a secret|non-secret|public by design/gi, ''));
    if ((named || docSays) && !exclude.includes(name)) out.push(name);
    doc = '';
  }
  return [...new Set(out)].sort();
}

export interface WorkerSecretSources {
  /** WORKER_SECRETS of tools/ci/deploy.ts. */
  deploy: readonly string[];
  /** Every `secrets.required` name of services/edge/wrangler.jsonc. */
  required: string[];
  /** The secret-like Env fields of services/edge/src/env.ts that are not config vars. */
  envTs: string[];
}

/** The three sources, read from disk (`edgeDir` defaults to services/edge). */
export function workerSecretSources(edgeDir: string = EDGE_DIR): WorkerSecretSources {
  const cfg = readFileSync(path.join(edgeDir, 'wrangler.jsonc'), 'utf8');
  const envTs = readFileSync(path.join(edgeDir, 'src', 'env.ts'), 'utf8');
  return { deploy: WORKER_SECRETS, required: wranglerRequiredSecrets(cfg), envTs: envTsSecretFields(envTs, wranglerVarNames(cfg)) };
}

/** Every known Worker secret name: the union of the three sources, sorted. */
export function workerSecretNames(edgeDir: string = EDGE_DIR): string[] {
  const s = workerSecretSources(edgeDir);
  return [...new Set([...s.deploy, ...s.required, ...s.envTs])].sort();
}

export interface BlankOptions extends ScrubOptions {
  /** The folder whose env files are scanned for the warning line (default services/edge). The names never depend on it. */
  envFileDir?: string;
  /** The environment that may carry the opt-in (default process.env). */
  env?: Readonly<Record<string, string | undefined>>;
}

/**
 * The bindings a local Worker gets: `{ NAME: '' }` for every known Worker secret name (workerSecretNames), always, unless the operator
 * opted in with exactly `DV_ALLOW_LIVE_SECRETS=1` (then `{}`; `force` blanks even then). Prints one warning line per env file in
 * `envFileDir` that holds a deny-listed name (names only); the files decide nothing.
 */
export function workerSecretBlanks(opts: BlankOptions): Record<string, string> {
  const log = opts.log ?? ((line: string): void => void process.stderr.write(`${line}\n`));
  const allowed = !opts.force && liveSecretsAllowed(opts.env ?? process.env);
  for (const hit of secretEnvFiles(opts.envFileDir ?? EDGE_DIR)) log(envFileLine(opts.label, hit, !allowed));
  if (allowed) return {};
  return Object.fromEntries(workerSecretNames().map((k) => [k, '']));
}
