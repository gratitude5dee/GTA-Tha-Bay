import {
  compileStringMatcher,
  NAME_DISTANCE_THRESHOLD,
  NPC_GUARDRAILS,
  normalisedDistance,
  normalizeName,
  scanText,
  type AgeBracket,
  type IpDenylistConfig,
  type LoginReq,
  type PasswordExportRes,
  type PasswordMeRes,
  type PasswordSessionRes,
  type SignupReq,
  type TermsRequiredDetails,
} from '@dv/shared';
import { DISPLAY_NAME } from '../../../../config/brand.ts';
import denylistJson from '../../../../config/ip-denylist.json' with { type: 'json' };
import { TERMS_VERSION } from '../../../../config/terms.ts';
import { netQuota } from '../budget/quota.ts';
import { nextUtcMidnight } from '../clock.ts';
import type { AdminPath } from '../deps.ts';
import type { Env } from '../env.ts';
import { apiError, json } from '../errors.ts';
import { netHash } from '../id/nethash.ts';
import { limitByNet, limitByUser } from '../ratelimit.ts';
import type { Ctx } from '../router.ts';

/**
 * Username/password accounts over Supabase Auth (GoTrue), conformed to the spec by M00e (ADR-ACCT-01).
 * GoTrue's password grant requires an email, so each username maps to a synthetic address
 * `u_<username>@player.tha-bay.test`; the project runs with mailer_autoconfirm and no mail is ever sent.
 *
 * The browser never calls Supabase. The access token is returned in JSON and kept in page memory; the refresh token
 * travels only in the HttpOnly cookie `dv-rt`. The 18+ attestation and the accepted terms version live only in
 * app-level metadata written through the admin path (`SUPABASE_SECRET_KEY`), never in user-writable metadata (U-ACCT-6).
 * Nothing here logs a password, token, username or network address.
 */

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const SYNTHETIC_DOMAIN = 'player.tha-bay.test';
export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 256;
const BODY_LIMIT = 8192;
const REFRESH_COOKIE = 'dv-rt';
const REFRESH_MAX_AGE_S = 30 * 24 * 60 * 60;
const RETRY_DEFAULT_MS = 60_000;

/**
 * Supabase Auth admin calls recorded as verified in spec/03 section 7 (U-ACCT-3, U-ACCT-6; DL-600, DL-611).
 * A member is true only with a row there that names it; AC-7 compares this constant with those rows.
 */
export const ADMIN_PATH: AdminPath = { create: true, updateMeta: true, getDelete: true };

const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin', 'administrator', 'staff', 'support', 'mod', 'moderator', 'system', 'official', 'root', 'security',
]);

const AGE_BRACKETS: readonly string[] = ['u13', '13_15', '16_17', '18p'];

let denylistMatcher: ReturnType<typeof compileStringMatcher> | null = null;
function denylist(): ReturnType<typeof compileStringMatcher> {
  denylistMatcher ??= compileStringMatcher(denylistJson as unknown as IpDenylistConfig);
  return denylistMatcher;
}

export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().toLowerCase();
  return USERNAME_PATTERN.test(name) ? name : null;
}

export function syntheticEmail(username: string): string {
  return `u_${username}@${SYNTHETIC_DOMAIN}`;
}

/** True when a well-formed username must still be refused: reserved, too close to the display name, or on the denylist. */
export function usernameUnavailable(username: string): boolean {
  if (RESERVED_USERNAMES.has(username)) return true;
  if (normalisedDistance(username, DISPLAY_NAME) < NAME_DISTANCE_THRESHOLD) return true;
  return scanText(normalizeName(username), denylist(), 1).length > 0;
}

// ---------------------------------------------------------------------------------------------
// Supabase access

interface GoTrueUser {
  id?: unknown;
  email?: unknown;
  created_at?: unknown;
  app_metadata?: { ab?: unknown; termsVersion?: unknown; acceptedAt?: unknown };
  user_metadata?: { username?: unknown };
}

