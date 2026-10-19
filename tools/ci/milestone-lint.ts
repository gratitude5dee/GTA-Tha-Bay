/**
 * C15 milestone lint (M00d; spec/domains/13-qa.md section 4.3, rules L1-L8).
 *
 *   tsx tools/ci/milestone-lint.ts [--dir <dir>] [--out <file>]
 *
 * Files whose README status is READY, IN PROGRESS or DONE are enforced (any L1-L7 error fails); PENDING files and files
 * absent from the table are reported, their errors downgraded to warnings that keep the rule id. L7's file-count
 * warning and L8 are warnings for every file. Writes tests/reports/milestones.json and prints `<file>:<line> <rule> <message>`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MILESTONE_ID_RE } from '../../packages/shared/src/contracts/c15-milestone.ts';
import { isMain } from './lib/common.ts';
import {
  EXPECTED_HEADINGS,
  inRegistry,
  isPnpmBuiltin,
  parseContractIndex,
  parseMilestone,
  parsePlanOrder,
  parseRIds,
  parseScriptRegistry,
  parseStatusTable,
  type FileStatus,
  type ParsedMilestone,
  type Section,
} from './md-parse.ts';
import { args, repoRoot } from './run.ts';

export type Rule = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8';

export interface Finding {
  file: string;
  line: number;
  rule: Rule;
  message: string;
}

export interface MilestoneReport {
  file: string;
  status: FileStatus | 'PENDING';
  enforced: boolean;
  errors: string[];
  warnings: string[];
}

/** L7 file-count exceptions; a new entry needs an Architect DL entry (DL-281). */
export const L7_FILE_EXCEPTIONS: Readonly<Record<string, number>> = { M00: 45 };
export const L7_MAX_FILES = 40;
export const L7_WARN_FILES = 35;

export interface LintContext {
  /** R-IDs of 06 section 2. */
  rids: Set<string>;
  /** `_PLAN.md` ids in run order. */
  planIds: string[];
  contractIndex: Map<string, string>;
  /** 08 section 6 plus the 06 section 5 script list. */
  baseRegistry: Set<string>;
  /** Scripts declared in each milestone's Deliverables, by id. */
  declared: Map<string, Set<string>>;
}

export interface LintOptions {
  /** Repository root holding prompt-pack/ and spec/; default: this repository. */
  root?: string;
  /** README status table; default `<dir>/README.md`. */
  readme?: string;
}

const read = (file: string): string => (existsSync(file) ? readFileSync(file, 'utf8') : '');

/** Script-like names declared by a Deliverables section: bold names, backticked `name:sub` tokens, `pnpm <script>` and package scripts. */
export function declaredScripts(section: Section | undefined): Set<string> {
  const out = new Set<string>();
  if (!section) return out;
  const text = section.lines.map((l) => l.text).join('\n');
  for (const m of text.matchAll(/\*\*`?([a-z][a-z0-9]*(?::[a-z0-9.*-]+)*)`?\*\*/g)) out.add(m[1] as string);
  for (const m of text.matchAll(/`([a-z][a-z0-9]*(?::[a-z0-9.*-]+)+)(?:[ `]|\*|$)/g)) out.add(m[1] as string);
  for (const m of text.matchAll(/`([a-z][a-z0-9]*(?::[a-z0-9.*-]+)+)\*?`/g)) out.add(m[1] as string);
  for (const m of text.matchAll(/\bpnpm\s+(?:--filter\s+\S+\s+)?([a-z][a-z0-9]*(?::[a-z0-9.*-]+)*)/g)) out.add(m[1] as string);
  for (const m of text.matchAll(/\b([a-z][a-z0-9]*:\*)/g)) out.add(m[1] as string);
  return out;
}

