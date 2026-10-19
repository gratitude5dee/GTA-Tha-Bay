/**
 * npc:lint. Rules L1-L14 of spec/domains/04-npc-contracts.md section B8 over soul.md files. Schema errors come first and
 * stop the run for that file, so a fixture that breaks one rule reports exactly that rule. Pure rule logic sits in
 * packages/shared/src/npc; this module adds file reads, inkjs, the lock file, the name registry and the optional model calls.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { SoulFrontmatter } from '../../../packages/shared/src/contracts/c10-npc.ts';
import type { VoiceCatalog } from '../../../packages/shared/src/contracts/c10-npc.ts';
import { compileSoul, deriveAssets, promptHash, publicSoulHash, requiredSections, SoulCompileError } from '../../../packages/shared/src/npc/compile.ts';
import type { CompiledOutputs, RulesBlock } from '../../../packages/shared/src/npc/compile.ts';
import { parseExampleLines, parseSoul, SoulParseError } from '../../../packages/shared/src/npc/parse.ts';
import { findContactInfo } from '../../../packages/shared/src/npc/pii.ts';
import { dayIntervals, formatClock, MINUTES_PER_DAY, parseClock, WEEKDAYS } from '../../../packages/shared/src/npc/schedule.ts';
import { soulVersionProblem } from '../../../packages/shared/src/npc/version.ts';
import { formatIssue, validateSoul, validateVoiceCatalog } from '../../../packages/shared/src/npc/validate.ts';
import { compileStringMatcher, scanText } from '../../../packages/shared/src/assets/gates/ip.ts';
import type { StringMatcher } from '../../../packages/shared/src/assets/gates/ip.ts';
import { compileRealNames, normalisedDistance, normalizeName, NAME_DISTANCE_THRESHOLD, scanRealNames } from '../../../packages/shared/src/assets/gates/names.ts';
import type { NamesFile } from '../../../packages/shared/src/assets/gates/names.ts';
import type { RealNameMatcher } from '../../../packages/shared/src/assets/gates/names.ts';
import { loadConfigs } from '../../ci/lib/common.ts';
import { loadRealSide } from '../../ci/names-lint.ts';
import { readLock } from '../../assets/src/lock.ts';
import type { AssetLock } from '../../assets/src/lock.ts';
import { BASELINE_PATH, discoverSouls, loadGoals, loadPoiTable, loadRules, readJson, readJsonIfExists } from './common.ts';
import type { PoiTable } from './common.ts';
import { compileInk, missingKnots } from './ink.ts';
import { resolveTokenBounds } from './tokens.ts';
import type { TokenBounds } from './tokens.ts';

export interface LintIssue { rule: string; file: string; message: string }

export interface BaselineEntry { soulVersion: number; promptSha256: string; publicSha256: string }
/** souls/index.json: the active version per id, plus the hashes lint L14 compares against. */
export interface SoulsIndex {
  schema: 'souls-index/1';
  rosterVersion: number;
  rosterSha256: string;
  souls: Record<string, BaselineEntry>;
}

export type ParodyClassifier = (text: string) => Promise<{ ok: boolean; reasons: string[] }>;

export interface LintEnv {
  root: string;
  rules: RulesBlock;
  rosterIds: ReadonlySet<string>;
  /** Display side of L3: normalised soul names and config/names.json display names, with their owner id. */
  knownNames: ReadonlyMap<string, string>;
  pois: PoiTable;
  goals: ReadonlySet<string>;
  voices: VoiceCatalog;
  strings: StringMatcher;
  realNames: NamesFile | null;
  realMatchers: RealNameMatcher[];
  lock: AssetLock | null;
  baseline: SoulsIndex | null;
  caps: { blockBTokensMin: number; blockBTokensMax: number };
  tokens: (id: string, text: string, sha256: string) => Promise<TokenBounds>;
  /** Null when ANTHROPIC_API_KEY is unset: L7 then fails closed for parody souls. */
  classifier: ParodyClassifier | null;
  /** `npc:build --release`: an active soul with assetsPending fails L10. */
  release: boolean;
  /** Repo-relative file reader for ink sources; null when absent. */
  readText: (rel: string) => string | null;
}

export interface LintResult {
  issues: LintIssue[];
  /** Present when the file parsed, passed the schema and compiled. */
  front?: SoulFrontmatter;
  compiled?: CompiledOutputs;
  tokens?: TokenBounds;
}

