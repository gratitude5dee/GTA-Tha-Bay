import { defineConfig } from '@playwright/test';
import base, { QA_PLAY_STORAGE } from './playwright.config.ts';

/**
 * `check:perf` (tools/ci/perf-check.ts): the CPU-side budget scenarios in tests/perf, on the two guaranteed software-GL
 * projects. The server, the QA build and the browsers come from the main config.
 */
export default defineConfig({
  ...base,
  testDir: 'tests/perf',
  // The perf scenarios load straight into play through the QA play bypass (M04b1).
  use: { ...base.use, storageState: QA_PLAY_STORAGE },
  outputDir: 'test-results/pw-perf',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  projects: (base.projects ?? []).filter((p) => p.name === 'chromium-webgl2' || p.name === 'webkit-webgl2'),
});
