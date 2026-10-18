import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx', 'packages/*/test/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, 'tests/e2e/**', 'tests/perf/**', 'services/*/test/**', '**/dist/**', '.claude/**'],
    environment: 'node',
    passWithNoTests: false,
  },
});