interface GoTrueGrant {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  user?: GoTrueUser;
}

function supabaseCfg(env: Env): { url: string; anonKey: string } | null {
  const url = env.SUPABASE_URL?.replace(/\/+$/, '');
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

function adminKey(env: Env): string | null {
  const key = env.SUPABASE_SECRET_KEY;
  return key !== undefined && key.length > 0 ? key : null;
}

/** One Supabase call. `admin` calls carry the secret key on the `apikey` header only (secret keys are not JWTs). Null when the network fails. */
async function sb(env: Env, kind: 'anon' | 'admin', path: string, init: RequestInit = {}): Promise<Response | null> {
  const cfg = supabaseCfg(env);
  if (!cfg) return null;
  const headers = new Headers(init.headers);
  headers.set('apikey', kind === 'admin' ? (adminKey(env) ?? '') : cfg.anonKey);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  try {
    return await fetch(`${cfg.url}${path}`, { ...init, headers });
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function userOf(data: unknown): GoTrueUser | null {
  if (typeof data !== 'object' || data === null) return null;
  const wrapped = (data as { user?: unknown }).user;
  const user = typeof wrapped === 'object' && wrapped !== null ? wrapped : data;
  return user as GoTrueUser;
}

/** Username from the synthetic email (written by the Worker); falls back to the user metadata of older accounts. */
function usernameOf(user: GoTrueUser): string | null {
  if (typeof user.email === 'string') {
    const m = /^u_([a-z0-9_]{3,20})@/.exec(user.email.toLowerCase());
    if (m?.[1] && user.email.toLowerCase().endsWith(`@${SYNTHETIC_DOMAIN}`)) return m[1];
  }
  return normalizeUsername(user.user_metadata?.username);
}

async function readJsonResponse(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// error mapping (item 4)

type ErrorKind = 'signup' | 'login' | 'session' | 'admin';

function retryAfterMs(res: Response): number {
  const seconds = Number(res.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : RETRY_DEFAULT_MS;
}

function userExists(body: Record<string, unknown>): boolean {
  const code = body['error_code'] ?? body['code'];
  const msg = body['msg'] ?? body['message'] ?? body['error_description'];
  return (
    code === 'user_already_exists' ||
    code === 'email_exists' ||
    (typeof msg === 'string' && /already (registered|exists)|has already been registered/i.test(msg))
  );
}

/** Maps a failed upstream answer to the C12 envelope. Upstream text is never echoed. */
export async function upstreamError(res: Response, ctx: Ctx, kind: ErrorKind): Promise<Response> {
  const { requestId } = ctx;
  if (res.status === 429) {
    void res.body?.cancel();
    return apiError('rate_limited', 'Too many attempts. Wait a minute and try again.', requestId, { retryAfterMs: retryAfterMs(res) });
  }
  const parsed = await readJsonResponse(res);
  if (res.status >= 500 || typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return apiError('upstream_unavailable', 'Identity service unavailable.', requestId);
  }
  const body = parsed as Record<string, unknown>;
  if (kind === 'login') {
    if (res.status === 400 || res.status === 401) return apiError('unauthorized', 'Wrong username or password.', requestId);
  } else if (kind === 'session') {
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return apiError('unauthorized', 'Session expired. Sign in again.', requestId);
    }
  } else if (kind === 'signup') {
    if (userExists(body)) return apiError('conflict', 'That username is taken.', requestId);
    if (res.status >= 400) return apiError('bad_request', 'Sign-up rejected.', requestId);
  }
  return apiError('upstream_unavailable', 'Identity service unavailable.', requestId);
}

const unavailable = (ctx: Ctx): Response => apiError('upstream_unavailable', 'Identity service unreachable.', ctx.requestId);
const notConfigured = (ctx: Ctx): Response => apiError('feature_disabled', 'Sign-in is not configured.', ctx.requestId);

function termsRequired(ctx: Ctx): Response {
  const details: TermsRequiredDetails = { reason: 'terms_required', termsVersion: TERMS_VERSION };
  return apiError('forbidden', 'Confirm your age and accept the current terms to continue.', ctx.requestId, {
    details: details as unknown as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------------------------
// request helpers

/** Reads at most BODY_LIMIT bytes whatever Content-Length says (item 5). */
async function readJsonBody(ctx: Ctx): Promise<Record<string, unknown> | Response> {
  const type = (ctx.request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') {
    return apiError('unsupported_media_type', 'Send application/json.', ctx.requestId);
  }
  const stream = ctx.request.body;
  if (!stream) return apiError('bad_request', 'Expected a JSON body.', ctx.requestId);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > BODY_LIMIT) {
      await reader.cancel().catch(() => undefined);
      return apiError('payload_too_large', 'Body too large.', ctx.requestId);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return apiError('bad_request', 'Expected a JSON object.', ctx.requestId);
    }
    return parsed as Record<string, unknown>;
  } catch {
    return apiError('bad_request', 'Expected a JSON body.', ctx.requestId);
  }
}

function bearer(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

const COOKIE_ATTRS = `Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict`;
const TOKEN_CHARS = /^[A-Za-z0-9._~-]{1,512}$/;

function setRefreshCookie(token: string): string {
  return `${REFRESH_COOKIE}=${token}; ${COOKIE_ATTRS}; Max-Age=${REFRESH_MAX_AGE_S}`;
}

function clearRefreshCookie(): string {
  return `${REFRESH_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`;
}

/** The session answer: access token in JSON, refresh token only in the cookie. Null when the grant is malformed. */
function sessionAnswer(grant: unknown, username: string | null): Response | null {
  if (typeof grant !== 'object' || grant === null) return null;
  const g = grant as GoTrueGrant;
  const user = g.user;
  const name = username ?? (user ? usernameOf(user) : null);
  if (
    typeof g.access_token !== 'string' ||
    typeof g.refresh_token !== 'string' ||
    !TOKEN_CHARS.test(g.refresh_token) ||
    typeof g.expires_in !== 'number' ||
    typeof user?.id !== 'string' ||
    name === null
  ) {
    return null;
  }
  const body: PasswordSessionRes = {
    user: { id: user.id, username: name },
    session: { accessToken: g.access_token, expiresIn: g.expires_in },
  };
  return json(body, { headers: { 'Set-Cookie': setRefreshCookie(g.refresh_token) } });
}

// ---------------------------------------------------------------------------------------------
// the age and terms record (items 9 and 15)

interface AccountRecord {
  readable: boolean;
  ab: string | null;
  termsVersion: string | null;
  acceptedAt: number | null;
  createdAt: number | null;
}

const UNREADABLE: AccountRecord = { readable: false, ab: null, termsVersion: null, acceptedAt: null, createdAt: null };

function isCurrent(rec: AccountRecord): boolean {
  return rec.readable && rec.ab === '18p' && rec.termsVersion === TERMS_VERSION;
}

/** Reads the record through the admin get; unreadable without the admin path, the secret key or when the call fails. */
async function readRecord(ctx: Ctx, userId: string): Promise<AccountRecord> {
  if (!ctx.deps.adminPath.getDelete || adminKey(ctx.env) === null || !UUID_RE.test(userId)) return UNREADABLE;
  const res = await sb(ctx.env, 'admin', `/auth/v1/admin/users/${userId}`);
  if (!res || !res.ok) {
    void res?.body?.cancel();
    return UNREADABLE;
  }
  const user = userOf(await readJsonResponse(res));
  if (!user) return UNREADABLE;
  const meta = user.app_metadata ?? {};
  const created = typeof user.created_at === 'string' ? Date.parse(user.created_at) : Number.NaN;
  return {
    readable: true,
    ab: typeof meta.ab === 'string' ? meta.ab : null,
    termsVersion: typeof meta.termsVersion === 'string' ? meta.termsVersion : null,
    acceptedAt: typeof meta.acceptedAt === 'number' ? meta.acceptedAt : null,
    createdAt: Number.isFinite(created) ? created : null,
  };
}

/** Writes app-level metadata through the admin path. True on success. */
async function writeMeta(ctx: Ctx, userId: string, meta: Record<string, unknown>): Promise<boolean> {
  if (!ctx.deps.adminPath.updateMeta || adminKey(ctx.env) === null || !UUID_RE.test(userId)) return false;
  const res = await sb(ctx.env, 'admin', `/auth/v1/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify({ app_metadata: meta }) });
  void res?.body?.cancel();
  return res?.ok === true;
}

async function deleteUser(ctx: Ctx, userId: string): Promise<boolean> {
  if (!ctx.deps.adminPath.getDelete || adminKey(ctx.env) === null || !UUID_RE.test(userId)) return false;
  const res = await sb(ctx.env, 'admin', `/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    body: JSON.stringify({ should_soft_delete: false }),
  });
  void res?.body?.cancel();
  return res?.ok === true;
}

// ---------------------------------------------------------------------------------------------
// the sign-up switch (item 8)

export type SignupBlock = 'switch' | 'contact' | 'supabase' | 'admin' | 'secret';

/** Why route 58 would refuse every sign-up in this environment, or null when it would accept one. */
export function signupBlockedReason(env: Env, adminPath: AdminPath): SignupBlock | null {
  if (env.AUTH_PASSWORD_SIGNUP !== 'on') return 'switch';
  if (!env.LEGAL_CONTACT || env.LEGAL_CONTACT.trim() === '') return 'contact';
  if (supabaseCfg(env) === null) return 'supabase';
  if (!adminPath.create && !adminPath.updateMeta) return 'admin';
  if (adminKey(env) === null) return 'secret';
  return null;
}

// ---------------------------------------------------------------------------------------------
// routes

/**
 * Route 58. Three layers before any upstream call: the per-net rate limit (RL_AUTH), then the exact daily cap of PlayerQuotaDO
 * (3 completed sign-ups per net per UTC day, M06a1 AC-13: a fourth answers 429 `rate_limited` until the next UTC midnight and makes 0 upstream
 * calls), then the body checks. A sign-up counts against the cap only once the upstream has accepted it.
 */
export async function handleSignup(ctx: Ctx): Promise<Response> {
  const limited = await limitByNet(ctx);
  if (limited) return limited;
  const quota = ctx.env.QUOTA ? netQuota(ctx.env, await netHash(ctx.request, ctx.env.QUOTA_NET_SALT_SECRET, ctx.deps.now())) : null;
  if (quota !== null && (await quota.peek('signup', NPC_GUARDRAILS.signupsPerNet)) >= NPC_GUARDRAILS.signupsPerNet) {
    const t = ctx.deps.now();
    return apiError('rate_limited', 'Too many sign-ups from this network today.', ctx.requestId, { retryAfterMs: nextUtcMidnight(t) - t });
  }
  const res = await signupFlow(ctx);
  if (quota !== null && res.ok) await quota.bump('signup');
  return res;
}

async function signupFlow(ctx: Ctx): Promise<Response> {
  const body = await readJsonBody(ctx);
  if (body instanceof Response) return body;

  // Body checks, 0 upstream calls (DL-649 order).
  const username = normalizeUsername(body['username']);
  if (username === null) return apiError('bad_request', 'Username must be 3-20 chars: a-z, 0-9, underscore.', ctx.requestId);
  const password = body['password'];
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return apiError('bad_request', `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.`, ctx.requestId);
  }
  if (usernameUnavailable(username)) return apiError('bad_request', 'That username is not available.', ctx.requestId);
  if (body['ageBracket'] !== '18p') return apiError('age_blocked', 'This service is not available to you.', ctx.requestId);
  if (typeof body['termsVersion'] !== 'string' || body['termsVersion'] !== TERMS_VERSION) {
    return apiError('bad_request', 'Accept the current terms to continue.', ctx.requestId);
  }
  const req: SignupReq = { username, password, ageBracket: '18p', termsVersion: TERMS_VERSION };

  // Availability checks.
  const blocked = signupBlockedReason(ctx.env, ctx.deps.adminPath);
  if (blocked !== null) {
    if (blocked === 'secret') ctx.deps.logOnce('auth-signup-secret', 'SKIP auth signup: SUPABASE_SECRET_KEY not set');
    return blocked === 'supabase' ? notConfigured(ctx) : apiError('feature_disabled', 'Sign-up is not open.', ctx.requestId);
  }

  const record = { ab: '18p', termsVersion: TERMS_VERSION, acceptedAt: ctx.deps.now() };
  const email = syntheticEmail(req.username);

  if (ctx.deps.adminPath.create) {
    const created = await sb(ctx.env, 'admin', '/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password: req.password, email_confirm: true, user_metadata: { username: req.username }, app_metadata: record }),
    });
    if (!created) return unavailable(ctx);
    if (!created.ok) return upstreamError(created, ctx, 'signup');
    void created.body?.cancel();
    const grant = await sb(ctx.env, 'anon', '/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password: req.password }),
    });
    if (!grant) return unavailable(ctx);
    if (!grant.ok) {
      void grant.body?.cancel();
      return unavailable(ctx);
    }
    return sessionAnswer(await readJsonResponse(grant), req.username) ?? unavailable(ctx);
  }

  // updateMeta only: public sign-up (returns the session), then the admin metadata write. A failed write deletes nothing;
  // the account stays without a record and sign-in re-asks (item 15).
  const signup = await sb(ctx.env, 'anon', '/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password: req.password, data: { username: req.username } }),
  });
  if (!signup) return unavailable(ctx);
  if (!signup.ok) return upstreamError(signup, ctx, 'signup');
  const grant: unknown = await readJsonResponse(signup);
  const userId = (grant as GoTrueGrant | null)?.user?.id;
  if (typeof userId !== 'string' || !(await writeMeta(ctx, userId, record))) return unavailable(ctx);
  return sessionAnswer(grant, req.username) ?? unavailable(ctx);
}

/** Route 59. Re-acceptance (item 15) happens here for accounts without a current record. */
export async function handleLogin(ctx: Ctx): Promise<Response> {
  const limited = await limitByNet(ctx);
  if (limited) return limited;
  const body = await readJsonBody(ctx);
  if (body instanceof Response) return body;
  const username = normalizeUsername(body['username']);
  const password = body['password'];
  if (username === null) return apiError('bad_request', 'Username must be 3-20 chars: a-z, 0-9, underscore.', ctx.requestId);
  if (typeof password !== 'string' || password.length === 0 || password.length > PASSWORD_MAX) {
    return apiError('bad_request', `Password must be at most ${PASSWORD_MAX} characters.`, ctx.requestId);
  }
  const bracket = body['ageBracket'];
  const termsVersion = body['termsVersion'];
  if (
    (bracket !== undefined && (typeof bracket !== 'string' || !AGE_BRACKETS.includes(bracket))) ||
    (termsVersion !== undefined && typeof termsVersion !== 'string')
  ) {
    return apiError('bad_request', 'Invalid confirmation.', ctx.requestId);
  }
  const req: LoginReq = {
    username,
    password,
    ...(bracket !== undefined ? { ageBracket: bracket as AgeBracket } : {}),
    ...(termsVersion !== undefined ? { termsVersion: termsVersion as string } : {}),
  };
  const userLimited = await limitByUser(ctx, req.username);
  if (userLimited) return userLimited;
  if (supabaseCfg(ctx.env) === null) return notConfigured(ctx);

  const grantRes = await sb(ctx.env, 'anon', '/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email: syntheticEmail(req.username), password: req.password }),
  });
  if (!grantRes) return unavailable(ctx);
  if (!grantRes.ok) return upstreamError(grantRes, ctx, 'login');
  const grant: unknown = await readJsonResponse(grantRes);
  const userId = (grant as GoTrueGrant | null)?.user?.id;
  if (typeof userId !== 'string') return unavailable(ctx);

  const record = await readRecord(ctx, userId);
  if (!isCurrent(record)) {
    if (req.ageBracket === undefined && req.termsVersion === undefined) return termsRequired(ctx);
    if (req.ageBracket !== '18p') {
      // Under 18 (the password was just checked): delete the account, or mark it and log the opaque id for the runbook (DL-612, DL-636).
      if (req.ageBracket === undefined) return apiError('bad_request', 'Invalid confirmation.', ctx.requestId);
      if (!(await deleteUser(ctx, userId))) {
        await writeMeta(ctx, userId, { ab: req.ageBracket });
        ctx.deps.log(`age_blocked_pending_delete user=${userId}`);
      }
      return apiError('age_blocked', 'This service is not available to you.', ctx.requestId);
    }
    if (req.termsVersion !== TERMS_VERSION) return apiError('bad_request', 'Accept the current terms to continue.', ctx.requestId);
    const stored = await writeMeta(ctx, userId, { ab: '18p', termsVersion: TERMS_VERSION, acceptedAt: ctx.deps.now() });
    if (!stored) ctx.deps.log('terms_attested_unstored');
  }
  return sessionAnswer(grant, req.username) ?? unavailable(ctx);
}

