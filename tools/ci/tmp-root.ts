/**
 * Per-run temporary root for test runs (BD-FIX-TMP-01).
 *
 * Specs and the tools they drive call `mkdtempSync(path.join(os.tmpdir(), 'dv-…-'))` and many never remove the folder, so one
 * afternoon of Builder runs left ~15,000 `/tmp/dv-*` folders (16 GB). Every test runner now works inside one folder per run:
 * `<os.tmpdir()>/dv-<label>-<pid>-XXXXXX`. TMPDIR, TEMP and TMP point at it, so `os.tmpdir()` resolves inside it in the runner,
 * in its workers (forked processes and worker threads copy `process.env` when they start) and in every subprocess they spawn.
 * The folder is removed when the run ends, whether it passed or failed.
 *
 * Who creates it: `tools/ci/run.ts` (vitest, playwright: `check:unit`, `check:e2e`, package `test` scripts), `check:workers`
 * (`tools/ci/check-workers.ts`), the root Vitest globalSetup (`tools/ci/vitest-tmp-root.ts`, also in the `services/edge` and
 * `services/pipeline` configs) and `playwright.config.ts` at config load. `check:perf` (`tools/ci/perf-check.ts`) is not changed: it
 * starts Playwright with `playwright.perf.config.ts`, which imports `playwright.config.ts`, so each Playwright run it starts makes and
 * removes its own root. Whoever comes first creates the root, writes the marker file `.dv-tmp-root` into it (creator pid and the
 * identity of its PID namespace) and publishes it in `DV_TEST_TMP_ROOT`; a nested runner that finds a valid one set (a Vitest started
 * by run.ts, a Playwright worker) reuses it and leaves the removal to its creator. Valid means: absolute, named like a per-run root, an
 * existing real folder, carrying a marker from this PID namespace, and its creator's pid alive. Anything else (`/tmp`, `/`, a typo, a
 * root leaked by an earlier run and left exported in a shell) is ignored with a warning and a fresh root is made, so an outside value
 * never turns containment off and never adopts a folder nobody would remove.
 *
 * Interrupts: run.ts and check-workers.ts start their tool with an asynchronous spawn (`spawnInTmpRoot`), so their event loop stays
 * free and tsx's signal relay gets its acknowledgement. SIGINT, SIGTERM and SIGHUP are forwarded to that one child; once it has exited,
 * the root is removed and the exit code is the child's (128 + signal when a signal ended it). Nothing here ever signals a process it
 * did not start: what the child started is the child's tool's business (the tool stops its own workers).
 *
 * Stale roots: nothing catches SIGKILL, so a run killed that way (or by a hard timeout or the OOM killer) leaves its root behind, and the
 * next run's creator removes it: before making its own root it sweeps the `dv-<label>-<pid>-XXXXXX` folders directly in its temp folder
 * that are owned by this user and whose marker shows a creator that cannot be alive: the same PID namespace and the same pid with that
 * pid dead (`process.kill(pid, 0)` throws ESRCH), or an earlier boot of this machine (another Linux boot id). A root from another PID
 * namespace of this boot (a container or sandbox sharing /tmp, where `process.kill(pid, 0)` cannot see the creator), a live pid's root,
 * an unmarked folder and anything that fails the name are never touched. Removal touches only a real folder with the per-run name
 * directly inside the expected parent.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The environment variable that names the active per-run root. */
export const TMP_ROOT_ENV = 'DV_TEST_TMP_ROOT';
/** The variables `os.tmpdir()` and other tools read (POSIX reads TMPDIR; Windows TEMP, then TMP). */
export const TMP_VARS = ['TMPDIR', 'TEMP', 'TMP'] as const;
/** Basename of a per-run root: `dv-<label>-<pid>-` plus mkdtemp's six characters (group 1 is the creator's pid). */
export const TMP_ROOT_NAME = /^dv-[a-z0-9]+-(\d+)-[A-Za-z0-9]{6}$/;
/** The signals run.ts and check-workers.ts forward to their own child before removing the root. */
export const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
/** The marker file every per-run root carries: JSON `{ ns, pid, label }` (see `runtimeIdentity`). */
export const TMP_ROOT_MARKER = '.dv-tmp-root';

