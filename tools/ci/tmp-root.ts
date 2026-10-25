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
 * free: tsx's signal relay gets its acknowledgement, SIGINT, SIGTERM and SIGHUP are forwarded to the tool, and once the tool has exited
 * and the processes it left in the root have stopped (Vitest's fork workers outlive an interrupted Vitest main process for a moment and
 * would recreate folders in a removed root), the root is removed. tsx still SIGKILLs its child when the acknowledgement misses its
 * 30 ms window (seen once under a load of about 14 on 4 vCPUs), and nothing catches SIGKILL, so every creator also starts a guard
 * (`tools/ci/tmp-root-guard.ts`): a detached process in a session of its own, so Ctrl-C and a group SIGKILL do not reach it, that holds
 * the read end of a pipe whose write end only the creator has. When the creator dies by any means the pipe closes; the guard then
 * drains and removes the root (a no-op after a normal cleanup). Last, every creator first sweeps stale roots directly in its temp
 * folder: `dv-<label>-<pid>-XXXXXX` folders owned by this user whose marker names this PID namespace and whose pid is no longer alive.
 * A root from another PID namespace (a container or sandbox sharing /tmp, where `process.kill(pid, 0)` cannot see the creator), a live
 * pid's root, an unmarked folder and anything that fails the name are never touched. Removal touches only a real folder with the
 * per-run name directly inside the expected parent.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The environment variable that names the active per-run root. */
export const TMP_ROOT_ENV = 'DV_TEST_TMP_ROOT';
/** The variables `os.tmpdir()` and other tools read (POSIX reads TMPDIR; Windows TEMP, then TMP). */
export const TMP_VARS = ['TMPDIR', 'TEMP', 'TMP'] as const;
/** Basename of a per-run root: `dv-<label>-<pid>-` plus mkdtemp's six characters (group 1 is the creator's pid). */
export const TMP_ROOT_NAME = /^dv-[a-z0-9]+-(\d+)-[A-Za-z0-9]{6}$/;
/** The signals run.ts and check-workers.ts forward to their tool before removing the root. */
export const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
/** The marker file every per-run root carries: JSON `{ ns, pid, label }` (see `runtimeIdentity`). */
export const TMP_ROOT_MARKER = '.dv-tmp-root';

let identity: string | null | undefined;

/**
 * The identity of the PID namespace this process runs in, or null when it cannot be read. `process.kill(pid, 0)` only answers for pids
 * of this namespace, so a root may be judged by its pid only when its marker carries the same identity. Linux:
 * `linux:<boot_id or hostname>:<readlink /proc/self/ns/pid>` (the boot id keeps a namespace inode reused after a reboot apart); other
 * systems have no PID namespaces: `<platform>:<hostname>`.
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
  if (marker.ns !== runtimeIdentity()) return 'made in another PID namespace (a container or sandbox sharing the temp folder)';
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

const sweepWarned = new Set<string>();

/**
 * Removes the per-run roots left directly in `base` (default `os.tmpdir()`) by runs that died without cleaning up (SIGKILL, a hard
 * timeout, a guard that could not start): every real folder named `dv-<label>-<pid>-XXXXXX`, owned by this user, whose marker names
 * this PID namespace (`runtimeIdentity`) and the same pid, and whose pid is not alive (`process.kill(pid, 0)` throws ESRCH). Skipped
 * without a word: anything that fails the name, files, symlinks, other users' folders, folders without a readable marker and roots made
 * in another PID namespace (a container or sandbox that shares the temp folder: its live pids are invisible here, so its root would look
 * stale). A live pid's root is never touched, and nothing is swept when this namespace cannot be identified. Removal goes through
 * `removeTmpRoot`, so its realpath and name guards apply; a removal that fails is reported once per process. Returns the removed paths.
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
    if (marker === null || marker.ns !== ns || marker.pid !== pid || pidAlive(pid)) continue;
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

/** The guard program (see the header): `node tools/ci/tmp-root-guard.ts <root> <parent>`, its stdin a pipe from the creator. */
export const GUARD_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tmp-root-guard.ts');

/**
 * Starts the guard for `root`: a detached process (a session of its own, so Ctrl-C and a group kill miss it) that waits for its stdin
 * to close, which happens when this process dies by any means or calls the returned `release()`, then drains and removes the root.
 * Its environment is the one from before the root was entered, so it is never mistaken for a process working in the root. Node runs the
 * TypeScript file directly (type stripping; built in from Node 22.18, behind the flag before that); where that fails the guard just
 * exits and the next run's sweep is the fallback.
 */
function startGuard(root: string, parent: string): () => void {
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', GUARD_SCRIPT, root, parent], {
      cwd: parent,
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      env: { ...process.env },
    });
  } catch {
    return () => {};
  }
  const stdin = child.stdin;
  child.on('error', () => {});
  stdin?.on('error', () => {});
  // Neither the process nor the pipe keeps this event loop alive; the pipe's write end closes when this process exits.
  child.unref();
  (stdin as unknown as { unref?: () => void } | null)?.unref?.();
  return () => stdin?.destroy();
}

/**
 * Makes this process (and everything it starts from now on) use a per-run root. Reuses the root named by `DV_TEST_TMP_ROOT` when it is
 * a valid one (`checkTmpRoot`); an invalid value is ignored with a warning (when TMPDIR names that same folder, the fresh root goes next
 * to it rather than inside it). Otherwise sweeps stale roots of dead runs from the temp folder, creates a fresh root, starts its guard
 * (unless `guard: false`), sets `DV_TEST_TMP_ROOT`, TMPDIR, TEMP and TMP, and registers a removal at process exit as a backstop for
 * runners that never reach their teardown.
 */
