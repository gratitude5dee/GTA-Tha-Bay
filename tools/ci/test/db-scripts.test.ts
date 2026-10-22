import { describe, expect, it } from 'vitest';
import { lintRepo, summariseTap } from '../check-db.ts';
import { firstDifference } from '../check-db-types.ts';
import { execute, formatStep, main as dbPush, planPush } from '../db-push.ts';
import { lintMigrations, stripSql } from '../lib/db-lint.ts';
import { selectSuites } from '../test-staging.ts';

const ok = (n: number, name: string): { name: string; text: string } => ({
  name: `${String(n).padStart(4, '0')}_${name}.sql`,
  text: `create table t${n} (id int primary key);\nalter table t${n} enable row level security;\n`,
});

describe('migration lint (AC-4)', () => {
  it('the real migrations pass', () => {
    expect(lintRepo()).toEqual([]);
  });

  it('create index concurrently fails with no-concurrent-index', () => {
    const f = lintMigrations([ok(1, 'a'), { name: '0002_b.sql', text: 'create index concurrently i on t1 (id);' }]);
    expect(f.map((x) => x.rule)).toEqual(['no-concurrent-index']);
    expect(f[0]?.file).toBe('0002_b.sql');
  });

  it('a gap in the numbering fails with contiguous-numbering', () => {
    const f = lintMigrations([ok(1, 'a'), ok(3, 'c')]);
    expect(f.map((x) => x.rule)).toEqual(['contiguous-numbering']);
    expect(f[0]?.message).toContain('expected 0002');
  });

  it('a repeated number fails with contiguous-numbering', () => {
    const f = lintMigrations([ok(1, 'a'), { ...ok(1, 'b') }]);
    expect(f.some((x) => x.rule === 'contiguous-numbering' && x.message.includes('twice'))).toBe(true);
  });

  it('numbering must start at 0001', () => {
    expect(lintMigrations([ok(2, 'a')]).map((x) => x.rule)).toEqual(['contiguous-numbering']);
  });

  it('a table without enable row level security fails with rls-required', () => {
    const f = lintMigrations([ok(1, 'a'), { name: '0002_b.sql', text: 'create table public.bare (id int);' }]);
    expect(f.map((x) => x.rule)).toEqual(['rls-required']);
    expect(f[0]?.message).toContain('bare');
  });

  it('row level security enabled before the create does not count, and a different table does not count', () => {
    const before = lintMigrations([{ name: '0001_a.sql', text: 'alter table x enable row level security;\ncreate table x (id int);' }]);
    expect(before.map((x) => x.rule)).toEqual(['rls-required']);
    const other = lintMigrations([{ name: '0001_a.sql', text: 'create table x (id int);\nalter table y enable row level security;' }]);
    expect(other.map((x) => x.rule)).toEqual(['rls-required']);
  });

  it('accepts if-not-exists, schema-qualified and quoted names, several statements on one line, and temp tables without RLS', () => {
    const text = [
      'create table if not exists app."odd name" (id int);',
      'create table public.p (id int); create table q (id int);',
      'alter table app."odd name" enable row level security; alter table only public.p enable row level security;',
      'alter table q enable row level security;',
      'create temp table scratch (id int);',
    ].join('\n');
    expect(lintMigrations([{ name: '0001_a.sql', text }])).toEqual([]);
  });

  it('a file that drops a column and creates a reader fails with expand-only; the drop alone passes', () => {
    const bad = lintMigrations([ok(1, 'a'), { name: '0002_b.sql', text: 'alter table t1 drop column x;\ncreate view v as select 1;' }]);
    expect(bad.map((x) => x.rule)).toEqual(['expand-only']);
    expect(lintMigrations([ok(1, 'a'), { name: '0002_b.sql', text: 'alter table t1 drop column x;' }])).toEqual([]);
  });

  it('keywords inside comments and strings do not count', () => {
    const text = "-- create index concurrently\n/* drop column */ create table t (note text default 'create table nope'); alter table t enable row level security;";
    expect(lintMigrations([{ name: '0001_a.sql', text }])).toEqual([]);
    expect(stripSql("select 'it''s a create table'")).toBe("select ''");
  });

  it('a bad file name fails with migration-name', () => {
    expect(lintMigrations([{ name: '1_x.sql', text: '' }]).map((x) => x.rule)).toEqual(['migration-name']);
    expect(lintMigrations([{ name: '0001_Bad.sql', text: '' }]).map((x) => x.rule)).toEqual(['migration-name']);
  });
});

