/**
 * Durable Object lifecycle gate.
 *
 *   tsx tools/ci/check-do-migrations.ts [--base origin/main]
 *
 * A change to the `migrations`, `durable_objects` or `exports` section of any wrangler.jsonc must change nothing else
 * that runs (a DO class change ships alone through `wrangler deploy`, and rollback cannot cross it). Alone, it passes
 * and prints `label: do-lifecycle`. Docs, specs and tests do not count as runtime changes.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { stripJsonc } from './deploy.ts';
import { args, repoRoot } from './run.ts';

export interface Change {
  file: string;
  /** File text on the base ref, or null when the file is new. */
  before: string | null;
  /** File text on the head, or null when the file was deleted. */
  after: string | null;
}

export interface Verdict {
  ok: boolean;
  lifecycle: boolean;
  label?: 'do-lifecycle';
  reasons: string[];
}

const LIFECYCLE_KEYS = ['migrations', 'durable_objects', 'exports'] as const;

function isWranglerConfig(file: string): boolean {
  return /(^|\/)wrangler\.jsonc$/.test(file);
}

function isNonRuntime(file: string): boolean {
  return (
    /^(spec|docs|research|prompt-pack|\.claude)\//.test(file) ||
    /\.(md|txt)$/.test(file) ||
    /(^|\/)test\//.test(file) ||
    /\.test\.tsx?$/.test(file) ||
    file === 'pnpm-lock.yaml'
  );
}

/** The lifecycle sections of a config (top level and each env), serialized for comparison. */
export function lifecycleSections(text: string | null): string {
  if (text === null) return '';
  const cfg = JSON.parse(stripJsonc(text)) as Record<string, unknown> & { env?: Record<string, Record<string, unknown>> };
  const pick = (o: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(LIFECYCLE_KEYS.filter((k) => k in o).map((k) => [k, o[k]]));
  const envs = Object.fromEntries(Object.entries(cfg.env ?? {}).map(([name, e]) => [name, pick(e)]));
  return JSON.stringify({ top: pick(cfg), envs });
}

/** Config text with the lifecycle sections removed, to tell whether anything else in the config changed. */
function withoutLifecycle(text: string | null): string {
  if (text === null) return '';
  const cfg = JSON.parse(stripJsonc(text)) as Record<string, unknown> & { env?: Record<string, Record<string, unknown>> };
  const strip = (o: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(o).filter(([k]) => !(LIFECYCLE_KEYS as readonly string[]).includes(k)));
  const { env, ...top } = cfg;
  return JSON.stringify({ top: strip(top), envs: Object.fromEntries(Object.entries(env ?? {}).map(([n, e]) => [n, strip(e)])) });
}

export function evaluate(changes: readonly Change[]): Verdict {
  const lifecycleFiles = changes.filter((c) => isWranglerConfig(c.file) && lifecycleSections(c.before) !== lifecycleSections(c.after));
  if (lifecycleFiles.length === 0) return { ok: true, lifecycle: false, reasons: [] };

  const reasons: string[] = [];
  for (const c of changes) {
    if (isNonRuntime(c.file)) continue;
    if (lifecycleFiles.includes(c)) {
      if (withoutLifecycle(c.before) !== withoutLifecycle(c.after)) reasons.push(`${c.file}: changes more than migrations/durable_objects/exports`);
      continue;
    }
    reasons.push(`${c.file}: runtime change in a Durable Object lifecycle change`);
  }
  if (reasons.length > 0) return { ok: false, lifecycle: true, reasons };
  return { ok: true, lifecycle: true, label: 'do-lifecycle', reasons: [] };
}

function git(cwd: string, gitArgs: string[]): { status: number; out: string } {
  const res = spawnSync('git', gitArgs, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: res.status ?? 1, out: res.stdout };
}

export function collectChanges(cwd: string, base: string): Change[] {
  const mergeBase = git(cwd, ['merge-base', base, 'HEAD']);
  if (mergeBase.status !== 0) throw new Error(`cannot find a merge base with ${base}; fetch it (actions/checkout fetch-depth: 0)`);
  const from = mergeBase.out.trim();
  const names = git(cwd, ['diff', '--name-status', '--no-renames', from, 'HEAD']).out.split('\n').filter(Boolean);
  return names.map((line) => {
    const [status, file] = line.split('\t') as [string, string];
    const before = status === 'A' ? null : git(cwd, ['show', `${from}:${file}`]).out;
    const after = status === 'D' ? null : git(cwd, ['show', `HEAD:${file}`]).out;
    return { file, before, after };
  });
}

export function main(argv: string[]): number {
  const { values } = parseArgs({ args: argv, options: { base: { type: 'string', default: 'origin/main' } }, allowPositionals: true });
  const base = values.base ?? 'origin/main';
  if (git(repoRoot, ['rev-parse', '--verify', '--quiet', base]).status !== 0) {
    console.log(`SKIP check:do-migrations: base ref ${base} not found (shallow checkout?)`);
    return 0;
  }
  const verdict = evaluate(collectChanges(repoRoot, base));
  if (!verdict.ok) {
    for (const r of verdict.reasons) console.error(`check:do-migrations FAIL ${r}`);
    console.error('A Durable Object lifecycle change must be the only runtime change in its pull request.');
    return 1;
  }
  if (verdict.lifecycle) console.log(`check:do-migrations ok\nlabel: ${verdict.label}`);
  else console.log('check:do-migrations ok: no Durable Object lifecycle change');
  return 0;
}


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(args()));