export function buildContext(root: string, milestoneDir: string): LintContext {
  const shared = read(path.join(root, 'prompt-pack', '06-SHARED-CONTEXT.md'));
  const plan = parsePlanOrder(read(path.join(root, 'spec', '07-milestones', '_PLAN.md')));
  const baseRegistry = parseScriptRegistry(read(path.join(root, 'spec', '08-test-and-ci.md')));
  // The 06 section 5 script list: every backticked `name:sub` token in the "Scripts" bullets.
  const s5 = /\n- \*\*Scripts\*\*[\s\S]*?(?=\n- \*\*Build and QA flags)/.exec(shared)?.[0] ?? '';
  for (const m of s5.matchAll(/`([a-z][a-z0-9]*(?::[a-z0-9.*-]+)*)/g)) baseRegistry.add(m[1] as string);
  const declared = new Map<string, Set<string>>();
  for (const f of existsSync(milestoneDir) ? readdirSync(milestoneDir) : []) {
    const id = /^(M\d{2}[a-z]?\d?)-/.exec(f)?.[1];
    if (!id) continue;
    declared.set(id, declaredScripts(parseMilestone(read(path.join(milestoneDir, f))).sections.get('Deliverables')));
  }
  return {
    rids: new Set(parseRIds(shared).map((r) => r.rid)),
    planIds: plan.map((p) => p.id),
    contractIndex: parseContractIndex(shared),
    baseRegistry,
    declared,
  };
}

/** Registry for the file `id`: 08 section 6, 06 section 5, and every Deliverables declaration at or before `id` in plan order. */
export function registryFor(ctx: LintContext, id: string): Set<string> {
  const out = new Set(ctx.baseRegistry);
  const at = ctx.planIds.indexOf(id);
  const upTo = at < 0 ? [id] : ctx.planIds.slice(0, at + 1);
  for (const m of upTo) for (const s of ctx.declared.get(m) ?? []) out.add(s);
  return out;
}

/** All scripts any milestone declares (for check:agents, which accepts a later milestone's script). */
export function allDeclared(ctx: LintContext): Set<string> {
  const out = new Set(ctx.baseRegistry);
  for (const set of ctx.declared.values()) for (const s of set) out.add(s);
  return out;
}

function versionAbove(cited: string, index: string): boolean {
  const [cMaj = 0, cMin = 0, cPat = 0] = cited.split('.').map(Number);
  const [iMaj = 0, iMin = 0, iPat = 0] = index.split('.').map(Number);
  if (cMaj !== iMaj) return cMaj > iMaj;
  if (cMin !== iMin) return cMin > iMin;
  return cPat > iPat;
}

/** Lints one parsed file; every finding is an error here, the caller downgrades for non-enforced files. */
export function lintParsed(file: string, doc: ParsedMilestone, ctx: LintContext): { errors: Finding[]; warnings: Finding[] } {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const err = (line: number, rule: Rule, message: string): void => void errors.push({ file, line, rule, message });
  const warn = (line: number, rule: Rule, message: string): void => void warnings.push({ file, line, rule, message });
  const stem = path.basename(file).replace(/\.md$/, '');
  const fileId = /^(M\d{2}[a-z]?\d?)-/.exec(stem)?.[1] ?? '';
  const id = fileId || stem;

  // L1: title and headings.
  if (!doc.titleOk) err(1, 'L1', `title line must be "# <id> — <slug>", got "${doc.titleLine}"`);
  else if (fileId && doc.titleId !== fileId) err(1, 'L1', `title id ${doc.titleId} differs from the file name id ${fileId}`);
  const names = doc.headings.map((h) => h.name);
  if (names.join('\n') !== EXPECTED_HEADINGS.join('\n')) {
    const missing = EXPECTED_HEADINGS.find((h) => !names.includes(h));
    const wrongAt = names.findIndex((n, i) => n !== EXPECTED_HEADINGS[i]);
    if (missing) err(doc.headings[0]?.line ?? 1, 'L1', `missing heading "## ${missing}"`);
    else err(doc.headings[Math.max(wrongAt, 0)]?.line ?? 1, 'L1', `headings are not exactly the C15 list in order (first difference at "${names[wrongAt] ?? ''}")`);
  }

  // L2 / L3 / L4: acceptance criteria.
  const acSection = doc.sections.get('Acceptance criteria');
  if (acSection && doc.acs.length === 0) err(acSection.heading.line, 'L2', 'no acceptance criteria found');
  doc.acs.forEach((ac, i) => {
    if (ac.n !== i + 1) err(ac.line, 'L2', `AC ids must run AC-1...AC-n without gaps (found AC-${ac.n} at position ${i + 1})`);
    if (ac.form === 'bad') err(ac.line, 'L2', `AC-${ac.n} needs Given with When...Then, or a nested list of expected results`);
    if (ac.proofCount !== 1) err(ac.line, 'L2', `AC-${ac.n} needs exactly one "— proof:" (found ${ac.proofCount})`);
    else if (ac.manual) {
      if (!ac.device || !ac.steps) err(ac.line, 'L3', `AC-${ac.n} manual proof needs a device label and steps`);
    } else if (ac.commands.length === 0) err(ac.line, 'L3', `AC-${ac.n} proof has no backticked pnpm command and does not start with "manual:"`);
    for (const l of ac.lines) {
      if (/UNVERIFIED/.test(l.text)) err(l.n, 'L4', `AC-${ac.n} contains the banned token UNVERIFIED`);
      for (const m of l.text.matchAll(/\bU-[A-Z]+-\d+\b/g)) {
        if (!/\b(?:records?|decides?)\b/i.test(l.text.slice(0, m.index ?? 0))) err(l.n, 'L4', `AC-${ac.n} cites ${m[0]} outside a "records" or "decides" clause`);
      }
    }
  });

  // L5: scripts.
  {
    const registry = registryFor(ctx, id);
    for (const s of declaredScripts(doc.sections.get('Deliverables'))) registry.add(s);
    for (const ac of doc.acs) {
      for (const c of ac.commands) {
        for (const p of c.pieces) {
          if (!p.script || isPnpmBuiltin(p.script)) continue;
          if (p.filter !== undefined && (p.script === 'test' || p.script.startsWith('test:'))) continue;
          if (!inRegistry(p.script, registry)) err(ac.line, 'L5', `AC-${ac.n} runs "pnpm ${p.script}", which is not in the script registry or this milestone's Deliverables`);
        }
      }
    }
  }

  // L6: requirements, dependencies, contract versions.
  const req = doc.sections.get('Requirements');
  for (const l of req?.lines ?? []) {
    for (const m of l.text.matchAll(/\bR-[A-Z]+-\d+\b/g)) if (!ctx.rids.has(m[0])) err(l.n, 'L6', `${m[0]} is not an R-ID of 06 section 2`);
  }
  const dep = doc.sections.get('Depends on');
  const known = new Set(ctx.planIds);
  for (const l of dep?.lines ?? []) {
    for (const m of l.text.matchAll(/\bM\d{2}[a-z]?\d?\b/g)) if (ctx.planIds.length > 0 && !known.has(m[0])) err(l.n, 'L6', `Depends on cites ${m[0]}, which is not in _PLAN.md`);
  }
  for (const l of doc.sections.get('Interfaces')?.lines ?? []) {
    for (const m of l.text.matchAll(/\bC(\d{2})\s+(?:v)?(\d+\.\d+(?:\.\d+)?)/g)) {
      const cid = `C${m[1]}`;
      const idx = ctx.contractIndex.get(cid);
      const cited = m[2] as string;
      if (!idx) err(l.n, 'L6', `${cid} is not in the 06 section 4.2 index`);
      else if (cited.split('.')[0] !== idx.split('.')[0]) err(l.n, 'L6', `${cid} ${cited} has a different major than the index (${idx})`);
      else if (versionAbove(cited, idx) && !/proposed/i.test(l.text)) err(l.n, 'L6', `${cid} ${cited} is above the index (${idx}) and the line does not say "proposed"`);
    }
  }

  // L7: effort.
  const eff = doc.sections.get('Effort');
  const effText = (eff?.lines ?? []).map((l) => l.text).join(' ');
  const effLine = eff?.heading.line ?? 1;
  const sessions = /([\d.]+)\s+(?:Builder\s+)?sessions?/i.exec(effText)?.[1];
  const files = /(?:≈|about)\s*(\d+)\s+(?:[A-Za-z-]+\s+){0,2}files/i.exec(effText)?.[1];
  if (sessions === undefined) err(effLine, 'L7', 'Effort does not state the sessions');
  else if (Number(sessions) > 1) err(effLine, 'L7', `Effort states ${sessions} sessions (limit 1)`);
  if (files === undefined) err(effLine, 'L7', 'Effort does not state a file count');
  else {
    const limit = L7_FILE_EXCEPTIONS[fileId] ?? L7_MAX_FILES;
    if (Number(files) > limit) err(effLine, 'L7', `Effort states ${files} files (limit ${limit})`);
    else if (Number(files) > L7_WARN_FILES) warn(effLine, 'L7', `Effort states ${files} files (warning above ${L7_WARN_FILES})`);
  }

  // L8 (warning): app or service deliverables need a deploy or smoke AC.
  const deliv = (doc.sections.get('Deliverables')?.lines ?? []).map((l) => l.text).join('\n');
  if (/\b(?:apps\/web|services\/[a-z]+)\b/.test(deliv)) {
    const proves = doc.acs.some((ac) => ac.commands.some((c) => c.pieces.some((p) => ['deploy:preview', 'deploy:prod', 'check:smoke'].includes(p.script))));
    if (!proves) warn(doc.sections.get('Acceptance criteria')?.heading.line ?? 1, 'L8', 'Deliverables touch apps/web or services but no AC proves deploy:preview, deploy:prod or check:smoke');
  }
  return { errors, warnings };
}

