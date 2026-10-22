import type { IdentityStateDTO } from '@dv/shared';
import { apiError, json } from '../errors.ts';
import { authenticatePlayer } from '../id/tofu.ts';
import { EXPORT_TTL_MS, exportKey, runExport } from '../ops/export.ts';
import { runForget } from '../ops/forget.ts';
import { sendJob } from '../ops/queue.ts';
import type { Ctx } from '../router.ts';

/**
 * Route 14 (P0, play token): `GET /me` -> `IdentityStateDTO`, `GET /me/export`, `DELETE /me` (spec/domains/09-backend-contracts.md section 2.4;
 * 09-backend-db.md section 7). Nothing links a password account to a profile before M12a1, so no Supabase-user code lives here (routes 64 and 65
 * cover that account); M12a1 registers its credential handler in ops/forget.ts instead.
 */
const EXPORT_ID = /^[0-9]{10,16}$/;
const PENDING_MS = 10 * 60_000;

/** `GET /api/v1/me`. */
export async function handleMe(ctx: Ctx): Promise<Response> {
  const auth = await authenticatePlayer(ctx);
  if (auth instanceof Response) return auth;
  const port = ctx.deps.data(ctx.env);
  if (port === null) {
    // No database (local run, Preview): the token alone is the identity.
    return json({ profileId: auth.profileId, tier: 'local', providers: [] } satisfies IdentityStateDTO);
  }
  const row = await port.profiles.get({ profileId: auth.profileId, tier: 'local', requestId: ctx.requestId });
  if (row === null) return apiError('not_found', 'No such profile.', ctx.requestId);
  return json({ profileId: row.id, tier: row.tier as IdentityStateDTO['tier'], providers: [] } satisfies IdentityStateDTO);
}

/**
 * `DELETE /api/v1/me`: the profile stops existing for the API now (`deleted_at`), and the forget job removes every row and R2 object keyed
 * by it within 24 h. Answers 202 `{state:'queued'}`, or 200 `{state:'done'}` where no queue is bound and the job ran inline. Repeating it is harmless.
 */
export async function handleDeleteMe(ctx: Ctx): Promise<Response> {
  const auth = await authenticatePlayer(ctx);
  if (auth instanceof Response) return auth;
  const port = ctx.deps.data(ctx.env);
  if (port === null) return json({ state: 'done', stored: false });
  await port.profiles.forget({ profileId: auth.profileId, tier: 'local', requestId: ctx.requestId });
  if (await sendJob(ctx.env, { type: 'forget', profileId: auth.profileId })) return json({ state: 'queued' }, { status: 202 });
  await runForget(ctx.env, ctx.deps, auth.profileId);
  return json({ state: 'done' });
}

/**
 * `GET /api/v1/me/export`. The first call queues the export job and answers 202 `{state:'pending'}`; once the ZIP exists the answer is 200
 * `{state:'ready', url, expiresAt}`. The `url` is this route with `?download=<id>`: an authenticated download served by the Worker for 7 days
 * (a presigned R2 link needs the S3 keys, which arrive as Worker secrets with M06b2; BD-M06a1-07). Without a bound queue the job runs inline.
 */
export async function handleExport(ctx: Ctx): Promise<Response> {
  const auth = await authenticatePlayer(ctx);
  if (auth instanceof Response) return auth;
  const { env, deps, url, requestId } = ctx;
  const pid = auth.profileId;

  const download = url.searchParams.get('download');
  if (download !== null) {
    if (!EXPORT_ID.test(download)) return apiError('bad_request', 'Invalid export id.', requestId);
    const obj = await env.PRIVATE.get(exportKey(pid, download));
    if (obj === null || obj.uploaded.getTime() < deps.now() - EXPORT_TTL_MS) return apiError('not_found', 'No such export.', requestId);
    return new Response(ctx.request.method === 'HEAD' ? null : obj.body, {
      status: 200,
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="export.zip"', 'Cache-Control': 'no-store', 'Content-Length': String(obj.size) },
    });
  }

  const ready = await latestExport(ctx, pid);
  if (ready !== null) return json({ state: 'ready', url: `/api/v1/me/export?download=${ready.id}`, expiresAt: ready.at + EXPORT_TTL_MS });

  if (deps.data(env) === null) return apiError('upstream_unavailable', 'Nothing is stored for this profile.', requestId);
  const t = deps.now();
  const marker = `exports/${pid}/pending`;
  const pending = await env.PRIVATE.head(marker);
  if (pending !== null && t - pending.uploaded.getTime() < PENDING_MS) return json({ state: 'pending', retryAfterMs: 15_000 }, { status: 202 });
  const exportId = String(t);
  await env.PRIVATE.put(marker, String(t));
  if (await sendJob(env, { type: 'export', profileId: pid, exportId })) return json({ state: 'pending', retryAfterMs: 15_000 }, { status: 202 });
  await runExport(env, deps, pid, exportId);
  await env.PRIVATE.delete(marker);
  return json({ state: 'ready', url: `/api/v1/me/export?download=${exportId}`, expiresAt: t + EXPORT_TTL_MS });
}

async function latestExport(ctx: Ctx, pid: string): Promise<{ id: string; at: number } | null> {
  const t = ctx.deps.now();
  let best: { id: string; at: number } | null = null;
  const listed = await ctx.env.PRIVATE.list({ prefix: `exports/${pid}/`, limit: 100 });
  for (const o of listed.objects) {
    const m = /\/([0-9]{10,16})\.zip$/.exec(o.key);
    if (!m) continue;
    const at = o.uploaded.getTime();
    if (at >= t - EXPORT_TTL_MS && (best === null || at > best.at)) best = { id: m[1]!, at };
  }
  return best;
}
