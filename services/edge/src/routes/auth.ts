import { apiError, json } from '../errors.ts';
import type { Env } from '../env.ts';
import type { Ctx } from '../router.ts';

/**
 * Username/password accounts over Supabase Auth (GoTrue), ahead of the M05d data spine and M12a
 * identity spine. GoTrue's password grant requires an email, so each username maps to a synthetic
 * address `u_<username>@player.tha-bay.test`; the project runs with mailer_autoconfirm so no mail
 * is ever sent and sign-up returns a session immediately. Third-party sign-in providers (OpenAI,
 * Hermes, OpenClaw, Thirdweb) attach later under the auth.openaiWeb / auth.thirdweb flags.
 */

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const SYNTHETIC_DOMAIN = 'player.tha-bay.test';
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 256;
const BODY_LIMIT = 8 * 1024;

export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().toLowerCase();
  return USERNAME_PATTERN.test(name) ? name : null;
}

export function syntheticEmail(username: string): string {
  return `u_${username}@${SYNTHETIC_DOMAIN}`;
}

interface GoTrueUser {
  id?: unknown;
  user_metadata?: { username?: unknown };
  confirmed_at?: unknown;
  email_confirmed_at?: unknown;
}

interface GoTrueSession {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
  user?: GoTrueUser;
}

function supabaseEnv(env: Env): { url: string; anonKey: string } | null {
  const url = env.SUPABASE_URL?.replace(/\/+$/, '');
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

async function gotrue(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const cfg = supabaseEnv(env);
  if (!cfg) throw new AuthUnconfigured();
  const headers = new Headers(init.headers);
  headers.set('apikey', cfg.anonKey);
  if (!headers.has('Content-Type') && init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${cfg.url}${path}`, { ...init, headers });
}

export class AuthUnconfigured extends Error {}

function sessionBody(data: GoTrueSession, username: string | null): Record<string, unknown> {
  const metaUsername = data.user?.user_metadata?.username;
  return {
    user: {
      id: typeof data.user?.id === 'string' ? data.user.id : null,
      username: username ?? (typeof metaUsername === 'string' ? metaUsername : null),
    },
    session: {
      accessToken: typeof data.access_token === 'string' ? data.access_token : null,
      refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
      expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
      tokenType: typeof data.token_type === 'string' ? data.token_type : null,
    },
  };
}

async function readJsonBody(ctx: Ctx): Promise<Record<string, unknown> | Response> {
  const length = Number(ctx.request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > BODY_LIMIT) {
    return apiError('payload_too_large', 'Body too large.', ctx.requestId);
  }
  try {
    const parsed: unknown = await ctx.request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return apiError('bad_request', 'Expected a JSON object.', ctx.requestId);
    }
    return parsed as Record<string, unknown>;
  } catch {
    return apiError('bad_request', 'Expected a JSON body.', ctx.requestId);
  }
}

async function postCredentials(
  ctx: Ctx,
  requestId: string,
): Promise<{ username: string; password: string } | Response> {
  const body = await readJsonBody(ctx);
  if (body instanceof Response) return body;
  const username = normalizeUsername(body['username']);
  const password = body['password'];
  if (username === null) {
    return apiError('bad_request', 'Username must be 3-20 chars: a-z, 0-9, underscore.', requestId);
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return apiError('bad_request', `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.`, requestId);
  }
  return { username, password };
}

export async function handleSignup(ctx: Ctx): Promise<Response> {
  const creds = await postCredentials(ctx, ctx.requestId);
  if (creds instanceof Response) return creds;
  let res: Response;
  try {
    res = await gotrue(ctx.env, '/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({
        email: syntheticEmail(creds.username),
        password: creds.password,
        data: { username: creds.username },
      }),
    });
  } catch (e) {
    if (e instanceof AuthUnconfigured) {
      return apiError('feature_disabled', 'Sign-in is not configured.', ctx.requestId);
    }
    return apiError('upstream_unavailable', 'Identity service unreachable.', ctx.requestId);
  }
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 422 || /already|exists|registered/i.test(text)) {
      return apiError('conflict', 'That username is taken.', ctx.requestId);
    }
    if (res.status === 400 || /password/i.test(text)) {
      return apiError('bad_request', 'Sign-up rejected by identity service.', ctx.requestId);
    }
    return apiError('upstream_unavailable', 'Identity service error.', ctx.requestId);
  }
  const data = (await res.json()) as GoTrueSession;
  return json(sessionBody(data, creds.username));
}

export async function handleLogin(ctx: Ctx): Promise<Response> {
  const creds = await postCredentials(ctx, ctx.requestId);
  if (creds instanceof Response) return creds;
  let res: Response;
  try {
    res = await gotrue(ctx.env, '/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: syntheticEmail(creds.username), password: creds.password }),
    });
  } catch (e) {
    if (e instanceof AuthUnconfigured) {
      return apiError('feature_disabled', 'Sign-in is not configured.', ctx.requestId);
    }
    return apiError('upstream_unavailable', 'Identity service unreachable.', ctx.requestId);
  }
  if (!res.ok) {
    return apiError('unauthorized', 'Wrong username or password.', ctx.requestId);
  }
  const data = (await res.json()) as GoTrueSession;
  return json(sessionBody(data, creds.username));
}

export async function handleRefresh(ctx: Ctx): Promise<Response> {
  const body = await readJsonBody(ctx);
  if (body instanceof Response) return body;
  const refreshToken = body['refreshToken'];
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    return apiError('bad_request', 'Missing refreshToken.', ctx.requestId);
  }
  let res: Response;
  try {
    res = await gotrue(ctx.env, '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch (e) {
    if (e instanceof AuthUnconfigured) {
      return apiError('feature_disabled', 'Sign-in is not configured.', ctx.requestId);
    }
    return apiError('upstream_unavailable', 'Identity service unreachable.', ctx.requestId);
  }
  if (!res.ok) return apiError('unauthorized', 'Session expired. Sign in again.', ctx.requestId);
  const data = (await res.json()) as GoTrueSession;
  return json(sessionBody(data, null));
}

function bearer(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export async function handleMe(ctx: Ctx): Promise<Response> {
  const token = bearer(ctx.request);
  if (!token) return apiError('unauthorized', 'Missing access token.', ctx.requestId);
  let res: Response;
  try {
    res = await gotrue(ctx.env, '/auth/v1/user', { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    if (e instanceof AuthUnconfigured) {
      return apiError('feature_disabled', 'Sign-in is not configured.', ctx.requestId);
    }
    return apiError('upstream_unavailable', 'Identity service unreachable.', ctx.requestId);
  }
  if (!res.ok) return apiError('unauthorized', 'Session expired. Sign in again.', ctx.requestId);
  const user = (await res.json()) as GoTrueUser;
  const metaUsername = user.user_metadata?.username;
  return json({
    user: {
      id: typeof user.id === 'string' ? user.id : null,
      username: typeof metaUsername === 'string' ? metaUsername : null,
    },
  });
}

export async function handleLogout(ctx: Ctx): Promise<Response> {
  const token = bearer(ctx.request);
  if (!token) return apiError('unauthorized', 'Missing access token.', ctx.requestId);
  try {
    const res = await gotrue(ctx.env, '/auth/v1/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    void res; // GoTrue returns 204 on success and 200/4xx otherwise; the local session drops either way.
  } catch (e) {
    if (e instanceof AuthUnconfigured) {
      return apiError('feature_disabled', 'Sign-in is not configured.', ctx.requestId);
    }
    return apiError('upstream_unavailable', 'Identity service unreachable.', ctx.requestId);
  }
  return json({ ok: true });
}
