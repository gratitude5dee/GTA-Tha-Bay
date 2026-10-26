import { defineConfig } from 'vitest/config';
import { scrubProcessEnv } from '../../tools/ci/secret-env.ts';

// BD-FIX-SEC-01: a run started directly drops the live secret names before any spec reads the environment (tools/ci/secret-env.ts;
// DV_ALLOW_LIVE_SECRETS=1 opts in).
scrubProcessEnv({ label: 'check:workers node' });

// Node-side specs of check:workers (BD-FIX-SEC-02, K2-R1): test/node holds the heavy probes that start real test runners (nested Vitest,
// check:workers with workerd) as child processes, which workerd cannot do. tools/ci/check-workers.ts runs them after the workerd suites;
// `pnpm check:unit` never collects them (the root config excludes services/*/test/**).
export default defineConfig({
  test: {
    include: ['test/node/**/*.test.ts'],
    environment: 'node',
    // Each case starts one to three nested runners; they run one file at a time so they do not compete for the 2-vCPU runner.
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 120_000,
    // BD-FIX-TMP-01: one per-run temporary root for the run, removed at teardown (reused when check:workers already made one).
    globalSetup: ['../../tools/ci/vitest-tmp-root.ts'],
  },
});
