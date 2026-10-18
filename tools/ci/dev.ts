/**
 * pnpm dev: Vite (QA flags on) and `wrangler dev` together. Vite proxies /api to the Worker on :8788.
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
    spawn('pnpm', ['--filter', '@dv/edge', 'exec', 'wrangler', 'dev', '--port', '8788'], { cwd: repoRoot, env, stdio: 'inherit' }),
  ];
  const stop = (code: number): void => {
    for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
    process.exit(code);
  };
  for (const c of children) c.on('exit', (exitCode) => stop(exitCode ?? 1));
  process.on('SIGINT', () => stop(130));
  process.on('SIGTERM', () => stop(143));
});
