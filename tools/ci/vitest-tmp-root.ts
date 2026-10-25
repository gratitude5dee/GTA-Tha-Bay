/**
 * Root Vitest globalSetup (BD-FIX-TMP-01): the run works inside one per-run temporary root (tools/ci/tmp-root.ts).
 *
 * globalSetup runs in the main Vitest process before any test worker starts, so the TMPDIR, TEMP and TMP set here are copied into
 * every worker (forks and threads both copy `process.env` at start) and into the processes the specs spawn; `os.tmpdir()` reads TMPDIR
 * on every call, so each `mkdtempSync(path.join(os.tmpdir(), …))` lands inside the root. The returned teardown runs after the last
 * file, whether specs passed or failed, and removes the root; a process-exit hook covers a run that dies before it. Started by
 * `tools/ci/run.ts`, Vitest finds `DV_TEST_TMP_ROOT` already set, reuses that root and leaves the removal to run.ts.
 */
import { enterTmpRoot } from './tmp-root.ts';

export default function setup(): () => void {
  const t = enterTmpRoot('vitest');
  return () => t.cleanup();
}
