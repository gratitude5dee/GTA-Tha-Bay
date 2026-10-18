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

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function main(): never {
  const [tool, ...rest] = args();
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
