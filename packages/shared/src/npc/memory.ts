// Pure rules of the NPC memory and roster stores (M06a1), shared by InMemoryDataPort and the Worker so both ports agree.
// The Postgres side of memory scoring is match_npc_memories() in supabase/migrations/0003_npc.sql; this is the same formula.
import { canonicalize } from '../json.ts';
import { sha256Hex } from '../hash.ts';
import { dexp, dsqrt } from '../detmath.ts';
import type { KillScope, RosterFlags } from '../api/v1.ts';
import type { AssetRef } from '../assets/c07.ts';
import type { MemoryKind, SummaryPatch } from '../contracts/c10-npc.ts';
import { scrubPii } from './pii.ts';

/** Recency decay scale in C06 game half-seconds: 72 game hours (C12 1.1 section 3, DL-058). Not 72*3600. */
export const MEMORY_RECENCY_SCALE = 518_400;
export const MEMORY_WEIGHTS = { relevance: 0.5, importance: 0.3, recency: 0.2 } as const;
export const MEMORY_DIM = 1024;
export const MEMORY_TTL_MS = 180 * 86_400_000;
export const RELATIONSHIP_SUMMARY_MAX = 1200;

/** Cosine similarity of two equal-length vectors; 0 when either has no length. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (dsqrt(na) * dsqrt(nb));
}

/** 0.5 relevance + 0.3 importance + 0.2 recency, as match_npc_memories() computes it. */
export function scoreMemory(m: { cosine: number; importance: number; gameTime: number }, nowGameTime: number): number {
  const age = Math.max(nowGameTime - m.gameTime, 0);
  return MEMORY_WEIGHTS.relevance * m.cosine + MEMORY_WEIGHTS.importance * (m.importance / 10) + MEMORY_WEIGHTS.recency * dexp(-age / MEMORY_RECENCY_SCALE);
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export interface RelationshipFields {
  affinity: number;
  trust: number;
  flags: Record<string, unknown>;
  encounters: number;
  summary: string;
  soul_version: number;
}

/**
 * A summary patch as the summarize consumer hands it to the ports. `replaceSummary` is a Worker-side extension of C10 `SummaryPatch`
 * (BD-M06a4-04): when set, `summaryUpdate` replaces the stored summary instead of being appended, which is how a summary that outgrew
 * 1,200 characters is re-summarized. Both ports honour it; the contract type is unchanged.
 */
export type SummaryPatchX = SummaryPatch & { replaceSummary?: boolean };

/**
 * The relationship after an encounter summary (C10 SummaryPatch): deltas are added and clamped to -100..100, `flagsPatch` is merged over
 * the flags, `summaryUpdate` is appended (or replaces the summary with `replaceSummary`) and the result keeps its newest 1,200 characters,
 * and the encounter count goes up by one. The per-encounter clamp of +-10 is `clampPatch`, applied before the port is called.
 * The patch's memories carry no embeddings, so they are written by the caller through `npcMemory.write`.
 */
export function mergeSummary(current: RelationshipFields | null, s: SummaryPatchX): RelationshipFields {
  const base: RelationshipFields = current ?? { affinity: 0, trust: 0, flags: {}, encounters: 0, summary: '', soul_version: s.soulVersion };
  const joined = s.replaceSummary === true ? s.summaryUpdate : base.summary === '' ? s.summaryUpdate : s.summaryUpdate === '' ? base.summary : `${base.summary} ${s.summaryUpdate}`;
  return {
    affinity: clamp(Math.round(base.affinity + s.affinityDelta), -100, 100),
    trust: clamp(Math.round(base.trust + s.trustDelta), -100, 100),
    flags: { ...base.flags, ...s.flagsPatch },
    encounters: base.encounters + 1,
    summary: joined.length > RELATIONSHIP_SUMMARY_MAX ? joined.slice(joined.length - RELATIONSHIP_SUMMARY_MAX) : joined,
    soul_version: s.soulVersion,
  };
}

// ---- the rules of M06a4 (04-npc.md section 5.6) ----

/** A new memory whose cosine against the pair's stored memories reaches this only refreshes `last_accessed_at`. */
export const MEMORY_DUPLICATE_COSINE = 0.92;
/** A memory may quote at most this many consecutive words of the player's text. */
export const MEMORY_QUOTE_WORDS_MAX = 8;
/** The affinity and trust deltas of one encounter summary are clamped to +-10. */
export const SUMMARY_DELTA_MAX = 10;
/** Every Nth encounter of a pair adds one reflection memory. */
export const REFLECTION_EVERY = 10;
export const REFLECTION_IMPORTANCE = 8;
export const PROMISE_IMPORTANCE_MIN = 6;
export const SUMMARY_MEMORIES_MAX = 5;

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter((w) => w !== '');

/** True when `text` repeats more than `max` consecutive words of `player`. Case and punctuation do not matter. */
export function quotesPlayer(text: string, player: string, max: number = MEMORY_QUOTE_WORDS_MAX): boolean {
  const t = words(text);
  const p = words(player);
  if (t.length <= max || p.length <= max) return false;
  // longest common run of words between the two lists
  let best = 0;
  const prev = new Array<number>(p.length + 1).fill(0);
  for (let i = 1; i <= t.length; i++) {
    let diag = 0;
    for (let j = 1; j <= p.length; j++) {
      const up = prev[j] as number;
      const run = t[i - 1] === p[j - 1] ? diag + 1 : 0;
      prev[j] = run;
      if (run > best) best = run;
      diag = up;
    }
  }
  return best > max;
}

export interface RawMemoryWrite {
  kind: MemoryKind;
  text: string;
  importance: number;
}

/**
 * The memory writes a turn may store: at most 2, PII removed, none that quotes more than 8 consecutive words of the player's text, a
 * `promise` at importance 6 or more. An empty text after scrubbing is dropped.
 */
export function filterMemoryWrites(writes: readonly RawMemoryWrite[], playerText: string | undefined, max = 2): RawMemoryWrite[] {
  const out: RawMemoryWrite[] = [];
  for (const w of writes) {
    if (out.length >= max) break;
    const text = Array.from(scrubPii(w.text.replace(/\s+/g, ' ').trim()).text).slice(0, 240).join('').trim();
    if (text === '') continue;
    if (playerText !== undefined && quotesPlayer(text, playerText)) continue;
    const base = clamp(Math.trunc(Number.isFinite(w.importance) ? w.importance : 1), 1, 10);
    out.push({ kind: w.kind, text, importance: w.kind === 'promise' ? Math.max(base, PROMISE_IMPORTANCE_MIN) : base });
  }
  return out;
}

/** A patch with its deltas clamped to +-10 and at most 5 memories. The summary text is bounded by the caller. */
export function clampPatch(s: SummaryPatchX): SummaryPatchX {
  const d = (n: number): number => clamp(Math.round(Number.isFinite(n) ? n : 0), -SUMMARY_DELTA_MAX, SUMMARY_DELTA_MAX);
  return { ...s, affinityDelta: d(s.affinityDelta), trustDelta: d(s.trustDelta), memories: s.memories.slice(0, SUMMARY_MEMORIES_MAX) };
}

/** Whether the encounter that is being folded in (number `encountersBefore + 1`) is a reflection encounter. */
export const isReflectionEncounter = (encountersBefore: number): boolean => (encountersBefore + 1) % REFLECTION_EVERY === 0;

/** Actor id stored in roster_flag.set_by when the ops token (no profile) made the change. */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export const GENERIC_STAND_IN = 'character/generic_stand_in' as AssetRef;

/** The `RosterFlags` document of the killed rows. The etag changes whenever the killed set, a scope or a stand-in changes. */
export function buildRosterFlags(rows: readonly { npc_id: string; killed: boolean; scope: string[]; stand_in: string; set_at: number }[]): RosterFlags {
  const killed: RosterFlags['killed'] = {};
  let updatedAt = 0;
  for (const r of [...rows].sort((a, b) => (a.npc_id < b.npc_id ? -1 : a.npc_id > b.npc_id ? 1 : 0))) {
    if (r.set_at > updatedAt) updatedAt = r.set_at;
    if (!r.killed) continue;
    killed[r.npc_id] = { scope: [...r.scope].sort(byText) as KillScope[], standIn: r.stand_in as AssetRef };
  }
  return { etag: sha256Hex(canonicalize(killed)).slice(0, 16), killed, updatedAt };
}
