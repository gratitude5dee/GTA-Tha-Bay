/**
 * Traceability report (M00d; spec/domains/13-qa.md section 2.6, 13-qa-trace.md section 1).
 *
 *   tsx tools/ci/trace.ts [--strict] [--closure <M##>] [--results <dir>] [--root <dir>] [--out <dir>]
 *
 * Joins the R-IDs of 06-SHARED-CONTEXT.md section 2 to the milestones that cite them (the milestone file wins over its
 * `_PLAN-N.md` row; no union, DL-289), the tests their AC proofs name, and a status: `blocked (Q-NN)`, `seen-on-device`,
 * `tested`, `ready`, `planned` (first match), or `post-gate` under a gate closure (DL-450). `empty` and `device-only`
 * are failure flags on a row; they fail only with `--strict`. Writes trace.json and trace.md (deterministic, no clock).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMain } from './lib/common.ts';
import {
  parseMilestone,
  parsePlanOrder,
  parsePlanRs,
  parseRequirements,
  parseRIds,
  parseStatusTable,
  toLines,
  type FileStatus,
  type ParsedAc,
  type Requirement,
} from './md-parse.ts';
import { resolveAuto, verifyFile } from './perf-verify.ts';
import { args, repoRoot } from './run.ts';

export type TraceStatus = 'blocked' | 'seen-on-device' | 'tested' | 'ready' | 'planned' | 'post-gate';
export type TraceFlag = 'empty' | 'device-only';

export interface TraceMilestone {
  id: string;
  support: boolean;
  postGate: boolean;
  /** `file` = the milestone file's Requirements; `plan` = the `_PLAN` row (no file yet). */
  source: 'file' | 'plan';
}

export interface TraceRow {
  rid: string;
  specSections: string[];
  milestones: TraceMilestone[];
  tests: string[];
  /** `blocked (Q-23)` is `status: 'blocked'` with `blockedBy: ['Q-23']`. */
  status: TraceStatus;
  blockedBy: string[];
  flags: TraceFlag[];
}

export interface TraceOptions {
  /** Repository root (or a fixture mimicking its layout). */
  root?: string;
  strict?: boolean;
  /** Gate closure milestone id (DL-450). */
  closure?: string;
  /** Vitest and Playwright JSON reports; default `<root>/tests/reports`. */
  results?: string;
  /** Where trace.json and trace.md go; nothing is written when absent. */
  out?: string;
}

export interface TraceResult {
  ok: boolean;
  rows: TraceRow[];
  failures: string[];
  /** Milestone files citing something that is not a 06 section 2 R-ID. */
  unknownCitations: { milestone: string; rid: string }[];
  markdown: string;
}

const read = (file: string): string => (existsSync(file) ? readFileSync(file, 'utf8') : '');

interface Cited {
  id: string;
  status: FileStatus;
  hasFile: boolean;
  support: Map<string, boolean>;
  rids: Set<string>;
  acs: ParsedAc[];
}

// ---------------------------------------------------------------------------------------------------------------
// Results (Vitest and Playwright JSON)
// ---------------------------------------------------------------------------------------------------------------

export interface Results {
  passedFiles: string[];
  failedFiles: string[];
  passedTags: Set<string>;
  failedTags: Set<string>;
}

function walkSpecs(node: unknown, file: string, acc: Results): void {
  if (typeof node !== 'object' || node === null) return;
  const n = node as { file?: string; specs?: unknown[]; suites?: unknown[] };
  const f = n.file ?? file;
  for (const sp of n.specs ?? []) {
    const s = sp as { title?: string; ok?: boolean; tags?: string[]; file?: string };
    const tags = [...(s.title ?? '').matchAll(/@[\w-]+/g)].map((m) => m[0]).concat((s.tags ?? []).map((t) => (t.startsWith('@') ? t : `@${t}`)));
    for (const t of tags) (s.ok ? acc.passedTags : acc.failedTags).add(t);
    const sf = s.file ?? f;
    if (sf) (s.ok ? acc.passedFiles : acc.failedFiles).push(sf);
  }
  for (const sub of n.suites ?? []) walkSpecs(sub, f, acc);
}

/** Reads every JSON report of `dir`: Vitest (`testResults`) and Playwright (`suites`). Unreadable files are ignored. */
export function readResults(dir: string): Results {
  const acc: Results = { passedFiles: [], failedFiles: [], passedTags: new Set(), failedTags: new Set() };
  if (!existsSync(dir)) return acc;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let j: unknown;
    try {
      j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    const o = j as { testResults?: { name?: string; status?: string }[]; suites?: unknown[] };
    for (const t of o.testResults ?? []) {
      if (!t.name) continue;
      (t.status === 'passed' ? acc.passedFiles : acc.failedFiles).push(t.name.replace(/\\/g, '/'));
    }
    for (const s of o.suites ?? []) walkSpecs(s, '', acc);
  }
  return acc;
}

