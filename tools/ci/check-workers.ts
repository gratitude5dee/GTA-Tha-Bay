/**
 * Workers-runtime tests for services/*.
 *
 *   tsx tools/ci/check-workers.ts [<suite> ...]    e.g. geo-gate, boot, telemetry-privacy, errors, headers
 *
 * Runs Vitest with the Cloudflare plugin inside services/edge (workerd). Each suite argument is a file-name filter.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, repoRoot } from './run.ts';
import { spawnInTmpRoot } from './tmp-root.ts';

export function main(argv: string[]): Promise<number> {
  // BD-FIX-TMP-01: Vitest, workerd and Miniflare work inside one per-run temporary root, removed when the run ends (pass, fail or
  // interrupt). The asynchronous spawn keeps the event loop free, so tsx's signal relay is acknowledged and SIGINT, SIGTERM and SIGHUP
  // are forwarded to the run before the root is removed. Vitest starts from services/edge/node_modules/.bin (its shim execs node), with
  // that folder first on PATH as `pnpm exec` would put it, so a forwarded signal reaches Vitest itself rather than a pnpm in between.
  const cwd = path.join(repoRoot, 'services/edge');
  const binDir = path.join(cwd, 'node_modules', '.bin');
  const bin = path.join(binDir, 'vitest');
  if (!existsSync(bin)) {
    console.error(`check:workers: ${bin} not found; run pnpm install`);
    return Promise.resolve(2);
  }
  return spawnInTmpRoot('workers', bin, ['run', ...argv], {
    cwd,
    env: { WRANGLER_SEND_METRICS: 'false', PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` },
    name: 'check:workers',
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main(args()).then((code) => process.exit(code));
