import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { scrubProcessEnv } from '../../tools/ci/secret-env.ts';

// Node tests of the pipeline (M05b2): they use Miniflare through wrangler's getPlatformProxy, so they run outside workerd.
// `pnpm check:pipeline` runs them; the root Vitest config excludes services/*/test/**.
// BD-FIX-SEC-01: a run started directly drops the live secret names before the pool (workerd, Miniflare, wrangler's `secrets.required`)
// reads the environment (tools/ci/secret-env.ts; DV_ALLOW_LIVE_SECRETS=1 opts in).
scrubProcessEnv({ label: 'pipeline vitest' });

export default defineConfig({
  // M05c4: the off-edge scenarios construct the real CutsceneJobDO of services/edge in Node over a fake DurableObjectState;
  // its `cloudflare:workers` import resolves to a stub.
  resolve: { alias: { 'cloudflare:workers': path.resolve(import.meta.dirname, 'test/stubs/cloudflare-workers.ts') } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // BD-FIX-TMP-01: one per-run temporary root for the run, removed at teardown.
    globalSetup: ['../../tools/ci/vitest-tmp-root.ts'],
  },
});
