import { sha256Hex } from '@dv/shared';
import { utcDay } from '../clock.ts';

/**
 * The network key shared by every per-net control (M06a1; M00e's rate-limit helper used the same recipe and now imports this file):
 * SHA-256 of the client /24 (IPv4) or /48 (IPv6) prefix and a salt that rotates each UTC day. The salt is the HMAC-SHA-256 of the UTC day under
 * `QUOTA_NET_SALT_SECRET` (the day alone when the secret is absent, so a local run still works). The raw address is never stored or logged.
 */

const enc = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
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

/** The net hash of a request's client address for the UTC day containing `nowMs`. */
export async function netHash(request: Request, secret: string | undefined, nowMs: number): Promise<string> {
  return netHashOf(request.headers.get('CF-Connecting-IP'), await dailySalt(secret, nowMs));
}

/** The net hash of an address and a salt (already derived). */
export function netHashOf(ip: string | null, salt: string): string {
  return sha256Hex(`${netPrefix(ip)}|${salt}`);
}
