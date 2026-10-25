import type { BuilderStore, DraftPatch, NpcDraftRow, NpcSoulRow } from '@dv/shared/data-port';
import { fromIso, fromIsoOrNull, must, mustMaybe, toIso, type Db } from './client.ts';

type DraftDb = {
  id: string;
  npc_id: string;
  owner_profile_id: string;
  state: string;
  rev: number;
  fields: unknown;
  backstory: string;
  image_upload_ids: string[];
  image_descriptions: unknown;
  attestation: string;
  moderation: unknown;
  publishable: boolean;
  soul_md: string | null;
  lint: unknown;
  probes: unknown;
  jobs: unknown;
  soul_version: number | null;
  created_at: string;
  updated_at: string;
};

export function draftRow(r: DraftDb): NpcDraftRow {
  return { ...r, created_at: fromIso(r.created_at), updated_at: fromIso(r.updated_at) } as NpcDraftRow;
}

type SoulDb = Omit<NpcSoulRow, 'published_at' | 'created_at'> & { published_at: string | null; created_at: string };
export function soulRow(r: SoulDb): NpcSoulRow {
  return { ...r, published_at: fromIsoOrNull(r.published_at), created_at: fromIso(r.created_at) };
}

/** Draft states the 180-day purge may delete (nothing that is, or is being, published). */
const UNPUBLISHED = ['draft', 'validating', 'rejected_auto', 'text_ok', 'soul_generating', 'soul_failed', 'soul_ready', 'probing', 'private'];

/**
 * `npc_draft` and `npc_soul` on the service path (M06b1). Backstory text and the soul are user content: nothing here logs a row or a value.
 * `updateDraft` is an optimistic update: it reads the row, checks the guards, and writes with the revision and state it read, so a writer
 * that lost a race gets 'conflict' or 'state' instead of overwriting the winner.
 */
export function builder(db: Db, now: () => number = Date.now): BuilderStore {
  const selectDraft = async (id: string): Promise<NpcDraftRow | null> => {
    const row = mustMaybe('npc_draft', await db.from('npc_draft').select('*').eq('id', id).maybeSingle());
    return row === null ? null : draftRow(row as unknown as DraftDb);
  };
  return {
    async createDraft(d, maxLive) {
      const head = await db.from('npc_draft').select('id', { count: 'exact', head: true }).eq('owner_profile_id', d.ownerProfileId);
      if (head.error) must('npc_draft', head);
      if ((head.count ?? 0) >= maxLive) return 'limit';
      const row = must(
        'npc_draft',
        await db
          .from('npc_draft')
          .insert({ id: d.id, npc_id: d.npcId, owner_profile_id: d.ownerProfileId, fields: d.fields, attestation: d.attestation, created_at: toIso(now()), updated_at: toIso(now()) })
          .select('*')
          .single(),
      );
      return draftRow(row as unknown as DraftDb);
    },
    getDraft: selectDraft,
    async listDrafts(owner) {
      const rows = must('npc_draft', await db.from('npc_draft').select('*').eq('owner_profile_id', owner).order('updated_at', { ascending: false }));
      return rows.map((r) => draftRow(r as unknown as DraftDb));
    },
    async updateDraft(id, patch: DraftPatch, guard = {}) {
      const cur = await selectDraft(id);
      if (cur === null) return null;
      if (guard.fromStates != null && !guard.fromStates.includes(cur.state)) return 'state';
      if (guard.ifRev != null && guard.ifRev !== cur.rev) return 'conflict';
      const res = await db
        .from('npc_draft')
        .update({ ...patch, rev: guard.bumpRev === true ? cur.rev + 1 : cur.rev, updated_at: toIso(now()) } as never)
        .eq('id', id)
        .eq('rev', cur.rev)
        .eq('state', cur.state)
        .select('*');
      const rows = must('npc_draft', res);
      if (rows.length === 0) {
        // Somebody wrote between the read and the write: report what they changed.
        const after = await selectDraft(id);
        if (after === null) return null;
        if (guard.fromStates != null && !guard.fromStates.includes(after.state)) return 'state';
        return 'conflict';
      }
      return draftRow(rows[0] as unknown as DraftDb);
    },
    async deleteDraft(id, owner) {
      const row = mustMaybe('npc_draft', await db.from('npc_draft').select('npc_id').eq('id', id).eq('owner_profile_id', owner).maybeSingle());
      if (row === null) return null;
      const souls = must('npc_soul', await db.from('npc_soul').delete().eq('npc_id', row.npc_id).eq('owner_profile_id', owner).select('prompt_r2_key'));
      must('npc_draft', await db.from('npc_draft').delete().eq('id', id).eq('owner_profile_id', owner).select('id'));
      return { promptKeys: souls.map((x) => x.prompt_r2_key) };
    },
    async putSoul(s) {
      must(
        'npc_soul',
        await db.from('npc_soul').upsert(
          {
            npc_id: s.npcId,
            soul_version: s.soulVersion,
            owner_profile_id: s.ownerProfileId,
            soul_md: s.soulMd,
            compiled_json: s.compiledJson,
            prompt_r2_key: s.promptR2Key,
            prompt_sha256: s.promptSha256,
            status: s.status,
          },
          { onConflict: 'npc_id,soul_version' },
        ),
      );
    },
    async getSoul(npcId, soulVersion) {
      const q = db.from('npc_soul').select('*').eq('npc_id', npcId);
      const row =
        soulVersion === undefined
          ? mustMaybe('npc_soul', await q.order('soul_version', { ascending: false }).limit(1).maybeSingle())
          : mustMaybe('npc_soul', await q.eq('soul_version', soulVersion).maybeSingle());
      return row === null ? null : soulRow(row as unknown as SoulDb);
    },
    async soulKeys(owner) {
      return must('npc_soul', await db.from('npc_soul').select('prompt_r2_key').eq('owner_profile_id', owner)).map((r) => r.prompt_r2_key);
    },
    async purgeStaleDrafts(beforeMs, limit) {
      const stale = must(
        'npc_draft',
        await db.from('npc_draft').select('id,npc_id').in('state', UNPUBLISHED).lt('updated_at', toIso(beforeMs)).order('updated_at').limit(limit),
      );
      if (stale.length === 0) return [];
      const npcIds = stale.map((r) => r.npc_id);
      const souls = must('npc_soul', await db.from('npc_soul').select('npc_id,prompt_r2_key').in('npc_id', npcIds).eq('status', 'private'));
      must('npc_soul', await db.from('npc_soul').delete().in('npc_id', npcIds).eq('status', 'private').select('npc_id'));
      must('npc_draft', await db.from('npc_draft').delete().in('id', stale.map((r) => r.id)).select('id'));
      return stale.map((r) => ({ npcId: r.npc_id, promptKeys: souls.filter((s) => s.npc_id === r.npc_id).map((s) => s.prompt_r2_key) }));
    },
  };
}
