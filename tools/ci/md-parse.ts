/**
 * Markdown helpers for the spec gates (M00d): tables by header name, the README status table, `_PLAN.md` order,
 * the 06 R-ID and contract indexes, the 08 script registry, and the C15 milestone parser (13-qa.md section 4).
 * Pure functions over text; the callers do the IO. Line numbers are 1-based.
 */
import {
  MILESTONE_HEADINGS,
  MILESTONE_ID_RE,
  type OracleKind,
} from '../../packages/shared/src/contracts/c15-milestone.ts';

export interface Line {
  n: number;
  text: string;
}

export function toLines(text: string): Line[] {
  return text.split(/\r?\n/).map((t, i) => ({ n: i + 1, text: t }));
}

/** Splits a markdown table row on unescaped pipes; leading and trailing empty cells are dropped. */
export function splitCells(row: string): string[] {
  const parts = row.split(/(?<!\\)\|/).map((c) => c.trim());
  if (parts[0] === '') parts.shift();
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

export interface Table {
  header: string[];
  rows: { line: number; cells: string[] }[];
}

/** Every pipe table in the text (a header row, a `---` separator row, then body rows). */
export function parseTables(text: string): Table[] {
  const lines = toLines(text);
  const out: Table[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const head = lines[i] as Line;
    const sep = lines[i + 1] as Line;
    if (!head.text.trim().startsWith('|') || !/^\|?\s*:?-{2,}/.test(sep.text.trim().replace(/^\|\s*/, '|'))) continue;
    if (!/^\|[\s:|-]+\|?$/.test(sep.text.trim())) continue;
    const table: Table = { header: splitCells(head.text), rows: [] };
    let j = i + 2;
    for (; j < lines.length; j++) {
      const l = lines[j] as Line;
      if (!l.text.trim().startsWith('|')) break;
      table.rows.push({ line: l.n, cells: splitCells(l.text) });
    }
    out.push(table);
    i = j - 1;
  }
  return out;
}

export type FileStatus = 'PENDING' | 'READY' | 'IN PROGRESS' | 'DONE';
export interface StatusRow {
  id: string;
  status: FileStatus;
  /** The full status cell, e.g. `READY · frozen (executing)`. */
  cell: string;
  file: string;
}

/** The README status table, read by header name (`ID`, `Status`, `File`); the first words of the status cell win (DL-245). */
export function parseStatusTable(readme: string): Map<string, StatusRow> {
  const out = new Map<string, StatusRow>();
  for (const t of parseTables(readme)) {
    const iId = t.header.indexOf('ID');
    const iSt = t.header.indexOf('Status');
    const iFile = t.header.indexOf('File');
    if (iId < 0 || iSt < 0) continue;
    for (const r of t.rows) {
      const id = (r.cells[iId] ?? '').replace(/[`*]/g, '').trim();
      if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(id)) continue;
      const cell = (r.cells[iSt] ?? '').replace(/[`*]/g, '').trim();
      const status: FileStatus = /^IN PROGRESS/i.test(cell) ? 'IN PROGRESS' : /^DONE/i.test(cell) ? 'DONE' : /^READY/i.test(cell) ? 'READY' : 'PENDING';
      out.set(id, { id, status, cell, file: (r.cells[iFile] ?? '').replace(/[`*]/g, '').trim() });
    }
  }
  return out;
}

export interface PlanRow {
  id: string;
  slug: string;
  sessions: string;
  dependsOn: string[];
}

/** `_PLAN.md` section 1 order: the table whose header has `ID` and `Depends on`. */
export function parsePlanOrder(plan: string): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const t of parseTables(plan)) {
    const iId = t.header.indexOf('ID');
    const iDep = t.header.indexOf('Depends on');
    if (iId < 0 || iDep < 0) continue;
    const iSlug = t.header.indexOf('Slug');
    const iSes = t.header.indexOf('Sessions');
    for (const r of t.rows) {
      const id = (r.cells[iId] ?? '').replace(/[`*]/g, '').trim();
      if (!MILESTONE_ID_RE.test(id)) continue;
      rows.push({
        id,
        slug: (r.cells[iSlug] ?? '').trim(),
        sessions: (r.cells[iSes] ?? '').trim(),
        dependsOn: (r.cells[iDep] ?? '').match(/M\d{2}[a-z]?\d?/g) ?? [],
      });
    }
  }
  return rows;
}

/** The R-IDs of 06-SHARED-CONTEXT.md section 2, in order, with their statement. */
export function parseRIds(shared: string): { rid: string; text: string }[] {
  const lines = toLines(shared);
  const start = lines.findIndex((l) => /^## 2\. /.test(l.text));
  const out: { rid: string; text: string }[] = [];
  if (start < 0) return out;
  for (let i = start + 1; i < lines.length; i++) {
    const t = (lines[i] as Line).text;
    if (/^## /.test(t)) break;
    const m = /^- (R-[A-Z]+-\d+)\b\s*(.*)$/.exec(t);
    if (m) out.push({ rid: m[1] as string, text: m[2] ?? '' });
  }
  return out;
}

/** Contract index of 06 section 4.2: `C01` -> `1.0`. */
export function parseContractIndex(shared: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = toLines(shared);
  const start = lines.findIndex((l) => /^### 4\.2 /.test(l.text));
  if (start < 0) return out;
  const end = lines.findIndex((l, i) => i > start && /^### /.test(l.text));
  const body = lines
    .slice(start, end < 0 ? undefined : end)
    .map((l) => l.text)
    .join('\n');
  for (const t of parseTables(body)) {
    for (const r of t.rows) {
      const id = (r.cells[0] ?? '').trim();
      const ver = (r.cells[3] ?? '').trim();
      if (/^C\d{2}$/.test(id) && /^\d+\.\d+/.test(ver)) out.set(id, ver);
    }
  }
  return out;
}

/** Script names of the 08 section 6 registry: the first column's backticked names (`assets:*` is a prefix entry). */
export function parseScriptRegistry(spec08: string): Set<string> {
  const lines = toLines(spec08);
  const start = lines.findIndex((l) => /^## 6\. Script registry/.test(l.text));
  const out = new Set<string>();
  if (start < 0) return out;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l.text));
  const body = lines
    .slice(start, end < 0 ? undefined : end)
    .map((l) => l.text)
    .join('\n');
  for (const t of parseTables(body)) {
    for (const r of t.rows) {
      for (const m of (r.cells[0] ?? '').matchAll(/`([^`]+)`/g)) {
        const name = /^([a-z][a-z0-9]*(?::[a-z0-9.*-]+)*\*?)/.exec((m[1] as string).trim())?.[1];
        if (name) out.add(name);
      }
    }
  }
  return out;
}

/** True when `script` is in the registry; registry entries ending in `*` match by prefix. */
export function inRegistry(script: string, registry: ReadonlySet<string>): boolean {
  if (registry.has(script)) return true;
  for (const e of registry) if (e.endsWith('*') && script.startsWith(e.slice(0, -1))) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Milestone files (C15)
// ---------------------------------------------------------------------------------------------------------------

export interface Heading {
  name: string;
  line: number;
}

export interface Section {
  heading: Heading;
  lines: Line[];
}

export interface ParsedCommand {
  /** The backtick span, verbatim. */
  raw: string;
  /** One entry per `&&`-joined piece that is a pnpm command. */
  pieces: PnpmPiece[];
}

export interface PnpmPiece {
  text: string;
  /** Script name (`check:unit`), `exec`, `install`...; empty when none could be read. */
  script: string;
  /** Set for `pnpm --filter <pkg> <script>`. */
  filter?: string;
  args: string;
  /** Variables named by `env -u VAR`. */
  unset: string[];
}

export interface ParsedAc {
  n: number;
  line: number;
  endLine: number;
  /** `gwt` = Given/When/Then on the first line; `list` = a nested list of expected results; `bad` = neither. */
  form: 'gwt' | 'list' | 'bad';
  given: string;
  when: string;
  then: string;
  subBullets: number;
  proofCount: number;
  proofText: string;
  manual: boolean;
  device: string;
  steps: string;
  commands: ParsedCommand[];
  explicitOracle?: OracleKind;
  oracles: OracleKind[];
  oracle: OracleKind;
  /** Every line of the block, for L4. */
  lines: Line[];
}

export interface ParsedMilestone {
  titleLine: string;
  titleId: string;
  titleSlug: string;
  titleOk: boolean;
  headings: Heading[];
  sections: Map<string, Section>;
  acs: ParsedAc[];
}

const ORACLES: readonly OracleKind[] = [
  'unit', 'golden', 'state-hash', 'replay', 'bot-run', 'e2e', 'workers', 'db', 'static-gate', 'perf-cpu', 'staging', 'ops', 'load', 'device-perf', 'device-check',
];

const PREFIX_RE = /^(?:(?:env\s+(?:-u\s+[A-Za-z_][A-Za-z0-9_]*\s+)+)|(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+))+/;

/** One `&&` piece of a backtick span, or null when it is not a pnpm command (after `env -u` and `VAR=value` prefixes). */
export function parsePnpmPiece(piece: string): PnpmPiece | null {
  const t = piece.trim();
  const prefix = PREFIX_RE.exec(t)?.[0] ?? '';
  const rest = t.slice(prefix.length);
  if (!/^pnpm\s/.test(rest)) return null;
  const unset = [...prefix.matchAll(/-u\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1] as string);
  const toks = rest.split(/\s+/).slice(1);
  let script = '';
  let filter: string | undefined;
  let i = 0;
  if (toks[0] === '--filter' || toks[0] === '-F') {
    filter = toks[1] ?? '';
    i = 2;
  }
  if (toks[i] === 'run') i++;
  script = toks[i] ?? '';
  return { text: t, script, ...(filter !== undefined ? { filter } : {}), args: toks.slice(i + 1).join(' '), unset };
}

export function parseCommandSpan(span: string): ParsedCommand | null {
  const pieces = span
    .split(/\s*&&\s*/)
    .map(parsePnpmPiece)
    .filter((p): p is PnpmPiece => p !== null);
  return pieces.length > 0 ? { raw: span, pieces } : null;
}

const PNPM_BUILTINS = new Set(['install', 'i', 'exec', 'add', 'dlx', 'run', 'remove', 'update', 'store']);
export function isPnpmBuiltin(script: string): boolean {
  return PNPM_BUILTINS.has(script) || script.startsWith('<') || script.startsWith('-');
}

/** The oracle a command's script names (13-qa.md section 4.2; first match wins). */
export function inferOracle(p: PnpmPiece): OracleKind {
  const s = p.script;
  const a = p.args;
  if (p.filter !== undefined) {
    if (s === 'test:determinism') return 'state-hash';
    if (s === 'test' || s.startsWith('test:')) return /golden|vectors/.test(a) ? 'golden' : 'unit';
    if (/replay/.test(s)) return 'replay';
    return 'static-gate';
  }
  if (s === 'check:unit') return /golden|vectors/.test(a) ? 'golden' : 'unit';
  if (s === 'test:determinism' || (/^check:e2e/.test(s) && /--grep\s+\S*(@determinism|@[a-z0-9]+-det\b|@[a-z0-9]+-hash)/.test(a))) return 'state-hash';
  if (/replay/.test(s)) return 'replay';
  if (['check:missions', 'check:balance', 'check:fighter', 'tycoon:sim'].includes(s) || (s === 'map:races' && /\bpar\b/.test(a))) return 'bot-run';
  if (s === 'check:e2e' || s === 'check:e2e:xr' || s === 'check:smoke') return 'e2e';
  if (s === 'check:workers' || s === 'check:pipeline') return 'workers';
  if (s === 'check:db' || s === 'check:db:types') return 'db';
  if (s === 'check:perf') return 'perf-cpu';
  if (s === 'test:staging') return 'staging';
  if (s === 'test:ops') return 'ops';
  if (s === 'load:rooms') return 'load';
  if (s === 'perf:verify') return 'device-perf';
  return 'static-gate';
}

function stripProofTail(text: string): { proof: string; oracle?: OracleKind } {
  let proof = text.trim();
  let oracle: OracleKind | undefined;
  const m = /\s*\[oracle:\s*([a-z-]+)\]\s*$/.exec(proof);
  if (m) {
    proof = proof.slice(0, m.index).trim();
    if ((ORACLES as readonly string[]).includes(m[1] as string)) oracle = m[1] as OracleKind;
  }
  proof = proof.replace(/:\s*$/, '').trim();
  return oracle ? { proof, oracle } : { proof };
}

function parseAc(head: Line, body: Line[], n: number): ParsedAc {
  const lines = [head, ...body];
  while (lines.length > 1 && (lines[lines.length - 1] as Line).text.trim() === '') lines.pop();
  const proofRe = /—\s*proof:/g;
  let proofCount = 0;
  let proofText = '';
  let explicitOracle: OracleKind | undefined;
  let firstWithoutProof = head.text;
  for (const [idx, l] of lines.entries()) {
    const ms = [...l.text.matchAll(proofRe)];
    proofCount += ms.length;
    const m = ms[0];
    if (m && !proofText) {
      const tail = stripProofTail(l.text.slice((m.index ?? 0) + m[0].length));
      proofText = tail.proof;
      explicitOracle = tail.oracle;
      if (idx === 0) firstWithoutProof = l.text.slice(0, m.index ?? 0);
    }
  }
  const subBullets = lines.slice(1).filter((l) => /^\s+-\s/.test(l.text)).length;
  const first = firstWithoutProof.replace(/^- AC-\d+\s+/, '').trim();
  let form: ParsedAc['form'] = 'bad';
  let given = '';
  let when = '';
  let then = '';
  const gwt = /^Given\s+(.+?)\s+When\s+(.+?)\s+Then\b\s*(.*)$/.exec(first);
  if (gwt) {
    form = 'gwt';
    given = gwt[1] as string;
    when = gwt[2] as string;
    then = (gwt[3] ?? '').replace(/:\s*$/, '');
  } else {
    const lst = /^Given\s+(.+?)(?:,\s*)?(?:the following hold|[:])\s*$/.exec(first);
    if (lst && subBullets > 0) {
      form = 'list';
      given = lst[1] as string;
    }
  }
  const manual = /^manual:/i.test(proofText);
  const commands: ParsedCommand[] = [];
  let device = '';
  let steps = '';
  if (manual) {
    const rest = proofText.replace(/^manual:\s*/i, '');
    const comma = rest.indexOf(',');
    device = (comma < 0 ? rest : rest.slice(0, comma)).trim();
    steps = comma < 0 ? '' : rest.slice(comma + 1).trim();
  } else {
    for (const m of proofText.matchAll(/`([^`]+)`/g)) {
      const c = parseCommandSpan(m[1] as string);
      if (c) commands.push(c);
    }
  }
  const oracles = manual ? (['device-check'] as OracleKind[]) : commands.flatMap((c) => c.pieces.map(inferOracle));
  const oracle: OracleKind = explicitOracle ?? (manual ? 'device-check' : (oracles.find((o) => o !== 'static-gate') ?? oracles[0] ?? 'static-gate'));
  return {
    n,
    line: head.n,
    endLine: (lines[lines.length - 1] as Line).n,
    form,
    given,
    when,
    then,
    subBullets,
    proofCount,
    proofText,
    manual,
    device,
    steps,
    commands,
    ...(explicitOracle ? { explicitOracle } : {}),
    oracles,
    oracle,
    lines,
  };
}

/** Parses one milestone file: title, `##` headings (outside code fences), sections, and the acceptance criteria. */
export function parseMilestone(text: string): ParsedMilestone {
  const all = toLines(text);
  const headings: Heading[] = [];
  const sections = new Map<string, Section>();
  let fence = false;
  let current: Section | null = null;
  let titleLine = '';
  for (const l of all) {
    if (/^\s*```/.test(l.text)) fence = !fence;
    if (!fence && /^# /.test(l.text) && !titleLine) titleLine = l.text;
    const h = !fence ? /^## (.+?)\s*$/.exec(l.text) : null;
    if (h) {
      const heading = { name: h[1] as string, line: l.n };
      headings.push(heading);
      current = { heading, lines: [] };
      if (!sections.has(heading.name)) sections.set(heading.name, current);
    } else if (current) current.lines.push(l);
  }
  const tm = /^#\s+(\S+)\s+—\s+(.+?)\s*$/.exec(titleLine);
  const acs: ParsedAc[] = [];
  const ac = sections.get('Acceptance criteria');
  if (ac) {
    const ls = ac.lines;
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i] as Line;
      const m = /^- AC-(\d+)\s+Given\b/.exec(l.text);
      if (!m) continue;
      const body: Line[] = [];
      let j = i + 1;
      for (; j < ls.length; j++) {
        const b = ls[j] as Line;
        if (b.text.trim() !== '' && !/^\s/.test(b.text)) break;
        body.push(b);
      }
      acs.push(parseAc(l, body, Number(m[1])));
      i = j - 1;
    }
  }
  return {
    titleLine,
    titleId: tm?.[1] ?? '',
    titleSlug: tm?.[2] ?? '',
    titleOk: !!tm && MILESTONE_ID_RE.test(tm[1] as string),
    headings,
    sections,
    acs,
  };
}

export const EXPECTED_HEADINGS: readonly string[] = MILESTONE_HEADINGS;

export interface Requirement {
  rid: string;
  clause: string;
  /** Qualified as support, groundwork, part or client half (shown "(s)" in the trace). */
  support: boolean;
}

/** Expands `R-PLAT-01/02/03` shorthand and returns every R-ID named in the text, in order. */
export function expandRIds(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/R-([A-Z]+)-(\d+)((?:\/\d+)*)/g)) {
    out.push(`R-${m[1]}-${m[2]}`);
    for (const extra of (m[3] ?? '').split('/').filter(Boolean)) out.push(`R-${m[1]}-${extra}`);
  }
  return out;
}

/** `## Requirements` bullets: `- R-XXX-NN[ and R-YYY-NN] (qualifier): clause`; every R-ID of the head is one requirement. */
export function parseRequirements(section: Section | undefined): Requirement[] {
  const out: Requirement[] = [];
  for (const l of section?.lines ?? []) {
    const m = /^\s*[-*]\s+\**(R-[A-Z]+-\d+.*?)\**\s*:\s*(.*)$/.exec(l.text);
    if (!m) continue;
    const head = m[1] as string;
    const support = /\((?:[^)]*\b)?(?:support|groundwork|part|client half)\b[^)]*\)/i.test(head);
    for (const rid of expandRIds(head)) out.push({ rid, clause: m[2] ?? '', support });
  }
  return out;
}

/** `**R**` fields of the `_PLAN-N.md` rows: `### M00 · slug ...` then `- **R** R-A-01/02, R-B-03 · **Dep** ...`. */
export function parsePlanRs(planPart: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let id = '';
  for (const l of toLines(planPart)) {
    const h = /^### (M\d{2}[a-z]?\d?)\b/.exec(l.text);
    if (h) id = h[1] as string;
    const r = id ? /\*\*R\*\*\s+([^·]*)/.exec(l.text) : null;
    if (r) out.set(id, expandRIds(r[1] as string));
  }
  return out;
}
