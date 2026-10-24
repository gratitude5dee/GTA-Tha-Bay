/**
 * Durable Object lifecycle gate.
 *
 *   tsx tools/ci/check-do-migrations.ts [--base origin/main]
 *
 * A change to the `migrations`, `durable_objects` or `exports` section of any wrangler.jsonc must change nothing else
 * that runs (a DO class change ships alone through `wrangler deploy`, and rollback cannot cross it). Alone, it passes
 * and prints `label: do-lifecycle`. Docs, specs and tests do not count as runtime changes.
 *
 * DL-233: the lifecycle change may also carry what a new class needs to exist: empty DO class skeletons (new files named
 * `*DO.ts`), `export { X } from '...'` lines added to `services/<name>/src/index.ts`, the manifests of a new service package
 * and workspace links added to a package.json. A logic edit in `src/index.ts` still fails.
 *
 * M05c3 (container classes): a Cloudflare Container application is part of its Durable Object class's lifecycle, so the
 * `containers` section counts as a lifecycle section, `export class X extends Container {}` is a skeleton, the
 * `@cloudflare/containers` dependency may be added, new files under `services/<name>/transcoder/` (the image sources the
 * container config points at) ride along, and a `dev` section (local development switches) is ignored.
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

const LIFECYCLE_KEYS = ['migrations', 'durable_objects', 'exports', 'containers'] as const;
/** Sections that only affect local development and bundling, never a deployed object. */
const LOCAL_ONLY_KEYS: readonly string[] = ['dev'];
/** Dependencies a lifecycle change may add besides workspace links: the Container base class (spec/03, @cloudflare/containers 0.3.7). */
const LIFECYCLE_DEPENDENCIES: readonly string[] = ['@cloudflare/containers'];

function isWranglerConfig(file: string): boolean {
  return /(^|\/)wrangler\.jsonc$/.test(file);
}

function isNonRuntime(file: string): boolean {
  return (
    /^(spec|docs|research|prompt-pack|\.claude)\//.test(file) ||
    // CI scripts are not deployed to a Worker, so they cannot affect a DO rollback.
    /^tools\/ci\//.test(file) ||
    /\.(md|txt)$/.test(file) ||
    /(^|\/)test\//.test(file) ||
    /\.test\.tsx?$/.test(file) ||
    file === 'pnpm-lock.yaml'
  );
}

/** The lifecycle sections of a config (top level and each env), serialized for comparison. */
export function lifecycleSections(text: string | null): string {
  if (text === null) return '';
  const cfg = JSON.parse(stripJsonc(text)) as Record<string, unknown> & { env?: Record<string, Record<string, unknown>>; previews?: Record<string, unknown> };
  const pick = (o: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(LIFECYCLE_KEYS.filter((k) => k in o).map((k) => [k, o[k]]));
  const envs = Object.fromEntries(Object.entries(cfg.env ?? {}).map(([name, e]) => [name, pick(e)]));
  return JSON.stringify({ top: pick(cfg), envs, previews: cfg.previews ? pick(cfg.previews) : null });
}

/** Config text with the lifecycle sections removed, to tell whether anything else in the config changed. */
function withoutLifecycle(text: string | null): string {
  if (text === null) return '';
  const cfg = JSON.parse(stripJsonc(text)) as Record<string, unknown> & { env?: Record<string, Record<string, unknown>>; previews?: Record<string, unknown> };
  const strip = (o: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(o).filter(([k]) => !(LIFECYCLE_KEYS as readonly string[]).includes(k) && !LOCAL_ONLY_KEYS.includes(k)));
  const { env, previews, ...top } = cfg;
  return JSON.stringify({
    top: strip(top),
    envs: Object.fromEntries(Object.entries(env ?? {}).map(([n, e]) => [n, strip(e)])),
    previews: previews ? strip(previews) : null,
  });
}

const SKELETON_IMPORT = /^import\s+\{[\w\s,]*\}\s+from\s+'[^']+';?$/;
const SKELETON_CLASS = /^export\s+class\s+\w+\s+extends\s+(?:DurableObject|Container)(<[\w\s,]*>)?\s*\{\s*\}$/;
const EXPORT_FROM = /^export\s+\{\s*[\w\s,]+\}\s+from\s+'[^']+';?$/;

function stripComments(text: string): string[] {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter((l) => l.length > 0);
}

/** A new file holding only imports and empty `export class X extends DurableObject {}` declarations. */
export function isDoSkeleton(c: Change): boolean {
  if (c.before !== null || c.after === null || !/DO\.ts$/.test(c.file)) return false;
  const lines = stripComments(c.after);
  return lines.length > 0 && lines.every((l) => SKELETON_IMPORT.test(l) || SKELETON_CLASS.test(l)) && lines.some((l) => SKELETON_CLASS.test(l));
}

/** services/<name>/src/index.ts where the only difference is added `export { X } from '...'` lines. */
export function isExportOnlyIndexChange(c: Change): boolean {
  if (!/^services\/[^/]+\/src\/index\.ts$/.test(c.file) || c.after === null) return false;
  const before = c.before === null ? [] : c.before.split('\n');
  const after = c.after.split('\n');
  const remaining = [...after];
  for (const line of before) {
    const i = remaining.indexOf(line);
    if (i < 0) return false; // a removed or edited line
    remaining.splice(i, 1);
  }
  return remaining.every((l) => l.trim() === '' || EXPORT_FROM.test(l.trim()));
}

/** Manifests of a new service package, or a package.json whose only change is added workspace links. */
export function isPackageScaffold(c: Change): boolean {
  if (c.after === null) return false;
  if (c.before === null) return /^services\/[^/]+\/(package\.json|tsconfig\.json)$/.test(c.file);
  if (!/(^|\/)package\.json$/.test(c.file)) return false;
  const a = JSON.parse(c.before) as Record<string, unknown>;
  const b = JSON.parse(c.after) as Record<string, unknown>;
  const sections = ['dependencies', 'devDependencies'];
  const strip = (o: Record<string, unknown>): string => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !sections.includes(k))));
  if (strip(a) !== strip(b)) return false;
  return sections.every((sec) => {
    const old = (a[sec] ?? {}) as Record<string, string>;
    const now = (b[sec] ?? {}) as Record<string, string>;
    return Object.keys(old).every((k) => now[k] === old[k]) && Object.entries(now).every(([k, v]) => k in old || v.startsWith('workspace:') || LIFECYCLE_DEPENDENCIES.includes(k));
  });
}

/** A new file of a container image: `services/<name>/transcoder/**` (Dockerfile, scripts, server). */
export function isContainerSource(c: Change): boolean {
  return c.before === null && c.after !== null && /^services\/[^/]+\/transcoder\//.test(c.file);
}

function isLifecycleScaffold(c: Change): boolean {
  return isDoSkeleton(c) || isExportOnlyIndexChange(c) || isPackageScaffold(c) || isContainerSource(c);
}

export function evaluate(changes: readonly Change[]): Verdict {
  const lifecycleFiles = changes.filter((c) => isWranglerConfig(c.file) && lifecycleSections(c.before) !== lifecycleSections(c.after));
  if (lifecycleFiles.length === 0) return { ok: true, lifecycle: false, reasons: [] };

  const reasons: string[] = [];
  for (const c of changes) {
    if (isNonRuntime(c.file) || isLifecycleScaffold(c)) continue;
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
