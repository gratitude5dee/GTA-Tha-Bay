import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { scrubProcessEnv } from '../../tools/ci/secret-env.ts';
import { workerSecretBlanks } from '../../tools/ci/worker-secrets.ts';

// Workers-runtime tests (check:workers). The Worker runs in workerd with the vars below and an in-memory AE stub
// supplied by each test; test routes are compiled in, as in staging and previews.
// BD-FIX-SEC-01: a run started directly drops the live secret names before the pool (workerd, Miniflare, wrangler's `secrets.required`)
// reads the environment (tools/ci/secret-env.ts; DV_ALLOW_LIVE_SECRETS=1 opts in).
scrubProcessEnv({ label: 'check:workers vitest' });
// BD-FIX-SEC-02: the plugin also loads `secrets.required` from services/edge/.dev.vars(.staging) or .env*, which the scrub above cannot
// touch, and it has no env-file option. So every known Worker secret name (tools/ci/worker-secrets.ts: deploy.ts WORKER_SECRETS, every
// secrets.required list of wrangler.jsonc, the secret-like fields of src/env.ts) is ALWAYS bound to the empty string over what wrangler
// loaded (user Miniflare bindings win the merge), whatever an env file holds; a file with deny-listed names only adds a loud line naming
// them. Only the exact opt-in DV_ALLOW_LIVE_SECRETS=1 skips the blanking.
const secretBlanks = workerSecretBlanks({ label: 'check:workers vitest' });

export default defineConfig({
  define: { __DV_TEST_ROUTES__: 'true' },
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      wrangler: { configPath: './wrangler.jsonc', environment: 'staging' },
      // The AI binding (M06a4) is remote-only: the suites stub `env.AI` and never reach Workers AI, so no Cloudflare login is needed.
      remoteBindings: false,
      miniflare: { bindings: secretBlanks },
    }),
  ],
  // test/db holds the tests that need a database: they run under check:db (vitest.db.config.ts), not here. test/node holds Node-side
  // specs that start child processes: check:workers runs them after this suite through vitest.node.config.ts.
  // BD-FIX-TMP-01: one per-run temporary root for the run, removed at teardown (reused when check:workers already made one).
  test: { include: ['test/**/*.test.ts'], exclude: ['test/db/**', 'test/node/**'], globalSetup: ['../../tools/ci/vitest-tmp-root.ts'] },
});
