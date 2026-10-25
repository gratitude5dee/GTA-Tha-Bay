import type { ExportRows, MaintenanceStore } from '@dv/shared/data-port';
import { cosine, MEMORY_TTL_MS } from '@dv/shared/npc/memory';
import { fromIso, must, toIso, DataPortError, type Db } from './client.ts';

/** Columns of each table the export holds. Refresh-token hashes, identity subjects and embeddings are left out on purpose. */
const EXPORT_COLUMNS: Record<string, { key: string; columns: string }> = {
  profiles: { key: 'id', columns: 'id,tier,display_name,display_name_state,created_at,registered_at,last_seen_at,flags,deleted_at' },
  device_keys: { key: 'profile_id', columns: 'kid,created_at,last_used_at,revoked_at' },
  identities: { key: 'profile_id', columns: 'provider,created_at,last_used_at' },
  age_assurance: { key: 'profile_id', columns: 'declared_bracket,declared_at,signal_source,signal_bracket,signal_at,effective_bracket,blocked,updated_at' },
  npc_relationship: { key: 'profile_id', columns: 'npc_id,affinity,trust,flags,encounters,summary,soul_version,last_seen_at' },
  npc_memory: { key: 'profile_id', columns: 'id,npc_id,scope,kind,text,importance,game_time,source,created_at,last_accessed_at,expires_at' },
  // M06b1: the builder's drafts (with the backstory the player wrote) and private souls.
  npc_draft: { key: 'owner_profile_id', columns: 'id,npc_id,state,rev,fields,backstory,attestation,moderation,publishable,soul_md,lint,probes,created_at,updated_at' },
  npc_soul: { key: 'owner_profile_id', columns: 'npc_id,soul_version,soul_md,status,published_at,created_at' },
  encounter_transcripts: { key: 'profile_id', columns: 'encounter_id,npc_id,r2_key,turns,usd_micros,closed_at,expires_at' },
};

const FK_VIOLATION = '23503';

/** Retention, forget and export on the service path (M06a1). Nothing here logs a row, a key or a filter value. */
export function maintenance(db: Db): MaintenanceStore {
  return {
    async recordTranscript(row) {
      const res = await db.from('encounter_transcripts').upsert(
        {
          encounter_id: row.encounter_id,
          profile_id: row.profile_id,
          npc_id: row.npc_id,
          r2_key: row.r2_key,
          turns: row.turns,
          usd_micros: row.usd_micros,
          closed_at: toIso(row.closed_at),
          expires_at: toIso(row.expires_at),
        },
        { onConflict: 'encounter_id', ignoreDuplicates: true },
      );
      if (res.error?.code === FK_VIOLATION) return 'no_profile';
      must('encounter_transcripts', res);
      return 'recorded';
    },
    async expiredTranscripts(nowMs, limit) {
      return must('encounter_transcripts', await db.from('encounter_transcripts').select('encounter_id,r2_key').lte('expires_at', toIso(nowMs)).order('expires_at').limit(limit));
    },
    async deleteTranscripts(ids) {
      if (ids.length === 0) return 0;
      return must('encounter_transcripts', await db.from('encounter_transcripts').delete().in('encounter_id', ids).select('encounter_id')).length;
    },
    async transcriptKeys(profileId) {
      return must('encounter_transcripts', await db.from('encounter_transcripts').select('r2_key').eq('profile_id', profileId)).map((r) => r.r2_key);
    },
    async purgeMemory(nowMs) {
      const mem = await db.from('npc_memory').delete({ count: 'exact' }).lte('expires_at', toIso(nowMs));
      if (mem.error) throw new DataPortError('npc_memory', mem.error.code, mem.error.message);
      const rel = await db.from('npc_relationship').delete({ count: 'exact' }).lt('last_seen_at', toIso(nowMs - MEMORY_TTL_MS));
      if (rel.error) throw new DataPortError('npc_relationship', rel.error.code, rel.error.message);
      return { memories: mem.count ?? 0, relationships: rel.count ?? 0 };
    },
    async stubProfiles(beforeMs, limit) {
      return must('profiles', await db.from('profiles').select('id').eq('tier', 'local').lt('last_seen_at', toIso(beforeMs)).order('last_seen_at').limit(limit)).map((r) => r.id);
    },
    async deletedProfiles(beforeMs, limit) {
      return must('profiles', await db.from('profiles').select('id').not('deleted_at', 'is', null).lt('deleted_at', toIso(beforeMs)).order('deleted_at').limit(limit)).map((r) => r.id);
    },
    async purgeProfile(profileId) {
      return must('profiles', await db.from('profiles').delete().eq('id', profileId).select('id')).length > 0;
    },
    async exportRows(profileId) {
      const out: ExportRows = {};
      for (const [table, { key, columns }] of Object.entries(EXPORT_COLUMNS)) {
        // The table name is a trusted constant of this file; PostgREST takes it as a path, so the generated table union cannot type it.
        const res = await (db.from(table as 'profiles') as unknown as { select(c: string): { eq(k: string, v: string): Promise<{ data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null }> } })
          .select(columns)
          .eq(key, profileId);
        out[table] = must(table, res).map((row) => timesToMs(row));
      }
      return out;
    },
    async nearestMemory(profileId, npcId, q, window = 64) {
      // Exact scan of the newest rows of the pair: the vectors come back as halfvec text and the cosine is computed here, so no function
      // beyond migration 0003 is needed. The newest 64 rows hold every memory a near-duplicate can come from within an encounter or two.
      const rows = must(
        'npc_memory',
        await db.from('npc_memory').select('id,embedding').eq('profile_id', profileId).eq('npc_id', npcId).gt('expires_at', toIso(Date.now())).order('id', { ascending: false }).limit(window),
      );
      let best: { id: number; cosine: number } | null = null;
      for (const r of rows) {
        const v = parseVector(r.embedding);
        if (v === null) continue;
        const c = cosine(v, q);
        if (best === null || c > best.cosine) best = { id: r.id, cosine: c };
      }
      return best;
    },
    async touchMemories(ids) {
      if (ids.length === 0) return;
      const t = Date.now();
      must('npc_memory', await db.from('npc_memory').update({ last_accessed_at: toIso(t), expires_at: toIso(t + MEMORY_TTL_MS) }).in('id', ids));
    },
    async forgetNpcMemory(profileId, npcId) {
      let mem = db.from('npc_memory').delete({ count: 'exact' }).eq('profile_id', profileId);
      let rel = db.from('npc_relationship').delete({ count: 'exact' }).eq('profile_id', profileId);
      if (npcId !== null) {
        mem = mem.eq('npc_id', npcId);
        rel = rel.eq('npc_id', npcId);
      }
      const m = await mem;
      if (m.error) throw new DataPortError('npc_memory', m.error.code, m.error.message);
      const r = await rel;
      if (r.error) throw new DataPortError('npc_relationship', r.error.code, r.error.message);
      return { memories: m.count ?? 0, relationships: r.count ?? 0 };
    },
  };
}

/** A halfvec/vector column as PostgREST returns it: the text `[a,b,...]` (or an array). Null when it cannot be read. */
function parseVector(raw: unknown): Float32Array | null {
  const list: unknown = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(list)) return null;
  const v = new Float32Array(list.length);
  for (let i = 0; i < list.length; i++) v[i] = Number(list[i]);
  return v;
}

/** timestamptz strings of an export row become epoch ms, as at every other port boundary. */
function timesToMs(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' && /_at$/.test(k) && !Number.isNaN(Date.parse(v)) ? fromIso(v) : v;
  }
  return out;
}
