import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { repoRoot, tmpLabel } from '../run.ts';
import { TMP_ROOT_ENV, TMP_ROOT_NAME, TMP_VARS, createTmpRoot, enterTmpRoot, removeTmpRoot, withTmpRoot } from '../tmp-root.ts';

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
