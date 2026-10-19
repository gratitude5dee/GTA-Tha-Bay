import { normalizeName, sha256Hex } from '@dv/shared';
import { apiError } from './errors.ts';
import type { Ctx } from './router.ts';

/**
 * Rate limit of class `auth` for the password routes 58-61, 64 and 65 (M00e item 1). Supabase's own limits see only
 * Cloudflare addresses (U-ACCT-4), so this is the real limit. Keys are SHA-256 hex of a network prefix or a normalised
 * username plus a daily salt; neither the address nor the username is stored or logged. M06a1 replaces this helper with
 * the shared `netHash`.
 */

const RETRY_AFTER_MS = 60_000;

const enc = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `yyyy-mm-dd` in UTC. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** HMAC-SHA-256(QUOTA_NET_SALT_SECRET, <UTC day>) as hex; the UTC day alone when the secret is absent. */
export async function dailySalt(secret: string | undefined, nowMs: number): Promise<string> {
  const day = utcDay(nowMs);
  if (!secret) return day;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(day)));
}

/** The /24 of an IPv4 address or the /48 of an IPv6 address, as a string; 'unknown' when the header is absent or unparsable. */
export function netPrefix(ip: string | null): string {
  if (!ip) return 'unknown';
  const addr = ip.trim().toLowerCase();
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (v4) return `4:${v4[1]}.${v4[2]}.${v4[3]}`;
  if (!addr.includes(':')) return 'unknown';
  const [head = '', tail = ''] = addr.split('::', 2);
  const headParts = head === '' ? [] : head.split(':');
  const tailParts = addr.includes('::') && tail !== '' ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  const groups = addr.includes('::') ? [...headParts, ...Array<string>(Math.max(missing, 0)).fill('0'), ...tailParts] : headParts;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return 'unknown';
  return `6:${groups.slice(0, 3).map((g) => g.padStart(4, '0')).join(':')}`;
}

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
  const key = sha256Hex(`${netPrefix(ctx.request.headers.get('CF-Connecting-IP'))}|${salt}`);
  return (await allowed(ctx.env.RL_AUTH, key)) ? null : limited(ctx);
}

/** Per-account limit (RL_AUTH_USER) for route 59, checked before any upstream call. */
export async function limitByUser(ctx: Ctx, username: string): Promise<Response | null> {
  if (!ctx.env.RL_AUTH_USER) return null;
  const salt = await saltFor(ctx);
  const key = sha256Hex(`${normalizeName(username)}|${salt}`);
  return (await allowed(ctx.env.RL_AUTH_USER, key)) ? null : limited(ctx);
}
