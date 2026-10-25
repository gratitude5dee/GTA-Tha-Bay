/**
 * pnpm dev: Vite (QA flags on) and `wrangler dev` together. Vite proxies /api to the Worker on :8788.
 * pnpm dev:edge (`tsx tools/ci/dev.ts --edge`): `wrangler dev` alone on :8788, with the top-level vars as they are.
 * The Worker of `pnpm dev` runs with `ANTHROPIC_MODE=fixture` and `npc.dialogue` on (M06a3): the top-level wrangler vars are the production ones,
 * and a local run must never call Anthropic. To try the real model set `ANTHROPIC_MODE=live` and `ANTHROPIC_API_KEY` in `.dev.vars` and run
 * `DV_ALLOW_LIVE_SECRETS=1 pnpm dev:edge` (see below).
 * `--local` (remote bindings disabled) as in the Playwright web server: the Workers AI binding is remote-only, so without it wrangler needs
 * CLOUDFLARE_API_TOKEN just to start (BD-M06a4-15, BD-FIX-CI4-E01).
 *
 * No live secret by default (BD-FIX-SEC-02). The top-level config names the production SUPABASE_URL and lists SUPABASE_SECRET_KEY in
 * `secrets.required`, which wrangler loads from the process environment and from services/edge/.dev.vars or .env by itself. So every name of
 * tools/ci/secret-env.ts is removed from the environment the children get, and every such name an env file holds is passed on empty
 * (`--var NAME:`; every route treats an empty secret as absent), each with a loud stderr line naming the names (never a value).
 * DV_ALLOW_LIVE_SECRETS=1 passes them through, with a warning.
 *
 * Ctrl-C stops both; if either exits, the other is stopped and the exit code is passed on.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './run.ts';
import { envFileSecretOverrides, scrubbedEnv, wranglerVarArgs } from './secret-env.ts';

/** The port `pnpm dev` and `pnpm dev:edge` serve the Worker on (apps/web/vite.config.ts proxies /api to it). The e2e default is elsewhere. */
export const DEV_EDGE_PORT = 8788;

export interface DevPlan {
  /** The environment every child gets: the caller's without the deny-listed names (unless opted in). */
  env: Record<string, string | undefined>;
  /** The `wrangler` arguments (after `pnpm --filter @dv/edge exec`). */
  wrangler: string[];
}

/**
 * What `pnpm dev` (edgeOnly false) or `pnpm dev:edge` (edgeOnly true) starts. `edgeDir` is the Worker's config folder, whose env files are
 * read for names only; `log` receives the stderr lines.
 */
export function devPlan(opts: { edgeOnly: boolean; env: Readonly<Record<string, string | undefined>>; edgeDir?: string; log?: (line: string) => void }): DevPlan {
  const label = opts.edgeOnly ? 'dev:edge' : 'dev';
  const log = opts.log;
  const env = { ...scrubbedEnv(opts.env, { label, ...(log ? { log } : {}) }), WRANGLER_SEND_METRICS: 'false', ...(opts.edgeOnly ? {} : { VITE_DV_QA: '1' }) };
  const blanks = envFileSecretOverrides(opts.edgeDir ?? path.join(repoRoot, 'services/edge'), { label, ...(log ? { log } : {}) });
  const fixture = opts.edgeOnly ? [] : ['--var', 'ANTHROPIC_MODE:fixture', '--var', 'FLAGS_JSON:{"npc.dialogue":true}'];
  return { env, wrangler: ['dev', '--local', '--port', String(DEV_EDGE_PORT), ...fixture, ...wranglerVarArgs(blanks)] };
}

function main(argv: string[]): void {
  const edgeOnly = argv.includes('--edge');
  const plan = devPlan({ edgeOnly, env: process.env });
  const { env } = plan;
  const edge = (): ChildProcess => spawn('pnpm', ['--filter', '@dv/edge', 'exec', 'wrangler', ...plan.wrangler], { cwd: repoRoot, env, stdio: 'inherit' });
  const run = (children: ChildProcess[]): void => {
    const stop = (code: number): void => {
      for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
      process.exit(code);
    };
    for (const c of children) c.on('exit', (exitCode) => stop(exitCode ?? 1));
    process.on('SIGINT', () => stop(130));
    process.on('SIGTERM', () => stop(143));
  };
  if (edgeOnly) {
    run([edge()]);
    return;
  }
  const tokens = spawn('pnpm', ['--filter', '@dv/ui', 'run', 'tokens'], { cwd: repoRoot, env, stdio: 'inherit' });
  tokens.on('exit', (code) => {
    if (code !== 0) process.exit(code ?? 1);
    run([spawn('pnpm', ['--filter', '@dv/web', 'exec', 'vite'], { cwd: repoRoot, env, stdio: 'inherit' }), edge()]);
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