const VOICE_ORDER = ['text', 't1', 't2', 't3'] as const;

export function moveIds(front: SoulFrontmatter): string[] {
  if (!front.fighter) return [];
  return [...front.fighter.specials, front.fighter.super, front.fighter.finisher].map((m) => m.id);
}

function realStrings(names: NamesFile | null): string[] {
  if (!names) return [];
  return names.entries
    .flatMap((e) => [e.real, ...(e.aliases ?? [])])
    .filter((s): s is string => typeof s === 'string' && normalizeName(s).length >= 3);
}

function checkSchedule(front: SoulFrontmatter, add: (rule: string, m: string) => void): void {
  front.schedule.forEach((b, i) => {
    const from = parseClock(b.from);
    const to = parseClock(b.to);
    if (from < 0 || to < 0 || from >= MINUTES_PER_DAY || from === to) add('L1', `schedule block ${i} has an invalid time range ${b.from}-${b.to}`);
  });
  const days = dayIntervals(front.schedule);
  days.forEach((list, d) => {
    let cursor = 0;
    for (const iv of list) {
      if (iv.from < cursor) add('L1', `${WEEKDAYS[d]}: blocks overlap before ${formatClock(cursor)} (block ${iv.index})`);
      else if (iv.from > cursor) add('L1', `${WEEKDAYS[d]}: nothing scheduled from ${formatClock(cursor)} to ${formatClock(iv.from)}`);
      cursor = Math.max(cursor, iv.to);
    }
    if (cursor < MINUTES_PER_DAY) add('L1', `${WEEKDAYS[d]}: nothing scheduled from ${formatClock(cursor)} to 24:00`);
  });
}