let identity: string | null | undefined;

/**
 * The identity of the PID namespace this process runs in, or null when it cannot be read. `process.kill(pid, 0)` only answers for pids
 * of this namespace, so a root may be judged by its pid only when its marker carries the same identity. Linux:
 * `linux:<boot_id or hostname>:<readlink /proc/self/ns/pid>` (the boot id keeps a namespace inode reused after a reboot apart, and
 * marks roots of earlier boots as stale, see `bootId`); other systems have no PID namespaces: `<platform>:<hostname>`.
 */
export function runtimeIdentity(): string | null {
  if (identity !== undefined) return identity;
  if (process.platform !== 'linux') return (identity = `${process.platform}:${os.hostname()}`);
  try {
    const ns = readlinkSync('/proc/self/ns/pid');
    let boot: string;
    try {
      boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    } catch {
      boot = os.hostname();
    }
    identity = `linux:${boot}:${ns}`;
  } catch {
    identity = null;
  }
  return identity;
}

const BOOT_ID = /^linux:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):/;

/**
 * The Linux boot id inside a `runtimeIdentity` string, or null when it has none (another system, or the hostname fallback used where
 * /proc/sys/kernel/random/boot_id cannot be read). Every PID namespace of one boot shares the boot id, so a marker with another one was
 * written before the last reboot and its creator cannot be alive.
 */
export function bootId(ns: string | null): string | null {
  return (ns === null ? null : BOOT_ID.exec(ns)?.[1]) ?? null;
}

/** The marker of the per-run root `root` (namespace identity and creator pid), or null when it is missing or unreadable. */
export function readTmpRootMarker(root: string): { ns: string | null; pid: number } | null {
  try {
    const m = JSON.parse(readFileSync(path.join(root, TMP_ROOT_MARKER), 'utf8')) as { ns?: unknown; pid?: unknown };
    if (typeof m.pid !== 'number' || (m.ns !== null && typeof m.ns !== 'string')) return null;
    return { ns: m.ns, pid: m.pid };
  } catch {
    return null;
  }
}

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
  writeFileSync(path.join(root, TMP_ROOT_MARKER), `${JSON.stringify({ ns: runtimeIdentity(), pid: process.pid, label })}\n`);
  let done = false;
  const cleanup = (): void => {
    if (done) return;
    done = true;
    removeTmpRoot(root, parent);
  };
  return { root, cleanup };
}

/**
 * Removes `root` recursively, but only when it is a per-run root directly inside `parent`: the name matches `TMP_ROOT_NAME`, it is a real
 * folder (not a symlink or a file) and its real path is `<realpath(parent)>/<name>`. A root that is already gone is a no-op.
 */
