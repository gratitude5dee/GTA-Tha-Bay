/**
 * Argument shim for root scripts.
 *
 * pnpm passes a literal `--` through to the script (`pnpm check:unit -- packages/ui` runs
 * `tsx tools/ci/run.ts vitest run -- packages/ui`). Playwright, Vitest and util.parseArgs treat that
 * `--` as "everything after me is positional", so filters and flags stop working. This file removes
 * the first `--` before the tool sees its arguments.
 *
 * Usage: tsx tools/ci/run.ts <tool> [args...]   (<tool> is a binary in node_modules/.bin)
 * In-house scripts import args() and parse its result.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnInTmpRoot } from './tmp-root.ts';

/** Drops the first literal `--` from an argument list (and only the first). */
export function dropDashDash(list: readonly string[]): string[] {
  const i = list.indexOf('--');
  return i < 0 ? [...list] : [...list.slice(0, i), ...list.slice(i + 1)];
}

/** `process.argv.slice(2)` without the `--` that pnpm passes through. */
export function args(argv: readonly string[] = process.argv.slice(2)): string[] {
  return dropDashDash(argv);
}

function vitestArgs(list: readonly string[]): string[] {
  return list.includes('--pkg') ? ['run', ...mapPkgFilter(list.filter((a) => a !== 'run'))] : [...list];
}

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * `--pkg <dir>` (vitest only): select the specs under `<dir>/test/`. Positional arguments become name filters
 * inside that directory (`--pkg packages/shared detmath` runs `packages/shared/test/detmath*`); with none, the whole
 * directory runs. Vitest filters are substring matches on the file path from the repository root, so the root
 * config (include globs are root-relative) keeps applying. Other flags pass through untouched.
 */
export function mapPkgFilter(list: readonly string[]): string[] {
  const i = list.indexOf('--pkg');
  const dir = i >= 0 ? list[i + 1] : undefined;
  if (i < 0 || !dir) return [...list];
  const rest = [...list.slice(0, i), ...list.slice(i + 2)];
  const base = `${dir.replace(/\/+$/, '')}/test/`;
  const flags = rest.filter((a) => a.startsWith('-') && a !== '--');
  const names = rest.filter((a) => !a.startsWith('-'));
  return [...flags, ...(names.length ? names.map((n) => `${base}${n}`) : [base])];
}

/** The `--pkg` spec directory (`<dir>/test/`) and its positional name filters, or null without `--pkg`. */
export function pkgSelection(list: readonly string[]): { dir: string; base: string; names: string[] } | null {
  const i = list.indexOf('--pkg');
  const dir = i >= 0 ? list[i + 1] : undefined;
  if (i < 0 || !dir) return null;
  const rest = [...list.slice(0, i), ...list.slice(i + 2)];
  const clean = dir.replace(/\/+$/, '');
  return { dir: clean, base: `${clean}/test/`, names: rest.filter((a) => !a.startsWith('-')) };
}

/** Repo-relative paths of the spec files (`*.{test,spec}.{ts,tsx}`) under `<root>/<dir>/test/`, recursive. */
export function listSpecs(dir: string, root: string = repoRoot): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    let entries;
    try {
      entries = readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (/\.(test|spec)\.tsx?$/.test(e.name)) out.push(child);
    }
  };
  walk(`${dir.replace(/\/+$/, '')}/test`);
  return out;
}

/** Names whose filter `<dir>/test/<name>` is contained in none of the spec paths (DL-674 part 2). */
export function unmatchedNames(base: string, names: readonly string[], specs: readonly string[]): string[] {
  return names.filter((n) => !specs.some((s) => s.includes(`${base}${n}`)));
}

async function main(): Promise<number> {
  const [tool, ...rest0] = args();
  if (tool === 'vitest') {
    const sel = pkgSelection(rest0);
    if (sel && sel.names.length > 0) {
      const missing = unmatchedNames(sel.base, sel.names, listSpecs(sel.dir));
      if (missing.length > 0) {
        for (const n of missing) console.error(`run.ts: no spec under ${sel.dir}/test matches ${n}`);
        return 1;
      }
    }
  }
  const rest = tool === 'vitest' ? vitestArgs(rest0) : rest0;
  if (!tool) {
    console.error('usage: tsx tools/ci/run.ts <tool> [args...]');
    return 2;
  }
  const bin = path.join(repoRoot, 'node_modules', '.bin', tool);
  if (!existsSync(bin)) {
    console.error(`run.ts: ${bin} not found; run pnpm install`);
    return 2;
  }
  // BD-FIX-TMP-01: the tool and everything it starts work inside one per-run temporary root, removed when the tool exits (pass, fail or
  // interrupt). The spawn is asynchronous so the event loop stays free: tsx's signal relay is acknowledged (a blocked loop got run.ts
  // SIGKILLed on Ctrl-C and the root leaked), SIGINT, SIGTERM and SIGHUP are forwarded to the tool, and the exit code is the tool's
  // (128 + signal when a signal ended it).
  return spawnInTmpRoot(tmpLabel(tool), bin, rest, { cwd: repoRoot, name: 'run.ts' });
}

/** The per-run root label for a tool name (`dv-<label>-<pid>-XXXXXX`). */
export function tmpLabel(tool: string): string {
  return tool.toLowerCase().replace(/[^a-z0-9]/g, '') || 'run';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().then((code) => process.exit(code));
