import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * BD-FIX-SEC-01: the Worker under test holds no secret from the shell. wrangler loads the names of `secrets.required` from the process
 * environment by itself, and the staging config names the production SUPABASE_URL, so a live SUPABASE_SECRET_KEY in the shell gave
 * these suites a real database (incident 2026-10-24/25). tools/ci/check-workers.ts removes every name of tools/ci/secret-env.ts before
 * Vitest starts. tools/ci/test/secret-env.test.ts starts `check:workers -- secret-env-probe` with the value below for every denied name;
 * in a normal run no binding carries it and the spec passes the same way.
 */
const FAKE = 'test-not-a-secret';

describe('secret-env probe (BD-FIX-SEC-01)', () => {
  it('no binding of the Worker under test carries a value from the shell', () => {
    const bindings = env as unknown as Record<string, unknown>;
    expect(Object.keys(bindings).filter((k) => bindings[k] === FAKE)).toEqual([]);
  });
});
