import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Probe for tools/ci/test/tmp-root.spec.ts (BD-FIX-TMP-01): that spec starts a nested Vitest on this file with DV_TMP_PROBE_OUT set;
 * the probe records the per-run root it ran in and leaves a temp folder behind on purpose. In an ordinary run it is skipped.
 */
const out = process.env.DV_TMP_PROBE_OUT;

describe.skipIf(!out)('tmp-root probe (driven by tmp-root.spec.ts)', () => {
  it('records the per-run root and leaves a temp folder in it', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dv-probe-'));
    writeFileSync(path.join(dir, 'left-behind.txt'), 'not cleaned up by the spec\n');
    writeFileSync(out as string, JSON.stringify({ root: process.env.DV_TEST_TMP_ROOT, tmpdir: os.tmpdir(), dir }));
    if (process.env.DV_TMP_PROBE_FAIL === '1') expect.fail('probe failure requested (DV_TMP_PROBE_FAIL=1)');
  });
});
