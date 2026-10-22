/**
 * Prompt hygiene lint (spec/domains/03-story-cutscenes.md section D4, DL-550): one pure rule set that three callers share, the CLI
 * `tools/ci/prompt-lint.ts` (missions:build, check:assets, the cutscene index builder) and the pipeline gate
 * (`services/pipeline/src/gate.ts`, on the filled prompt before any fal call). Everything the rules need is passed in by the
 * caller in `ctx`: no IO, no clock (C02 scope).
 *
 * Rules (the numbers are stable; the gate maps them to GateCodes and puts the number in `detail`):
 *   1  a NameRegistry name or alias, a config/ip-denylist.json term, "in the style of"
 *   2  firearm, gore, killing, drug or sexual vocabulary from config/prompt-banned.json
 *   3  realism tokens when the cast holds a character whose tier is not `consented`
 *   4  a slot filled from outside the closed sources, a protagonist or user-NPC reference, or more than 1,200 characters
 *   5  the "no text, no logos" clause is missing
 *   6  (templates) the template's `keyframePin` differs from the registry pin
 */
import { compileRealNames } from '../assets/gates/names.ts';
import { compileStringMatcher, scanText, type IpDenylistConfig } from '../assets/gates/ip.ts';
import type { LikenessTier } from '../assets/c07.ts';

export type PromptLintRule = 1 | 2 | 3 | 4 | 5 | 6;

export const PROMPT_MAX_CHARS = 1200;

/** Where a slot may be filled from (the closed table of section D4). */
export type PromptSlotSource = 'style-bible' | 'soul-visual-brief' | 'places' | 'enum' | 'move-def' | 'ref-slots';

/** Slot name with its numeric suffix removed (`subject_brief_2` is `subject_brief`) to the only source that may fill it. */
export const CLOSED_SLOT_SOURCES: Readonly<Record<string, PromptSlotSource>> = {
  style_tokens: 'style-bible',
  subject_brief: 'soul-visual-brief',
  place_desc: 'places',
  time_of_day: 'enum',
  weather: 'enum',
  move_desc: 'move-def',
  action: 'ref-slots',
  camera: 'ref-slots',
  mood: 'ref-slots',
};

/** `subject_brief_2` to `subject_brief`. */
export const slotBase = (slot: string): string => slot.replace(/_\d+$/, '');

/** The slot placeholders of a template body, in order of first use. */
export function templateSlots(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/\{([a-z][a-z0-9_]*)\}/g)) {
    const name = m[1] as string;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

export interface PromptBanned {
  /** Case-insensitive terms matched on word boundaries (rule 2). */
  words: readonly string[];
  /** Realism tokens (rule 3): "photoreal", camera brands, film stocks. */
  realism: readonly string[];
}

export interface PromptCastMember {
  id: string;
  tier: LikenessTier;
  /** The protagonist or a user NPC: never in a generated clip (section D1). */
  protected?: boolean;
}

export interface PromptLintCtx {
  /** NameRegistry strings: display names, real names and aliases. Real-side strings are the caller's secret; never logged here. */
  names: readonly string[];
  /** config/ip-denylist.json. */
  denylist: Pick<IpDenylistConfig, 'terms' | 'words' | 'patterns' | 'exceptions'>;
  /** config/prompt-banned.json. */
  banned: PromptBanned;
  cast: readonly PromptCastMember[];
  /** Where each filled slot came from. Omitted: the slot rule is not checked (a bare prompt). */
  slots?: readonly { slot: string; source: string }[];
  /** Template check: the template's `keyframePin` and the registry's pin. */
  keyframePin?: { template: string; registry: string };
}

export interface PromptLintFailure {
  rule: PromptLintRule;
  detail: string;
}

export interface PromptLintResult {
  ok: boolean;
  /** Each failing rule number once, ascending. */
  rules: PromptLintRule[];
  failures: PromptLintFailure[];
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive, with a trailing-letter tolerance for plurals and verb forms of a stem written with `*`. */
function wordRegex(list: readonly string[]): RegExp | null {
  const alts = list
    .map((w) => w.trim())
    .filter((w) => w !== '')
    .map((w) => (w.endsWith('*') ? `${escapeRe(w.slice(0, -1))}[a-z]*` : escapeRe(w)));
  return alts.length === 0 ? null : new RegExp(`(?<![a-z0-9])(?:${alts.join('|')})(?![a-z0-9])`, 'gi');
}

const STYLE_OF = /\bin the (?:style|manner) of\b/i;
const NO_TEXT_CLAUSE = /\bno text\b[^.]*\bno logos?\b/i;

/** Lints one prompt (a template body or a filled prompt). Never throws. */
export function lintPrompt(prompt: string, ctx: PromptLintCtx): PromptLintResult {
  const failures: PromptLintFailure[] = [];
  const fail = (rule: PromptLintRule, detail: string): void => {
    failures.push({ rule, detail });
  };

  // 1. names, denylist, "in the style of". The detail never repeats the matched name.
  const nameMatchers = compileRealNames(ctx.names.map((s, i) => ({ id: `n${i}`, real: s })));
  if (nameMatchers.some((m) => m.re.test(prompt))) fail(1, 'a registry name or alias');
  const hits = scanText(prompt, compileStringMatcher({ ...ctx.denylist, exceptions: [...ctx.denylist.exceptions] }), 1);
  if (hits.length > 0) fail(1, `a denylisted ${hits[0]?.rule ?? 'term'}`);
  if (STYLE_OF.test(prompt)) fail(1, '"in the style of"');

  // 2. banned vocabulary
  const banned = wordRegex(ctx.banned.words);
  if (banned) {
    banned.lastIndex = 0;
    const m = banned.exec(prompt);
    if (m) fail(2, `banned vocabulary: ${m[0].toLowerCase()}`);
  }

  // 3. realism tokens with a non-consented cast
  if (ctx.cast.some((c) => c.tier !== 'consented')) {
    const realism = wordRegex(ctx.banned.realism);
    if (realism) {
      realism.lastIndex = 0;
      const m = realism.exec(prompt);
      if (m) fail(3, `realism token: ${m[0].toLowerCase()}`);
    }
  }

  // 4. closed slot sources, protected cast, length cap
  for (const s of ctx.slots ?? []) {
    const want = CLOSED_SLOT_SOURCES[slotBase(s.slot)];
    if (want === undefined) fail(4, `unknown slot ${s.slot}`);
    else if (want !== s.source) fail(4, `slot ${s.slot} is filled from ${s.source}, not ${want}`);
  }
  for (const c of ctx.cast) {
    if (c.protected === true) fail(4, `${c.id} is the protagonist or a user NPC`);
  }
  if ([...prompt].length > PROMPT_MAX_CHARS) fail(4, `${[...prompt].length} characters (limit ${PROMPT_MAX_CHARS})`);

  // 5. "no text, no logos"
  if (!NO_TEXT_CLAUSE.test(prompt)) fail(5, 'the "no text, no logos" clause is missing');

  // 6. template keyframe pin
  if (ctx.keyframePin && ctx.keyframePin.template !== ctx.keyframePin.registry) {
    fail(6, `keyframePin ${ctx.keyframePin.template} differs from the registry pin ${ctx.keyframePin.registry}`);
  }

  const rules = [...new Set(failures.map((f) => f.rule))].sort((a, b) => a - b);
  return { ok: failures.length === 0, rules, failures };
}
