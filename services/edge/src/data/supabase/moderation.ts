import { MODERATION_SLA_HOURS, laterModeration, type ModerationCaseRow, type ModerationSignalRow, type ModerationStore } from '@dv/shared/data-port';
import { fromIso, fromIsoOrNull, must, mustMaybe, toIso, type Db } from './client.ts';

type CaseDb = Omit<ModerationCaseRow, 'sla_due_at' | 'statutory_due_at' | 'created_at' | 'closed_at'> & {
  sla_due_at: string;
  statutory_due_at: string | null;
  created_at: string;
  closed_at: string | null;
};
const caseRow = (r: CaseDb): ModerationCaseRow => ({
  ...r,
  sla_due_at: fromIso(r.sla_due_at),
  statutory_due_at: fromIsoOrNull(r.statutory_due_at),
  created_at: fromIso(r.created_at),
  closed_at: fromIsoOrNull(r.closed_at),
});

/**
 * Moderation tables on the service path (M06b1): an item per subject, its signals, cases. Scores and snapshots can hold user text excerpts, so
 * nothing here logs them. The report, decision, evidence, hash-bank and takedown members land with M06b2 and M13d1.
 */
export function moderation(db: Db, now: () => number = Date.now): ModerationStore {
  const itemIds = async (kind: 'npc_draft', subjectId: string): Promise<string[]> =>
    must('moderation_item', await db.from('moderation_item').select('id').eq('subject_kind', kind).eq('subject_id', subjectId)).map((r) => r.id);
  return {
    async ensureItem(subject) {
      const found = mustMaybe(
        'moderation_item',
        await db.from('moderation_item').select('id').eq('subject_kind', subject.kind).eq('subject_id', subject.id).order('created_at').limit(1).maybeSingle(),
      );
      if (found !== null) return found.id;
      must(
        'moderation_item',
        await db.from('moderation_item').insert({ id: subject.newId, subject_kind: subject.kind, subject_id: subject.id, owner_profile_id: subject.ownerProfileId }),
      );
      return subject.newId;
    },
    async setItemState(itemId, state) {
      must('moderation_item', await db.from('moderation_item').update({ state, updated_at: toIso(now()) }).eq('id', itemId).select('id'));
    },
    async recordSignals(itemId, signals) {
      if (signals.length === 0) return;
      must(
        'moderation_signal',
        await db.from('moderation_signal').insert(
          signals.map((g) => ({
            item_id: itemId,
            source: g.source,
            source_version: g.sourceVersion,
            verdict: g.verdict,
            scores: g.scores as never,
            latency_ms: g.latencyMs ?? null,
          })),
        ),
      );
    },
    async openCase(c) {
      const at = now();
      const row = must(
        'moderation_case',
        await db
          .from('moderation_case')
          .insert({
            id: c.id,
            item_id: c.itemId,
            queue: c.queue,
            reason: c.reason,
            opened_by: c.openedBy,
            sla_due_at: toIso(at + MODERATION_SLA_HOURS[c.queue] * 3_600_000),
            created_at: toIso(at),
            subject_snapshot: c.snapshot as never,
          })
          .select('*')
          .single(),
      );
      return caseRow(row as unknown as CaseDb);
    },
    async draftVerdicts(draftId) {
      const ids = await itemIds('npc_draft', draftId);
      if (ids.length === 0) return [];
      const rows = must('moderation_signal', await db.from('moderation_signal').select('*').in('item_id', ids).order('id'));
      return rows.map((r): ModerationSignalRow => ({ ...r, created_at: fromIso(r.created_at) }));
    },
    async casesFor(kind, subjectId) {
      const ids = must('moderation_item', await db.from('moderation_item').select('id').eq('subject_kind', kind).eq('subject_id', subjectId)).map((r) => r.id);
      if (ids.length === 0) return [];
      const rows = must('moderation_case', await db.from('moderation_case').select('*').in('item_id', ids).order('created_at'));
      return rows.map((r) => caseRow(r as unknown as CaseDb));
    },
    ...laterModeration(),
  };
}