/** Route 60. The refresh token comes only from the `dv-rt` cookie; there is no body. */
export async function handleRefresh(ctx: Ctx): Promise<Response> {
  const limited = await limitByNet(ctx);
  if (limited) return limited;
  const token = cookieValue(ctx.request, REFRESH_COOKIE);
  if (token === null || !TOKEN_CHARS.test(token)) return apiError('unauthorized', 'Session expired. Sign in again.', ctx.requestId);
  if (supabaseCfg(ctx.env) === null) return notConfigured(ctx);
  const res = await sb(ctx.env, 'anon', '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: token }),
  });
  if (!res) return unavailable(ctx);
  if (!res.ok) return upstreamError(res, ctx, 'session');
  const grant: unknown = await readJsonResponse(res);
  const userId = (grant as GoTrueGrant | null)?.user?.id;
  if (typeof userId !== 'string') return unavailable(ctx);
  // Readable and missing or stale: refuse. Unreadable: the cookie suffices, since only routes 58 and 59 set it after an attestation.
  const record = await readRecord(ctx, userId);
  if (record.readable && !isCurrent(record)) {
    const refused = termsRequired(ctx);
    refused.headers.set('Set-Cookie', clearRefreshCookie());
    return refused;
  }
  return sessionAnswer(grant, null) ?? unavailable(ctx);
}

