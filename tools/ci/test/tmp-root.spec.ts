import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { repoRoot, tmpLabel } from '../run.ts';
import {
  TMP_ROOT_ENV,
  TMP_ROOT_MARKER,
  TMP_ROOT_NAME,
  TMP_VARS,
  bootId,
  checkTmpRoot,
  createTmpRoot,
  enterTmpRoot,
  pidAlive,
  readTmpRootMarker,
  removeTmpRoot,
  runtimeIdentity,
  sweepStaleTmpRoots,
  withTmpRoot,
} from '../tmp-root.ts';

// BD-FIX-TMP-01: every test run works inside one per-run temporary root, removed at teardown.

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const scratch = (prefix: string): string => {
  const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(d);
  return d;
};

/** Writes a per-run root marker into `dir`, as createTmpRoot does (`ns` defaults to this PID namespace). */
const writeMarker = (dir: string, pid: number, ns: string | null = runtimeIdentity()): void =>
  writeFileSync(path.join(dir, TMP_ROOT_MARKER), JSON.stringify({ ns, pid, label: 'unit' }));

/** A namespace identity of this boot that is not this process's PID namespace (as a container sharing the temp folder would have). */
const otherNamespace = (): string => {
  const ns = runtimeIdentity() as string;
  const other = `${ns.slice(0, ns.indexOf(':', 'linux:'.length) + 1)}pid:[1]`;
  expect(other).not.toBe(ns);
  return other;
};

/** The pid of a child that has been spawned and reaped, so no process has it (checked; a reused pid fails the calling test). */
function deadPid(): number {
  const reaped = spawnSync(process.execPath, ['-e', '']);
  expect(reaped.status).toBe(0);
  const pid = reaped.pid as number;
  expect(pidAlive(pid), `pid ${pid} was reused before the check; rerun`).toBe(false);
  return pid;
}

/** Runs `fn` with DV_TEST_TMP_ROOT unset, so enterTmpRoot creates a root of its own (nested in the current one), then restores it. */
function withoutInherited<T>(fn: () => T): T {
  const saved = Object.fromEntries([TMP_ROOT_ENV, ...TMP_VARS].map((k) => [k, process.env[k]]));
  delete process.env[TMP_ROOT_ENV];
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('the per-run temporary root (this run)', () => {
  it('is in effect in this worker: TMPDIR, TEMP and TMP name it and os.tmpdir() resolves to it', () => {
    const root = process.env[TMP_ROOT_ENV];
    expect(root, `${TMP_ROOT_ENV} must be set by the root globalSetup or tools/ci/run.ts`).toBeTruthy();
    expect(existsSync(root as string)).toBe(true);
    expect(path.basename(root as string)).toMatch(TMP_ROOT_NAME);
    for (const k of TMP_VARS) expect(process.env[k]).toBe(root);
    expect(os.tmpdir()).toBe(root);
  });

  it('a spec that makes a temp folder sees it under the per-run root', () => {
    const dir = scratch('dv-contract-');
    expect(path.dirname(dir)).toBe(realpathSync(process.env[TMP_ROOT_ENV] as string));
  });

  it('a process the spec spawns inherits it', () => {
    const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("node:os").tmpdir())'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(process.env[TMP_ROOT_ENV]);
  });
});

