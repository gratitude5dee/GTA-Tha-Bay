/**
 * The golden store (M04d; 13-qa.md 3.4). Node only. Layout `tests/golden/<suite>/<name>.json` in `canonicalize` form.
 * `DV_UPDATE_GOLDEN=1` rewrites only the golden of the run's suite directory; a CI run with `DV_UPDATE_GOLDEN` set fails in the
 * runner before it steps (`assertNoGoldenUpdateInCi`). Updates go through a pull request labelled `golden-update`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { canonicalize } from '@dv/shared';
import type { StateHashTrace } from './runner.ts';

/** `build` is machine state (a commit sha), not behaviour: goldens store this constant and comparisons ignore the field. */
export const GOLDEN_BUILD = 'golden';

export function goldenRoot(): string {
  // packages/engine/src/qa -> repository root
  return resolve(dirname(new URL(import.meta.url).pathname), '../../../..', 'tests', 'golden');
}

export function goldenPath(suite: string, name: string, root: string = goldenRoot()): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(suite) || !/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new Error(`golden id '${suite}/${name}' must use letters, digits, dot, dash and underscore only`);
  }
  const p = resolve(join(root, suite, `${name}.json`));
  if (!p.startsWith(resolve(root) + sep)) throw new Error(`golden path escapes the golden root: ${p}`);
  return p;
}

/** The trace as a golden stores it. */
export function toGolden(trace: StateHashTrace): StateHashTrace {
  return { ...trace, build: GOLDEN_BUILD };
}

export function goldenText(trace: StateHashTrace): string {
  return `${canonicalize(toGolden(trace))}\n`;
}

export function readGolden(suite: string, name: string, root?: string): StateHashTrace | null {
  const p = goldenPath(suite, name, root);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as StateHashTrace) : null;
}

export interface GoldenCheck {
  ok: boolean;
  /** `matched`, `written` (update mode), `missing` or `differs`. */
  state: 'matched' | 'written' | 'missing' | 'differs';
  path: string;
  /** The first checkpoint that differs, when `differs`. */
  firstDiff?: string;
}

const updating = (env: Readonly<Record<string, string | undefined>>): boolean => env['DV_UPDATE_GOLDEN'] === '1';

/**
 * Compares `trace` with `tests/golden/<suite>/<name>.json`. With `DV_UPDATE_GOLDEN=1` (and CI unset) it writes that one file
 * and nothing else.
 */
export function checkGolden(
  trace: StateHashTrace,
  name: string,
  opts: { root?: string; env?: Readonly<Record<string, string | undefined>> } = {},
): GoldenCheck {
  const env = opts.env ?? process.env;
  const path = goldenPath(trace.spec.suite, name, opts.root);
  if (updating(env)) {
    const ci = env['CI'];
    if (ci !== undefined && ci !== '' && ci !== '0' && ci !== 'false') throw new Error('DV_UPDATE_GOLDEN is set in a CI run');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, goldenText(trace));
    return { ok: true, state: 'written', path };
  }
  if (!existsSync(path)) return { ok: false, state: 'missing', path };
  const want = readFileSync(path, 'utf8');
  const got = goldenText(trace);
  if (want === got) return { ok: true, state: 'matched', path };
  return { ok: false, state: 'differs', path, firstDiff: describeDiff(JSON.parse(want) as StateHashTrace, toGolden(trace)) };
}

/** Which checkpoint (or the end, or the spec) is the first to differ between two traces. */
export function describeDiff(want: StateHashTrace, got: StateHashTrace): string {
  if (canonicalize(want.spec) !== canonicalize(got.spec)) return 'spec differs';
  const n = Math.max(want.checkpoints.length, got.checkpoints.length);
  for (let i = 0; i < n; i++) {
    const a = want.checkpoints[i];
    const b = got.checkpoints[i];
    if (!a || !b || a.tick !== b.tick || a.hash !== b.hash) {
      return `checkpoint ${i}: want ${a ? `${a.tick}:${a.hash}` : 'none'}, got ${b ? `${b.tick}:${b.hash}` : 'none'}`;
    }
  }
  return `end: want ${want.end.tick}:${want.end.hash}:${want.end.outcome}, got ${got.end.tick}:${got.end.hash}:${got.end.outcome}`;
}

/** Traces equal when everything but `build` is equal. */
export function sameTrace(a: StateHashTrace, b: StateHashTrace): boolean {
  return canonicalize(toGolden(a)) === canonicalize(toGolden(b));
}