export async function lintSoul(file: string, md: string, env: LintEnv): Promise<LintResult> {
  const issues: LintIssue[] = [];
  const add = (rule: string, message: string): void => {
    issues.push({ rule, file, message });
  };

  let parsed;
  try {
    parsed = parseSoul(md);
  } catch (e) {
    add('schema', e instanceof SoulParseError ? e.message : String(e));
    return { issues };
  }
  const schemaIssues = validateSoul(parsed.front);
  if (schemaIssues.length) {
    for (const i of schemaIssues) add('schema', `${formatIssue(i)} [${i.schemaPath}]`);
    return { issues };
  }
  const front = parsed.front;
  const missing = requiredSections(front).filter((s) => !parsed.sections[s] || parsed.sections[s]?.trim() === '');
  if (missing.length) {
    for (const s of missing) add('schema', `section "## ${s}" is missing or empty`);
    return { issues };
  }

  // L1
  checkSchedule(front, add);

  // L2
  for (const r of front.relations) if (!env.rosterIds.has(r.npc)) add('L2', `relations: ${r.npc} is not in the roster`);
  if (front.standIn !== null) {
    const id = front.standIn.slice('character/'.length);
    if (!env.rosterIds.has(id)) add('L2', `standIn ${front.standIn} is not in the roster`);
  }
  const places = [front.locations.home, ...front.locations.hangouts, ...front.schedule.map((b) => b.place)];
  for (const p of [...new Set(places)]) if (!env.pois.pois.has(p)) add('L2', `place ${p} is not in ${env.pois.source}`);
  if (env.pois.districts) for (const d of front.locations.districts) if (!env.pois.districts?.has(d)) add('L2', `district ${d} is not in ${env.pois.source}`);

  // L3
  const owner = env.knownNames.get(normalizeName(front.name));
  if (owner && owner !== front.id) add('L3', `name "${front.name}" collides with ${owner}`);
  const reals = realStrings(env.realNames);
  const dists = reals.map((s) => normalisedDistance(front.name, s));
  const minDist = dists.length ? Math.min(...dists) : 1;
  if (front.tier === 'parody') {
    if (reals.length && minDist < NAME_DISTANCE_THRESHOLD) add('L3', `name is ${minDist.toFixed(2)} from a real-side name (limit ${NAME_DISTANCE_THRESHOLD})`);
    if (reals.length && (minDist >= NAME_DISTANCE_THRESHOLD) !== front.likeness.nameDistanceOk) add('L3', 'likeness.nameDistanceOk does not match the computed distance');
    if (!front.likeness.nameDistanceOk) add('L3', 'parody needs likeness.nameDistanceOk: true');
  } else if (reals.length && minDist === 0) add('L3', 'name equals a real-side name');
  if (env.realMatchers.length) {
    for (const f of scanRealNames(file, front.name, env.realMatchers)) add('L3', f.detail);
  }

  // L4 and L14 need the compiled prompt
  let compiled: CompiledOutputs | undefined;
  try {
    compiled = compileSoul(md, env.rules);
  } catch (e) {
    add('schema', e instanceof SoulCompileError ? e.message : String(e));
    return { issues };
  }
  const again = compileSoul(md, env.rules);
  const sha = promptHash(compiled.promptTxt);
  const pubSha = publicSoulHash(compiled.publicSoul);
  const tokens = await env.tokens(front.id, compiled.promptTxt, sha);
  if (tokens.exact !== null) {
    if (tokens.exact > env.caps.blockBTokensMax) add('L4', `block B is ${tokens.exact} tokens (limit ${env.caps.blockBTokensMax})`);
    if (tokens.exact < env.caps.blockBTokensMin) add('L4', `block B is ${tokens.exact} tokens (minimum ${env.caps.blockBTokensMin})`);
  } else {
    if (tokens.upper > env.caps.blockBTokensMax) add('L4', `block B may be ${tokens.upper} tokens by the byte bound (limit ${env.caps.blockBTokensMax})`);
    if (tokens.lower < env.caps.blockBTokensMin) add('L4', `block B may be only ${tokens.lower} tokens by the byte bound (minimum ${env.caps.blockBTokensMin})`);
  }

  // L5
  const ex = parseExampleLines(parsed.sections['Example lines'] ?? '');
  for (const b of ex.bad) add('L5', `example line is not "[tag] text": ${b.slice(0, 40)}`);
  if (ex.lines.length < 8) add('L5', `Example lines has ${ex.lines.length} lines (minimum 8)`);
  const need = ['greeting', 'mission', 'deflect', 'threat', 'farewell'];
  if (front.roles.fighter) need.push('fight');
  if (front.roles.tycoonActor) need.push('tycoon');
  for (const t of need) if (!ex.lines.some((l) => l.tag === t)) add('L5', `Example lines has no [${t}] line`);
  for (const l of ex.lines) {
    const words = l.text.split(/\s+/).filter(Boolean).length;
    if (words > front.speech.maxWordsPerLine) add('L5', `[${l.tag}] line has ${words} words (maxWordsPerLine ${front.speech.maxWordsPerLine})`);
  }

  // L6
  for (const c of findContactInfo(md)) add('L6', `${c.kind} in the file: ${c.match.slice(0, 40)}`);

  // L7
  if (front.tier === 'parody') {
    if (!env.classifier) add('L7', 'L7: classifier unavailable');
    else {
      try {
        const r = await env.classifier(Object.values(parsed.sections).join('\n\n'));
        if (!r.ok) add('L7', `claim classifier rejected the prose: ${r.reasons.join('; ') || 'no reason given'}`);
      } catch (e) {
        add('L7', `L7: classifier unavailable (${(e as Error).message})`);
      }
    }
  }

  // L8 (inside one soul; across souls in lintFiles)
  const seen = new Set<string>();
  for (const id of moveIds(front)) {
    if (seen.has(id)) add('L8', `move id ${id} is used twice`);
    seen.add(id);
  }

  // L9
  const v = front.voice;
  if (v.voiceRef === null) {
    if (v.tier !== 'text') add('L9', `voice.tier ${v.tier} needs a voiceRef`);
  } else {
    const entry = env.voices.entries.find((e) => e.voiceRef === v.voiceRef);
    if (!entry) add('L9', `${v.voiceRef} is not in config/voice-catalog.json`);
    else {
      if (!entry.allowedTiers.includes(front.tier)) add('L9', `${v.voiceRef} does not allow likeness tier ${front.tier}`);
      if (VOICE_ORDER.indexOf(entry.tier) < VOICE_ORDER.indexOf(v.tier)) add('L9', `${v.voiceRef} is tier ${entry.tier}, below voice.tier ${v.tier}`);
    }
  }

  // L10
  if (front.status === 'active') {
    if (front.assetsPending) {
      if (env.release) add('L10', `assetsPending is set on active soul ${front.id}; --release refuses it`);
    } else {
      const a = deriveAssets(front);
      const refs = [a.model, a.rig, ...a.anim, a.portrait, a.mouthAtlas, a.voice, a.ink, a.barks].filter((r): r is NonNullable<typeof r> => r !== null);
      for (const r of refs) if (!env.lock?.entries[r]) add('L10', `${r} is not in assets/assets.lock.json`);
    }
  }

  // L11
  const scopes = front.likeness.consentScopes;
  const derivedFace = front.tier === 'consented' && (scopes.includes('likeness_stylized') || scopes.includes('likeness_realistic'));
  if (front.likeness.faceReferenceAllowed !== derivedFace) add('L11', `faceReferenceAllowed is ${front.likeness.faceReferenceAllowed}, derived value is ${derivedFace}`);
  if (front.likeness.basis === 'real_person') {
    if (front.likeness.deceased && front.tier === 'parody') add('L11', 'a deceased real person is never parody');
    if (front.likeness.fameDomain.length === 0) add('L11', 'fameDomain is required for a real-derived soul');
  }

  // L12
  const promptStrings = [front.voice.design_prompt, front.visual_brief, ...front.speech.catchphrases];
  for (const s of promptStrings) {
    for (const h of scanText(s, env.strings, 3)) add('L12', `denylisted text (${h.rule}): ${h.match}`);
    if (/\bin the style of\b/i.test(s)) add('L12', `"in the style of": ${s.slice(0, 40)}`);
    if (/\bsounds? like\b/i.test(s)) add('L12', `"sounds like": ${s.slice(0, 40)}`);
    if (env.realMatchers.length) for (const f of scanRealNames(file, s, env.realMatchers)) add('L12', f.detail);
  }

  // L13
  for (const g of front.goals) if (!env.goals.has(g)) add('L13', `goal ${g} is not in config/npc-goals.json`);
  const ink = env.readText(front.dialogue.ink);
  if (ink === null) add('L13', `${front.dialogue.ink} does not exist`);
  else {
    const r = compileInk(ink);
    for (const e of r.errors) add('L13', `ink: ${e}`);
    if (!r.errors.length) for (const k of missingKnots(r.knots)) add('L13', `ink does not define the knot ${k}`);
  }

  // L14
  if (again.promptTxt !== compiled.promptTxt || promptHash(again.promptTxt) !== sha) add('L14', 'compiling twice gave different prompt bytes');
  const verProblem = soulVersionProblem(env.baseline?.souls[front.id], { soulVersion: front.soulVersion, promptSha256: sha, publicSha256: pubSha });
  if (verProblem) add('L14', verProblem);

  return { issues, front, compiled, tokens };
}

