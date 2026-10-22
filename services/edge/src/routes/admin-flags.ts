import { apiError, json } from '../errors.ts';
import { OPS_ACTOR, parseFlagName, readFeatures, requireOps, type KsRecord } from '../flags/admin.ts';
import type { Ctx } from '../router.ts';

const BODY_LIMIT = 2048;
const REASON_MAX = 200;

/**
 * Route 47, `PUT /api/v1/admin/flags/:flag` (staff:admin; the ops token until M12a1). `:flag` is `ks:<name>` for a kill switch
 * (09-backend-db.md section 5; a name with a slash such as `ks:fal:<endpoint>` is percent-encoded) or `feature:<flag>` for an entry of
 * `flags:features`. Body `{on: boolean, reason?: string, expiresAt?: number}`. The write lands in KV and in `audit_log`.
 * A kill switch is read by the genAI paths with a 30 s cache; anything that needs an immediate stop also goes through a DO.
 */
export async function handlePutFlag(ctx: Ctx): Promise<Response> {
  const denied = await requireOps(ctx);
  if (denied) return denied;
  const name = decodeURIComponent(ctx.url.pathname.slice('/api/v1/admin/flags/'.length));
  const flag = parseFlagName(name);
  if (flag === null) return apiError('bad_request', 'Unknown flag name.', ctx.requestId);
  const text = await ctx.request.text();
  let body: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = text.length > 0 && text.length <= BODY_LIMIT ? JSON.parse(text) : undefined;
    body = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    body = undefined;
  }
  if (body === undefined || typeof body['on'] !== 'boolean') return apiError('bad_request', 'Body must be {on: boolean}.', ctx.requestId);
  const reason = body['reason'];
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > REASON_MAX)) return apiError('bad_request', 'reason must be a string of at most 200 characters.', ctx.requestId);
  const expiresAt = body['expiresAt'];
  if (expiresAt !== undefined && (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0)) return apiError('bad_request', 'expiresAt must be an epoch ms number.', ctx.requestId);
  const port = ctx.deps.data(ctx.env);
  if (port === null) return apiError('upstream_unavailable', 'The audit database is not configured.', ctx.requestId);

  const on = body['on'];
  const ts = ctx.deps.now();
  if (flag.kind === 'ks') {
    const rec: KsRecord = { on, reason: reason ?? '', by: OPS_ACTOR.actor, ts, expiresAt: expiresAt ?? null };
    await ctx.env.FLAGS.put(flag.key, JSON.stringify(rec));
  } else {
    await ctx.env.FLAGS.put('flags:features', JSON.stringify({ ...(await readFeatures(ctx.env)), [flag.flag]: on }));
  }
  await port.audit.append({ ...OPS_ACTOR, action: 'flag.set', targetKind: 'flag', targetId: name, details: { on, ...(reason === undefined ? {} : { reason }), ...(expiresAt === undefined ? {} : { expiresAt }) } });
  return json({ flag: name, on, ts });
}
