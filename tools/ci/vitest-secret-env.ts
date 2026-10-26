/**
 * Root Vitest setup file (BD-FIX-SEC-01): runs in every test worker before each spec file is imported and removes the secret names of
 * tools/ci/secret-env.ts from `process.env`, unless DV_ALLOW_LIVE_SECRETS=1. The root vitest.config.ts already scrubs the main process at
 * config load, before any worker forks, and tools/ci/run.ts scrubs before Vitest starts; this layer covers a worker that got its
 * environment some other way.
 */
import { scrubProcessEnv } from './secret-env.ts';

scrubProcessEnv({ label: 'vitest setup' });
