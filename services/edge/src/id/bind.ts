import { apiError } from '../errors.ts';
import type { Ctx } from '../router.ts';

/**
 * Trust on first use for the device key (M06a1, spec/domains/09-backend-contracts.md section 2.3): the first server write for a `pid` creates
 * its profile row and binds the key thumbprint to it (`profiles.ensureLocal`); a later request for that pid under another key is refused with 403.
 * Shared by route 5 (the mint) and by every route that takes a play token (id/tofu.ts).
 */
const BOUND_TTL_MS = 300_000;
/** (pid, dkt) pairs confirmed in this isolate, so a busy player does not cost a database round trip per request. */
const bound = new Map<string, number>();

export function resetBoundCache(): void {
  bound.clear();
}

/** Binds the device key on first use. Returns the 403 response on a mismatch, null otherwise (including when the database is unreachable or absent). */
export async function bindDeviceKey(ctx: Ctx, pid: string, dkt: string): Promise<Response | null> {
  const port = ctx.deps.data(ctx.env);
  if (port === null) return null;
  const key = `${pid}|${dkt}`;
  const t = ctx.deps.now();
  const until = bound.get(key);
  if (until !== undefined && until > t) return null;
  let result: 'created' | 'exists' | 'key_mismatch';
  try {
    result = await port.profiles.ensureLocal(pid, dkt);
  } catch {
    // Database down (09-backend.md section 5.3): the HMAC already proves the token is ours; the binding is retried on the next request.
    ctx.deps.logOnce('tofu-db-down', JSON.stringify({ event: 'tofu.skipped', reason: 'database_unavailable' }));
    return null;
  }
  if (result === 'key_mismatch') return apiError('forbidden', 'This profile is bound to another device key.', ctx.requestId);
  bound.set(key, t + BOUND_TTL_MS);
  if (bound.size > 5000) bound.clear();
  return null;
}
