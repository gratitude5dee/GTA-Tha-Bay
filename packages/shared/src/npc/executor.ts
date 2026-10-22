/**
 * The executor of an NPC turn (04-npc.md section 5.4 item 5; DL-234: pure, so `services/*` can import it from @dv/shared and
 * `packages/npc` re-exports it). The model only proposes: this file decides what survives.
 *
 *  - `affinity_delta` is an integer clamped to -10..10.
 *  - at most 2 memory writes, each at most 240 characters, importance 1..10, contact data removed.
 *  - `action_arg` must be one of the scene's offers; an action the soul's roles do not allow becomes `none`.
 *  - `attack` and `call_police` need `temperament: volatile` or `archetype: police`, and the story mode.
 *  - `end_conversation` is honoured, and a caller can force it (a self-harm phrase in the prefilter).
 *  - the spoken line is cut to the word limit plus 5, at a sentence boundary when one fits.
 */
import type { Archetype, DialogueEvent, Emotion, Gesture, MemoryKind, NPCDialogueContext, NpcAction, SoulFrontmatter } from '../contracts/c10-npc.ts';
import { scrubPii } from './pii.ts';
import { splitSentences } from './sentences.ts';

/** The model's reply after the schema check (`npc-turn-1.0`). */
export interface NpcTurnOutput {
  line: string;
  emotion: Emotion;
  gesture: Gesture;
  action: NpcAction;
  action_arg: string | null;
  affinity_delta: number;
  memory_writes: { kind: Exclude<MemoryKind, 'reflection'>; text: string; importance: number }[];
  end_conversation: boolean;
}

export interface ExecutorSoul {
  roles: SoulFrontmatter['roles'];
  archetype: Archetype;
  temperament: SoulFrontmatter['personality']['temperament'];
  maxWordsPerLine: number;
}

export interface ExecutorScene {
  mode: NPCDialogueContext['mode'];
  offers: NPCDialogueContext['offers'];
  /** Forces `endConversation` (a self-harm phrase in the player's text, or the last turn of the encounter). */
  forceEnd?: boolean;
}

export type TurnEffects = Extract<DialogueEvent, { event: 'effects' }>['data'];

export interface ValidatedTurn {
  /** The line as it is shown, cut to the word limit. */
  line: string;
  words: number;
  /** True when the line was cut. */
  truncated: boolean;
  effects: TurnEffects;
  memoryWrites: { kind: Exclude<MemoryKind, 'reflection'>; text: string; importance: number }[];
}

export const AFFINITY_MAX = 10;
export const MEMORY_WRITES_MAX = 2;
export const MEMORY_TEXT_MAX = 240;
/** The word limit is soft: a line may run this many words over before it is cut. */
export const WORD_SLACK = 5;

const ENUM_KEYS = ['emotion', 'gesture', 'action'] as const;

/**
 * The model may change the case of an enum value (research/ai-npc-runtime.md section 2.4: "compare case-insensitively"). Returns a copy
 * with `emotion`, `gesture`, `action` and the memory kinds lower-cased; anything that is not an object is returned unchanged.
 */
export function normalizeTurnJson(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const o: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const k of ENUM_KEYS) if (typeof o[k] === 'string') o[k] = (o[k] as string).trim().toLowerCase();
  if (Array.isArray(o['memory_writes'])) {
    o['memory_writes'] = (o['memory_writes'] as unknown[]).map((m) =>
      typeof m === 'object' && m !== null && typeof (m as { kind?: unknown }).kind === 'string' ? { ...(m as object), kind: (m as { kind: string }).kind.trim().toLowerCase() } : m,
    );
  }
  return o;
}

export const wordCount = (text: string): number => (text.trim() === '' ? 0 : text.trim().split(/\s+/).length);

/** Cuts a line to `max + WORD_SLACK` words: whole sentences while they fit, else the first `max` words. */
export function limitWords(line: string, max: number): { text: string; truncated: boolean } {
  const text = line.replace(/\s+/g, ' ').trim();
  const cap = max + WORD_SLACK;
  if (wordCount(text) <= cap) return { text, truncated: false };
  let kept = '';
  for (const sentence of splitSentences(text)) {
    const next = kept === '' ? sentence : `${kept} ${sentence}`;
    if (wordCount(next) > cap) break;
    kept = next;
  }
  if (kept !== '') return { text: kept, truncated: true };
  return { text: `${text.split(' ').slice(0, max).join(' ')}…`, truncated: true };
}

/** `action` after the role, mode and offer rules. `none` when the proposal is refused. */
function checkedAction(kind: NpcAction, arg: string | null, soul: ExecutorSoul, scene: ExecutorScene): { kind: NpcAction; arg: string | null } {
  const none = { kind: 'none' as const, arg: null };
  const offers = scene.offers;
  switch (kind) {
    case 'none':
      return none;
    case 'offer_mission':
      return soul.roles.questGiver && arg !== null && offers.missionIds.includes(arg) ? { kind, arg } : none;
    case 'offer_race':
      return soul.roles.racer && arg !== null && offers.raceIds.includes(arg) ? { kind, arg } : none;
    case 'offer_deal':
      return soul.roles.tycoonActor && arg !== null && offers.dealIds.includes(arg) ? { kind, arg } : none;
    case 'offer_fight':
      return soul.roles.fighter ? { kind, arg: null } : none;
    case 'sell':
      return soul.roles.vendor ? { kind, arg: null } : none;
    case 'give_item':
      return soul.roles.vendor || soul.roles.questGiver ? { kind, arg: null } : none;
    case 'attack':
    case 'call_police':
      return scene.mode === 'story' && (soul.temperament === 'volatile' || soul.archetype === 'police') ? { kind, arg: null } : none;
    case 'refuse':
    case 'flee':
    case 'follow':
    case 'leave':
      return { kind, arg: null };
    default:
      return none;
  }
}

const clampInt = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.trunc(Number.isFinite(n) ? n : 0)));

/** Validates one schema-valid turn against the soul and the scene. */
export function validateTurn(out: NpcTurnOutput, soul: ExecutorSoul, scene: ExecutorScene): ValidatedTurn {
  const cut = limitWords(out.line, soul.maxWordsPerLine);
  const action = checkedAction(out.action, out.action_arg, soul, scene);
  const affinity = clampInt(out.affinity_delta, -AFFINITY_MAX, AFFINITY_MAX);
  const memoryWrites: ValidatedTurn['memoryWrites'] = [];
  for (const m of out.memory_writes) {
    if (memoryWrites.length >= MEMORY_WRITES_MAX) break;
    const scrubbed = scrubPii(m.text.replace(/\s+/g, ' ').trim()).text;
    const text = Array.from(scrubbed).slice(0, MEMORY_TEXT_MAX).join('').trim();
    if (text === '') continue;
    memoryWrites.push({ kind: m.kind, text, importance: clampInt(m.importance, 1, 10) });
  }
  const effects: TurnEffects = {};
  if (action.kind !== 'none') effects.action = { kind: action.kind, arg: action.arg };
  effects.mood = out.emotion;
  if (out.gesture !== 'none') effects.gesture = out.gesture;
  if (memoryWrites.length > 0) effects.memoryWrite = { count: memoryWrites.length };
  if (affinity !== 0) effects.affinityDelta = affinity;
  if (out.end_conversation || scene.forceEnd === true) effects.endConversation = true;
  return { line: cut.text, words: wordCount(cut.text), truncated: cut.truncated, effects, memoryWrites };
}