export async function lintFiles(root: string, files: readonly string[], env: LintEnv): Promise<{ issues: LintIssue[]; results: Map<string, LintResult> }> {
  const issues: LintIssue[] = [];
  const results = new Map<string, LintResult>();
  const moves = new Map<string, string>();
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    const shown = path.relative(root, abs).split(path.sep).join('/');
    const r = await lintSoul(shown, readFileSync(abs, 'utf8'), env);
    results.set(shown, r);
    issues.push(...r.issues);
    if (r.front) {
      for (const id of moveIds(r.front)) {
        const other = moves.get(id);
        if (other && other !== r.front.id) issues.push({ rule: 'L8', file: shown, message: `move id ${id} is also used by ${other}` });
        else moves.set(id, r.front.id);
      }
    }
  }
  return { issues, results };
}

// ---------------------------------------------------------------------------------------------

const CLASSIFIER_SYSTEM =
  'You review the prose of a fictional character sheet for a satirical video game. The character is a parody of a real person. ' +
  'Reply with one JSON object {"ok": boolean, "reasons": string[]}. ok is false if the prose states or implies anything about a real ' +
  "person's private life, health, legal matters, relationships or finances, or presents anything about a real person as fact.";

/** Haiku claim classifier for L7. Live use is UNVERIFIED in this repository (no key in CI); every failure is a failed check. */
export function liveParodyClassifier(apiKey: string, fetchImpl: typeof fetch = fetch): ParodyClassifier {
  return async (text) => {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-5-5',
        max_tokens: 400,
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        system: CLASSIFIER_SYSTEM,
        messages: [{ role: 'user', content: text }],
      }),
    });
    if (!res.ok) throw new Error(`messages answered HTTP ${res.status}`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const out = body.content?.find((c) => c.type === 'text')?.text ?? '';
    const m = /\{[\s\S]*\}/.exec(out);
    if (!m) throw new Error('classifier returned no JSON');
    const j = JSON.parse(m[0]) as { ok?: unknown; reasons?: unknown };
    if (typeof j.ok !== 'boolean') throw new Error('classifier JSON has no boolean ok');
    return { ok: j.ok, reasons: Array.isArray(j.reasons) ? j.reasons.map(String) : [] };
  };
}

