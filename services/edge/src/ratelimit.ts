import { normalizeName, sha256Hex } from '@dv/shared';
import { apiError } from './errors.ts';
import { dailySalt, netHashOf } from './id/nethash.ts';
import type { Ctx } from './router.ts';

/**
 * Rate limit of class `auth` for the password routes 58-61, 64 and 65 (M00e item 1). Supabase's own limits see only
 * Cloudflare addresses (U-ACCT-4), so this is the real limit. Keys are SHA-256 hex of a network prefix or a normalised
 * username plus a daily salt; neither the address nor the username is stored or logged. The net key is the shared
 * `netHash` recipe of id/nethash.ts (M06a1).
 */

const RETRY_AFTER_MS = 60_000;

async function allowed(binding: RateLimit | undefined, key: string): Promise<boolean> {
  if (!binding) return true;
  try {
    return (await binding.limit({ key })).success;
  } catch {
    // A failing limiter must not lock every player out of sign-in; Supabase's own limits still apply.
    return true;
  }
}

function limited(ctx: Ctx): Response {
  return apiError('rate_limited', 'Too many attempts. Wait a minute and try again.', ctx.requestId, { retryAfterMs: RETRY_AFTER_MS });
}

async function saltFor(ctx: Ctx): Promise<string> {
  if (!ctx.env.QUOTA_NET_SALT_SECRET) {
    ctx.deps.logOnce('auth-ratelimit-salt', 'SKIP auth ratelimit salt: QUOTA_NET_SALT_SECRET not set');
  }
  return dailySalt(ctx.env.QUOTA_NET_SALT_SECRET, ctx.deps.now());
}

/** Per-net limit (RL_AUTH). Returns the 429 response, or null to continue. */
export async function limitByNet(ctx: Ctx): Promise<Response | null> {
  if (!ctx.env.RL_AUTH) return null;
  const salt = await saltFor(ctx);
  const key = netHashOf(ctx.request.headers.get('CF-Connecting-IP'), salt);
  return (await allowed(ctx.env.RL_AUTH, key)) ? null : limited(ctx);
}

/** Per-account limit (RL_AUTH_USER) for route 59, checked before any upstream call. */
export async function limitByUser(ctx: Ctx, username: string): Promise<Response | null> {
  if (!ctx.env.RL_AUTH_USER) return null;
  const salt = await saltFor(ctx);
  const key = sha256Hex(`${normalizeName(username)}|${salt}`);
  return (await allowed(ctx.env.RL_AUTH_USER, key)) ? null : limited(ctx);
}
