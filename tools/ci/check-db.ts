/**
 * pnpm check:db (M05d): migration lint, then the pgTAP files and the DataPort contract run against a local database.
 *
 *   tsx tools/ci/check-db.ts [--lint-only] [--pg-url <postgres url>] [--keep]
 *
 * Mode 1, the Supabase local stack (CI, any machine with Docker): `supabase start` -> `supabase db lint --level error --fail-on error`
 * -> `supabase test db` -> the contract test of services/edge/test/db against the stack's API -> `supabase stop`.
 *
 * Mode 2, `--pg-url` or DV_DB_URL (a throwaway Postgres 16 or 17 with the pgtap extension, no Docker): the database named in the URL is
 * dropped and recreated, supabase/support/local-pg-shim.sql stands in for the Supabase roles and schema auth, the migrations are
 * applied with psql and every supabase/tests/*.sql runs through psql with its TAP output parsed here. `supabase db lint` needs the
 * plpgsql_check extension of the Supabase image, so this mode runs only the migration lint of tools/ci/lib/db-lint.ts. The contract
 * test runs when DV_DB_API_URL and DV_DB_SECRET_KEY point at a Supabase-compatible API (PostgREST behind /rest/v1) for that database.
 *
 * Neither mode available: outside CI the script prints `SKIP check:db: docker not available` and exits 0 after the lint; in CI it fails.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { formatFinding, lintMigrations, type LintFinding, type MigrationFile } from './lib/db-lint.ts';
import { args, repoRoot } from './run.ts';

export const MIGRATIONS_DIR = 'supabase/migrations';
export const TESTS_DIR = 'supabase/tests';
export const SHIM = 'supabase/support/local-pg-shim.sql';

/** Reads the migration files of a repository root. */
export function readMigrations(root: string = repoRoot): MigrationFile[] {
  const dir = path.join(root, MIGRATIONS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => !n.startsWith('.'))
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(dir, name), 'utf8') }));
}

export function lintRepo(root: string = repoRoot): LintFinding[] {
  return lintMigrations(readMigrations(root));
}

export interface TapSummary {
  planned: number | null;
  ok: number;
  notOk: string[];
  errors: string[];
  problems: string[];
}

/** Reads the TAP output of one pgTAP file as psql prints it (`-t -A`): the plan, ok / not ok lines and psql errors. */
export function summariseTap(output: string): TapSummary {
  const s: TapSummary = { planned: null, ok: 0, notOk: [], errors: [], problems: [] };
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    const plan = /^1\.\.(\d+)$/.exec(line);
    if (plan) s.planned = Number.parseInt(plan[1]!, 10);
    else if (/^not ok\b/.test(line)) s.notOk.push(line);
    else if (/^ok\b/.test(line)) s.ok++;
    else if (/\bERROR:/.test(line)) s.errors.push(line);
  }
  if (s.planned === null) s.problems.push('no plan line: the file never reached select plan(n)');
  else if (s.planned !== s.ok + s.notOk.length) s.problems.push(`planned ${s.planned} tests, ran ${s.ok + s.notOk.length}`);
  for (const l of s.notOk) s.problems.push(l);
  for (const l of s.errors) s.problems.push(l);
  return s;
}

