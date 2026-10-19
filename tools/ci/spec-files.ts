/**
 * Spec-file checks (M00d; spec/domains/13-qa.md section 3.8, the automatable part of 03-SPEC-TEMPLATE section H):
 *
 *   tsx tools/ci/spec-files.ts [--strict] [--root <dir>] [--out <dir>]
 *
 *  1. the 03-SPEC-TEMPLATE section A files exist;
 *  2. every spec/**\/*.md is at most 6,000 words;
 *  3. every spec/99 U-row names a default and a verifying milestone present in _PLAN.md;
 *  4. the kickoff <milestones> list matches _PLAN.md section 1 (ids and sessions, in order);
 *  5. no retired U-id (the "Merged U-ids" line of spec/99) appears in spec/**\/*.md or docs/decisions/** outside spec/99 and
 *     the decision logs; a hit in a frozen or started milestone file is a warning (DL-539).
 *
 * Writes tests/reports/spec-files.json. Fails only with --strict (M14b3): the Wave 5 integration files are still landing.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMain } from './lib/common.ts';
import { parsePlanOrder, parseStatusTable, parseTables, toLines } from './md-parse.ts';
import { args, repoRoot } from './run.ts';

export const MAX_SPEC_WORDS = 6000;

/** 03-SPEC-TEMPLATE section A: files and directories that must exist (milestone files are checked by the lint). */
export const SECTION_A_FILES: readonly string[] = [
  'spec/00-plan.md',
  'spec/01-product.md',
  'spec/02-architecture.md',
  'spec/03-decisions-and-facts.md',
  'spec/04-data-models.md',
  'spec/05-api-and-realtime.md',
  'spec/06-asset-pipeline.md',
  'spec/07-milestones',
  'spec/08-test-and-ci.md',
  'spec/09-risk-register.md',
  'spec/10-cost-model.md',
  'spec/11-decision-log.md',
  'spec/12-glossary.md',
  'spec/99-open-questions.md',
  'CLAUDE.md',
  'AGENTS.md',
  'prompt-pack/04-SONNET-KICKOFF.md',
];

export type FindingKind = 'missing-file' | 'too-long' | 'u-row' | 'kickoff' | 'retired-u';

export interface SpecFinding {
  kind: FindingKind;
  file: string;
  message: string;
}

export interface SpecFilesResult {
  ok: boolean;
  failures: SpecFinding[];
  warnings: SpecFinding[];
}

export interface SpecFilesOptions {
  root?: string;
  strict?: boolean;
  /** Directory for spec-files.json; nothing is written when absent. */
  out?: string;
}

const read = (file: string): string => (existsSync(file) ? readFileSync(file, 'utf8') : '');

function walkMd(dir: string, rel = ''): string[] {
  const full = path.join(dir, rel);
  if (!existsSync(full)) return [];
  const out: string[] = [];
  for (const name of readdirSync(full).sort()) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(path.join(dir, r)).isDirectory()) out.push(...walkMd(dir, r));
    else if (name.endsWith('.md')) out.push(r);
  }
  return out;
}

export const wordCount = (text: string): number => (text.match(/\S+/g) ?? []).length;

/** The old ids of the "Merged U-ids" line of spec/99 (everything left of an arrow). */
export function retiredUIds(spec99: string): string[] {
  const line = spec99.split(/\r?\n/).find((l) => l.includes('Merged U-ids'));
  if (!line) return [];
  const body = line.slice(line.indexOf(':') + 1);
  const out: string[] = [];
  for (const seg of body.split('·')) {
    const arrow = seg.indexOf('→');
    if (arrow < 0) continue;
    for (const m of seg.slice(0, arrow).matchAll(/\bU-[A-Z0-9]+-\d+\b/g)) out.push(m[0]);
  }
  return out;
}

