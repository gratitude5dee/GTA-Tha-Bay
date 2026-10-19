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
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

function main(): never {
  const [tool, ...rest0] = args();
  const rest = tool === 'vitest' ? vitestArgs(rest0) : rest0;
  if (!tool) {
    console.error('usage: tsx tools/ci/run.ts <tool> [args...]');
    process.exit(2);
  }
  const bin = path.join(repoRoot, 'node_modules', '.bin', tool);
  if (!existsSync(bin)) {
    console.error(`run.ts: ${bin} not found; run pnpm install`);
    process.exit(2);
  }
  const res = spawnSync(bin, rest, { stdio: 'inherit', cwd: repoRoot, env: process.env });
  if (res.error) {
    console.error(`run.ts: failed to start ${tool}: ${res.error.message}`);
    process.exit(1);
  }
  process.exit(res.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
