import type { AuditStore, RosterFlagRow, RosterStore } from '@dv/shared/data-port';
import { NIL_UUID, buildRosterFlags } from '@dv/shared/npc/memory';
import { fromIso, must, toIso, type Db } from './client.ts';

function rosterRow(r: { npc_id: string; killed: boolean; scope: string[]; reason: string | null; stand_in: string; ticket_id: string | null; set_by: string; set_at: string }): RosterFlagRow {
  return { ...r, set_at: fromIso(r.set_at) };
}

/** `roster_flag` access: the live state of the kill switch (read from Postgres, strongly consistent; DL-557). */
export function roster(db: Db, now: () => number = Date.now): RosterStore {
  return {
    async flags() {
      const rows = must('roster_flag', await db.from('roster_flag').select('npc_id,killed,scope,reason,stand_in,ticket_id,set_by,set_at'));
      return buildRosterFlags(rows.map(rosterRow));
    },
    async kill(ctx, npcId, req) {
      const row = must(
        'roster_flag',
        await db
          .from('roster_flag')
          .upsert(
            {
              npc_id: npcId,
              killed: true,
              scope: [...req.scope],
              reason: req.reason,
              stand_in: req.standIn,
              ticket_id: req.ticketId,
              set_by: ctx.profileId ?? NIL_UUID,
              set_at: toIso(now()),
            },
            { onConflict: 'npc_id' },
          )
          .select('npc_id,killed,scope,reason,stand_in,ticket_id,set_by,set_at')
          .single(),
      );
      return rosterRow(row);
    },
  };
}

/** `audit_log` appends through the hash-chaining SQL function audit_append (0003). */
export function audit(db: Db): AuditStore {
  return {
    async append(e) {
      must(
        'audit_log',
        await db.rpc('audit_append', {
          p_actor: e.actor,
          p_role: e.role,
          p_action: e.action,
          p_target_kind: e.targetKind ?? (null as never),
          p_target_id: e.targetId ?? (null as never),
          p_details: (e.details ?? {}) as never,
        }),
      );
    },
  };
}