export function removeTmpRoot(root: string, parent: string): void {
  const abs = path.resolve(root);
  const refuse = (why: string): Error => new Error(`tmp-root: refusing to remove ${abs}: ${why}`);
  if (path.dirname(abs) !== path.resolve(parent) || !TMP_ROOT_NAME.test(path.basename(abs))) {
    throw refuse(`not a per-run root inside ${parent}`);
  }
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    return;
  }
  if (st.isSymbolicLink() || !st.isDirectory()) throw refuse('not a real folder');
  if (realpathSync(abs) !== path.join(realpathSync(parent), path.basename(abs))) throw refuse(`it does not resolve inside ${parent}`);
  rmSync(abs, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/**
 * Why `p` cannot be used as an inherited per-run root, or null when it can: absolute, a per-run name, an existing real folder, a marker
 * from this PID namespace naming the same pid, and that creator still alive. The last checks keep a root leaked by an earlier run, or
 * one made in another container, from being adopted: a reused root is never removed by the process that reuses it.
 */
export function checkTmpRoot(p: string): string | null {
  if (!path.isAbsolute(p)) return 'not an absolute path';
  const name = TMP_ROOT_NAME.exec(path.basename(p));
  if (!name) return 'not named like a per-run root (dv-<label>-<pid>-XXXXXX)';
  let st;
  try {
    st = lstatSync(p);
  } catch {
    return 'does not exist';
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return 'not a real folder';
  const marker = readTmpRootMarker(p);
  if (marker === null) return `no readable ${TMP_ROOT_MARKER} marker (not made by tools/ci/tmp-root.ts)`;
  if (marker.ns !== runtimeIdentity()) return 'made in another PID namespace or an earlier boot';
  const pid = Number(name[1]);
  if (marker.pid !== pid) return `its marker names pid ${marker.pid}, not ${pid}`;
  if (pid !== process.pid && !pidAlive(pid)) return `its creator (pid ${pid}) is not running: a root left by an earlier run`;
  return null;
}

/** True unless signalling `pid` fails with ESRCH (no such process); EPERM (another user's process) counts as alive. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * True when the creator recorded in a root's marker cannot be alive, judged from this namespace `ns`: the marker names the same pid as
 * the folder and either this PID namespace with that pid dead, or another Linux boot (both identities carry a boot id and they differ).
 */
function creatorGone(marker: { ns: string | null; pid: number }, pid: number, ns: string): boolean {
  if (marker.pid !== pid) return false;
  if (marker.ns === ns) return !pidAlive(pid);
  const ours = bootId(ns);
  const theirs = bootId(marker.ns);
  return ours !== null && theirs !== null && ours !== theirs;
}

const sweepWarned = new Set<string>();

/**
 * Removes the per-run roots left directly in `base` (default `os.tmpdir()`) by runs that died without cleaning up (SIGKILL, a hard
 * timeout, a reboot): every real folder named `dv-<label>-<pid>-XXXXXX`, owned by this user, whose marker names the same pid and whose
 * creator cannot be alive (`creatorGone`: this PID namespace and the pid dead, or an earlier boot). Skipped without a word: anything that
 * fails the name, files, symlinks, other users' folders, folders without a readable marker, live pids' roots and roots made in another
 * PID namespace of this boot (a container or sandbox that shares the temp folder: its live pids are invisible here, so its root would
 * look stale). Nothing is swept when this namespace cannot be identified. Removal goes through `removeTmpRoot`, so its realpath and name
 * guards apply; a removal that fails is reported once per process. Returns the removed paths.
 */
export function sweepStaleTmpRoots(base: string = os.tmpdir()): string[] {
  const ns = runtimeIdentity();
  if (ns === null) return [];
  let real: string;
  let names: string[];
  try {
    real = realpathSync(base);
    names = readdirSync(real);
  } catch {
    return [];
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const removed: string[] = [];
  for (const name of names) {
    const pid = Number(TMP_ROOT_NAME.exec(name)?.[1] ?? NaN);
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) continue;
    const abs = path.join(real, name);
    try {
      const st = lstatSync(abs);
      if (st.isSymbolicLink() || !st.isDirectory() || (uid !== null && st.uid !== uid)) continue;
    } catch {
      continue;
    }
    const marker = readTmpRootMarker(abs);
    if (marker === null || !creatorGone(marker, pid, ns)) continue;
    try {
      removeTmpRoot(abs, real);
      removed.push(abs);
    } catch (err) {
      if (sweepWarned.has(abs)) continue;
      sweepWarned.add(abs);
      console.warn(`tmp-root: stale root ${abs} left in place: ${(err as Error).message}`);
    }
  }
  if (removed.length > 0) console.warn(`tmp-root: removed ${removed.length} stale per-run root(s) of dead runs in ${real}`);
  return removed;
}

/**
 * Makes this process (and everything it starts from now on) use a per-run root. Reuses the root named by `DV_TEST_TMP_ROOT` when it is
 * a valid one (`checkTmpRoot`); an invalid value is ignored with a warning (when TMPDIR names that same folder, the fresh root goes next
 * to it rather than inside it). Otherwise sweeps stale roots of dead runs from the temp folder, creates a fresh root, sets
 * `DV_TEST_TMP_ROOT`, TMPDIR, TEMP and TMP, and registers a removal at process exit as a backstop for runners that never reach their
 * teardown.
 */
export function enterTmpRoot(label: string): TmpRoot {
  const inherited = process.env[TMP_ROOT_ENV];
  let base = os.tmpdir();
  if (inherited) {
    const why = checkTmpRoot(inherited);
    if (why === null) {
      // A nested runner: make sure the variables agree with the inherited root (a caller may have reset TMPDIR), never remove it.
      for (const [k, v] of Object.entries(tmpRootEnv(inherited))) process.env[k] = v;
      return { root: inherited, owned: false, cleanup: () => {} };
    }
    console.warn(`tmp-root: ignoring ${TMP_ROOT_ENV}=${inherited}: ${why}; making a fresh per-run root`);
    // A leaked root left exported with TMPDIR pointing into it: work next to it, so that the sweep there can remove it.
    if (path.isAbsolute(inherited) && TMP_ROOT_NAME.test(path.basename(inherited)) && path.resolve(base) === path.resolve(inherited)) {
      base = path.dirname(path.resolve(inherited));
    }
  }
  sweepStaleTmpRoots(base);
  const saved = Object.fromEntries([TMP_ROOT_ENV, ...TMP_VARS].map((k) => [k, process.env[k]]));
  const created = createTmpRoot(label, base);
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

/**
 * Runs `cmd` asynchronously inside a per-run root (see `enterTmpRoot`) and resolves with its exit code, or 128 + the signal number when
 * a signal ended it. Because the event loop stays free while the tool runs, tsx's signal relay is acknowledged. SIGINT, SIGTERM and
 * SIGHUP are forwarded to this one child and to no other process; once it has exited, the root is removed (only when this call created
 * it: a root reused from `DV_TEST_TMP_ROOT` belongs to an enclosing run, which removes it). Used by run.ts and check-workers.ts.
 */
export function spawnInTmpRoot(
  label: string,
  cmd: string,
  argv: readonly string[],
  opts: { cwd: string; env?: Record<string, string>; name?: string },
): Promise<number> {
  const t = enterTmpRoot(label);
  const name = opts.name ?? 'tmp-root';
  return new Promise<number>((resolve) => {
    let child: ChildProcess | undefined;
    let settled = false;
    const forward = (sig: NodeJS.Signals): void => {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      try {
        child.kill(sig);
      } catch {
        // The child exited between the check and the kill; its exit handler finishes the run.
      }
    };
    // While a listener is registered, a signal does not end this process: it waits for its child, then removes the root.
    for (const s of FORWARDED_SIGNALS) process.on(s, forward);
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      try {
        t.cleanup();
      } catch (err) {
        console.error(`${name}: ${(err as Error).message}`);
      }
      for (const s of FORWARDED_SIGNALS) process.off(s, forward);
      resolve(code);
    };
    try {
      child = spawn(cmd, [...argv], { stdio: 'inherit', cwd: opts.cwd, env: { ...process.env, ...opts.env } });
    } catch (err) {
      console.error(`${name}: failed to start ${cmd}: ${(err as Error).message}`);
      finish(1);
      return;
    }
    child.on('error', (err) => {
      if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) return; // a failed kill, not a failed start
      console.error(`${name}: failed to start ${cmd}: ${err.message}`);
      finish(1);
    });
    child.once('exit', (code, signal) => finish(code ?? (signal ? 128 + (os.constants.signals[signal] ?? 0) : 1)));
  });
}
