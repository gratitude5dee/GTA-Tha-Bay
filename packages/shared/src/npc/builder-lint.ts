/**
 * The lints the NPC builder runs on a generated soul.md (spec/domains/04-npc-builder.md section C4, "Validation"): the canonical schema, then
 * L1 (schedule), L2 (places), L3 (names), L5 (example lines), L6 (contact data) and L12 (denylisted prompt strings) of
 * spec/domains/04-npc-contracts.md section B8, plus the goal catalog (L13, goals half). Pure: the Worker supplies the tables.
 *
 * `npc:lint` (tools/soul/src/lint.ts) keeps its own copy of these rules for souls on disk; the two are kept in step by the shared fixtures of
 * packages/shared/test/npc/builder-lint.spec.ts. The model-free rules need no file system, so they live here and run in the Worker.
 */
import type { LintIssue } from '../contracts/c10-npc-builder.ts';
import type { SoulFrontmatter } from '../contracts/c10-npc.ts';
import { scanText, type StringMatcher } from '../assets/gates/ip.ts';
import { normalizeName, scanRealNames, type RealNameMatcher } from '../assets/gates/names.ts';
import { requiredSections } from './compile.ts';
import { parseExampleLines, parseSoul, SoulParseError } from './parse.ts';
import { findContactInfo } from './pii.ts';
import { dayIntervals, formatClock, MINUTES_PER_DAY, parseClock, WEEKDAYS } from './schedule.ts';
import { formatIssue, validateSoul } from './validate.ts';

/** The tables the lints read. */
export interface BuilderLintEnv {
  /** PoiIds of the draft's district: the only places a generated soul may use. */
  pois: ReadonlySet<string>;
  /** The goal catalog (`config/npc-goals.json`). */
  goals: ReadonlySet<string>;
  /** Normalised display names of the shipped souls and of `config/names.json`, to the id that owns each (L3, display side). */
  knownNames: ReadonlyMap<string, string>;
  /** Compiled real-side names (PRIVATE `names/real.json`); empty when the object is absent. */
  realMatchers: readonly RealNameMatcher[];
  /** The IP denylist matcher (`config/ip-denylist.json`). */
  strings: StringMatcher;
}

export interface BuilderLintResult {
  issues: LintIssue[];
  /** Present when the file parsed, passed the schema and has every required section. */
  front?: SoulFrontmatter;
  sections?: Record<string, string>;
}

function checkSchedule(front: SoulFrontmatter, add: (rule: string, path: string, m: string) => void): void {
  front.schedule.forEach((b, i) => {
    const from = parseClock(b.from);
    const to = parseClock(b.to);
    if (from < 0 || to < 0 || from >= MINUTES_PER_DAY || from === to) add('L1', `/schedule/${i}`, `schedule block ${i} has an invalid time range ${b.from}-${b.to}`);
  });
  dayIntervals(front.schedule).forEach((list, d) => {
    let cursor = 0;
    for (const iv of list) {
      if (iv.from < cursor) add('L1', '/schedule', `${WEEKDAYS[d]}: blocks overlap before ${formatClock(cursor)} (block ${iv.index})`);
      else if (iv.from > cursor) add('L1', '/schedule', `${WEEKDAYS[d]}: nothing scheduled from ${formatClock(cursor)} to ${formatClock(iv.from)}`);
      cursor = Math.max(cursor, iv.to);
    }
    if (cursor < MINUTES_PER_DAY) add('L1', '/schedule', `${WEEKDAYS[d]}: nothing scheduled from ${formatClock(cursor)} to 24:00`);
  });
}

/** Schema first (a schema error stops the run, so a fixture that breaks one rule reports that rule), then L1, L2, L3, L5, L6, L12 and the goal catalog. */
export function lintBuilderSoul(md: string, env: BuilderLintEnv): BuilderLintResult {
  const issues: LintIssue[] = [];
  const add = (rule: string, path: string, message: string): void => {
    issues.push({ rule, path, message });
  };

  let parsed;
  try {
    parsed = parseSoul(md);
  } catch (e) {
    add('schema', '', e instanceof SoulParseError ? e.message : 'the file could not be read');
    return { issues };
  }
  const schemaIssues = validateSoul(parsed.front);
  if (schemaIssues.length > 0) {
    for (const i of schemaIssues) add('schema', i.path, formatIssue(i));
    return { issues };
  }
  const front = parsed.front;
  const missing = requiredSections(front).filter((s) => (parsed.sections[s] ?? '').trim() === '');
  if (missing.length > 0) {
    for (const s of missing) add('schema', `/sections/${s}`, `section "## ${s}" is missing or empty`);
    return { issues };
  }

  // L1
  checkSchedule(front, add);

  // L2: every place is one of the district's POIs.
  const places = [front.locations.home, ...front.locations.hangouts, ...front.schedule.map((b) => b.place)];
  for (const p of [...new Set(places)]) if (!env.pois.has(p)) add('L2', '/locations', `place ${p} is not in the district's place list`);

  // L3
  const owner = env.knownNames.get(normalizeName(front.name));
  if (owner !== undefined && owner !== front.id) add('L3', '/name', `name "${front.name}" collides with ${owner}`);
  if (env.realMatchers.length > 0) for (const f of scanRealNames('soul.md', front.name, env.realMatchers)) add('L3', '/name', f.detail);

  // L5
  const ex = parseExampleLines(parsed.sections['Example lines'] ?? '');
  for (const b of ex.bad) add('L5', '/sections/Example lines', `example line is not "[tag] text": ${b.slice(0, 40)}`);
  if (ex.lines.length < 8) add('L5', '/sections/Example lines', `Example lines has ${ex.lines.length} lines (minimum 8)`);
  for (const t of ['greeting', 'mission', 'deflect', 'threat', 'farewell']) {
    if (!ex.lines.some((l) => l.tag === t)) add('L5', '/sections/Example lines', `Example lines has no [${t}] line`);
  }
  for (const l of ex.lines) {
    const words = l.text.split(/\s+/).filter(Boolean).length;
    if (words > front.speech.maxWordsPerLine) add('L5', '/sections/Example lines', `[${l.tag}] line has ${words} words (maxWordsPerLine ${front.speech.maxWordsPerLine})`);
  }

  // L6: no contact data anywhere in the file.
  for (const c of findContactInfo(md)) add('L6', '', `${c.kind} in the file`);

  // L12: prompt-bound strings carry no denylisted term, no real-side name and no style imitation.
  for (const s of [front.voice.design_prompt, front.visual_brief, ...front.speech.catchphrases]) {
    for (const h of scanText(s, env.strings, 3)) add('L12', '/visual_brief', `denylisted text (${h.rule})`);
    if (/\bin the style of\b/i.test(s)) add('L12', '/visual_brief', 'the text imitates a style ("in the style of")');
    if (/\bsounds? like\b/i.test(s)) add('L12', '/visual_brief', 'the text imitates a voice ("sounds like")');
    if (env.realMatchers.length > 0) for (const f of scanRealNames('soul.md', s, env.realMatchers)) add('L12', '/visual_brief', f.detail);
  }

  // L13 (goal half): goals come from the catalog.
  for (const g of front.goals) if (!env.goals.has(g)) add('L13', '/goals', `goal ${g} is not in the goal catalog`);

  return { issues, front, sections: parsed.sections };
}