export interface EnvOptions {
  root: string;
  env?: NodeJS.ProcessEnv;
  release?: boolean;
  /** Override the L14 baseline file (repo-relative or absolute). */
  baseline?: string | undefined;
  /** Extra roster ids, for lint runs on files outside content/npcs (fixtures). */
  extraRosterIds?: string[];
  noTokenWrite?: boolean;
  classifier?: ParodyClassifier | null;
  log?: (line: string) => void;
}

export function rosterIdsOf(root: string): Set<string> {
  const ids = new Set<string>();
  for (const p of ['content/npcs/roster.json', 'content-private/npcs/roster.json']) {
    const r = readJsonIfExists<{ entries?: { id: string }[] }>(root, p);
    for (const e of r?.entries ?? []) ids.add(e.id);
  }
  for (const f of discoverSouls(root)) ids.add(f.split('/')[2] as string);
  return ids;
}

/** Display names of the shipped souls and of config/names.json (the display side of L3). */
export function knownNamesOf(root: string, names: NamesFile): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of discoverSouls(root)) {
    try {
      const front = parseSoul(readFileSync(path.join(root, f), 'utf8')).front;
      if (typeof front.name === 'string' && typeof front.id === 'string') m.set(normalizeName(front.name), front.id);
    } catch {
      /* reported when that file is linted */
    }
  }
  for (const e of names.entries) if (e.display) m.set(normalizeName(e.display), `names:${e.id}`);
  return m;
}

export function buildLintEnv(o: EnvOptions): LintEnv {
  const root = o.root;
  const penv = o.env ?? process.env;
  const cfg = loadConfigs(root);
  const voices = readJson<VoiceCatalog>(root, 'config/voice-catalog.json');
  const voiceProblems = validateVoiceCatalog(voices);
  if (voiceProblems.length) throw new Error(`config/voice-catalog.json: ${voiceProblems.map(formatIssue).join('; ')}`);
  const npc = readJson<{ caps: { blockBTokensMin: number; blockBTokensMax: number } }>(root, 'config/npc.json');
  let realNames: NamesFile | null = null;
  try {
    realNames = loadRealSide(penv.DV_NAMES_REAL_JSON);
  } catch (e) {
    throw new Error(`DV_NAMES_REAL_JSON: ${(e as Error).message}`);
  }
  const baselinePath = o.baseline ?? BASELINE_PATH;
  const baselineAbs = path.isAbsolute(baselinePath) ? baselinePath : path.join(root, baselinePath);
  const key = penv.ANTHROPIC_API_KEY;
  const classifier = o.classifier !== undefined ? o.classifier : key ? liveParodyClassifier(key) : null;
  return {
    root,
    rules: loadRules(root),
    rosterIds: new Set([...rosterIdsOf(root), ...(o.extraRosterIds ?? [])]),
    knownNames: knownNamesOf(root, cfg.names),
    pois: loadPoiTable(root),
    goals: loadGoals(root),
    voices,
    strings: compileStringMatcher(cfg.denylist),
    realNames,
    realMatchers: realNames ? compileRealNames(realNames.entries.filter((e) => e.real || (e.aliases?.length ?? 0) > 0)) : [],
    lock: readLock(root),
    baseline: existsSync(baselineAbs) ? (JSON.parse(readFileSync(baselineAbs, 'utf8')) as SoulsIndex) : null,
    caps: npc.caps,
    tokens: (id, text, sha256) =>
      resolveTokenBounds({ root, id, text, sha256, env: penv, noWrite: o.noTokenWrite ?? false, ...(o.log ? { log: o.log } : {}) }),
    classifier,
    release: o.release ?? false,
    readText: (rel) => {
      const p = path.join(root, rel);
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    },
  };
}
