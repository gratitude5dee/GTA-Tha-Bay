/**
 * The fal spend ledger of the one-off programme (DL-OWN-01, DL-OWN-07): `assets/ledger/fal-spend.jsonl`, append-only and repo-audited.
 * One JSON object per line, money in integer USD micros, times in ISO-8601 `Z` (a repo-audited file, CLAUDE.md). The lines and the
 * program cap come from `config/guardrails.yaml` (`GENAI_GUARDRAILS`). Rows are seeded from `research/genai-spike/ledger.json` and
 * `--import <file>` (for example the M05c3 spend from the M05d ledger export); a settled job appends one row.
 *
 * Pure parts (totals, the refusal rule, the alarm text) take rows and numbers; the file helpers do the IO.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { GENAI_GUARDRAILS } from '../../../packages/shared/src/genai/guardrails.generated.ts';

export type LedgerLine = keyof typeof GENAI_GUARDRAILS.lines;
export const LEDGER_LINES: readonly LedgerLine[] = ['spike', 'characters', 'cutscenes', 'vehiclesProps', 'buffer'];
export const LEDGER_FILE = 'assets/ledger/fal-spend.jsonl';
export const SPIKE_LEDGER_FILE = 'research/genai-spike/ledger.json';

export interface LedgerRow {
  schema: 'fal-spend/1';
  kind: 'seed' | 'settle' | 'import';
  /** ISO-8601 UTC with a trailing Z. */
  at: string;
  line: LedgerLine;
  usdMicros: number;
  /** Where the row comes from: a job key, a request id, an import reference. Imports are idempotent by `ref`. */
  ref: string;
  slug?: string;
  stage?: string;
  requestId?: string;
  note?: string;
}

export interface LineCaps {
  program: number;
  lines: Readonly<Record<LedgerLine, number>>;
}

export const DEFAULT_CAPS: LineCaps = { program: GENAI_GUARDRAILS.programCapUsdMicros, lines: GENAI_GUARDRAILS.lines };

export function parseLedger(text: string): LedgerRow[] {
  const rows: LedgerRow[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line === '') return;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      throw new Error(`ledger line ${i + 1} is not JSON`);
    }
    const r = o as Partial<LedgerRow>;
    if (r.schema !== 'fal-spend/1' || !LEDGER_LINES.includes(r.line as LedgerLine) || !Number.isInteger(r.usdMicros) || (r.usdMicros as number) < 0 || typeof r.ref !== 'string') {
      throw new Error(`ledger line ${i + 1} is not a fal-spend/1 row`);
    }
    if (typeof r.at !== 'string' || !/Z$/.test(r.at)) throw new Error(`ledger line ${i + 1}: \`at\` must be ISO-8601 UTC with a trailing Z`);
    rows.push(r as LedgerRow);
  });
  return rows;
}

export type Totals = Record<LedgerLine, number> & { total: number };

export function totals(rows: readonly LedgerRow[]): Totals {
  const t = { spike: 0, characters: 0, cutscenes: 0, vehiclesProps: 0, buffer: 0, total: 0 };
  for (const r of rows) {
    t[r.line] += r.usdMicros;
    t.total += r.usdMicros;
  }
  return t;
}

/** The refusal rule of `plan` and `reserve`: a batch is refused when the line or the program cap would be passed. */
export function capRefusal(t: Totals, line: LedgerLine, addMicros: number, caps: LineCaps = DEFAULT_CAPS): string | null {
  if (t[line] + addMicros > caps.lines[line]) {
    return `refused: ${fmt(t[line])} spent + ${fmt(addMicros)} planned passes the ${line} line of ${fmt(caps.lines[line])}`;
  }
  if (t.total + addMicros > caps.program) {
    return `refused: ${fmt(t.total)} spent + ${fmt(addMicros)} planned passes the program cap of ${fmt(caps.program)}`;
  }
  return null;
}

const fmt = (micros: number): string => `${micros.toLocaleString('en-US')} micros`;
export const usd = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;

/** Alarm text for every line and the program at or above 50, 80 and 100 % (the highest threshold each has reached). */
export function alarms(t: Totals, caps: LineCaps = DEFAULT_CAPS, thresholds: readonly number[] = GENAI_GUARDRAILS.alarms): string[] {
  const out: string[] = [];
  const check = (name: string, spent: number, cap: number): void => {
    if (cap <= 0) return;
    const hit = [...thresholds].sort((a, b) => b - a).find((th) => spent >= cap * th);
    if (hit !== undefined) out.push(`ALARM ${Math.round(hit * 100)} %: ${name} at ${usd(spent)} of ${usd(cap)}${hit >= 1 ? ' (hard stop)' : ''}`);
  };
  for (const l of LEDGER_LINES) check(`the ${l} line`, t[l], caps.lines[l]);
  check('the program', t.total, caps.program);
  return out;
}

export function readLedger(file: string): LedgerRow[] {
  return existsSync(file) ? parseLedger(readFileSync(file, 'utf8')) : [];
}

