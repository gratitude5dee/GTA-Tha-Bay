import { defineConfig } from 'vitest/config';

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
