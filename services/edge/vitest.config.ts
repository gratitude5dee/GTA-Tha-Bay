import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// The staging config lists OPS_TOKEN as a required secret; the tests pass their own token per request, and this placeholder
// only keeps wrangler from warning about it (config load runs in Node).
const nodeEnv = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
if (nodeEnv) nodeEnv['OPS_TOKEN'] ??= 'vitest-placeholder';

// Workers-runtime tests (check:workers). The Worker runs in workerd with the vars below and an in-memory AE stub
// supplied by each test; test routes are compiled in, as in staging and previews.
export default defineConfig({
  define: { __DV_TEST_ROUTES__: 'true' },
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      wrangler: { configPath: './wrangler.jsonc', environment: 'staging' },
    }),
  ],
  test: { include: ['test/**/*.test.ts'] },
});