type Runner = (cmd: string, argv: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv; inherit?: boolean }) => SpawnSyncReturns<string>;
const defaultRun: Runner = (cmd, argv, opts = {}) =>
  spawnSync(cmd, argv, { cwd: opts.cwd ?? repoRoot, env: opts.env ?? process.env, encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe', maxBuffer: 64 * 1024 * 1024 });

const log = (line: string): void => void console.log(line);

function supabaseBin(): string {
  return path.join(repoRoot, 'node_modules', '.bin', 'supabase');
}

function dockerAvailable(run: Runner): boolean {
  const r = run('docker', ['info'], {});
  return !r.error && r.status === 0;
}

function contractTest(run: Runner, env: NodeJS.ProcessEnv): number {
  const r = run('pnpm', ['--filter', '@dv/edge', 'exec', 'vitest', 'run', '--config', 'vitest.db.config.ts'], { env: { ...process.env, ...env }, inherit: true });
  return r.status ?? 1;
}

/** Mode 1: the Supabase local stack. */
export function runStack(run: Runner = defaultRun): number {
  const sb = supabaseBin();
  const step = (title: string, argv: string[]): boolean => {
    log(`check:db: ${title}`);
    return (run(sb, argv, { inherit: true }).status ?? 1) === 0;
  };
  let code = 0;
  try {
    if (!step('supabase start', ['start'])) return 1;
    if (!step('supabase db lint', ['db', 'lint', '--level', 'error', '--fail-on', 'error'])) code = 1;
    if (!step('supabase test db', ['test', 'db'])) code = 1;
    const status = run(sb, ['status', '-o', 'env'], {});
    const vars = Object.fromEntries(
      (status.stdout ?? '')
        .split('\n')
        .map((l) => /^([A-Z0-9_]+)="?(.*?)"?$/.exec(l.trim()))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => [m[1]!, m[2]!] as const),
    );
    const apiUrl = vars['API_URL'];
    const key = vars['SECRET_KEY'] ?? vars['SERVICE_ROLE_KEY'];
    if (!apiUrl || !key) {
      log('check:db: FAIL supabase status printed no API_URL and SECRET_KEY (or SERVICE_ROLE_KEY)');
      return 1;
    }
    log('check:db: DataPort contract against the local stack');
    if (contractTest(run, { DV_DB_API_URL: apiUrl, DV_DB_SECRET_KEY: key }) !== 0) code = 1;
  } finally {
    run(sb, ['stop', '--no-backup'], { inherit: true });
  }
  return code;
}

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export interface Provisioned {
  /** The same server, database `postgres`: where the throwaway database is dropped. */
  admin: string;
  target: string;
  psql(u: string, argv: string[]): SpawnSyncReturns<string>;
  drop(): void;
}

/**
 * Drops and recreates the database named in `url`, loads the shim and applies every migration. Returns null (after printing why)
 * when a step fails. The caller drops the database with `drop()` unless it asked to keep it.
 */
export function provisionDatabase(url: string, run: Runner = defaultRun, tag = 'check:db'): Provisioned | null {
  const target = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/^[a-z0-9_]+$/.test(target) || target === 'postgres') {
    log(`${tag}: FAIL the database named in the URL is recreated on every run; give a throwaway name (letters, digits, underscore) that is not "postgres"`);
    return null;
  }
  const admin = withDatabase(url, 'postgres');
  const psql = (u: string, argv: string[]): SpawnSyncReturns<string> => run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', u, ...argv], {});
  const drop = (): void => void psql(admin, ['-c', `drop database if exists ${target} with (force)`]);
  for (const sql of [`drop database if exists ${target} with (force)`, `create database ${target}`]) {
    const r = psql(admin, ['-c', sql]);
    if (r.status !== 0) {
      log(`${tag}: FAIL ${sql}: ${(r.stderr ?? '').trim().split('\n')[0] ?? ''}`);
      return null;
    }
  }
  const apply = (rel: string, single: boolean): boolean => {
    const r = psql(url, [...(single ? ['-1'] : []), '-f', path.join(repoRoot, rel)]);
    if (r.status !== 0) log(`${tag}: FAIL applying ${rel}: ${(r.stderr ?? '').trim().split('\n').slice(0, 3).join(' | ')}`);
    return r.status === 0;
  };
  const ok = apply(SHIM, false) && readMigrations().every((m) => apply(`${MIGRATIONS_DIR}/${m.name}`, true));
  if (!ok) {
    drop();
    return null;
  }
  return { admin, target, psql, drop };
}

/** Mode 2: a plain Postgres with pgtap. */
export function runPlainPostgres(url: string, run: Runner = defaultRun, keep = false): number {
  const db = provisionDatabase(url, run);
  if (db === null) return 1;
  let code = 0;
  try {
    log(`check:db: ${readMigrations().length} migrations applied`);

    const files = readdirSync(path.join(repoRoot, TESTS_DIR)).filter((n) => n.endsWith('.sql')).sort();
    for (const f of files) {
      const r = run('psql', ['-X', '-q', '-t', '-A', url, '-f', path.join(repoRoot, TESTS_DIR, f)], {});
      const s = summariseTap(`${r.stdout ?? ''}\n${r.stderr ?? ''}`);
      if (s.problems.length === 0) log(`check:db: ok ${f} (${s.ok} tests)`);
      else {
        code = 1;
        log(`check:db: FAIL ${f}`);
        for (const p of s.problems) log(`  ${p}`);
      }
    }
    if (process.env['DV_DB_API_URL'] && process.env['DV_DB_SECRET_KEY']) {
      log('check:db: DataPort contract against DV_DB_API_URL');
      if (contractTest(run, {}) !== 0) code = 1;
    } else {
      log('SKIP check:db contract run: DV_DB_API_URL / DV_DB_SECRET_KEY not set (no API in front of this database)');
    }
  } finally {
    if (!keep) db.drop();
  }
  return code;
}

export function main(argv: string[], run: Runner = defaultRun): number {
  const { values } = parseArgs({
    args: argv,
    options: { 'lint-only': { type: 'boolean', default: false }, 'pg-url': { type: 'string' }, keep: { type: 'boolean', default: false } },
  });
  const findings = lintRepo();
  for (const f of findings) log(`check:db: FAIL ${formatFinding(f)}`);
  if (findings.length > 0) return 1;
  log(`check:db: migration lint ok (${readMigrations().length} files)`);
  if (values['lint-only']) return 0;

  const url = values['pg-url'] ?? process.env['DV_DB_URL'];
  if (url) return runPlainPostgres(url, run, values.keep);
  if (dockerAvailable(run)) return runStack(run);
  if (process.env['CI']) {
    log('check:db: FAIL docker is not available in CI');
    return 1;
  }
  log('SKIP check:db: docker not available');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(args()));
