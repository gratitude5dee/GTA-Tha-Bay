import type { DataPort, RelationshipRow } from '@dv/shared/data-port';
import { MEMORY_DIM, MEMORY_TTL_MS, mergeSummary } from '@dv/shared/npc/memory';
import { fromIso, must, mustMaybe, toIso, type Db } from './client.ts';

/** A halfvec literal as PostgREST takes it: `[v1,v2,...]`. Non-finite components become 0. */
export function vectorLiteral(v: ArrayLike<number>): string {
  if (v.length !== MEMORY_DIM) throw new Error(`embedding must have ${MEMORY_DIM} components`);
  const parts: string[] = [];
  for (let i = 0; i < v.length; i++) {
    const x = v[i] as number;
    parts.push(Number.isFinite(x) ? String(x) : '0');
  }
  return `[${parts.join(',')}]`;
}

export function relationshipRow(r: {
  profile_id: string;
  npc_id: string;
  affinity: number;
  trust: number;
  flags: unknown;
  encounters: number;
  summary: string;
  soul_version: number;
  last_seen_at: string;
}): RelationshipRow {
  return { ...r, flags: r.flags as RelationshipRow['flags'], last_seen_at: fromIso(r.last_seen_at) };
}

/** `npcMemory`: relationship rows, the exact-scan memory match (match_npc_memories) and the writes. Text of a memory is never logged. */
export function npcMemory(db: Db, now: () => number = Date.now): DataPort['npcMemory'] {
  return {
    async relationship(pid, npcId) {
      const row = mustMaybe('npc_relationship', await db.from('npc_relationship').select('*').eq('profile_id', pid).eq('npc_id', npcId).maybeSingle());
      return row === null ? null : relationshipRow(row);
    },
    async topK(pid, npcId, q, gameTime, k = 6) {
      const hits = must(
        'match_npc_memories',
        await db.rpc('match_npc_memories', { p_profile: pid, p_npc: npcId, q: vectorLiteral(q), now_gt: Math.trunc(gameTime), k }),
      );
      if (hits.length > 0) {
        // A memory that is read lives 180 days from now (migration 0003: reset to +180 d on access).
        const t = now();
        must(
          'npc_memory',
          await db
            .from('npc_memory')
            .update({ last_accessed_at: toIso(t), expires_at: toIso(t + MEMORY_TTL_MS) })
            .in(
              'id',
              hits.map((h) => h.id),
            ),
        );
      }
      return hits.map((h) => ({ id: h.id, text: h.text, kind: h.kind as 'event', score: h.score }));
    },
    async write(pid, npcId, ms) {
      if (ms.length === 0) return;
      must(
        'npc_memory',
        await db.from('npc_memory').insert(
          ms.map((m) => ({
            profile_id: pid,
            npc_id: npcId,
            scope: npcId === '*' ? 'world' : 'pair',
            kind: m.kind,
            text: m.text,
            importance: m.importance,
            game_time: Math.trunc(m.gameTime),
            source: m.source,
            embedding: vectorLiteral(m.embedding),
          })),
        ),
      );
    },
    async applySummary(pid, npcId, s) {
      const old = mustMaybe('npc_relationship', await db.from('npc_relationship').select('*').eq('profile_id', pid).eq('npc_id', npcId).maybeSingle());
      const merged = mergeSummary(
        old === null ? null : { affinity: old.affinity, trust: old.trust, flags: old.flags as Record<string, unknown>, encounters: old.encounters, summary: old.summary, soul_version: old.soul_version },
        s,
      );
      must(
        'npc_relationship',
        await db.from('npc_relationship').upsert(
          {
            profile_id: pid,
            npc_id: npcId,
            affinity: merged.affinity,
            trust: merged.trust,
            flags: merged.flags as never,
            encounters: merged.encounters,
            summary: merged.summary,
            soul_version: merged.soul_version,
            last_seen_at: toIso(now()),
          },
          { onConflict: 'profile_id,npc_id' },
        ),
      );
    },
  };
}