export interface LintResult {
  reports: MilestoneReport[];
  /** Enforced errors only. */
  errors: Finding[];
  findings: Finding[];
}

const fmtFinding = (f: Finding): string => `${f.file}:${f.line} ${f.rule} ${f.message}`;

/** Lints every `M*.md` file of `dir` (README.md and _PLAN*.md are skipped). */
export function lintMilestones(dir: string, opts: LintOptions = {}): LintResult {
  const root = opts.root ?? repoRoot;
  const ctx = buildContext(root, dir);
  const statuses = parseStatusTable(read(opts.readme ?? path.join(dir, 'README.md')));
  const reports: MilestoneReport[] = [];
  const errors: Finding[] = [];
  const findings: Finding[] = [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('_PLAN'))
    .sort();
  for (const f of files) {
    const id = /^(M\d{2}[a-z]?\d?)-/.exec(f)?.[1] ?? f.replace(/\.md$/, '');
    const doc = parseMilestone(read(path.join(dir, f)));
    const { errors: errs, warnings } = lintParsed(f, doc, ctx);
    const status = statuses.get(id)?.status ?? 'PENDING';
    const enforced = status !== 'PENDING';
    const asWarn = enforced ? warnings : [...errs, ...warnings];
    reports.push({
      file: f,
      status,
      enforced,
      errors: enforced ? errs.map(fmtFinding) : [],
      warnings: asWarn.map(fmtFinding),
    });
    if (enforced) errors.push(...errs);
    findings.push(...errs, ...warnings);
  }
  return { reports, errors, findings };
}

export function writeReport(reports: MilestoneReport[], out: string): void {
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(reports, null, 2)}\n`);
}

export { MILESTONE_ID_RE };

function main(): void {
  const argv = args();
  const flag = (n: string): string | undefined => argv[argv.indexOf(n) + 1];
  const dir = path.resolve(argv.includes('--dir') ? (flag('--dir') as string) : path.join(repoRoot, 'spec', '07-milestones'));
  const out = path.resolve(argv.includes('--out') ? (flag('--out') as string) : path.join(repoRoot, 'tests', 'reports', 'milestones.json'));
  const res = lintMilestones(dir);
  writeReport(res.reports, out);
  for (const r of res.reports) for (const line of [...r.errors, ...r.warnings]) console.log(line);
  console.log(`milestone-lint: ${res.reports.length} files, ${res.errors.length} errors in enforced files -> ${path.relative(repoRoot, out)}`);
  process.exit(res.errors.length === 0 ? 0 : 1);
}

if (isMain(import.meta.url)) main();
