/**
 * Verifier lock (M04d; 13-qa.md 2.3 item 3 and 3.6), built on M00d's `golden-guard`.
 *
 * `tools/ci/verifiers.lock.json` stores, per verifier (runner, drivers, det spec, econ-sim, goldens), the SHA-256 of its files and
 * the subject paths it verifies. Two rules:
 *   1. pair rule: a change to a verifier and to one of its subjects in the same range fails unless the PR carries the label
 *      `golden-update` and a non-empty reason (`DV_PR_REASON`: one line, or the PR body with a `Golden-update: <reason>` line);
 *   2. hash rule: the stored hash of a verifier must equal the repository (refresh with `--write` in the PR that changes it).
 *
 *   tsx tools/ci/verifiers-lock.ts           check (CI: GITHUB_BASE_REF set adds the pair rule over origin/$GITHUB_BASE_REF...HEAD)
 *   tsx tools/ci/verifiers-lock.ts --write   refresh the hashes
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalize } from '../../packages/shared/src/json.ts';
import { changedPathsFromGit, GOLDEN_LABEL, labelsFromEnv } from './golden-guard.ts';
import { isMain, toolsRoot, walk } from './lib/common.ts';
import { args } from './run.ts';

export const LOCK_PATH = path.join(toolsRoot, 'tools', 'ci', 'verifiers.lock.json');

export interface VerifierDef {
  /** Files or directories (repo-relative, `/` separators) that are the verifier. */
  paths: string[];
  /** Path prefixes (directories end with `/`) of the code the verifier checks. */
  subjects: string[];
}

export interface VerifierEntry extends VerifierDef {
  sha256: string;
}

export interface VerifiersLock {
  v: 1;
  verifiers: Record<string, VerifierEntry>;
}

/** What is locked: the verifier scripts and the golden directories of the QA layer (13-qa.md 3.4, 3.6). */
export const VERIFIER_DEFS: Readonly<Record<string, VerifierDef>> = {
  'engine-runner': {
    paths: [
      'packages/engine/src/qa/runner.ts', 'packages/engine/src/qa/bots.ts', 'packages/engine/src/qa/scenarios.ts',
      'packages/engine/src/qa/golden.ts', 'packages/engine/src/qa/engine-specs.ts', 'packages/engine/src/qa/browser.ts',
    ],
    subjects: ['packages/engine/src/sim/', 'packages/engine/src/headless/', 'tests/golden/'],
  },
  'engine-drivers': {
    paths: ['packages/engine/src/qa/drivers/'],
    subjects: ['packages/engine/src/sim/lines/', 'packages/engine/src/sim/input/', 'packages/engine/src/sim/vehicle/', 'tests/golden/'],
  },
  'det-suites': {
    paths: ['tests/e2e/det/', 'tests/e2e/determinism.spec.ts'],
    subjects: ['apps/web/src/qa/', 'packages/engine/src/sim/', 'packages/engine/src/workers/', 'tests/golden/'],
  },
  'econ-sim': {
    paths: ['tools/ci/econ-sim/', 'config/econ-bands.json'],
    subjects: ['packages/engine/src/sim/modes/', 'packages/modes/', 'packages/shared/src/contracts/'],
  },
  'tycoon-sim': {
    // the baseline file is not locked: it is rewritten together with a balance change under a `balance-rebaseline:` commit line
    paths: ['tools/ci/tycoon-sim/', 'config/tycoon.bands.json'],
    subjects: ['packages/shared/src/events/', 'packages/shared/src/tycoon/', 'packages/modes/tycoon/', 'content/tycoon/', 'config/tycoon.balance.json'],
  },
  'goldens-qa': {
    paths: ['tests/golden/'],
    subjects: ['packages/engine/src/sim/', 'packages/shared/src/', 'packages/world/src/'],
  },
  'goldens-package': {
    paths: [
      'packages/engine/test/golden/', 'packages/shared/test/golden/', 'packages/world/test/golden/',
      'packages/engine/src/sim/save/__golden__/',
    ],
    subjects: ['packages/engine/src/sim/', 'packages/shared/src/', 'packages/world/src/'],
  },
};

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

/** Repo-relative files of a verifier, sorted; a directory entry (trailing `/`) expands recursively. */
export function verifierFiles(def: VerifierDef, root: string = toolsRoot): string[] {
  const out = new Set<string>();
  for (const p of def.paths) {
    const abs = path.join(root, p);
    if (!existsSync(abs)) throw new Error(`verifier path is missing: ${p}`);
    if (statSync(abs).isDirectory()) for (const f of walk(abs)) out.add(`${p.replace(/\/+$/, '')}/${f}`);
    else out.add(norm(p));
  }
  return [...out].sort();
}

/** SHA-256 over `<path>\0<sha256 of the bytes>\n` lines of the verifier's files. */
export function hashVerifier(def: VerifierDef, root: string = toolsRoot): string {
  const h = createHash('sha256');
  for (const f of verifierFiles(def, root)) {
    h.update(`${f}\0${createHash('sha256').update(readFileSync(path.join(root, f))).digest('hex')}\n`);
  }
  return h.digest('hex');
}

