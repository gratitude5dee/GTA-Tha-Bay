import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';


// Workers-runtime tests (check:workers). The Worker runs in workerd with the vars below and an in-memory AE stub
// supplied by each test; test routes are compiled in, as in staging and previews.
export default defineConfig({
  define: { __DV_TEST_ROUTES__: 'true' },
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      wrangler: { configPath: './wrangler.jsonc', environment: 'staging' },
      // The AI binding (M06a4) is remote-only: the suites stub `env.AI` and never reach Workers AI, so no Cloudflare login is needed.
      remoteBindings: false,
    }),
  ],
  // test/db holds the tests that need a database: they run under check:db (vitest.db.config.ts), not here.
  test: { include: ['test/**/*.test.ts'], exclude: ['test/db/**'] },
});