export function checkSpecFiles(opts: SpecFilesOptions = {}): SpecFilesResult {
  const root = opts.root ?? repoRoot;
  const failures: SpecFinding[] = [];
  const warnings: SpecFinding[] = [];
  const fail = (kind: FindingKind, file: string, message: string): void => void failures.push({ kind, file, message });

  // 1. Section A files.
  for (const f of SECTION_A_FILES) if (!existsSync(path.join(root, f))) fail('missing-file', f, `${f} is missing (03-SPEC-TEMPLATE section A)`);

  // 2. Word ceiling.
  const specMd = walkMd(root, 'spec');
  for (const f of specMd) {
    const words = wordCount(read(path.join(root, 'spec', f)));
    if (words > MAX_SPEC_WORDS) fail('too-long', `spec/${f}`, `spec/${f} has ${words} words (limit ${MAX_SPEC_WORDS}); split it`);
  }

  // 3. spec/99 U-rows.
  const spec99Path = path.join(root, 'spec', '99-open-questions.md');
  const spec99 = read(spec99Path);
  const plan = parsePlanOrder(read(path.join(root, 'spec', '07-milestones', '_PLAN.md')));
  const planIds = new Set(plan.map((p) => p.id));
  for (const t of parseTables(spec99)) {
    const iU = t.header.findIndex((h) => h === 'U');
    const iVer = t.header.findIndex((h) => /^Verified/.test(h));
    const iDef = t.header.findIndex((h) => /^Default/.test(h));
    if (iU < 0 || iVer < 0 || iDef < 0) continue;
    for (const r of t.rows) {
      const u = (r.cells[iU] ?? '').trim();
      if (!/^U-[A-Z0-9]+-\d+$/.test(u)) continue;
      if (!(r.cells[iDef] ?? '').trim()) fail('u-row', `spec/99-open-questions.md:${r.line}`, `${u} has no default`);
      const ids = ((r.cells[iVer] ?? '').match(/\bM\d{2}[a-z]?\d?\b/g) ?? []).filter((m) => planIds.has(m));
      if (ids.length === 0) fail('u-row', `spec/99-open-questions.md:${r.line}`, `${u} names no verifying milestone present in _PLAN.md ("${(r.cells[iVer] ?? '').trim()}")`);
    }
  }

  // 4. Kickoff list against _PLAN.md section 1.
  const kickoff = read(path.join(root, 'prompt-pack', '04-SONNET-KICKOFF.md'));
  const block = /^<milestones>\s*$([\s\S]*?)^<\/milestones>/m.exec(kickoff)?.[1] ?? '';
  const listed: { id: string; sessions: string }[] = [];
  for (const l of toLines(block)) {
    const m = /^\d+\.\s+(M\d{2}[a-z]?\d?)\s+·\s+\S+\s+·\s+([\d.]+)\s+·/.exec(l.text);
    if (m) listed.push({ id: m[1] as string, sessions: m[2] as string });
  }
  const KICK = 'prompt-pack/04-SONNET-KICKOFF.md';
  if (plan.length === 0) fail('kickoff', KICK, 'no _PLAN.md section 1 table to compare with');
  else {
    const have = new Set(listed.map((x) => x.id));
    for (const p of plan) if (!have.has(p.id)) fail('kickoff', KICK, `kickoff <milestones> list is missing ${p.id}`);
    for (const x of listed) if (!planIds.has(x.id)) fail('kickoff', KICK, `kickoff lists ${x.id}, which is not in _PLAN.md`);
    const bySessions = new Map(plan.map((p) => [p.id, p.sessions]));
    for (const x of listed) {
      const want = bySessions.get(x.id);
      if (want !== undefined && Number(want) !== Number(x.sessions)) fail('kickoff', KICK, `${x.id} is ${x.sessions} sessions in the kickoff and ${want} in _PLAN.md`);
    }
    const common = listed.map((x) => x.id).filter((id) => planIds.has(id));
    const expected = plan.map((p) => p.id).filter((id) => have.has(id));
    if (common.join(',') !== expected.join(',')) fail('kickoff', KICK, 'kickoff list order differs from _PLAN.md section 1');
  }

  // 5. Retired U-ids.
  const retired = retiredUIds(spec99);
  if (retired.length > 0) {
    const statuses = parseStatusTable(read(path.join(root, 'spec', '07-milestones', 'README.md')));
    const candidates = [...specMd.map((f) => `spec/${f}`), ...walkMd(root, 'docs/decisions').map((f) => `docs/decisions/${f}`)];
    for (const rel of candidates) {
      if (rel === 'spec/99-open-questions.md' || /^spec\/11-decision-log[^/]*\.md$/.test(rel)) continue;
      const text = read(path.join(root, rel));
      for (const l of toLines(text)) {
        for (const id of retired) {
          if (!new RegExp(`\\b${id}(?![\\w-])`).test(l.text)) continue;
          const msId = /^spec\/07-milestones\/(M\d{2}[a-z]?\d?)-/.exec(rel)?.[1];
          const st = msId ? statuses.get(msId) : undefined;
          const started = !!st && (st.status !== 'READY' || /frozen/i.test(st.cell));
          const finding: SpecFinding = { kind: 'retired-u', file: `${rel}:${l.n}`, message: `retired U-id ${id} (merged, see spec/99 section 2)` };
          if (started) warnings.push(finding);
          else failures.push(finding);
        }
      }
    }
  }

  const ok = !opts.strict || failures.length === 0;
  if (opts.out) {
    mkdirSync(opts.out, { recursive: true });
    writeFileSync(path.join(opts.out, 'spec-files.json'), `${JSON.stringify({ strict: !!opts.strict, failures, warnings }, null, 2)}\n`);
  }
  return { ok, failures, warnings };
}

function main(): void {
  const argv = args();
  const root = argv.includes('--root') ? path.resolve(argv[argv.indexOf('--root') + 1] as string) : repoRoot;
  const strict = argv.includes('--strict');
  const res = checkSpecFiles({ root, strict, out: path.resolve(argv.includes('--out') ? (argv[argv.indexOf('--out') + 1] as string) : path.join(root, 'tests', 'reports')) });
  for (const f of res.failures) console.log(`${strict ? 'FAIL' : 'finding'} ${f.kind} ${f.file}: ${f.message}`);
  for (const w of res.warnings) console.log(`warn ${w.kind} ${w.file}: ${w.message}`);
  console.log(`spec-files: ${res.failures.length} findings, ${res.warnings.length} warnings${strict ? ' (strict)' : ' (reported, not failing)'}`);
  process.exit(res.ok ? 0 : 1);
}

if (isMain(import.meta.url)) main();
