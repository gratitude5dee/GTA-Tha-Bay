/**
 * pnpm test:staging [-- <suite>] (M05d): the suites of tests/staging against the deployed staging Worker.
 *
 *   tsx tools/ci/test-staging.ts [keepalive|smoke ...]    (no suite: all)
 *
 * DV_STAGING_URL names the Worker (default https://tha-bay-web-staging.gratitude-8f4.workers.dev). Suites:
 *   keepalive  one database select through POST /api/v1/_test/run-scheduled?job=keepalive (the nightly run; keeps the Free project awake)
 *   smoke      GET /api/v1/health and GET /api/v1/boot on the staging host
 *   npc-cache  (M06a3) a 3-turn conversation with npc_test: cache reads from turn 2, TTFT to tests/reports/npc/ttft.json;
 *              prints SKIP and runs nothing without ANTHROPIC_API_KEY. Not part of the default run: it spends real model tokens.
 * M12a1 adds rls-thirdparty.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { args, repoRoot } from './run.ts';

export const SUITES = ['keepalive', 'smoke', 'npc-cache'] as const;
export type Suite = (typeof SUITES)[number];
export const DEFAULT_STAGING_URL = 'https://tha-bay-web-staging.gratitude-8f4.workers.dev';

/** Pure: the suites to run, or the unknown names. */
export function selectSuites(argv: readonly string[]): { suites: Suite[]; unknown: string[] } {
  const names = argv.filter((a) => !a.startsWith('-'));
  if (names.length === 0) return { suites: SUITES.filter((s) => s !== 'npc-cache'), unknown: [] };
  const unknown = names.filter((n) => !(SUITES as readonly string[]).includes(n));
  return { suites: names.filter((n): n is Suite => (SUITES as readonly string[]).includes(n)), unknown };
}

export function main(argv: string[], env: NodeJS.ProcessEnv = process.env): number {
  const { suites, unknown } = selectSuites(argv);
  if (unknown.length > 0) {
    console.error(`test:staging: unknown suite ${unknown.join(', ')}; known: ${SUITES.join(', ')}`);
    return 1;
  }
  const res = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'tests/staging/vitest.config.ts', ...suites.map((s) => `tests/staging/${s}.test.ts`)],
    { cwd: repoRoot, stdio: 'inherit', env: { ...env, DV_STAGING_URL: env['DV_STAGING_URL'] || DEFAULT_STAGING_URL } },
  );
  if (res.error) {
    console.error(`test:staging failed to start: ${res.error.message}`);
    return 1;
  }
  return res.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(args()));
