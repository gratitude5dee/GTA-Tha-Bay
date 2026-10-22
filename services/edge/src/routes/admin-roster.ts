import { GENERIC_STAND_IN } from '@dv/shared/npc/memory';
import { KILL_SCOPES, type KillReason, type KillReq, type KillScope } from '@dv/shared';
import { apiError, json } from '../errors.ts';
import { OPS_ACTOR, requireOps } from '../flags/admin.ts';
import { dropRosterCache, writeKvCopy } from '../flags/roster.ts';
import type { EncounterDO } from '../npc/EncounterDO.ts';
import type { Ctx } from '../router.ts';

const NPC_ID = /^[a-z][a-z0-9_-]{2,47}$/;
const STAND_IN = /^character\/[a-z0-9][a-z0-9_-]{0,63}$/;
const REASONS: readonly KillReason[] = ['consent_revoked', 'complaint', 'legal', 'safety', 'quality'];
const BODY_LIMIT = 4096;

/** Hand validator of the route 46 body (no runtime ajv.compile on Workers, DL-694). */
export function parseKillReq(value: unknown): KillReq | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const scope = v['scope'];
  if (!Array.isArray(scope) || scope.length === 0 || scope.length > KILL_SCOPES.length || !scope.every((s) => KILL_SCOPES.includes(s as KillScope))) return null;
  if (typeof v['reason'] !== 'string' || !REASONS.includes(v['reason'] as KillReason)) return null;
  if (typeof v['ticketId'] !== 'string' || v['ticketId'].length === 0 || v['ticketId'].length > 64) return null;
  const standIn = v['standIn'];
  if (standIn !== undefined && (typeof standIn !== 'string' || !STAND_IN.test(standIn))) return null;
  return {
    scope: [...new Set(scope as KillScope[])],
    reason: v['reason'] as KillReason,
    ticketId: v['ticketId'],
    ...(standIn === undefined ? {} : { standIn: standIn as KillReq['standIn'] & string }),
  };
}

/**
 * Route 46, `POST /api/v1/admin/roster/:npcId/kill {scope[], reason, ticketId}` (staff:admin; the ops token until M12a1). It writes the
 * `roster_flag` row and an audit entry, rewrites the KV fallback copy, drops this isolate's roster cache, hands the purge to KillPurgeWorkflow
 * (logs only until M10b) and tells every open encounter of the NPC to stop: those streams end with `fallback{killed}` at once.
 */
export async function handleKill(ctx: Ctx): Promise<Response> {
  const denied = await requireOps(ctx);
  if (denied) return denied;
  const m = /^\/api\/v1\/admin\/roster\/([^/]+)\/kill$/.exec(ctx.url.pathname);
  const npcId = m ? decodeURIComponent(m[1]!) : '';
  if (!NPC_ID.test(npcId)) return apiError('bad_request', 'Unknown NPC id.', ctx.requestId);
  const text = await ctx.request.text();
  let body: unknown;
  try {
    body = text.length > 0 && text.length <= BODY_LIMIT ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  const req = parseKillReq(body);
  if (req === null) return apiError('bad_request', 'Body must be {scope[], reason, ticketId}.', ctx.requestId);
  const port = ctx.deps.data(ctx.env);
  if (port === null) return apiError('upstream_unavailable', 'The roster database is not configured.', ctx.requestId);

  const row = await port.roster.kill({ profileId: null, tier: 'local', requestId: ctx.requestId }, npcId, { ...req, standIn: req.standIn ?? GENERIC_STAND_IN });

  let audited = true;
  try {
    await port.audit.append({ ...OPS_ACTOR, action: 'roster.kill', targetKind: 'npc', targetId: npcId, details: { scope: req.scope, reason: req.reason, ticketId: req.ticketId } });
  } catch {
    // The kill is already in force; a failed audit is reported, never allowed to undo it.
    audited = false;
    ctx.deps.log(JSON.stringify({ event: 'audit.failed', action: 'roster.kill' }));
  }
  dropRosterCache();
  let etag = '';
  try {
    const flags = await port.roster.flags();
    etag = flags.etag;
    await writeKvCopy(ctx.env, flags);
  } catch {
    ctx.deps.log(JSON.stringify({ event: 'roster.kv_copy_failed' }));
  }
  // Open conversations: the index instance of this NPC fans the kill out to each of them.
  let reached = 0;
  try {
    const index = ctx.env.ENCOUNTER.get(ctx.env.ENCOUNTER.idFromName(`enc:index:${npcId}`)) as DurableObjectStub<EncounterDO>;
    reached = await index.indexKill(npcId);
  } catch {
    ctx.deps.log(JSON.stringify({ event: 'roster.kill_broadcast_failed' }));
  }
  await ctx.deps.killPurge(ctx.env, npcId, req.scope);
  return json({ npcId, killed: true, scope: row.scope, etag, openEncounters: reached, audited });
}
