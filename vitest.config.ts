import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: [...configDefaults.exclude, 'tests/e2e/**', 'tests/perf/**', 'services/*/test/**', '**/dist/**', '.claude/**'],
    environment: 'node',
    // ESLint-driven lint tests and the 10,000-string FNV reference take 5-10 s on a loaded 2-vCPU runner (the 5 s default timed out on the untouched base).
    testTimeout: 30_000,
    passWithNoTests: false,
  },
});
