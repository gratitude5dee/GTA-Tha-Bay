/**
 * Migration lint (M05d, 09-backend-db.md section 2 and 8). Pure: takes file names and texts, returns findings.
 *
 *   migration-name        file name is NNNN_name.sql (four digits, lowercase snake_case)
 *   contiguous-numbering  the numbers run 0001, 0002, ... with no gap and no repeat
 *   no-concurrent-index   no `create index concurrently` (migrations run in one transaction; Supabase branching stays possible)
 *   expand-only           a file that drops a column adds no reader (function, view, policy, trigger, index, rule); a column drop
 *                         ships one release after the code stops reading it
 *   rls-required          every `create table` is followed by `alter table ... enable row level security`
 */
export type LintRule = 'migration-name' | 'contiguous-numbering' | 'no-concurrent-index' | 'expand-only' | 'rls-required';

export interface MigrationFile {
  name: string;
  text: string;
}
export interface LintFinding {
  rule: LintRule;
  file: string;
  message: string;
}

/** Removes `--` and block comments and the contents of single-quoted strings, so keywords inside them do not match. */
export function stripSql(sql: string): string {
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    const n = sql[i + 1];
    if (c === '-' && n === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i++;
      out += ' ';
    } else if (c === "'") {
      out += "''";
      i++;
      while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1;
    } else out += c;
  }
  return out;
}

const NAME = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const IDENT = '(?:"[^"]+"|[a-z_][a-z0-9_$]*)';
const QUALIFIED = `${IDENT}(?:\\s*\\.\\s*${IDENT})?`;

const bare = (qualified: string): string => {
  const last = qualified.split('.').pop()!.trim();
  return last.replace(/^"|"$/g, '').toLowerCase();
};

/** Table names created by the file, in order, with the offset of each statement. Temporary tables are skipped. */
function createdTables(sql: string): { table: string; at: number }[] {
  const out: { table: string; at: number }[] = [];
  const re = new RegExp(`\\bcreate\\s+(?:(?:global|local)\\s+)?(temp(?:orary)?\\s+)?(?:unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${QUALIFIED})`, 'gi');
  for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
    if (m[1] === undefined) out.push({ table: bare(m[2]!), at: m.index });
  }
  return out;
}

function hasRls(sql: string, table: string, after: number): boolean {
  const re = new RegExp(`\\balter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?(${QUALIFIED})\\s+enable\\s+row\\s+level\\s+security\\b`, 'gi');
  for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
    if (m.index > after && bare(m[1]!) === table) return true;
  }
  return false;
}

const READER = /\bcreate\s+(?:or\s+replace\s+)?(?:(?:unique\s+)?index|function|view|materialized\s+view|policy|trigger|rule)\b/i;

export function lintMigrations(files: readonly MigrationFile[]): LintFinding[] {
  const findings: LintFinding[] = [];
  const named: { n: number; name: string }[] = [];
  for (const f of files) {
    const m = NAME.exec(f.name);
    if (m === null) findings.push({ rule: 'migration-name', file: f.name, message: 'expected NNNN_name.sql (four digits, then lowercase words joined by underscores)' });
    else named.push({ n: Number.parseInt(m[1]!, 10), name: f.name });
  }
  named.sort((a, b) => a.n - b.n || a.name.localeCompare(b.name));
  let expected = 1;
  for (const { n, name } of named) {
    if (n !== expected) {
      findings.push({
        rule: 'contiguous-numbering',
        file: name,
        message: n < expected ? `number ${String(n).padStart(4, '0')} is used twice` : `expected ${String(expected).padStart(4, '0')}, found ${String(n).padStart(4, '0')} (a gap)`,
      });
      expected = n;
    }
    expected++;
  }

  for (const f of files) {
    const sql = stripSql(f.text);
    if (/\bcreate\s+(?:unique\s+)?index\s+concurrently\b/i.test(sql)) {
      findings.push({ rule: 'no-concurrent-index', file: f.name, message: '`create index concurrently` cannot run in the migration transaction' });
    }
    if (/\bdrop\s+column\b/i.test(sql) && READER.test(sql)) {
      findings.push({ rule: 'expand-only', file: f.name, message: 'a file that drops a column also creates a function, view, policy, trigger or index; ship the drop one release after the code stops reading the column' });
    }
    for (const { table, at } of createdTables(sql)) {
      if (!hasRls(sql, table, at)) findings.push({ rule: 'rls-required', file: f.name, message: `table ${table} has no \`alter table ${table} enable row level security\` after its create` });
    }
  }
  return findings;
}

export const formatFinding = (f: LintFinding): string => `${f.rule}  ${f.file}: ${f.message}`;
