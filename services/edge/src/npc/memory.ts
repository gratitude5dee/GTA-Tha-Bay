import type { MemoryHit, MemoryKind, NPCDialogueContext } from '@dv/shared/contracts/c10-npc';
import { cosine, filterMemoryWrites, MEMORY_DUPLICATE_COSINE, type RawMemoryWrite } from '@dv/shared/npc/memory';
import type { ServerDataPort } from '@dv/shared/data-port';
import type { Env } from '../env.ts';
import { embedText, embedTexts } from './ai.ts';

/**
 * MemoryService (04-npc.md section 5.6, M06a4). Two paths, both best effort:
 *
 *  - `retrieve` (step 4 of the turn): embed the player's text, or the intent label plus the mission id; ask the port for the top six memories
 *    of the pair and its relationship summary. Any failure (no port, no AI binding, an error, a timeout) gives an empty memory: the turn goes on.
 *  - `write` (after the turn, in `ctx.waitUntil`): scrub, drop quotes of the player, embed, skip near-duplicates (cosine 0.92 or more against
 *    the pair's rows or an earlier write of the same turn: only `last_accessed_at` is refreshed), store with the clock time of the turn.
 *
 * Nothing is stored or retrieved without a verified `18p` play token: the callers pass the claim and `age !== '18p'` is refused here too.
 * No memory text is logged.
 */
export interface MemoryScope {
  profileId: string;
  npcId: string;
  /** The `age` claim of the play token. Anything but `18p` stores and reads nothing. */
  age: string;
}

export interface RetrieveInput extends MemoryScope {
  context: Pick<NPCDialogueContext, 'clockT' | 'missionId'>;
  /** The player's text after the prefilter, or '' when the turn is an intent. */
  text: string;
  intent: string | undefined;
}

export interface MemoryView {
  summary: string;
  hits: MemoryHit[];
}

export const EMPTY_MEMORY: MemoryView = { summary: '', hits: [] };
/** The relationship summary that goes into `<memory>`: 150 tokens at about four characters each. */
export const SUMMARY_PROMPT_CHARS = 600;

/** The text that is embedded to find memories: the player's words, else the intent label plus the mission id. */
export function queryText(text: string, intent: string | undefined, missionId: string | null): string {
  const t = text.trim();
  if (t !== '') return t;
  return `${intent ?? 'smalltalk'} ${missionId ?? ''}`.trim();
}

export async function retrieve(env: Pick<Env, 'AI'>, port: ServerDataPort | null, input: RetrieveInput): Promise<MemoryView> {
  if (port === null || input.age !== '18p') return EMPTY_MEMORY;
  try {
    const [rel, q] = await Promise.all([
      port.npcMemory.relationship(input.profileId, input.npcId),
      embedText(env, queryText(input.text, input.intent, input.context.missionId)),
    ]);
    const summary = rel === null ? '' : rel.summary.slice(-SUMMARY_PROMPT_CHARS);
    if (q === null) return { summary, hits: [] };
    const hits = await port.npcMemory.topK(input.profileId, input.npcId, q, input.context.clockT, 6);
    return { summary, hits: hits.slice(0, 6) };
  } catch {
    return EMPTY_MEMORY;
  }
}

export interface WriteInput extends MemoryScope {
  writes: readonly RawMemoryWrite[];
  /** The player's text of the turn (sanitized), for the quote rule. */
  playerText: string | undefined;
  /** C06 half-seconds from the turn's context. */
  clockT: number;
  /** `dialogue` for a turn's own writes (default), `summary` for the memories of an encounter summary. */
  source?: 'dialogue' | 'summary';
  /** At most this many writes are kept (2 per turn, the default; 6 for a summary). */
  max?: number;
}

export interface WriteResult {
  written: number;
  refreshed: number;
  dropped: number;
}

/** Stores what a turn learned. Never throws; returns what it did (counts only). */
export async function write(env: Pick<Env, 'AI'>, port: ServerDataPort | null, input: WriteInput): Promise<WriteResult> {
  const none: WriteResult = { written: 0, refreshed: 0, dropped: input.writes.length };
  if (port === null || input.age !== '18p' || input.writes.length === 0) return none;
  try {
    const kept = filterMemoryWrites(input.writes, input.playerText, input.max ?? 2);
    if (kept.length === 0) return none;
    const vectors = await embedTexts(env, kept.map((k) => k.text));
    if (vectors === null) return none;
    const fresh: { w: RawMemoryWrite; v: Float32Array }[] = [];
    const touch: number[] = [];
    let refreshed = 0;
    for (let i = 0; i < kept.length; i++) {
      const w = kept[i] as RawMemoryWrite;
      const v = vectors[i] as Float32Array;
      if (fresh.some((f) => cosine(f.v, v) >= MEMORY_DUPLICATE_COSINE)) {
        refreshed++;
        continue;
      }
      const near = await port.maintenance.nearestMemory(input.profileId, input.npcId, v);
      if (near !== null && near.cosine >= MEMORY_DUPLICATE_COSINE) {
        touch.push(near.id);
        refreshed++;
        continue;
      }
      fresh.push({ w, v });
    }
    if (touch.length > 0) await port.maintenance.touchMemories(touch);
    if (fresh.length > 0) {
      await port.npcMemory.write(
        input.profileId,
        input.npcId,
        fresh.map(({ w, v }) => ({
          kind: w.kind as MemoryKind,
          text: w.text,
          importance: w.importance,
          gameTime: Math.max(0, Math.trunc(input.clockT)),
          source: input.source ?? ('dialogue' as const),
          embedding: v,
        })),
      );
    }
    return { written: fresh.length, refreshed, dropped: input.writes.length - fresh.length - refreshed };
  } catch {
    return none;
  }
}
