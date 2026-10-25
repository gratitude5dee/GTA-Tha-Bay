import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Probe for tools/ci/test/tmp-root.spec.ts (BD-FIX-TMP-01): that spec starts a nested Vitest on this file with DV_TMP_PROBE_OUT set;
 * the probe records the per-run root it ran in and leaves a temp folder behind on purpose. With DV_TMP_PROBE_HOLD_MS set it then waits
 * that long, so the interrupt test can signal the run while the folder exists. For the first 3 s of the wait it is busy in synchronous
 * code, like a worker in the middle of a heavy spec, recreating `<folder>/tick` with a recursive mkdir every 25 ms: such a worker cannot
 * run its signal handler, outlives the interrupted Vitest main process, and brings back a root removed too early (seen with tools/map).
 * In an ordinary run it is skipped.
 */
const out = process.env.DV_TMP_PROBE_OUT;

describe.skipIf(!out)('tmp-root probe (driven by tmp-root.spec.ts)', () => {
  it('records the per-run root and leaves a temp folder in it', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dv-probe-'));
    writeFileSync(path.join(dir, 'left-behind.txt'), 'not cleaned up by the spec\n');
    writeFileSync(out as string, JSON.stringify({ root: process.env.DV_TEST_TMP_ROOT, tmpdir: os.tmpdir(), dir }));
    if (process.env.DV_TMP_PROBE_FAIL === '1') expect.fail('probe failure requested (DV_TMP_PROBE_FAIL=1)');
    const hold = Number(process.env.DV_TMP_PROBE_HOLD_MS ?? 0);
    if (hold > 0) {
      const busyUntil = Date.now() + Math.min(hold, 3000);
      while (Date.now() < busyUntil) {
        mkdirSync(path.join(dir, 'tick'), { recursive: true });
        const next = Date.now() + 25;
        while (Date.now() < next) {
          // Busy on purpose: no event-loop turn, so no signal handler runs.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, hold));
    }
  }, 120_000);
});