describe('tmp-root helpers', () => {
  it('createTmpRoot names the folder dv-<label>-<pid>-XXXXXX and its cleanup removes it with everything inside', () => {
    const base = scratch('dv-base-');
    const t = createTmpRoot('unit', base);
    expect(path.dirname(t.root)).toBe(base);
    expect(path.basename(t.root)).toMatch(new RegExp(`^dv-unit-${process.pid}-[A-Za-z0-9]{6}$`));
    // The marker ties the root to its creator and to this PID namespace (what the sweep and checkTmpRoot read).
    expect(runtimeIdentity()).toBeTruthy();
    expect(readTmpRootMarker(t.root)).toEqual({ ns: runtimeIdentity(), pid: process.pid });
    expect(checkTmpRoot(t.root)).toBeNull();
    mkdirSync(path.join(t.root, 'a', 'b'), { recursive: true });
    writeFileSync(path.join(t.root, 'a', 'b', 'f.txt'), 'x');
    t.cleanup();
    t.cleanup();
    expect(existsSync(t.root)).toBe(false);
    expect(readdirSync(base)).toEqual([]);
  });

  it('removeTmpRoot refuses anything that is not a per-run root directly inside the given parent', () => {
    const base = scratch('dv-base-');
    const other = path.join(base, 'dv-map-test-abc123');
    mkdirSync(other);
    expect(() => removeTmpRoot(other, base)).toThrow(/refusing/);
    expect(() => removeTmpRoot(base, path.dirname(base))).toThrow(/refusing/);
    expect(() => removeTmpRoot(path.join(base, 'x', 'dv-unit-1-abcdef'), base)).toThrow(/refusing/);
    expect(existsSync(other)).toBe(true);
    expect(() => createTmpRoot('Bad/Label', base)).toThrow(/label/);
  });

  it('enterTmpRoot reuses an inherited root and never removes it', () => {
    const t = enterTmpRoot('unit');
    expect(t.owned).toBe(false);
    expect(t.root).toBe(process.env[TMP_ROOT_ENV]);
    t.cleanup();
    expect(existsSync(t.root)).toBe(true);
  });

  it('withTmpRoot points the variables at a fresh root, restores them and removes the root, also when the callback throws', () => {
    const outer = os.tmpdir();
    let seen = '';
    let child = '';
    withoutInherited(() => {
      withTmpRoot('unit', (root) => {
        seen = root;
        expect(os.tmpdir()).toBe(root);
        expect(process.env[TMP_ROOT_ENV]).toBe(root);
        child = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("node:os").tmpdir())'], { encoding: 'utf8' }).stdout;
        mkdtempSync(path.join(os.tmpdir(), 'dv-left-'));
      });
      expect(process.env[TMP_ROOT_ENV]).toBeUndefined();
    });
    expect(path.dirname(seen)).toBe(realpathSync(outer));
    expect(child).toBe(seen);
    expect(existsSync(seen)).toBe(false);
    expect(os.tmpdir()).toBe(outer);

    let thrownIn = '';
    expect(() =>
      withoutInherited(() =>
        withTmpRoot('unit', (root) => {
          thrownIn = root;
          throw new Error('boom');
        }),
      ),
    ).toThrow('boom');
    expect(thrownIn).not.toBe('');
    expect(existsSync(thrownIn)).toBe(false);
  });

  it('tmpLabel turns a tool name into a label', () => {
    expect(tmpLabel('vitest')).toBe('vitest');
    expect(tmpLabel('Play-Wright')).toBe('playwright');
    expect(tmpLabel('---')).toBe('run');
  });
});

/**
 * The teardown contract, end to end: a nested run of tmp-root.probe.spec.ts leaves a temp folder behind on purpose; once the run has
 * exited, the per-run root it used is gone, and nothing else is left in the folder it was made in. The nested run's TMPDIR is a scratch
 * folder inside this run's root, so even a broken teardown stays contained.
 */
describe('after the run, the per-run root is gone', () => {
  const probe = (cmd: string, argv: string[], fail: boolean): { status: number | null; base: string; rec: { root: string; tmpdir: string; dir: string } } => {
    const base = scratch('dv-nested-');
    const out = path.join(base, 'probe.json');
    const env: NodeJS.ProcessEnv = { ...process.env, ...Object.fromEntries(TMP_VARS.map((k) => [k, base])), DV_TMP_PROBE_OUT: out };
    delete env[TMP_ROOT_ENV];
    if (fail) env.DV_TMP_PROBE_FAIL = '1';
    const r = spawnSync(cmd, argv, { cwd: repoRoot, env, encoding: 'utf8' });
    if (!existsSync(out)) throw new Error(`the probe did not run (exit ${String(r.status)}):\n${r.stdout}\n${r.stderr}`);
    return { status: r.status, base, rec: JSON.parse(readFileSync(out, 'utf8')) as { root: string; tmpdir: string; dir: string } };
  };
  const PROBE = 'tools/ci/test/tmp-root.probe.spec.ts';

  it('vitest on its own (root globalSetup): the root is removed after a failing run', () => {
    const { status, base, rec } = probe(path.join(repoRoot, 'node_modules', '.bin', 'vitest'), ['run', PROBE], true);
    expect(status).not.toBe(0);
    expect(path.dirname(rec.root)).toBe(base);
    expect(path.basename(rec.root)).toMatch(/^dv-vitest-\d+-[A-Za-z0-9]{6}$/);
    expect(rec.tmpdir).toBe(rec.root);
    expect(path.dirname(rec.dir)).toBe(rec.root);
    expect(existsSync(rec.root)).toBe(false);
    expect(readdirSync(base)).toEqual(['probe.json']);
  }, 120_000);

  it('vitest through tools/ci/run.ts (pnpm check:unit): run.ts owns the root and removes it after a passing run', () => {
    const { status, base, rec } = probe(path.join(repoRoot, 'node_modules', '.bin', 'tsx'), ['tools/ci/run.ts', 'vitest', 'run', PROBE], false);
    expect(status).toBe(0);
    expect(path.dirname(rec.root)).toBe(base);
    expect(path.dirname(rec.dir)).toBe(rec.root);
    expect(existsSync(rec.root)).toBe(false);
    // tsx keeps its own reused cache folder (tsx-<uid>) in the TMPDIR it starts with, before run.ts makes the root.
    expect(readdirSync(base).filter((n) => !/^tsx-\d+$/.test(n))).toEqual(['probe.json']);
  }, 120_000);
});

