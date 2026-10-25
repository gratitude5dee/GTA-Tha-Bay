import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: [...configDefaults.exclude, 'tests/e2e/**', 'tests/perf/**', 'tests/staging/**', 'services/*/test/**', '**/dist/**', '.claude/**', 'third_party/**'],
    environment: 'node',
    // BD-FIX-TMP-01: one per-run temporary root (TMPDIR/TEMP/TMP) for the run and its workers, removed at teardown.
    globalSetup: ['tools/ci/vitest-tmp-root.ts'],
    // ESLint-driven lint tests and the 10,000-string FNV reference take 5-10 s on a loaded 2-vCPU runner (the 5 s default timed out on the untouched base).
    testTimeout: 30_000,
    passWithNoTests: false,
  },
});