/** Route 61. Clears the cookie whatever the upstream says. */
export async function handleLogout(ctx: Ctx): Promise<Response> {
  const limited = await limitByNet(ctx);
  if (limited) return limited;
  const token = bearer(ctx.request);
  if (!token) return apiError('unauthorized', 'Missing access token.', ctx.requestId);
  if (supabaseCfg(ctx.env) === null) return notConfigured(ctx);
  const res = await sb(ctx.env, 'anon', '/auth/v1/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (!res) return unavailable(ctx);
  void res.body?.cancel(); // GoTrue answers 204 on success and 4xx for a dead token; the local session drops either way.
  return json({ ok: true }, { headers: { 'Set-Cookie': clearRefreshCookie() } });
}

/** Looks up the user behind an access token. */
async function userForToken(ctx: Ctx, token: string): Promise<GoTrueUser | Response> {
  const res = await sb(ctx.env, 'anon', '/auth/v1/user', { headers: { Authorization: `Bearer ${token}` } });
  if (!res) return unavailable(ctx);
  if (!res.ok) return upstreamError(res, ctx, 'session');
  const user = userOf(await readJsonResponse(res));
  return user && typeof user.id === 'string' ? user : unavailable(ctx);
}

/** Route 62. */
export async function handleMe(ctx: Ctx): Promise<Response> {
  const token = bearer(ctx.request);
  if (!token) return apiError('unauthorized', 'Missing access token.', ctx.requestId);
  if (supabaseCfg(ctx.env) === null) return notConfigured(ctx);
  const user = await userForToken(ctx, token);
  if (user instanceof Response) return user;
  const username = usernameOf(user);
  if (username === null || typeof user.id !== 'string') return unavailable(ctx);
  const out: PasswordMeRes = { user: { id: user.id, username } };
  return json(out);
}

/** Routes 64 and 65 need the admin get and delete, a configured project and the secret key. */
function adminDisabled(ctx: Ctx, what: string): Response | null {
  if (supabaseCfg(ctx.env) === null) return notConfigured(ctx);
  if (!ctx.deps.adminPath.getDelete) {
    ctx.deps.logOnce(`auth-${what}-admin`, `SKIP auth ${what}: admin path not recorded`);
    return apiError('feature_disabled', 'This is not available yet. Use the contact in the privacy notice.', ctx.requestId);
  }
  if (adminKey(ctx.env) === null) {
    ctx.deps.logOnce(`auth-${what}-secret`, `SKIP auth ${what}: SUPABASE_SECRET_KEY not set`);
    return apiError('feature_disabled', 'This is not available yet. Use the contact in the privacy notice.', ctx.requestId);
  }
  return null;
}

/** Route 64: delete the Supabase user behind the access token. */
export async function handleDeleteMe(ctx: Ctx): Promise<Response> {
  const limited = await limitByNet(ctx);
  if (limited) return limited;
  const disabled = adminDisabled(ctx, 'delete');
  if (disabled) return disabled;
  const token = bearer(ctx.request);
  if (!token) return apiError('unauthorized', 'Missing access token.', ctx.requestId);
  const user = await userForToken(ctx, token);
  if (user instanceof Response) return user;
  if (typeof user.id !== 'string' || !UUID_RE.test(user.id)) return unavailable(ctx);
  const res = await sb(ctx.env, 'admin', `/auth/v1/admin/users/${user.id}`, {
    method: 'DELETE',
    body: JSON.stringify({ should_soft_delete: false }),
  });
  if (!res) return unavailable(ctx);
  if (!res.ok) return upstreamError(res, ctx, 'admin');
  void res.body?.cancel();
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': clearRefreshCookie() } });
}

/** Route 65: the stored record of the account. */
export async function handleExportMe(ctx: Ctx): Promise<Response> {
  const limited = await limitByNet(ctx);
  if (limited) return limited;
  const disabled = adminDisabled(ctx, 'export');
  if (disabled) return disabled;
  const token = bearer(ctx.request);
  if (!token) return apiError('unauthorized', 'Missing access token.', ctx.requestId);
  const user = await userForToken(ctx, token);
  if (user instanceof Response) return user;
  const username = usernameOf(user);
  if (typeof user.id !== 'string' || username === null) return unavailable(ctx);
  const record = await readRecord(ctx, user.id);
  if (!record.readable) return unavailable(ctx);
  // No field is ever invented: a record that is not a complete 18p record answers terms_required (DL-639).
  if (record.ab !== '18p' || record.termsVersion === null || record.acceptedAt === null || record.createdAt === null) {
    return termsRequired(ctx);
  }
  const out: PasswordExportRes = {
    username,
    ageBracket: '18p',
    termsVersion: record.termsVersion,
    acceptedAt: record.acceptedAt,
    createdAt: record.createdAt,
  };
  return json(out);
}

