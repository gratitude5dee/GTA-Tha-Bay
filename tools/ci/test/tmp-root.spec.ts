import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { repoRoot, tmpLabel } from '../run.ts';
import {
  TMP_ROOT_ENV,
  TMP_ROOT_NAME,
  TMP_VARS,
  checkTmpRoot,
  createTmpRoot,
  enterTmpRoot,
  pidAlive,
  removeTmpRoot,
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

/**
 * Part 2 of BD-FIX-TMP-01: interrupts. `pnpm check:unit` is `tsx tools/ci/run.ts vitest run`; Ctrl-C sends SIGINT to the whole process
 * group, and tsx SIGKILLs run.ts unless run.ts acknowledges the signal within about 30 ms, which a blocked event loop (spawnSync) could
 * not. Each round starts that command on the probe in a process group of its own, waits until the probe has made its folder inside the
 * per-run root, sends SIGINT, and checks that the root is gone once the command has exited.
 */
describe('an interrupted run removes its per-run root', () => {
  const PROBE = 'tools/ci/test/tmp-root.probe.spec.ts';

  /** One round; `target` is the whole process group (Ctrl-C in a terminal) or run.ts alone (its pid is in the root's name). */
  async function interruptRound(target: 'group' | 'run.ts', round: number): Promise<void> {
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
      if (target === 'group') process.kill(-pgid, 'SIGINT');
      else process.kill(Number(name?.[1]), 'SIGINT');
      const res = await Promise.race([
        exited,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${tag}: no exit 30 s after SIGINT:\n${log}`)), 30_000)),
      ]);
      expect(res.code === 0, `${tag}: an interrupted run must not report success:\n${log}`).toBe(false);
      expect(existsSync(rec.root), `${tag}: per-run root ${rec.root} left behind:\n${log}`).toBe(false);
      expect(readdirSync(base).filter((n) => !/^tsx-\d+$/.test(n))).toEqual(['probe.json']);
    } finally {
      try {
        process.kill(-pgid, 'SIGKILL');
      } catch {
        // The group has already exited.
      }
    }
  }

  it('SIGINT to the process group of `tsx tools/ci/run.ts vitest run` (Ctrl-C), three rounds', async () => {
    for (let round = 1; round <= 3; round++) await interruptRound('group', round);
  }, 300_000);

  // run.ts forwards the signal to Vitest, then waits for the probe's worker, which outlives the Vitest main process in busy code and
  // keeps recreating its folder, before it removes the root (with a blocking spawn the signal was ignored and the run went on).
  it('SIGINT to run.ts alone is forwarded, and the root goes only after the orphaned worker has stopped', async () => {
    await interruptRound('run.ts', 1);
  }, 120_000);

  // A run.ts started inside this run (unit-collect.test.ts does that) reuses this run's root: it must neither stop the processes that
  // still use the root nor remove it when its tool exits.
  it('a run.ts that reused an inherited root leaves its processes and the root alone', async () => {
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
      expect(log).not.toMatch(/leftover process/);
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
    const reaped = spawnSync(process.execPath, ['-e', '']);
    const dead = reaped.pid as number;
    expect(reaped.status).toBe(0);
    expect(pidAlive(dead), `pid ${dead} was reused before the sweep; rerun`).toBe(false);
    expect(pidAlive(process.pid)).toBe(true);

    const deadRoot = path.join(base, `dv-unit-${dead}-abc123`);
    mkdirSync(path.join(deadRoot, 'nested'), { recursive: true });
    writeFileSync(path.join(deadRoot, 'nested', 'f.txt'), 'x');
    const liveRoot = path.join(base, `dv-unit-${process.pid}-def456`);
    mkdirSync(liveRoot);
    const badName = path.join(base, `dv-unit-${dead}-abc`);
    mkdirSync(badName);
    const oldStyle = path.join(base, 'dv-map-test-abc123');
    mkdirSync(oldStyle);
    const aFile = path.join(base, `dv-unit-${dead}-file00`);
    writeFileSync(aFile, 'a file, not a root');
    const target = scratch('dv-target-');
    writeFileSync(path.join(target, 'keep.txt'), 'keep');
    const link = path.join(base, `dv-unit-${dead}-link00`);
    symlinkSync(target, link);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let removed: string[];
    try {
      removed = sweepStaleTmpRoots(base);
    } finally {
      warn.mockRestore();
    }
    expect(removed).toEqual([deadRoot]);
    expect(existsSync(deadRoot)).toBe(false);
    for (const kept of [liveRoot, badName, oldStyle, aFile, link]) expect(existsSync(kept), kept).toBe(true);
    expect(readFileSync(path.join(target, 'keep.txt'), 'utf8')).toBe('keep');
  });

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
    // The file-system root, the system temp folder, an existing folder with another name, a per-run name that does not exist, a relative path.
    const invalid = ['/', ...(existsSync('/tmp') ? ['/tmp'] : []), plain, path.join(plain, 'dv-unit-1-abcdef'), 'dv-unit-1-abcdef'];
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
  });
});
