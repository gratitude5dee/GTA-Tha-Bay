import { defineConfig } from 'vitest/config';

// Node tests of the pipeline (M05b2): they use Miniflare through wrangler's getPlatformProxy, so they run outside workerd.
// `pnpm check:pipeline` runs them; the root Vitest config excludes services/*/test/**.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 60_000, hookTimeout: 60_000 },
});
