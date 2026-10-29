import { governorBudget, handleFalWebhook, kvFlags, webhookDeps } from '@dv/pipeline/core';
import type { CutsceneStatus, GenJob } from '@dv/shared';
import type { Env } from '../env.ts';
import { apiError, json } from '../errors.ts';
import type { Ctx } from '../router.ts';
import { CUTSCENE_KEY, inCatalog } from './catalog.ts';
import { buildCutsceneJob } from './job.ts';

/** Minimal RPC surface of CutsceneJobDO as the routes use it. */
interface CutsceneJobRpc {
  status(key: string): Promise<CutsceneStatus>;
  ensure(job: GenJob, opts: { allowGenerate: boolean }): Promise<CutsceneStatus>;
}

function jobStub(env: Env, key: string): CutsceneJobRpc {
  return env.CUTSCENE_JOB.get(env.CUTSCENE_JOB.idFromName(`cut:${key}`)) as unknown as CutsceneJobRpc;
}

/** Why a new generation would not start right now (kill switches, governor level 3), or null when it may. */
export async function generationBlock(env: Env): Promise<'kill_switched' | 'budget' | null> {
  const ks = await kvFlags(env.FLAGS).killSwitches();
  if (ks.has('ks:cutscene_gen') || ks.has('ks:genai:all') || ks.has('ks:fal')) return 'kill_switched';
  if ((await governorBudget(env).level()) >= 3) return 'budget';
  return null;
}

/** Route 27: GET /api/v1/cutscenes/:key. Never starts generation; reports what a prewarm would be allowed to do. */
export async function handleCutsceneStatus({ env, url, requestId, deps }: Ctx): Promise<Response> {
  const key = url.pathname.slice('/api/v1/cutscenes/'.length);
  if (!CUTSCENE_KEY.test(key)) return apiError('bad_request', 'A cutscene key is 64 lowercase hex characters.', requestId);
  const inCat = await inCatalog(env, deps, key);
  // Database down (09-backend.md section 5.3): the catalog cannot be read, so report what R2 holds and start nothing. `status` never
  // calls `ensure`; a manifest in MEDIA is `ready`, anything else is `absent`.
  if (inCat === 'down') return json(await jobStub(env, key).status(key));
  if (inCat === 'no') return json({ key, state: 'absent', reason: 'not_in_catalog' } satisfies CutsceneStatus);
  const st = await jobStub(env, key).status(key);
  if (st.state !== 'absent') return json(st);
  const block = await generationBlock(env);
  return json(block === null ? st : ({ ...st, reason: block } satisfies CutsceneStatus));
}

function bearer(request: Request): string | null {
  const h = request.headers.get('Authorization');
  return h !== null && h.startsWith('Bearer ') ? h.slice('Bearer '.length) : null;
}

/** Constant-time comparison of two strings through their SHA-256 digests. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

const MAX_PREWARM_KEYS = 50;

/** Route 28: POST /api/v1/admin/cutscenes/prewarm {keys[]} -> 202. Staff only (OPS_TOKEN until staff JWTs, M12a1); geo-exempt (DL-184). */
export async function handlePrewarm({ request, env, requestId, deps }: Ctx): Promise<Response> {
  const token = bearer(request);
  if (!env.OPS_TOKEN || token === null || !(await sameSecret(token, env.OPS_TOKEN))) {
    return apiError('unauthorized', 'A staff token is required.', requestId);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('bad_request', 'The body must be JSON.', requestId);
  }
  const keys = (body as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_PREWARM_KEYS || !keys.every((k) => typeof k === 'string' && CUTSCENE_KEY.test(k))) {
    return apiError('bad_request', `keys must be 1 to ${MAX_PREWARM_KEYS} cutscene keys.`, requestId);
  }
  const block = await generationBlock(env);
  const unique = [...new Set(keys as string[])];
  const results: CutsceneStatus[] = [];
  for (const key of unique) {
    const inCat = await inCatalog(env, deps, key);
    if (inCat === 'no') {
      results.push({ key, state: 'absent', reason: 'not_in_catalog' });
      continue;
    }
    const stub = jobStub(env, key);
    if (inCat === 'down') {
      // The catalog cannot be checked, so nothing is generated; the key reports what R2 holds.
      results.push(await stub.status(key));
      continue;
    }
    // A ready key stays ready whatever the budget or kill state; only a new generation is held back. A handed-off key never generates:
    // `ensure` starts its publish phase once finish.json exists, with or without `allowGenerate` (the spend was settled at the hand-off, M05c4).
    const st = await stub.ensure(buildCutsceneJob(key, env, 'ops:prewarm'), { allowGenerate: block === null });
    results.push(block !== null && st.state === 'absent' ? { ...st, reason: block } : st);
  }
  return json({ keys: results }, { status: 202 });
}

/** Route 29: POST /api/v1/hooks/fal?wf=<instance>. Authenticated by the ED25519 signature, so it is geo-exempt. */
export async function handleFalHook({ request, env, requestId }: Ctx): Promise<Response> {
  const result = await handleFalWebhook(request, webhookDeps(env));
  if (result.status === 401) return apiError('unauthorized', 'Webhook signature rejected.', requestId);
  if (result.status === 400) return apiError('bad_request', 'Webhook request rejected.', requestId, { details: { reason: result.reason ?? 'bad_request' } });
  return json({ ok: true, delivered: result.delivered });
}
