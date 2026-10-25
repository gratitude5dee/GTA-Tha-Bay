import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { secretNamesIn } from '../secret-env.ts';

/**
 * BD-FIX-SEC-01 probe. Skipped in a normal run; tools/ci/test/secret-env.test.ts starts Vitest on this file with DV_SECRET_PROBE=1 and a
 * fake value for every denied name, then reads the names this spec saw from DV_SECRET_PROBE_OUT. DV_SECRET_PROBE_EXPECT says what the
 * spec must see: `none` (the scrub ran) or `all` (DV_ALLOW_LIVE_SECRETS=1 let every name through).
 */
const PROBE = process.env['DV_SECRET_PROBE'] === '1';

describe.skipIf(!PROBE)('secret-env probe', () => {
  it('sees exactly the secret names the runner let through', () => {
    const seen = secretNamesIn(process.env);
    const out = process.env['DV_SECRET_PROBE_OUT'];
    if (out) writeFileSync(out, `${JSON.stringify({ seen })}\n`);
    const expected = process.env['DV_SECRET_PROBE_EXPECT'];
    if (expected === 'none') expect(seen).toEqual([]);
    else expect(seen.length).toBeGreaterThan(0);
  });
});