describe('pgTAP output', () => {
  it('summarises a passing file', () => {
    const s = summariseTap('1..2\nok 1 - a\nok 2 - b\n');
    expect(s).toMatchObject({ planned: 2, ok: 2, problems: [] });
  });

  it('reports a failing test, a short run and a psql error', () => {
    expect(summariseTap('1..2\nok 1 - a\nnot ok 2 - b\n').problems).toEqual(['not ok 2 - b']);
    expect(summariseTap('1..3\nok 1 - a\n').problems).toEqual(['planned 3 tests, ran 1']);
    expect(summariseTap('psql:x.sql:5: ERROR:  boom\n').problems.length).toBe(2);
  });
});

describe('db:push plan (AC-9)', () => {
  const full = { SUPABASE_ACCESS_TOKEN: 't', SUPABASE_PROJECT_ID: 'abcdefghijklmnopqrst', SUPABASE_DB_PASSWORD: 'p' };

  it('lists link, db push --dry-run and db push in that order', () => {
    const plan = planPush('staging', full);
    expect(plan.skip).toBeUndefined();
    expect(plan.steps.map(formatStep)).toEqual(['supabase link --project-ref abcdefghijklmnopqrst', 'supabase db push --dry-run', 'supabase db push']);
    expect(plan.steps[1]?.summary).toBe(true);
  });

  it('--dry-run prints the three commands and runs nothing, even with no credentials', () => {
    const lines: string[] = [];
    const code = dbPush(['--env', 'staging', '--dry-run'], {}, { log: (l) => lines.push(l), run: () => { throw new Error('must not run'); } });
    expect(code).toBe(0);
    const text = lines.join('\n');
    expect(text.indexOf('supabase link')).toBeGreaterThan(-1);
    expect(text.indexOf('supabase db push --dry-run')).toBeGreaterThan(text.indexOf('supabase link'));
    expect(text.indexOf('supabase db push\n') >= 0 || text.trimEnd().includes('supabase db push')).toBe(true);
    expect(text).not.toContain('abcdefghijklmnopqrst');
  });

  it('without SUPABASE_ACCESS_TOKEN a real run prints the SKIP line and exits 0', () => {
    const lines: string[] = [];
    const code = dbPush(['--env', 'staging'], { SUPABASE_PROJECT_ID: 'x', SUPABASE_DB_PASSWORD: 'p' }, { log: (l) => lines.push(l), run: () => { throw new Error('must not run'); } });
    expect(code).toBe(0);
    expect(lines).toEqual(['SKIP db:push: SUPABASE_ACCESS_TOKEN not set']);
  });

  it('skips with the name of the first missing variable', () => {
    expect(planPush('prod', { SUPABASE_ACCESS_TOKEN: 't' }).skip).toBe('SKIP db:push: SUPABASE_DB_PASSWORD not set');
    expect(planPush('staging', { SUPABASE_ACCESS_TOKEN: 't', SUPABASE_DB_PASSWORD: 'p' }).skip).toBe('SKIP db:push: SUPABASE_PROJECT_ID not set');
  });

  it('the prod ref comes from config/supabase.projects.json when the variable is absent', () => {
    expect(planPush('prod', { SUPABASE_ACCESS_TOKEN: 't', SUPABASE_DB_PASSWORD: 'p' }).skip).toBeUndefined();
  });

  it('a real run stops at the first failing command and puts the dry-run listing in the summary', () => {
    const ran: string[] = [];
    const summaries: string[] = [];
    const code = execute(planPush('staging', full), {
      log: () => {},
      summary: (t) => summaries.push(t),
      run: (argv) => {
        ran.push(argv.join(' '));
        return argv[1] === 'push' && argv.includes('--dry-run') ? { status: 0, stdout: 'Would push 0002_genai.sql' } : { status: argv[0] === 'db' ? 1 : 0, stdout: '' };
      },
    });
    expect(code).toBe(1);
    expect(ran).toEqual(['link --project-ref abcdefghijklmnopqrst', 'db push --dry-run', 'db push']);
    expect(summaries[0]).toContain('Would push 0002_genai.sql');
  });
});

describe('test:staging suites and types diff', () => {
  it('selects all suites, a named one, and reports unknown names', () => {
    expect(selectSuites([]).suites).toEqual(['keepalive', 'smoke']);
    expect(selectSuites(['keepalive']).suites).toEqual(['keepalive']);
    expect(selectSuites(['nope']).unknown).toEqual(['nope']);
  });

  it('firstDifference names the first differing line', () => {
    expect(firstDifference('a\nb\nc', 'a\nX\nc')).toContain('line 2');
    expect(firstDifference('a', 'a')).toBe('no difference');
  });
});