export function buildLock(root: string = toolsRoot): VerifiersLock {
  const verifiers: Record<string, VerifierEntry> = {};
  for (const [id, def] of Object.entries(VERIFIER_DEFS)) verifiers[id] = { ...def, sha256: hashVerifier(def, root) };
  return { v: 1, verifiers };
}

export function readLock(file: string = LOCK_PATH): VerifiersLock {
  return JSON.parse(readFileSync(file, 'utf8')) as VerifiersLock;
}

export function lockText(lock: VerifiersLock): string {
  return `${JSON.stringify(JSON.parse(canonicalize(lock)), null, 2)}\n`;
}

export interface LockResult {
  ok: boolean;
  messages: string[];
}

const inPaths = (changed: string, def: VerifierDef): boolean =>
  def.paths.some((p) => (p.endsWith('/') ? changed.startsWith(p) : changed === p));
const inSubjects = (changed: string, def: VerifierDef): boolean => def.subjects.some((s) => changed.startsWith(s));

/** The reason of the PR: `Golden-update: <reason>` line of a body, or a one-line value; empty when there is none. */
export function reasonOf(text: string | undefined): string {
  if (!text) return '';
  const m = /^\s*golden-update(?:\s+reason)?\s*:\s*(\S.*)$/im.exec(text);
  if (m) return (m[1] as string).trim();
  if (/^\s*golden-update(?:\s+reason)?\s*:/im.test(text)) return '';
  return /[\r\n]/.test(text.trim()) ? '' : text.trim();
}

/**
 * Pair rule. `changedPaths` empty (a push to main) checks nothing here. A verifier and its subject changed together fails without
 * the label `golden-update` and a non-empty reason.
 */
export function verify(changedPaths: readonly string[], labels: readonly string[], reason: string, defs: Readonly<Record<string, VerifierDef>> = VERIFIER_DEFS): LockResult {
  const changed = changedPaths.map(norm);
  if (changed.length === 0) return { ok: true, messages: ['verifiers-lock: no changed paths (push to main): hashes only, the pair rule is skipped'] };
  const messages: string[] = [];
  const hasLabel = labels.map((l) => l.trim()).includes(GOLDEN_LABEL);
  const hasReason = reason.trim() !== '';
  let ok = true;
  for (const [id, def] of Object.entries(defs)) {
    const verifierChanged = changed.filter((c) => inPaths(c, def));
    const subjectChanged = changed.filter((c) => inSubjects(c, def) && !inPaths(c, def));
    if (verifierChanged.length === 0 || subjectChanged.length === 0) continue;
    const pair = `${id}: ${verifierChanged[0]} and ${subjectChanged[0]} changed together`;
    if (hasLabel && hasReason) messages.push(`verifiers-lock: ${pair}; label ${GOLDEN_LABEL} and a reason are present`);
    else {
      ok = false;
      messages.push(`verifiers-lock: ${pair} without ${!hasLabel ? `the label ${GOLDEN_LABEL}` : 'a reason (DV_PR_REASON / the Golden-update: line of the PR body)'}`);
    }
  }
  if (messages.length === 0) messages.push('verifiers-lock: no verifier changed together with its subject');
  return { ok, messages };
}

/** Hash rule: the stored hashes must equal the repository. */
export function checkHashes(lock: VerifiersLock, root: string = toolsRoot): LockResult {
  const messages: string[] = [];
  let ok = true;
  const ids = new Set([...Object.keys(VERIFIER_DEFS), ...Object.keys(lock.verifiers)]);
  for (const id of [...ids].sort()) {
    const def = VERIFIER_DEFS[id];
    const entry = lock.verifiers[id];
    if (!def) {
      ok = false;
      messages.push(`verifiers-lock: ${id} is in the lock but not defined in verifiers-lock.ts`);
    } else if (!entry) {
      ok = false;
      messages.push(`verifiers-lock: ${id} is not in verifiers.lock.json; run: tsx tools/ci/verifiers-lock.ts --write`);
    } else if (hashVerifier(def, root) !== entry.sha256) {
      ok = false;
      messages.push(`verifiers-lock: ${id} differs from verifiers.lock.json; refresh with: tsx tools/ci/verifiers-lock.ts --write (golden-update label and reason when subjects changed too)`);
    }
  }
  if (ok) messages.push(`verifiers-lock: ${ids.size} verifier hashes match`);
  return { ok, messages };
}

function main(): number {
  const argv = args();
  if (argv.includes('--write')) {
    writeFileSync(LOCK_PATH, lockText(buildLock()));
    console.log(`verifiers-lock: wrote ${path.relative(toolsRoot, LOCK_PATH)}`);
    return 0;
  }
  const hashes = checkHashes(readLock());
  for (const m of hashes.messages) console.log(m);
  const changed = changedPathsFromGit();
  const pair = changed ? verify(changed, labelsFromEnv(), reasonOf(process.env['DV_PR_REASON'])) : { ok: true, messages: ['verifiers-lock: GITHUB_BASE_REF not set; the pair rule is skipped'] };
  for (const m of pair.messages) console.log(m);
  return hashes.ok && pair.ok ? 0 : 1;
}

if (isMain(import.meta.url)) process.exit(main());