/** Polls `fn` every 50 ms until it returns a value other than undefined, or throws after `ms`. */
async function waitFor<T>(what: string, ms: number, fn: () => T | undefined): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Resolves once no process is left in the process group `pgid` (one the test started, detached). */
async function groupGone(pgid: number, ms: number): Promise<void> {
  await waitFor(`process group ${pgid} to exit`, ms, () => {
    try {
      process.kill(-pgid, 0);
      return undefined;
    } catch {
      return true;
    }
  });
}

/**
 * Interrupts. `pnpm check:unit` is `tsx tools/ci/run.ts vitest run`; Ctrl-C sends SIGINT to the whole process group, and tsx SIGKILLs
 * run.ts unless run.ts acknowledges the signal within about 30 ms, which a blocked event loop (spawnSync) could not. Each round starts
 * that command on the probe in a process group of its own, waits until the probe has made its folder inside the per-run root, signals,
 * and checks what is left once the command has exited.
 */
describe('an interrupted run and its per-run root', () => {
  const PROBE = 'tools/ci/test/tmp-root.probe.spec.ts';

  /**
   * One round; `target` is the whole process group (Ctrl-C in a terminal), run.ts alone (its pid is in the root's name), or a SIGKILL of
   * run.ts (what tsx's relay does when the acknowledgement misses its 30 ms window), which nothing can catch.
   */
  async function interruptRound(target: 'group' | 'run.ts' | 'run.ts SIGKILL', round: number): Promise<void> {
    const base = scratch('dv-intr-');
    const out = path.join(base, 'probe.json');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...Object.fromEntries(TMP_VARS.map((k) => [k, base])),
      DV_TMP_PROBE_OUT: out,
      DV_TMP_PROBE_HOLD_MS: '60000',
    };
    delete env[TMP_ROOT_ENV];
    const child = spawn(path.join(repoRoot, 'node_modules', '.bin', 'tsx'), ['tools/ci/run.ts', 'vitest', 'run', PROBE], {
      cwd: repoRoot,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (b: Buffer) => (log += b.toString()));
    child.stderr.on('data', (b: Buffer) => (log += b.toString()));
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    );
    const pgid = child.pid as number;
    const tag = `${target} round ${round}`;
    let bystander: ReturnType<typeof spawn> | undefined;
    try {
      const rec = await waitFor(`the probe (${tag})`, 90_000, () => {
        if (child.exitCode !== null) throw new Error(`the run exited (${child.exitCode}) before the probe wrote ${out}:\n${log}`);
        try {
          return JSON.parse(readFileSync(out, 'utf8')) as { root: string; dir: string };
        } catch {
          return undefined;
        }
      });
      expect(path.dirname(rec.root)).toBe(base);
      const name = /^dv-vitest-(\d+)-[A-Za-z0-9]{6}$/.exec(path.basename(rec.root));
      expect(name, path.basename(rec.root)).not.toBeNull();
      expect(existsSync(rec.dir)).toBe(true);
      if (target === 'run.ts') {
        // The reviewer's case: a process run.ts did not start (a developer shell) works in the root, cwd and TMPDIR both inside it.
        // run.ts must leave it alone.
        bystander = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
          cwd: rec.dir,
          env: { ...process.env, ...Object.fromEntries(TMP_VARS.map((k) => [k, rec.root])), [TMP_ROOT_ENV]: rec.root },
          stdio: 'ignore',
        });
      }
      if (target === 'group') process.kill(-pgid, 'SIGINT');
      else process.kill(Number(name?.[1]), target === 'run.ts' ? 'SIGINT' : 'SIGKILL');
      const res = await Promise.race([
        exited,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${tag}: no exit 30 s after the signal:\n${log}`)), 30_000)),
      ]);
      expect(res.code === 0, `${tag}: an interrupted run must not report success:\n${log}`).toBe(false);
      if (target === 'run.ts SIGKILL') {
        // Nothing caught the SIGKILL, so the root is left. tsx exits at once; Vitest and the probe's worker live on as orphans in the
        // test's own process group, which the test stops. Then the next run's sweep removes the root: its marker names this namespace
        // and run.ts's pid, which is dead.
        expect(existsSync(rec.root), `${tag}: the root of a SIGKILLed run.ts stays until the next run`).toBe(true);
        process.kill(-pgid, 'SIGKILL');
        await groupGone(pgid, 30_000);
        expect(existsSync(rec.root)).toBe(true);
        const nextEnv: NodeJS.ProcessEnv = { ...env };
        delete nextEnv.DV_TMP_PROBE_HOLD_MS;
        const next = spawnSync(path.join(repoRoot, 'node_modules', '.bin', 'tsx'), ['tools/ci/run.ts', 'vitest', 'run', PROBE], {
          cwd: repoRoot,
          env: nextEnv,
          encoding: 'utf8',
        });
        expect(next.status, `${tag}: the next run:\n${next.stdout}\n${next.stderr}`).toBe(0);
        expect(next.stderr).toMatch(/removed 1 stale per-run root/);
        const nextRoot = (JSON.parse(readFileSync(out, 'utf8')) as { root: string }).root;
        expect(nextRoot).not.toBe(rec.root);
        expect(existsSync(nextRoot)).toBe(false);
      }
      expect(existsSync(rec.root), `${tag}: per-run root ${rec.root} left behind:\n${log}`).toBe(false);
      expect(readdirSync(base).filter((n) => !/^tsx-\d+$/.test(n))).toEqual(['probe.json']);
      if (bystander) {
        expect(bystander.exitCode, `${tag}: run.ts stopped a process it did not start`).toBeNull();
        expect(bystander.signalCode, `${tag}: run.ts stopped a process it did not start`).toBeNull();
      }
    } finally {
      bystander?.kill('SIGKILL');
      try {
        process.kill(-pgid, 'SIGKILL');
      } catch {
        // The group has already exited.
      }
    }
  }

  it('SIGINT to the process group of `tsx tools/ci/run.ts vitest run` (Ctrl-C), three rounds: the root is removed', async () => {
    for (let round = 1; round <= 3; round++) await interruptRound('group', round);
  }, 300_000);

  // run.ts forwards the signal to its own child, Vitest, waits for it to exit and removes the root (with a blocking spawn the signal
  // was ignored and the run went on). A process it did not start keeps running, even with its cwd and TMPDIR inside the root.
  it('SIGINT to run.ts alone is forwarded to its child, the root is removed, and a bystander in the root is left alone', async () => {
    await interruptRound('run.ts', 1);
  }, 120_000);

  it("SIGKILL to run.ts: the root is left, and the next run's sweep removes it", async () => {
    await interruptRound('run.ts SIGKILL', 1);
  }, 180_000);

  // A run.ts started inside this run (unit-collect.test.ts does that) reuses this run's root: it must neither stop a process that
  // still uses the root nor remove the root when its tool exits.
  it('a run.ts that reused an inherited root leaves the processes of the enclosing run and the root alone', async () => {
    const root = process.env[TMP_ROOT_ENV] as string;
    const sentinel = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    try {
      // Asynchronous, so this worker's event loop keeps running and would see the sentinel exit if the nested run.ts stopped it.
      const nested = spawn(path.join(repoRoot, 'node_modules', '.bin', 'tsx'), ['tools/ci/run.ts', 'vitest', 'run', PROBE], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '';
      nested.stdout.on('data', (b: Buffer) => (log += b.toString()));
      nested.stderr.on('data', (b: Buffer) => (log += b.toString()));
      const code = await new Promise<number | null>((resolve) => nested.once('close', resolve));
      await new Promise((r) => setTimeout(r, 200));
      expect(code, log).toBe(0);
      expect(sentinel.exitCode, 'the nested run.ts stopped a process of this run').toBeNull();
      expect(sentinel.signalCode, 'the nested run.ts stopped a process of this run').toBeNull();
      expect(existsSync(root)).toBe(true);
    } finally {
      sentinel.kill('SIGKILL');
    }
  }, 120_000);
});

describe('stale-root sweep and outside DV_TEST_TMP_ROOT values', () => {
  it('sweepStaleTmpRoots removes a dead pid\'s root, keeps a live pid\'s root and never touches what fails the name', () => {
    const base = scratch('dv-sweep-');
    const dead = deadPid();
    expect(pidAlive(process.pid)).toBe(true);

    const deadRoot = path.join(base, `dv-unit-${dead}-abc123`);
    mkdirSync(path.join(deadRoot, 'nested'), { recursive: true });
    writeFileSync(path.join(deadRoot, 'nested', 'f.txt'), 'x');
    writeMarker(deadRoot, dead);
    const liveRoot = path.join(base, `dv-unit-${process.pid}-def456`);
    mkdirSync(liveRoot);
    writeMarker(liveRoot, process.pid);
    const badName = path.join(base, `dv-unit-${dead}-abc`);
    mkdirSync(badName);
    writeMarker(badName, dead);
    const oldStyle = path.join(base, 'dv-map-test-abc123');
    mkdirSync(oldStyle);
    const aFile = path.join(base, `dv-unit-${dead}-file00`);
    writeFileSync(aFile, 'a file, not a root');
    const target = scratch('dv-target-');
    writeFileSync(path.join(target, 'keep.txt'), 'keep');
    writeMarker(target, dead);
    const link = path.join(base, `dv-unit-${dead}-link00`);
    symlinkSync(target, link);
    // A root made in another PID namespace of this boot (a container or sandbox sharing the temp folder) is judged by a pid this
    // namespace cannot see, so its marker keeps it; so does a folder with no marker or with a marker for another pid.
    const foreign = path.join(base, `dv-unit-${dead}-frgn00`);
    mkdirSync(foreign);
    writeMarker(foreign, dead, otherNamespace());
    const unmarked = path.join(base, `dv-unit-${dead}-nomark`);
    mkdirSync(unmarked);
    const otherPid = path.join(base, `dv-unit-${dead}-other0`);
    mkdirSync(otherPid);
    writeMarker(otherPid, process.pid);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let removed: string[];
    let warnings: string[];
    try {
      removed = sweepStaleTmpRoots(base);
      warnings = warn.mock.calls.map((c) => String(c[0]));
    } finally {
      warn.mockRestore();
    }
    expect(removed).toEqual([deadRoot]);
    // What it skips (a file, a symlink, unmarked or foreign folders) it skips without a word, so no run warns about them forever.
    expect(warnings.filter((w) => w.includes('left in place'))).toEqual([]);
    expect(existsSync(deadRoot)).toBe(false);
    for (const kept of [liveRoot, badName, oldStyle, aFile, link, foreign, unmarked, otherPid]) expect(existsSync(kept), kept).toBe(true);
    expect(readFileSync(path.join(target, 'keep.txt'), 'utf8')).toBe('keep');
  });

  // A marker written before the last reboot (same `linux:` form, another boot id): its creator cannot be alive whatever its pid shows
  // now, so the sweep removes it, also when that pid belongs to a live process of this boot. A boot segment that is no boot id (the
  // hostname fallback where boot_id cannot be read) proves nothing and is kept, as is an other-boot marker naming another pid.
  const ourBoot = bootId(runtimeIdentity());
  it.skipIf(ourBoot === null)('sweepStaleTmpRoots removes a root whose marker names another boot of this machine', () => {
    const base = scratch('dv-boot-');
    const ns = runtimeIdentity() as string;
    const boot = ourBoot as string;
    const otherBoot = boot === '00000000-0000-0000-0000-000000000000' ? '11111111-1111-1111-1111-111111111111' : '00000000-0000-0000-0000-000000000000';
    const otherBootNs = ns.replace(`linux:${boot}:`, `linux:${otherBoot}:`);
    expect(bootId(otherBootNs)).toBe(otherBoot);
    const dead = deadPid();
    const live = process.ppid;
    expect(pidAlive(live)).toBe(true);
    const deadPidRoot = path.join(base, `dv-unit-${dead}-boot01`);
    mkdirSync(path.join(deadPidRoot, 'nested'), { recursive: true });
    writeMarker(deadPidRoot, dead, otherBootNs);
    const livePidRoot = path.join(base, `dv-unit-${live}-boot02`);
    mkdirSync(livePidRoot);
    writeMarker(livePidRoot, live, otherBootNs);
    const hostFallback = path.join(base, `dv-unit-${dead}-boot03`);
    mkdirSync(hostFallback);
    writeMarker(hostFallback, dead, ns.replace(`linux:${boot}:`, 'linux:some-host:'));
    const wrongPid = path.join(base, `dv-unit-${dead}-boot04`);
    mkdirSync(wrongPid);
    writeMarker(wrongPid, live, otherBootNs);
    // The same live pid with this namespace's marker keeps its root: only the boot id makes the difference.
    const liveHere = path.join(base, `dv-unit-${live}-boot05`);
    mkdirSync(liveHere);
    writeMarker(liveHere, live);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let removed: string[];
    try {
      removed = sweepStaleTmpRoots(base);
    } finally {
      warn.mockRestore();
    }
    expect([...removed].sort()).toEqual([deadPidRoot, livePidRoot].sort());
    for (const gone of [deadPidRoot, livePidRoot]) expect(existsSync(gone), gone).toBe(false);
    for (const kept of [hostFallback, wrongPid, liveHere]) expect(existsSync(kept), kept).toBe(true);
  });

  // The reviewer's reproduction: a live run in its own PID namespace (`unshare --pid --fork --mount-proc`, as a container or sandbox
  // would be) whose root sits in a temp folder this namespace shares. Its creator's pid is not alive here, so before the marker the
  // sweep removed the root mid-run; now the sweep must keep it and checkTmpRoot must refuse to adopt it.
  const UNSHARE = ['--pid', '--fork', '--mount-proc', '--kill-child'];
  const unshareWorks = process.platform === 'linux' && spawnSync('unshare', [...UNSHARE, 'true']).status === 0;
  it.skipIf(!unshareWorks)('a live run in another PID namespace keeps its root (unshare --pid)', async () => {
    const base = scratch('dv-pidns-');
    const out = path.join(base, 'root.txt');
    // Pids count from 1 in the new namespace. The namespace's first process uses up pids until its next child gets one at or above
    // `from`, chosen so that this namespace has no process on it or on the next 200, then that child creates the root and stays alive.
    let from = 300;
    while (Array.from({ length: 200 }, (_, i) => from + i).some((p) => pidAlive(p))) from += 200;
    const creator = [
      `const m = await import(${JSON.stringify(path.join(repoRoot, 'tools/ci/tmp-root.ts'))});`,
      `const t = m.createTmpRoot('unit', ${JSON.stringify(base)});`,
      `(await import('node:fs')).writeFileSync(${JSON.stringify(out)}, t.root);`,
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const init = [
      "const { spawn, spawnSync } = require('node:child_process');",
      `while ((spawnSync('true').pid ?? 0) < ${from - 1});`,
      `const c = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', ${JSON.stringify(creator)}], { stdio: 'inherit' });`,
      "c.on('exit', (code) => process.exit(code ?? 1));",
    ].join('\n');
    const child = spawn('unshare', [...UNSHARE, process.execPath, '-e', init], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (b: Buffer) => (err += b.toString()));
    try {
      const root = await waitFor('the root made in the other namespace', 30_000, () => {
        if (child.exitCode !== null) throw new Error(`the namespaced run exited (${child.exitCode}):\n${err}`);
        try {
          return readFileSync(out, 'utf8') || undefined;
        } catch {
          return undefined;
        }
      });
      const pid = Number(TMP_ROOT_NAME.exec(path.basename(root))?.[1]);
      const marker = readTmpRootMarker(root);
      expect(marker?.pid).toBe(pid);
      expect(marker?.ns).not.toBe(runtimeIdentity());
      // Seen from here the creator is dead, which is exactly what made the old sweep remove a live run's root: only the marker tells.
      expect(pid).toBeGreaterThanOrEqual(from);
      expect(pidAlive(pid), `pid ${pid} is in use in this namespace too; the check proves nothing, rerun`).toBe(false);
      expect(sweepStaleTmpRoots(base)).toEqual([]);
      expect(existsSync(root)).toBe(true);
      expect(checkTmpRoot(root)).toMatch(/another PID namespace/);
    } finally {
      child.kill('SIGKILL');
    }
  }, 60_000);

  it('removeTmpRoot refuses a symlink or a file that carries a per-run name', () => {
    const base = scratch('dv-base-');
    const target = scratch('dv-target-');
    const link = path.join(base, 'dv-unit-1-link00');
    symlinkSync(target, link);
    const file = path.join(base, 'dv-unit-1-file00');
    writeFileSync(file, 'x');
    expect(() => removeTmpRoot(link, base)).toThrow(/refusing/);
    expect(() => removeTmpRoot(file, base)).toThrow(/refusing/);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(file)).toBe(true);
    expect(() => removeTmpRoot(path.join(base, 'dv-unit-1-gone00'), base)).not.toThrow();
  });

  it('enterTmpRoot ignores an invalid DV_TEST_TMP_ROOT with a warning and makes a fresh root', () => {
    const plain = scratch('dv-plain-');
    // Existing per-run-named folders that must not be adopted either: a root whose creator is dead (left by an earlier run and still
    // exported in a shell), a folder without a marker, and a root made in another PID namespace.
    const dead = deadPid();
    const leaked = path.join(plain, `dv-unit-${dead}-leaked`);
    mkdirSync(leaked);
    writeMarker(leaked, dead);
    const unmarked = path.join(plain, `dv-unit-${process.pid}-nomark`);
    mkdirSync(unmarked);
    const foreign = path.join(plain, `dv-unit-${process.pid}-frgn00`);
    mkdirSync(foreign);
    writeMarker(foreign, process.pid, otherNamespace());
    // The file-system root, the system temp folder, an existing folder with another name, a per-run name that does not exist, a relative path.
    const invalid = [
      '/',
      ...(existsSync('/tmp') ? ['/tmp'] : []),
      plain,
      path.join(plain, 'dv-unit-1-abcdef'),
      'dv-unit-1-abcdef',
      leaked,
      unmarked,
      foreign,
    ];
    for (const value of invalid) {
      expect(checkTmpRoot(value), value).not.toBeNull();
      const saved = Object.fromEntries([TMP_ROOT_ENV, ...TMP_VARS].map((k) => [k, process.env[k]]));
      const outer = os.tmpdir();
      process.env[TMP_ROOT_ENV] = value;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const t = enterTmpRoot('unit');
        expect(warn.mock.calls.some((c) => String(c[0]).includes(`ignoring ${TMP_ROOT_ENV}=${value}`)), value).toBe(true);
        expect(t.owned).toBe(true);
        expect(t.root).not.toBe(value);
        expect(path.basename(t.root)).toMatch(new RegExp(`^dv-unit-${process.pid}-[A-Za-z0-9]{6}$`));
        expect(path.dirname(t.root)).toBe(realpathSync(outer));
        expect(process.env[TMP_ROOT_ENV]).toBe(t.root);
        expect(os.tmpdir()).toBe(t.root);
        t.cleanup();
        expect(existsSync(t.root)).toBe(false);
        expect(process.env[TMP_ROOT_ENV]).toBe(value);
        expect(os.tmpdir()).toBe(outer);
      } finally {
        warn.mockRestore();
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    }
    expect(existsSync(plain)).toBe(true);
    for (const kept of [leaked, unmarked, foreign]) expect(existsSync(kept), kept).toBe(true);
  });

  it('a leaked root exported with TMPDIR pointing into it: the fresh root goes next to it and the sweep removes the leaked one', () => {
    const parent = scratch('dv-leak-');
    const dead = deadPid();
    const leaked = path.join(parent, `dv-unit-${dead}-leaked`);
    mkdirSync(path.join(leaked, 'fixture'), { recursive: true });
    writeMarker(leaked, dead);
    const saved = Object.fromEntries([TMP_ROOT_ENV, ...TMP_VARS].map((k) => [k, process.env[k]]));
    for (const k of [TMP_ROOT_ENV, ...TMP_VARS]) process.env[k] = leaked;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const t = enterTmpRoot('unit');
      expect(warn.mock.calls.some((c) => String(c[0]).includes(`ignoring ${TMP_ROOT_ENV}=${leaked}`))).toBe(true);
      expect(t.owned).toBe(true);
      expect(path.dirname(t.root)).toBe(parent);
      expect(existsSync(leaked)).toBe(false);
      expect(os.tmpdir()).toBe(t.root);
      t.cleanup();
      expect(existsSync(t.root)).toBe(false);
      expect(readdirSync(parent)).toEqual([]);
    } finally {
      warn.mockRestore();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
