/**
 * Workers-runtime tests for services/*.
 *
 *   tsx tools/ci/check-workers.ts [<suite> ...]    e.g. geo-gate, boot, telemetry-privacy, errors, headers
 *
 * Runs Vitest with the Cloudflare plugin inside services/edge (workerd). Each suite argument is a file-name filter.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, repoRoot } from './run.ts';

export function main(argv: string[]): number {
  const res = spawnSync('pnpm', ['exec', 'vitest', 'run', ...argv], {
    cwd: path.join(repoRoot, 'services/edge'),
    stdio: 'inherit',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (res.error) {
    console.error(`check:workers failed to start: ${res.error.message}`);
    return 1;
  }
  return res.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(args()));
