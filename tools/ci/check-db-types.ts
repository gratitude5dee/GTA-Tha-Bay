/**
 * pnpm check:db:types (M05d): regenerates packages/shared/src/db.gen.ts from the migrations and fails on any difference.
 *
 *   tsx tools/ci/check-db-types.ts [--write] [--pg-url <postgres url>]
 *
 * The generator is `supabase gen types typescript --db-url <url> --schema public` (the same call for both ways of getting a database):
 *   - Supabase local stack (Docker): `supabase db start` applies the migrations, the URL is the stack's own, then `supabase stop`.
 *   - --pg-url or DV_DB_URL (throwaway database, no Docker): provisioned like check:db does (shim + migrations).
 * --write rewrites the file instead of comparing. Neither available: SKIP outside CI, failure in CI.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { provisionDatabase, readMigrations } from './check-db.ts';
import { args, repoRoot } from './run.ts';

export const TYPES_FILE = 'packages/shared/src/db.gen.ts';
const LOCAL_STACK_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const log = (line: string): void => void console.log(line);
const sb = (): string => path.join(repoRoot, 'node_modules', '.bin', 'supabase');

/** Generated text for the database at `url`, or null (after printing why). */
function generate(url: string): string | null {
  const r = spawnSync(sb(), ['gen', 'types', 'typescript', '--db-url', url, '--schema', 'public'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0 || !r.stdout) {
    log(`check:db:types: FAIL supabase gen types failed: ${(r.stderr || r.error?.message || '').trim().split('\n').slice(-2).join(' | ')}`);
    return null;
  }
  return r.stdout;
}

/** First differing lines, for the failure message. */
export function firstDifference(a: string, b: string): string {
  const x = a.split('\n');
  const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return `line ${i + 1}: file has ${JSON.stringify((x[i] ?? '').slice(0, 120))}, generated has ${JSON.stringify((y[i] ?? '').slice(0, 120))}`;
  }
  return 'no difference';
}

export function main(argv: string[]): number {
  const { values } = parseArgs({ args: argv, options: { write: { type: 'boolean', default: false }, 'pg-url': { type: 'string' } } });
  const url = values['pg-url'] ?? process.env['DV_DB_URL'];
  let generated: string | null = null;

  if (url) {
    const db = provisionDatabase(url, undefined, 'check:db:types');
    if (db === null) return 1;
    try {
      generated = generate(url);
    } finally {
      db.drop();
    }
  } else if (spawnSync('docker', ['info'], { encoding: 'utf8' }).status === 0) {
    log(`check:db:types: supabase db start (${readMigrations().length} migrations)`);
    try {
      if ((spawnSync(sb(), ['db', 'start'], { cwd: repoRoot, stdio: 'inherit' }).status ?? 1) !== 0) return 1;
      generated = generate(LOCAL_STACK_URL);
    } finally {
      spawnSync(sb(), ['stop', '--no-backup'], { cwd: repoRoot, stdio: 'inherit' });
    }
  } else if (process.env['CI']) {
    log('check:db:types: FAIL docker is not available in CI');
    return 1;
  } else {
    log('SKIP check:db:types: docker not available (set DV_DB_URL to a throwaway Postgres to run without it)');
    return 0;
  }
  if (generated === null) return 1;

  const file = path.join(repoRoot, TYPES_FILE);
  if (values.write) {
    writeFileSync(file, generated);
    log(`check:db:types: wrote ${TYPES_FILE}`);
    return 0;
  }
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current !== generated) {
    log(`check:db:types: FAIL ${TYPES_FILE} differs from the generated types (${firstDifference(current, generated)}); run: pnpm check:db:types -- --write`);
    return 1;
  }
  log(`check:db:types: ${TYPES_FILE} matches the migrations`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(args()));
