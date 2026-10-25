/**
 * Per-run temporary root for test runs (BD-FIX-TMP-01).
 *
 * Specs and the tools they drive call `mkdtempSync(path.join(os.tmpdir(), 'dv-…-'))` and many never remove the folder, so one
 * afternoon of Builder runs left ~15,000 `/tmp/dv-*` folders (16 GB). Every test runner now works inside one folder per run:
 * `<os.tmpdir()>/dv-<label>-<pid>-XXXXXX`. TMPDIR, TEMP and TMP point at it, so `os.tmpdir()` resolves inside it in the runner,
 * in its workers (forked processes and worker threads copy `process.env` when they start) and in every subprocess they spawn.
 * The folder is removed when the run ends, whether it passed or failed.
 *
 * Who creates it: `tools/ci/run.ts` (vitest, playwright), `check:workers`, `check:perf`, the root Vitest globalSetup
 * (`tools/ci/vitest-tmp-root.ts`) and the Playwright config. Whoever comes first creates it and publishes it in
 * `DV_TEST_TMP_ROOT`; a nested runner that finds it set (a Vitest started by run.ts, a Playwright worker) reuses it and leaves the
 * removal to its creator. Removal touches only the folder this process created, never anything outside it.
 */
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The environment variable that names the active per-run root. */
export const TMP_ROOT_ENV = 'DV_TEST_TMP_ROOT';
/** The variables `os.tmpdir()` and other tools read (POSIX reads TMPDIR; Windows TEMP, then TMP). */
export const TMP_VARS = ['TMPDIR', 'TEMP', 'TMP'] as const;
/** Basename of a per-run root: `dv-<label>-<pid>-` plus mkdtemp's six characters. */
export const TMP_ROOT_NAME = /^dv-[a-z0-9]+-\d+-[A-Za-z0-9]{6}$/;

export interface TmpRoot {
  /** Absolute, symlink-resolved path of the per-run root. */
  readonly root: string;
  /** True when this call created the root (and so owns its removal); false when it reused one from `DV_TEST_TMP_ROOT`. */
  readonly owned: boolean;
  /** Restores the variables and, when owned, removes the root recursively. Idempotent. */
  readonly cleanup: () => void;
}

/** The environment entries that point a child process at `root`. */
export function tmpRootEnv(root: string): Record<string, string> {
  return { [TMP_ROOT_ENV]: root, ...Object.fromEntries(TMP_VARS.map((k) => [k, root])) };
}

/**
 * Creates a fresh per-run root under `base` (default `os.tmpdir()`) without touching `process.env`. The cleanup removes exactly that
 * folder and refuses any other path.
 */
export function createTmpRoot(label: string, base: string = os.tmpdir()): { root: string; cleanup: () => void } {
  if (!/^[a-z0-9]+$/.test(label)) throw new Error(`tmp-root: label must be [a-z0-9]+, got ${label}`);
  const root = realpathSync(mkdtempSync(path.join(base, `dv-${label}-${process.pid}-`)));
  const parent = path.dirname(root);
  let done = false;
  const cleanup = (): void => {
    if (done) return;
    done = true;
    removeTmpRoot(root, parent);
  };
  return { root, cleanup };
}

/** Removes `root` recursively, but only when it is a per-run root directly inside `parent`. */
export function removeTmpRoot(root: string, parent: string): void {
  const abs = path.resolve(root);
  if (path.dirname(abs) !== path.resolve(parent) || !TMP_ROOT_NAME.test(path.basename(abs))) {
    throw new Error(`tmp-root: refusing to remove ${abs}: not a per-run root inside ${parent}`);
  }
  rmSync(abs, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/**
 * Makes this process (and everything it starts from now on) use a per-run root. Reuses the root named by `DV_TEST_TMP_ROOT` when it
 * exists; otherwise creates one, sets `DV_TEST_TMP_ROOT`, TMPDIR, TEMP and TMP, and registers a removal at process exit as a backstop
 * for runners that never reach their teardown.
 */
export function enterTmpRoot(label: string): TmpRoot {
  const inherited = process.env[TMP_ROOT_ENV];
  if (inherited && existsSync(inherited)) {
    // A nested runner: make sure the variables agree with the inherited root (a caller may have reset TMPDIR), never remove it.
    for (const [k, v] of Object.entries(tmpRootEnv(inherited))) process.env[k] = v;
    return { root: inherited, owned: false, cleanup: () => {} };
  }
  const saved = Object.fromEntries([TMP_ROOT_ENV, ...TMP_VARS].map((k) => [k, process.env[k]]));
  const created = createTmpRoot(label);
  for (const [k, v] of Object.entries(tmpRootEnv(created.root))) process.env[k] = v;
  let done = false;
  const cleanup = (): void => {
    if (done) return;
    done = true;
    process.off('exit', cleanup);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    created.cleanup();
  };
  process.on('exit', cleanup);
  return { root: created.root, owned: true, cleanup };
}

/** Runs `fn` inside a per-run root (see `enterTmpRoot`) and cleans up afterwards, also when `fn` throws. */
export function withTmpRoot<T>(label: string, fn: (root: string) => T): T {
  const t = enterTmpRoot(label);
  try {
    return fn(t.root);
  } finally {
    t.cleanup();
  }
}
