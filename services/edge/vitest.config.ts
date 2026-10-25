import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { envFileSecretOverrides, scrubProcessEnv } from '../../tools/ci/secret-env.ts';


// Workers-runtime tests (check:workers). The Worker runs in workerd with the vars below and an in-memory AE stub
// supplied by each test; test routes are compiled in, as in staging and previews.
// BD-FIX-SEC-01: a run started directly drops the live secret names before the pool (workerd, Miniflare, wrangler's `secrets.required`)
// reads the environment (tools/ci/secret-env.ts; DV_ALLOW_LIVE_SECRETS=1 opts in).
scrubProcessEnv({ label: 'check:workers vitest' });
// BD-FIX-SEC-02: the plugin also loads `secrets.required` from services/edge/.dev.vars(.staging) or .env*, which the scrub above cannot
// touch, and it has no env-file option. Every deny-listed name such a file holds is bound to the empty string over what wrangler loaded
// (user Miniflare bindings win the merge), with a loud line naming the file; the opt-in passes them through.
const envFileBlanks = envFileSecretOverrides(path.dirname(fileURLToPath(import.meta.url)), { label: 'check:workers vitest' });

export default defineConfig({
  define: { __DV_TEST_ROUTES__: 'true' },
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      wrangler: { configPath: './wrangler.jsonc', environment: 'staging' },
      // The AI binding (M06a4) is remote-only: the suites stub `env.AI` and never reach Workers AI, so no Cloudflare login is needed.
      remoteBindings: false,
      miniflare: { bindings: envFileBlanks },
    }),
  ],
  // test/db holds the tests that need a database: they run under check:db (vitest.db.config.ts), not here.
  // BD-FIX-TMP-01: one per-run temporary root for the run, removed at teardown (reused when check:workers already made one).
  test: { include: ['test/**/*.test.ts'], exclude: ['test/db/**'], globalSetup: ['../../tools/ci/vitest-tmp-root.ts'] },
});
