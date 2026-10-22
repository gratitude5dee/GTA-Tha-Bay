import type { PlayTokenClaims, PlayTokenReq, PlayTokenRes } from '@dv/shared';
import type { Env } from '../env.ts';
import { apiError, json } from '../errors.ts';
import type { Ctx } from '../router.ts';

/**
 * Route 5, `POST /api/v1/id/play-token`: the stateless P0 play-token mint (M04b3, DL-182). Trust-on-first-use binding of the
 * device key to the profile id arrives with M06a1; here the proof only shows that the caller holds the key it posted.
 *
 * Secret format (BD-M04b3-01): `PLAY_TOKEN_HMAC = "<kid>:<base64url of 32 bytes>"`; `PLAY_TOKEN_HMAC_PREV` has the same
 * format and verifies only. Nothing here logs a profile id, thumbprint, key or token.
 */

export const PLAY_TOKEN_TTL_MS = 86_400_000;
export const PROOF_SKEW_MS = 120_000;
const BODY_LIMIT = 4096;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const encoder = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Uint8Array | null {
  if (!B64URL.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

interface Keyring {
  kid: string;
  key: CryptoKey;
}

async function parseKeyring(raw: string | undefined): Promise<Keyring | null> {
  if (!raw) return null;
  const at = raw.indexOf(':');
  if (at < 1) return null;
  const kid = raw.slice(0, at);
  const bytes = b64urlDecode(raw.slice(at + 1));
  if (!bytes || bytes.length < 16) return null;
  const key = await crypto.subtle.importKey('raw', bytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return { kid, key };
}

type SecretEnv = Pick<Env, 'PLAY_TOKEN_HMAC' | 'PLAY_TOKEN_HMAC_PREV'>;

/** Hand validator of the body schema (BD-M00a-02 pattern: no runtime ajv.compile on Workers, DL-694). */
export function parseRequest(value: unknown): PlayTokenReq | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (keys.length !== 5 || !['pid', 'jwk', 'ts', 'sig', 'age'].every((k) => keys.includes(k))) return null;
  if (typeof v.pid !== 'string' || !UUID_PATTERN.test(v.pid)) return null;
  if (typeof v.ts !== 'number' || !Number.isFinite(v.ts)) return null;
  if (typeof v.sig !== 'string' || v.sig.length > 200 || !B64URL.test(v.sig)) return null;
  if (typeof v.age !== 'string') return null;
  const jwk = v.jwk;
  if (typeof jwk !== 'object' || jwk === null || Array.isArray(jwk)) return null;
  const j = jwk as Record<string, unknown>;
  if (j.kty !== 'EC' || j.crv !== 'P-256') return null;
  if (typeof j.x !== 'string' || typeof j.y !== 'string' || j.x.length > 64 || j.y.length > 64) return null;
  if (!B64URL.test(j.x) || !B64URL.test(j.y)) return null;
  return { pid: v.pid, jwk: j as PlayTokenReq['jwk'], ts: v.ts, sig: v.sig, age: v.age as '18p' };
}

/** RFC 7638: base64url SHA-256 of the required members in lexical order. */
export async function jwkThumbprint(jwk: { crv?: string; kty?: string; x?: string; y?: string }): Promise<string> {
  const text = `{"crv":${JSON.stringify(jwk.crv)},"kty":${JSON.stringify(jwk.kty)},"x":${JSON.stringify(jwk.x)},"y":${JSON.stringify(jwk.y)}}`;
  return b64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}

async function hmac(key: CryptoKey, data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

/** Issues `pt1.<claims>.<mac>` for the claims. Returns null when the secret is absent or malformed. */
export async function mint(env: SecretEnv, claims: Omit<PlayTokenClaims, 'kid' | 'v'>): Promise<string | null> {
  const ring = await parseKeyring(env.PLAY_TOKEN_HMAC);
  if (!ring) return null;
  const full: PlayTokenClaims = { v: 1, ...claims, kid: ring.kid };
  const head = `pt1.${b64urlEncode(encoder.encode(JSON.stringify(full)))}`;
  return `${head}.${b64urlEncode(await hmac(ring.key, head))}`;
}

/** Verifies the MAC under the key named by `kid` (current or PREV) and the expiry; returns the claims or null. */
export async function verify(env: SecretEnv, token: string, now: number = Date.now()): Promise<PlayTokenClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'pt1') return null;
  const body = b64urlDecode(parts[1]!);
  const mac = b64urlDecode(parts[2]!);
  if (!body || !mac) return null;
  let claims: PlayTokenClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(body)) as PlayTokenClaims;
  } catch {
    return null;
  }
  if (typeof claims !== 'object' || claims === null || claims.v !== 1 || claims.age !== '18p') return null;
  if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number' || claims.exp <= now) return null;
  for (const raw of [env.PLAY_TOKEN_HMAC, env.PLAY_TOKEN_HMAC_PREV]) {
    const ring = await parseKeyring(raw);
    if (ring && ring.kid === claims.kid) {
      const ok = await crypto.subtle.verify('HMAC', ring.key, mac as BufferSource, encoder.encode(`${parts[0]}.${parts[1]}`));
      return ok ? claims : null;
    }
  }
  return null;
}

let skipLogged = false;
/** Test hook: lets a suite see the once-per-isolate SKIP line again. */
export function resetSkipLog(): void {
  skipLogged = false;
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length === 0 || text.length > BODY_LIMIT) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function handlePlayToken(ctx: Ctx): Promise<Response> {
  const { request, env, requestId } = ctx;
  const bad = (message: string): Response => apiError('bad_request', message, requestId);
  const req = parseRequest(await readBody(request));
  if (!req) return bad('Invalid play-token request.');
  if (req.age !== '18p') return apiError('age_blocked', 'Online features need an 18+ attestation.', requestId);
  const now = Date.now();
  if (Math.abs(now - req.ts) > PROOF_SKEW_MS) return bad('Proof timestamp out of range.');
  const sigBytes = b64urlDecode(req.sig);
  if (!sigBytes || sigBytes.length !== 64) return bad('Invalid proof signature.');
  let verified = false;
  try {
    const pub = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: req.jwk.x as string, y: req.jwk.y as string },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sigBytes as BufferSource, encoder.encode(`pt-req|${req.pid}|${req.ts}`));
  } catch {
    verified = false;
  }
  if (!verified) return bad('Invalid proof signature.');
  const dkt = await jwkThumbprint(req.jwk);
  const exp = now + PLAY_TOKEN_TTL_MS;
  const token = await mint(env, { pid: req.pid, dkt, age: '18p', iat: now, exp });
  if (token === null) {
    if (!skipLogged) {
      skipLogged = true;
      console.log('SKIP play-token: PLAY_TOKEN_HMAC not set');
    }
    return apiError('upstream_unavailable', 'Play tokens are not available.', requestId);
  }
  const res: PlayTokenRes = { token, exp };
  return json(res);
}
