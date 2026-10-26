/**
 * Workers-runtime tests for services/*.
 *
 *   tsx tools/ci/check-workers.ts [<suite> ...]    e.g. geo-gate, boot, telemetry-privacy, errors, headers
 *
 * Runs Vitest with the Cloudflare plugin inside services/edge (workerd), then the Node-side specs of services/edge/test/node (child
 * processes that workerd cannot start, such as the nested-runner secret probes, K2-R1) through services/edge/vitest.node.config.ts. Each
 * suite argument is a file-name filter applied to both; a part whose files none of the filters names is skipped, and the exit status is
 * the first failing part's.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, repoRoot } from './run.ts';
import { scrubProcessEnv } from './secret-env.ts';
import { FORWARDED_SIGNALS, spawnInTmpRoot } from './tmp-root.ts';

const EDGE = path.join(repoRoot, 'services/edge');

/** The spec files under `dir` (relative to services/edge, `/`-separated) ending in `.test.ts`. */
function specsUnder(dir: string): string[] {
  const root = path.join(EDGE, dir);
  if (!existsSync(root)) return [];
  return (readdirSync(root, { recursive: true }) as string[])
    .map((f) => `${dir}/${f.split(path.sep).join('/')}`)
    .filter((f) => f.endsWith('.test.ts'))
    .sort();
}

/** The workerd specs (services/edge/vitest.config.ts: test/**, except test/db and test/node) and the Node-side ones (test/node). */
export function edgeSpecs(): { workerd: string[]; node: string[] } {
  const node = specsUnder('test/node');
  const workerd = specsUnder('test').filter((f) => !f.startsWith('test/db/') && !f.startsWith('test/node/'));
  return { workerd, node };
}

/**
 * Which parts run for `argv`: the positional arguments are Vitest file filters (a substring of the path). Without one both parts run;
 * with some, a part runs only when a filter names one of its files. Flags pass to both.
 */
export function plan(argv: readonly string[], specs = edgeSpecs()): { workerd: boolean; node: boolean } {
  const filters = argv.filter((a) => !a.startsWith('-'));
  if (filters.length === 0) return { workerd: true, node: specs.node.length > 0 };
  const named = (files: string[]): boolean => files.some((f) => filters.some((x) => f.includes(x)));
  const workerd = named(specs.workerd);
  const node = named(specs.node);
  // A filter that names nothing: let the workerd Vitest report it (no test files found) as before.
  return { workerd: workerd || !node, node };
}

export async function main(argv: string[]): Promise<number> {
  // BD-FIX-TMP-01: Vitest, workerd and Miniflare work inside one per-run temporary root, removed when the run ends (pass, fail or
  // interrupt). The asynchronous spawn keeps the event loop free, so tsx's signal relay is acknowledged and SIGINT, SIGTERM and SIGHUP
  // are forwarded to Vitest, and to no other process, before the root is removed. Vitest starts from services/edge/node_modules/.bin (its shim execs node), with
  // that folder first on PATH as `pnpm exec` would put it, so a forwarded signal reaches Vitest itself rather than a pnpm in between.
  // BD-FIX-SEC-01: wrangler loads `secrets.required` from the process environment and the staging config names the production
  // SUPABASE_URL, so a live SUPABASE_SECRET_KEY in the shell gave the Worker under test a real database. Vitest, workerd and Miniflare
  // start without any secret name of tools/ci/secret-env.ts (DV_ALLOW_LIVE_SECRETS=1 opts in).
  scrubProcessEnv({ label: 'check:workers' });
  const binDir = path.join(EDGE, 'node_modules', '.bin');
  const bin = path.join(binDir, 'vitest');
  if (!existsSync(bin)) {
    console.error(`check:workers: ${bin} not found; run pnpm install`);
    return 2;
  }
  const env = { WRANGLER_SEND_METRICS: 'false', PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` };
  const parts = plan(argv);
  // An interrupt during the first part ends the run there: the second part never starts.
  let interrupted = false;
  const onSignal = (): void => void (interrupted = true);
  for (const s of FORWARDED_SIGNALS) process.on(s, onSignal);
  try {
    let code = 0;
    if (parts.workerd) code = await spawnInTmpRoot('workers', bin, ['run', ...argv], { cwd: EDGE, env, name: 'check:workers' });
    // K2-R1: the Node-side specs (nested runners) run after the workerd suites, also when those failed, so one run reports both.
    if (parts.node && !interrupted) {
      const nodeCode = await spawnInTmpRoot('workers', bin, ['run', '--config', 'vitest.node.config.ts', ...argv], { cwd: EDGE, env, name: 'check:workers node' });
      if (code === 0) code = nodeCode;
    }
    return code;
  } finally {
    for (const s of FORWARDED_SIGNALS) process.off(s, onSignal);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main(args()).then((code) => process.exit(code));
