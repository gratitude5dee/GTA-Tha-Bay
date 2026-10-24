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
 *   npc-tts    (M06a4) one sentence voiced by Aura-1 and Aura-2 through the staging Worker's AI binding; codec, size and latency go to
 *              tests/reports/npc/tts.json (U-NPC-05). Not part of the default run. `--render-creator` also renders the eight creator voice samples
 *              (tools/soul/src/creator-voices.ts); without CLOUDFLARE_API_TOKEN it prints SKIP and writes no clip.
 * M12a1 adds rls-thirdparty.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { args, repoRoot } from './run.ts';

export const SUITES = ['keepalive', 'smoke', 'npc-cache', 'npc-tts'] as const;
export type Suite = (typeof SUITES)[number];
export const DEFAULT_STAGING_URL = 'https://tha-bay-web-staging.gratitude-8f4.workers.dev';

/** Pure: the suites to run, or the unknown names. */
export function selectSuites(argv: readonly string[]): { suites: Suite[]; unknown: string[] } {
  const names = argv.filter((a) => !a.startsWith('-'));
  if (names.length === 0) return { suites: SUITES.filter((s) => s !== 'npc-cache' && s !== 'npc-tts'), unknown: [] };
  const unknown = names.filter((n) => !(SUITES as readonly string[]).includes(n));
  return { suites: names.filter((n): n is Suite => (SUITES as readonly string[]).includes(n)), unknown };
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const { suites, unknown } = selectSuites(argv);
  if (unknown.length > 0) {
    console.error(`test:staging: unknown suite ${unknown.join(', ')}; known: ${SUITES.join(', ')}`);
    return 1;
  }
  // A skipped vitest file swallows its own console output, so the SKIP line (CLAUDE.md: secret absent) is printed here.
  if (suites.includes('npc-cache') && !env['ANTHROPIC_API_KEY']) console.log('SKIP npc-cache: ANTHROPIC_API_KEY not set (staging stays in fixture mode; U-NPC-01 and U-NPC-02 stay open)');
  const res = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'tests/staging/vitest.config.ts', ...suites.map((s) => `tests/staging/${s}.test.ts`)],
    { cwd: repoRoot, stdio: 'inherit', env: { ...env, DV_STAGING_URL: env['DV_STAGING_URL'] || DEFAULT_STAGING_URL } },
  );
  if (res.error) {
    console.error(`test:staging failed to start: ${res.error.message}`);
    return 1;
  }
  let code = res.status ?? 1;
  // M06a4: the creator's voice samples. SKIP (nothing written) without CLOUDFLARE_API_TOKEN; a failed render fails the run.
  if (suites.includes('npc-tts') && argv.includes('--render-creator')) {
    const { renderCreatorVoices } = await import('../soul/src/creator-voices.ts');
    const r = await renderCreatorVoices({ root: repoRoot, env, log: (l) => console.log(l) });
    if (r === 'failed') code = 1;
  }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main(args()).then((c) => process.exit(c));
