/**
 * pnpm dev: Vite (QA flags on) and `wrangler dev` together. Vite proxies /api to the Worker on :8788.
 * The Worker runs with `ANTHROPIC_MODE=fixture` and `npc.dialogue` on (M06a3): the top-level wrangler vars are the production ones, and a local
 * run must never call Anthropic. To try the real model set `ANTHROPIC_MODE=live` and `ANTHROPIC_API_KEY` in `.dev.vars` and run `pnpm dev:edge`.
 * `--local` (remote bindings disabled) as in `dev:edge` and the Playwright web server: the Workers AI binding is remote-only, so
 * without it wrangler needs CLOUDFLARE_API_TOKEN just to start (BD-M06a4-15, BD-FIX-CI4-E01).
 * Ctrl-C stops both; if either exits, the other is stopped and the exit code is passed on.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { repoRoot } from './run.ts';

const env = { ...process.env, VITE_DV_QA: '1', WRANGLER_SEND_METRICS: 'false' };

const tokens = spawn('pnpm', ['--filter', '@dv/ui', 'run', 'tokens'], { cwd: repoRoot, env, stdio: 'inherit' });
tokens.on('exit', (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const children: ChildProcess[] = [
    spawn('pnpm', ['--filter', '@dv/web', 'exec', 'vite'], { cwd: repoRoot, env, stdio: 'inherit' }),
    spawn('pnpm', ['--filter', '@dv/edge', 'exec', 'wrangler', 'dev', '--local', '--port', '8788', '--var', 'ANTHROPIC_MODE:fixture', '--var', 'FLAGS_JSON:{"npc.dialogue":true}'], { cwd: repoRoot, env, stdio: 'inherit' }),
  ];
  const stop = (code: number): void => {
    for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
    process.exit(code);
  };
  for (const c of children) c.on('exit', (exitCode) => stop(exitCode ?? 1));
  process.on('SIGINT', () => stop(130));
  process.on('SIGTERM', () => stop(143));
});
