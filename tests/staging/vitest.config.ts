import { defineConfig } from 'vitest/config';

// pnpm test:staging: suites against the deployed staging Worker (DV_STAGING_URL). Not collected by the root config.
export default defineConfig({
  test: { include: ['tests/staging/*.test.ts'], environment: 'node', testTimeout: 60_000, hookTimeout: 60_000 },
});