interface NamedTests {
  files: string[];
  tags: string[];
  names: string[];
}

/** Test files, e2e tags and display names a proof command line names. */
export function namedTests(ac: ParsedAc): NamedTests {
  const out: NamedTests = { files: [], tags: [], names: [] };
  for (const c of ac.commands) {
    for (const p of c.pieces) {
      for (const m of p.args.matchAll(/(\S+\.(?:test|spec)\.tsx?)/g)) {
        out.files.push((m[1] as string).replace(/^['"]|['"]$/g, ''));
      }
      for (const m of p.args.matchAll(/@[\w-]+/g)) out.tags.push(m[0]);
      if (p.filter !== undefined) {
        const name = p.args.replace(/^--\s*/, '').trim();
        out.names.push(name ? `${p.filter}/${name.split(/\s+/)[0]}` : `${p.filter}/${p.script}`);
      } else if (p.script && !/^check:unit$/.test(p.script)) out.names.push(p.script);
    }
  }
  return out;
}

function proofGreen(ac: ParsedAc, res: Results): boolean {
  const n = namedTests(ac);
  for (const f of n.files) {
    const hit = (list: string[]): boolean => list.some((x) => x.endsWith(f) || f.endsWith(x));
    if (!hit(res.passedFiles) || hit(res.failedFiles)) return false;
  }
  for (const t of n.tags) if (!res.passedTags.has(t) || res.failedTags.has(t)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------------------------------

function launchGateEntries(raw: unknown): { id: string; status: string }[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null
      ? Array.isArray((raw as { gates?: unknown }).gates)
        ? ((raw as { gates: unknown[] }).gates)
        : Array.isArray((raw as { entries?: unknown }).entries)
          ? ((raw as { entries: unknown[] }).entries)
          : Object.entries(raw as Record<string, unknown>).map(([id, v]) => (typeof v === 'string' ? { id, status: v } : { id, ...(v as object) }))
      : [];
  return list
    .map((e) => e as { id?: unknown; status?: unknown })
    .filter((e) => typeof e.id === 'string' && typeof e.status === 'string')
    .map((e) => ({ id: e.id as string, status: e.status as string }));
}

/** A Q-id is open until launch-gates.json has entries for it (the id itself or `Q-23a`, `Q-13:<device>`...) and all are pass or waived. */
export function openGates(qids: string[], launchGates: unknown): string[] {
  const entries = launchGateEntries(launchGates);
  return qids.filter((q) => {
    const mine = entries.filter((e) => e.id === q || (e.id.startsWith(q) && !/\d/.test(e.id.charAt(q.length))));
    return mine.length === 0 || !mine.every((e) => e.status === 'pass' || e.status === 'waived');
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Device runs
// ---------------------------------------------------------------------------------------------------------------

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Device ACs of a milestone are seen when each has a passing `perf.json` (judged by `perf:verify --auto`) or a `notes.json` under docs/device-runs/<M##>/<device>/. */
function deviceSeen(root: string, id: string, acs: ParsedAc[], checklistDir: string): boolean {
  const dev = acs.filter((a) => a.oracle === 'device-check' || a.oracle === 'device-perf');
  if (dev.length === 0) return true;
  const base = path.join(root, 'docs', 'device-runs', id);
  if (!existsSync(base)) return false;
  const dirs = readdirSync(base).filter((d) => statSync(path.join(base, d)).isDirectory());
  return dev.every((ac) => {
    const label = norm(ac.device || ac.proofText);
    const dir = dirs.find((d) => label.includes(norm(d)));
    if (!dir) return false;
    const perf = path.join(base, dir, 'perf.json');
    if (existsSync(perf)) {
      const auto = resolveAuto(perf, checklistDir);
      if (auto.error || !auto.tier) return false;
      return verifyFile(perf, { tier: auto.tier, ...(auto.checklistFile ? { checklist: JSON.parse(readFileSync(auto.checklistFile, 'utf8')) } : {}) }).ok;
    }
    return existsSync(path.join(base, dir, 'notes.json'));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Spec sections
// ---------------------------------------------------------------------------------------------------------------

function specSectionsByRid(root: string): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  const dir = path.join(root, 'spec', 'domains');
  if (!existsSync(dir)) return new Map();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    let section = '';
    for (const l of toLines(read(path.join(dir, f)))) {
      const h = /^#{2,3}\s+(\d+(?:\.\d+)?)\b/.exec(l.text);
      if (h) section = h[1] as string;
      if (!l.text.trim().startsWith("|") || section.split(".")[0] !== "1") continue;
      for (const m of l.text.matchAll(/\bR-[A-Z]+-\d+\b/g)) {
        const key = m[0];
        (out.get(key) ?? out.set(key, new Set()).get(key)!).add(`${f.replace(/\.md$/, '')}${section ? ` §${section.split('.')[0]}` : ''}`);
      }
    }
  }
  return new Map([...out].map(([k, v]) => [k, [...v].sort()]));
}

// ---------------------------------------------------------------------------------------------------------------
// buildTrace
// ---------------------------------------------------------------------------------------------------------------

export function buildTrace(opts: TraceOptions = {}): TraceResult {
  const root = opts.root ?? repoRoot;
  const dir = path.join(root, 'spec', '07-milestones');
  const rids = parseRIds(read(path.join(root, 'prompt-pack', '06-SHARED-CONTEXT.md')));
  const ridSet = new Set(rids.map((r) => r.rid));
  const statuses = parseStatusTable(read(path.join(dir, 'README.md')));
  const planRows = parsePlanOrder(read(path.join(dir, '_PLAN.md')));
  const planRs = new Map<string, string[]>();
  for (const part of ['_PLAN-1.md', '_PLAN-2.md', '_PLAN-3.md', '_PLAN.md']) for (const [k, v] of parsePlanRs(read(path.join(dir, part)))) planRs.set(k, v);

  const files = new Map<string, string>();
  if (existsSync(dir)) for (const f of readdirSync(dir)) {
    const id = /^(M\d{2}[a-z]?\d?)-.*\.md$/.exec(f)?.[1];
    if (id) files.set(id, path.join(dir, f));
  }
  const order = planRows.map((p) => p.id);
  for (const id of [...files.keys(), ...planRs.keys()].sort()) if (!order.includes(id)) order.push(id);

  const cited = new Map<string, Cited>();
  const unknownCitations: { milestone: string; rid: string }[] = [];
  for (const id of order) {
    const status = statuses.get(id)?.status ?? 'PENDING';
    const file = files.get(id);
    if (file) {
      const doc = parseMilestone(read(file));
      const reqs: Requirement[] = parseRequirements(doc.sections.get('Requirements'));
      const support = new Map<string, boolean>();
      for (const r of reqs) support.set(r.rid, (support.get(r.rid) ?? true) && r.support);
      cited.set(id, { id, status, hasFile: true, support, rids: new Set(reqs.map((r) => r.rid)), acs: doc.acs });
    } else if (planRs.has(id)) {
      cited.set(id, { id, status: 'PENDING', hasFile: false, support: new Map(), rids: new Set(planRs.get(id)), acs: [] });
    }
    for (const rid of cited.get(id)?.rids ?? []) if (!ridSet.has(rid)) unknownCitations.push({ milestone: id, rid });
  }

  const gates = (() => {
    try {
      return JSON.parse(read(path.join(root, 'spec', 'trace-gates.json')) || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  let launch: unknown = [];
  try {
    launch = JSON.parse(read(path.join(root, 'docs', 'legal', 'launch-gates.json')) || '[]');
  } catch {
    launch = [];
  }
  const results = readResults(opts.results ?? path.join(root, 'tests', 'reports'));
  const sections = specSectionsByRid(root);
  const checklistDir = path.join(root, 'tools', 'ci', 'checklists');
  const closureAt = opts.closure ? order.indexOf(opts.closure) : -1;

  const rows: TraceRow[] = rids.map(({ rid }) => {
    const citing = order.filter((id) => cited.get(id)?.rids.has(rid)).map((id) => cited.get(id) as Cited);
    const ms: TraceMilestone[] = citing.map((c) => ({
      id: c.id,
      support: c.support.get(rid) ?? false,
      postGate: closureAt >= 0 && order.indexOf(c.id) > closureAt,
      source: c.hasFile ? 'file' : 'plan',
    }));
    const counted = citing.filter((c) => !(closureAt >= 0 && order.indexOf(c.id) > closureAt));
    const tests = [...new Set(citing.flatMap((c) => c.acs.flatMap((ac) => { const n = namedTests(ac); return [...n.files.map((f) => path.basename(f)), ...n.tags, ...n.names]; })))].sort();
    const flags: TraceFlag[] = [];
    if (citing.length === 0) flags.push('empty');
    const acsAll = citing.flatMap((c) => c.acs);
    if (acsAll.length > 0 && acsAll.every((a) => a.oracle === 'device-check' || a.oracle === 'device-perf')) flags.push('device-only');

    let status: TraceStatus;
    let blockedBy: string[] = [];
    if (citing.length > 0 && counted.length === 0) status = 'post-gate';
    else if (counted.length === 0) status = 'planned';
    else {
      const allReady = counted.every((c) => c.hasFile && c.status !== 'PENDING');
      const allDone = counted.every((c) => c.hasFile && c.status === 'DONE');
      const green = allDone && counted.every((c) => c.acs.filter((a) => a.oracle !== 'device-check').every((a) => proofGreen(a, results)));
      const seen = green && counted.every((c) => deviceSeen(root, c.id, c.acs, checklistDir));
      status = seen ? 'seen-on-device' : green ? 'tested' : allReady ? 'ready' : 'planned';
      if (status === 'tested' || status === 'seen-on-device') {
        const mapped = Array.isArray(gates[rid]) ? (gates[rid] as string[]) : [];
        blockedBy = openGates(mapped, launch);
        if (blockedBy.length > 0) status = 'blocked';
      }
    }
    return { rid, specSections: sections.get(rid) ?? [], milestones: ms, tests, status, blockedBy, flags };
  });

  const failures: string[] = [];
  if (opts.strict) {
    for (const r of rows) for (const f of r.flags) failures.push(`${r.rid}: ${f}`);
    for (const u of unknownCitations) failures.push(`${u.milestone}: cites ${u.rid}, which is not a 06 section 2 R-ID`);
  }
  const markdown = renderMarkdown(rows, unknownCitations, opts.closure);
  const result: TraceResult = { ok: failures.length === 0, rows, failures, unknownCitations, markdown };
  if (opts.out) {
    mkdirSync(opts.out, { recursive: true });
    writeFileSync(path.join(opts.out, 'trace.json'), `${JSON.stringify({ rows, unknownCitations, failures }, null, 2)}\n`);
    writeFileSync(path.join(opts.out, 'trace.md'), markdown);
  }
  return result;
}

export function statusText(r: TraceRow): string {
  return r.status === 'blocked' ? `blocked (${r.blockedBy.join(', ')})` : r.status;
}

function renderMarkdown(rows: TraceRow[], unknown: { milestone: string; rid: string }[], closure: string | undefined): string {
  const cap = (xs: string[], n: number): string => (xs.length <= n ? xs.join(', ') : `${xs.slice(0, n).join(', ')} (+${xs.length - n})`);
  const out: string[] = [
    '# Traceability',
    '',
    `Generated by \`tools/ci/trace.ts\` (M00d)${closure ? `; gate closure ${closure}` : ''}. Format: 03-SPEC-TEMPLATE section G.`,
    '',
    '| R-ID | spec sections | milestones | tests (names) | status |',
    '|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const ms = r.milestones.map((m) => `${m.id}${m.support ? ' (s)' : ''}${m.postGate ? ' (post-gate)' : ''}`);
    const flags = r.flags.length ? ` [${r.flags.join(', ')}]` : '';
    out.push(`| ${r.rid} | ${r.specSections.join(', ') || '-'} | ${ms.join(', ') || '-'} | ${cap(r.tests, 6) || '-'} | ${statusText(r)}${flags} |`);
  }
  if (unknown.length > 0) {
    out.push('', '## Unknown R-IDs cited', '', ...unknown.map((u) => `- ${u.milestone}: ${u.rid}`));
  }
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.status, (count.get(r.status) ?? 0) + 1);
  out.push('', `Totals: ${[...count].map(([k, v]) => `${k} ${v}`).join(', ')}.`, '');
  return out.join('\n');
}

function main(): void {
  const argv = args();
  const flag = (n: string): string | undefined => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const root = flag('--root') ? path.resolve(flag('--root') as string) : repoRoot;
  const res = buildTrace({
    root,
    strict: argv.includes('--strict'),
    ...(flag('--closure') ? { closure: flag('--closure') as string } : {}),
    ...(flag('--results') ? { results: path.resolve(flag('--results') as string) } : {}),
    out: path.resolve(flag('--out') ?? path.join(root, 'tests', 'reports')),
  });
  const flagged = res.rows.filter((r) => r.flags.length > 0);
  for (const r of flagged) console.log(`flag ${r.rid}: ${r.flags.join(', ')}`);
  for (const u of res.unknownCitations) console.log(`flag ${u.milestone}: cites ${u.rid}, not a 06 section 2 R-ID`);
  console.log(`trace: ${res.rows.length} R-IDs, ${flagged.length} flagged${argv.includes('--strict') ? ' (strict)' : ''}`);
  for (const f of res.failures) console.error(`FAIL ${f}`);
  process.exit(res.ok ? 0 : 1);
}

if (isMain(import.meta.url)) main();