export function appendRow(file: string, row: LedgerRow): void {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`);
}

const isoZ = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const isoNow = (nowMs: number): string => isoZ(nowMs);

/** The seed row for the spike: its total from `research/genai-spike/ledger.json` (`totalMicros`). */
export function spikeSeedRow(spikeLedgerText: string, nowMs: number): LedgerRow {
  const doc = JSON.parse(spikeLedgerText) as { totalMicros?: number };
  const micros = Number.isInteger(doc.totalMicros) ? (doc.totalMicros as number) : 0;
  return { schema: 'fal-spend/1', kind: 'seed', at: isoZ(nowMs), line: 'spike', usdMicros: micros, ref: SPIKE_LEDGER_FILE, note: 'seed from the M00c spike ledger' };
}

/**
 * Imports rows from a JSON file `{ rows: [{ line, usdMicros, ref, note? }] }` or a JSONL file of such rows. A ref that is already in the
 * ledger is skipped, so an import can run twice.
 */
export function importRows(existing: readonly LedgerRow[], text: string, nowMs: number): { added: LedgerRow[]; skipped: string[] } {
  const raw = text.trim().startsWith('{') && text.includes('"rows"') ? ((JSON.parse(text) as { rows: unknown[] }).rows) : text.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as unknown);
  const have = new Set(existing.map((r) => r.ref));
  const added: LedgerRow[] = [];
  const skipped: string[] = [];
  for (const o of raw) {
    const r = o as { line?: string; usdMicros?: number; ref?: string; note?: string };
    if (!LEDGER_LINES.includes(r.line as LedgerLine) || !Number.isInteger(r.usdMicros) || (r.usdMicros as number) < 0 || typeof r.ref !== 'string' || r.ref === '') {
      throw new Error(`import row is not { line, usdMicros, ref }: ${JSON.stringify(o)}`);
    }
    if (have.has(r.ref)) {
      skipped.push(r.ref);
      continue;
    }
    have.add(r.ref);
    added.push({ schema: 'fal-spend/1', kind: 'import', at: isoZ(nowMs), line: r.line as LedgerLine, usdMicros: r.usdMicros as number, ref: r.ref, ...(r.note !== undefined ? { note: r.note } : {}) });
  }
  return { added, skipped };
}

export function renderLedger(rows: readonly LedgerRow[], only: LedgerLine | null, caps: LineCaps = DEFAULT_CAPS): string[] {
  const t = totals(rows);
  const out: string[] = ['fal spend ledger (DL-OWN-01: hard cap $100 total)'];
  for (const l of only === null ? LEDGER_LINES : [only]) {
    const cap = caps.lines[l];
    out.push(`  ${l.padEnd(14)} ${usd(t[l]).padStart(8)} of ${usd(cap).padStart(8)}  (${cap === 0 ? 0 : Math.round((t[l] / cap) * 100)} %)  ${t[l].toLocaleString('en-US')} micros`);
  }
  if (only === null) out.push(`  ${'program'.padEnd(14)} ${usd(t.total).padStart(8)} of ${usd(caps.program).padStart(8)}  (${Math.round((t.total / caps.program) * 100)} %)  ${t.total.toLocaleString('en-US')} micros`);
  out.push(...alarms(t, caps).filter((a) => only === null || a.includes(`the ${only} line`) || a.includes('the program')));
  return out;
}

/**
 * assets:gen ledger [--line characters|cutscenes|spike|buffer|vehiclesProps] [--seed] [--import <file>] [--file <ledger>]
 * `--seed` writes the spike row from `research/genai-spike/ledger.json` once; `--import` appends rows by reference.
 */
export function ledgerCommand(argv: readonly string[], root: string, log: (l: string) => void, nowMs: number): number {
  let values;
  try {
    values = parseArgs({ args: [...argv], options: { line: { type: 'string' }, seed: { type: 'boolean', default: false }, import: { type: 'string' }, file: { type: 'string' } } }).values;
  } catch (e) {
    log(`assets:gen ledger: ${(e as Error).message}`);
    return 2;
  }
  const only = values.line === undefined ? null : (values.line as LedgerLine);
  if (only !== null && !LEDGER_LINES.includes(only)) {
    log(`assets:gen ledger: --line must be one of ${LEDGER_LINES.join(', ')}`);
    return 2;
  }
  const file = path.resolve(root, values.file ?? LEDGER_FILE);
  let rows = readLedger(file);
  if (values.seed) {
    if (rows.some((r) => r.kind === 'seed' && r.ref === SPIKE_LEDGER_FILE)) log('seed: the spike row is already in the ledger');
    else {
      const spike = path.resolve(root, SPIKE_LEDGER_FILE);
      if (!existsSync(spike)) {
        log(`assets:gen ledger: ${SPIKE_LEDGER_FILE} does not exist`);
        return 1;
      }
      const row = spikeSeedRow(readFileSync(spike, 'utf8'), nowMs);
      appendRow(file, row);
      log(`seed: spike row of ${usd(row.usdMicros)} written`);
    }
    rows = readLedger(file);
  }
  if (values.import !== undefined) {
    try {
      const { added, skipped } = importRows(rows, readFileSync(path.resolve(root, values.import), 'utf8'), nowMs);
      for (const r of added) appendRow(file, r);
      log(`import: ${added.length} row(s) added, ${skipped.length} already present`);
    } catch (e) {
      log(`assets:gen ledger: ${(e as Error).message}`);
      return 1;
    }
    rows = readLedger(file);
  }
  for (const line of renderLedger(rows, only)) log(line);
  return 0;
}