export function enterTmpRoot(label: string, opts: { guard?: boolean } = {}): TmpRoot {
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
  const release = opts.guard === false ? () => {} : startGuard(created.root, path.dirname(created.root));
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
    try {
      created.cleanup();
    } finally {
      release();
    }
  };
  process.on('exit', cleanup);
  return { root: created.root, owned: true, cleanup };
}

/** Runs `fn` inside a per-run root (see `enterTmpRoot`) and cleans up afterwards, also when `fn` throws. */
export function withTmpRoot<T>(label: string, fn: (root: string) => T, opts: { guard?: boolean } = {}): T {
  const t = enterTmpRoot(label, opts);
  try {
    return fn(t.root);
  } finally {
    t.cleanup();
  }
}

/**
 * Pids of the live processes that work in `root`: the descendants of a tool started in it. A process counts when its start-up
 * environment names `root` in `DV_TEST_TMP_ROOT`, TMPDIR, TEMP or TMP (so one that scrubbed the first but kept TMPDIR still counts), or
 * when its working folder is inside `root`. Linux only, from /proc; elsewhere an empty list, so no drain happens there and a straggler
 * that writes into the root after its removal leaves it to the guard or the next run's sweep. Left out: this process, its direct
 * children (the tool is one and has exited; any other, such as tsx's esbuild service, was started before the root existed), zombies,
 * and processes this user cannot read. A descendant that dropped all four variables and works outside the root is not found.
 */
export function processesInRoot(root: string): number[] {
  if (process.platform !== 'linux') return [];
  let entries: string[];
  try {
    entries = readdirSync('/proc');
  } catch {
    return [];
  }
  const needles = [TMP_ROOT_ENV, ...TMP_VARS].map((k) => Buffer.from(`\0${k}=${root}\0`));
  const inside = `${root}${path.sep}`;
  const pids: number[] = [];
  for (const e of entries) {
    const pid = Number(e);
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) continue;
    try {
      const env = Buffer.concat([Buffer.from([0]), readFileSync(`/proc/${e}/environ`)]);
      if (!needles.some((n) => env.includes(n))) {
        const cwd = readlinkSync(`/proc/${e}/cwd`);
        if (cwd !== root && !cwd.startsWith(inside)) continue;
      }
      // /proc/<pid>/stat: "<pid> (<comm>) <state> <ppid> ..."; comm may hold spaces and parentheses, so split after the last ')'.
      const stat = readFileSync(`/proc/${e}/stat`, 'utf8');
      const [state, ppid] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (state === 'Z' || Number(ppid) === process.pid) continue;
      pids.push(pid);
    } catch {
      // Gone already, or another user's process.
    }
  }
  return pids;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function killQuietly(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // Exited meanwhile.
  }
}

/**
 * Waits until no process still works in `root` (see `processesInRoot`), so removing it is final: after an interrupt, Vitest's fork
 * workers outlive the Vitest main process for a moment and would otherwise recreate folders inside a removed root. Survivors get SIGTERM
 * after `graceMs` (at once when `hurry()` turns true, e.g. after a second Ctrl-C), then SIGKILL two seconds later.
 */
export async function drainRoot(root: string, opts: { graceMs?: number; hurry?: () => boolean; name?: string } = {}): Promise<void> {
  const grace = opts.graceMs ?? 5000;
  const start = Date.now();
  let termAt = 0;
  for (;;) {
    const left = processesInRoot(root);
    if (left.length === 0) return;
    const now = Date.now();
    if (termAt === 0 && (now - start >= grace || opts.hurry?.() === true)) {
      termAt = now;
      console.warn(`${opts.name ?? 'tmp-root'}: stopping ${left.length} leftover process(es) still using ${root}: ${left.join(' ')}`);
      for (const pid of left) killQuietly(pid, 'SIGTERM');
    } else if (termAt !== 0 && now - termAt >= 2000) {
      for (const pid of left) killQuietly(pid, 'SIGKILL');
      await sleep(200);
      return;
    }
    await sleep(50);
  }
}

/**
 * Runs `cmd` asynchronously inside a per-run root (see `enterTmpRoot`) and resolves with its exit code, or 128 + the signal number when
 * a signal ended it. Because the event loop stays free while the tool runs, tsx's signal relay is acknowledged; SIGINT, SIGTERM and
 * SIGHUP are forwarded to the tool. Once the tool has exited, the processes it left that still work in the root are drained
 * (`drainRoot`) and the root is removed, both only when this call created the root: a root reused from `DV_TEST_TMP_ROOT` belongs to an
 * enclosing run whose processes still use it. Used by run.ts and check-workers.ts.
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
    let hurry = false;
    const forward = (sig: NodeJS.Signals): void => {
      if (child && child.exitCode === null && child.signalCode === null) {
        try {
          child.kill(sig);
        } catch {
          // The tool exited between the check and the kill; its exit handler finishes the run.
        }
      } else {
        hurry = true; // A signal while draining: stop the leftovers now.
      }
    };
    // The listeners stay until the root is gone: with none, tsx's preflight would exit this process on a signal mid-drain.
    for (const s of FORWARDED_SIGNALS) process.on(s, forward);
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      // Only the owner drains: a reused root (run.ts started inside another run) is still in use by the processes of that run.
      void (t.owned ? drainRoot(t.root, { hurry: () => hurry, name }) : Promise.resolve())
        .catch((err: unknown) => console.warn(`${name}: could not drain ${t.root}: ${(err as Error).message}`))
        .then(() => {
          try {
            t.cleanup();
          } catch (err) {
            console.error(`${name}: ${(err as Error).message}`);
          }
          for (const s of FORWARDED_SIGNALS) process.off(s, forward);
          resolve(code);
        });
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
