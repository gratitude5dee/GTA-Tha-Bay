import { defineConfig } from 'vitest/config';
import { scrubProcessEnv } from '../../tools/ci/secret-env.ts';

// BD-FIX-SEC-01: a run started directly drops the live secret names before any spec reads the environment (tools/ci/secret-env.ts;
// DV_ALLOW_LIVE_SECRETS=1 opts in). DV_DB_API_URL and DV_DB_SECRET_KEY (the local stack check:db started) are not on the list.
scrubProcessEnv({ label: 'check:db vitest' });

// DB-backed tests (check:db): plain Node, no workerd. They need DV_DB_API_URL and DV_DB_SECRET_KEY.
export default defineConfig({
  test: {
    include: ['test/db/**/*.db.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    // BD-FIX-TMP-01: one per-run temporary root for the run, removed at teardown.
    globalSetup: ['../../tools/ci/vitest-tmp-root.ts'],
  },
});
