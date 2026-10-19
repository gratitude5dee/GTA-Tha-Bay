import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgeBracket } from '@dv/shared';
import ipDenylist from '../../../config/ip-denylist.json' with { type: 'json' };
import { TERMS_VERSION } from '../../../config/terms.ts';
import spec03 from '../../../spec/03-decisions-and-facts.md?raw';
import { createApp } from '../src/index.ts';
import type { AdminPath } from '../src/deps.ts';
import type { Env } from '../src/env.ts';
import { ADMIN_PATH, normalizeUsername, syntheticEmail } from '../src/routes/auth.ts';
import { call } from './helpers.ts';
import { ANON_KEY, installGoTrue, SB, SECRET_KEY } from './gotrue-stub.ts';

const ENV: Partial<Env> = {
  SUPABASE_URL: SB,
  SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SECRET_KEY: SECRET_KEY,
  AUTH_PASSWORD_SIGNUP: 'on',
  LEGAL_CONTACT: 'privacy@example.test',
  ENVIRONMENT: 'staging',
  // The real Rate Limiting bindings of the staging config are replaced: tests inject stubs where they need them.
  RL_AUTH: undefined,
  RL_AUTH_USER: undefined,
};

const CREATE_ONLY: AdminPath = { create: true, updateMeta: false, getDelete: false };
const UPDATE_ONLY: AdminPath = { create: false, updateMeta: true, getDelete: false };
const NONE: AdminPath = { create: false, updateMeta: false, getDelete: false };
const ALL: AdminPath = { create: true, updateMeta: true, getDelete: true };

let gt: ReturnType<typeof installGoTrue>;
let logs: string[];
let consoleLines: string[];

function app(adminPath: AdminPath = ALL) {
  return createApp({ adminPath, log: (l) => logs.push(l), now: () => 1_800_000_000_000 });
}

interface ApiOpts {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  env?: Partial<Env>;
  admin?: AdminPath;
  country?: string;
  ip?: string;
  raw?: { body: string; contentType: string };
}

function api(path: string, o: ApiOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { ...o.headers };
  let body: string | undefined;
  if (o.raw) {
    body = o.raw.body;
    headers['content-type'] = o.raw.contentType;
  } else if (o.body !== undefined) {
    body = JSON.stringify(o.body);
    headers['content-type'] = 'application/json';
  }
  if (o.ip) headers['CF-Connecting-IP'] = o.ip;
  return call(path, {
    method: o.method ?? (o.body !== undefined || o.raw ? 'POST' : 'GET'),
    ...(body !== undefined ? { body } : {}),
    headers,
    env: { ...ENV, ...o.env },
    app: app(o.admin),
    ...(o.country ? { country: o.country } : {}),
  });
}

const signupBody = (over: Record<string, unknown> = {}) => ({
  username: 'pilot',
  password: 's3cret-pass',
  ageBracket: '18p',
  termsVersion: TERMS_VERSION,
  ...over,
});

async function errorOf(res: Response): Promise<{ code: string; details?: Record<string, unknown>; retryAfterMs?: number }> {
  return ((await res.json()) as { error: { code: string; details?: Record<string, unknown>; retryAfterMs?: number } }).error;
}

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie') ?? '';
}

function rtFrom(res: Response): string {
  return /dv-rt=([^;]*)/.exec(cookieOf(res))?.[1] ?? '';
}

beforeEach(() => {
  gt = installGoTrue();
  logs = [];
  consoleLines = [];
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void consoleLines.push(a.map(String).join(' ')));
  }
});

afterEach(() => {
  gt.restore();
  vi.restoreAllMocks();
});

describe('username mapping', () => {
  it('normalizes and validates usernames', () => {
    expect(normalizeUsername('  Pilot_9 ')).toBe('pilot_9');
    expect(normalizeUsername('ab')).toBe(null);
    expect(normalizeUsername('has space')).toBe(null);
    expect(normalizeUsername(42)).toBe(null);
    expect(syntheticEmail('pilot_9')).toBe('u_pilot_9@player.tha-bay.test');
  });
});

describe('AC-1 rate limits on the account routes', () => {
  it('the 11th login from one net answers 429 with 0 upstream calls and no address in any log', async () => {
    gt.addUser({ username: 'pilot' });
    const keys: string[] = [];
    let n = 0;
    const RL_AUTH = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: ++n <= 10 }) } as unknown as RateLimit;
    const ip = '203.0.113.77';
    for (let i = 0; i < 10; i++) {
      const res = await api('/api/v1/auth/login', { body: { username: 'pilot', password: 'wrong-pass' }, env: { RL_AUTH }, ip });
      expect(res.status).toBe(401);
    }
    const before = gt.requests.length;
    const res = await api('/api/v1/auth/login', { body: { username: 'pilot', password: 'wrong-pass' }, env: { RL_AUTH }, ip });
    expect(res.status).toBe(429);
    const err = await errorOf(res);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterMs).toBe(60000);
    expect(gt.requests.length).toBe(before);
    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toContain('203');
    }
    for (const line of [...logs, ...consoleLines]) expect(line).not.toContain('203.0.113');
  });

  it('the net key is the same inside one /24 and differs across nets', async () => {
    const keys: string[] = [];
    const RL_AUTH = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) } as unknown as RateLimit;
    for (const ip of ['198.51.100.1', '198.51.100.200', '198.51.101.1', '2001:db8:abcd:1::1', '2001:db8:abcd:2::9', '2001:db8:abce::1']) {
      await api('/api/v1/auth/refresh', { method: 'POST', env: { RL_AUTH }, ip });
    }
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[3]).toBe(keys[4]);
    expect(keys[5]).not.toBe(keys[3]);
  });

  it('the 6th login for one username from 6 different nets answers 429 with 0 upstream calls and no username in any log', async () => {
    gt.addUser({ username: 'pilot' });
    const userKeys: string[] = [];
    const seen = new Map<string, number>();
    const RL_AUTH_USER = {
      limit: async ({ key }: { key: string }) => {
        userKeys.push(key);
        const c = (seen.get(key) ?? 0) + 1;
        seen.set(key, c);
        return { success: c <= 5 };
      },
    } as unknown as RateLimit;
    const statuses: number[] = [];
    let before = 0;
    for (let i = 1; i <= 6; i++) {
      before = gt.requests.length;
      const res = await api('/api/v1/auth/login', {
        body: { username: 'Pilot', password: 'wrong-pass' },
        env: { RL_AUTH_USER },
        ip: `10.0.${i}.9`,
      });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect(gt.requests.length).toBe(before);
    for (const key of userKeys) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toContain('pilot');
    }
    for (const line of [...logs, ...consoleLines]) expect(line.toLowerCase()).not.toContain('pilot');
  });

  it('applies to logout, delete and export as well, and an absent binding allows', async () => {
    const RL_AUTH = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    for (const [method, path] of [['POST', '/api/v1/auth/logout'], ['DELETE', '/api/v1/auth/me'], ['GET', '/api/v1/auth/me/export'], ['POST', '/api/v1/auth/refresh'], ['POST', '/api/v1/auth/signup']] as const) {
      const res = await api(path, { method, env: { RL_AUTH } });
      expect(res.status, path).toBe(429);
    }
    expect((await api('/api/v1/auth/me', { headers: { Authorization: 'Bearer nope' }, env: { RL_AUTH } })).status).toBe(401);
  });

  it('logs the salt SKIP line once when QUOTA_NET_SALT_SECRET is not set', async () => {
    const RL_AUTH = { limit: async () => ({ success: true }) } as unknown as RateLimit;
    const logged: string[] = [];
    const b = createApp({ adminPath: ALL, log: (l) => logged.push(l) });
    for (let i = 0; i < 3; i++) await call('/api/v1/auth/refresh', { method: 'POST', env: { ...ENV, RL_AUTH }, app: b });
    expect(logged.filter((l) => l === 'SKIP auth ratelimit salt: QUOTA_NET_SALT_SECRET not set').length).toBe(1);
  });
});

describe('AC-2 sign-up checks and the stored record', () => {
  it('refuses 13_15, a missing and a stale terms version with 0 upstream calls', async () => {
    const under = await api('/api/v1/auth/signup', { body: signupBody({ ageBracket: '13_15' }) });
    expect(under.status).toBe(403);
    expect((await errorOf(under)).code).toBe('age_blocked');
    const missing = await api('/api/v1/auth/signup', { body: { ...signupBody(), termsVersion: undefined } });
    expect(missing.status).toBe(400);
    const stale = await api('/api/v1/auth/signup', { body: signupBody({ termsVersion: 'interim-0' }) });
    expect(stale.status).toBe(400);
    const noBracket = await api('/api/v1/auth/signup', { body: { ...signupBody(), ageBracket: undefined } });
    expect(noBracket.status).toBe(403);
    expect(gt.requests.length).toBe(0);
  });

  it('creates one user through the admin call with the record in app-level metadata only', async () => {
    const res = await api('/api/v1/auth/signup', { body: signupBody({ username: 'Pilot' }), admin: CREATE_ONLY });
    expect(res.status).toBe(200);
    const user = gt.find('pilot');
    expect(user).toBeDefined();
    expect(user?.app_metadata['ab']).toBe('18p');
    expect(user?.app_metadata['termsVersion']).toBe(TERMS_VERSION);
    expect(user?.app_metadata['acceptedAt']).toBe(1_800_000_000_000);
    expect(user?.user_metadata).toEqual({ username: 'pilot' });
    expect(gt.users.size).toBe(1);
    const create = gt.requests.find((r) => r.path === '/auth/v1/admin/users');
    expect(create?.headers.get('apikey')).toBe(SECRET_KEY);
    expect(create?.headers.has('authorization')).toBe(false);
    for (const r of gt.requests) expect(JSON.stringify(r.body?.['user_metadata'] ?? r.body?.['data'] ?? {})).not.toMatch(/termsVersion|18p|acceptedAt/);
  });
});

describe('AC-3 re-acceptance at sign-in', () => {
  const stale = (over: Record<string, unknown> = {}) => gt.addUser({ username: 'pilot', app_metadata: { ab: '18p', termsVersion: 'interim-0', ...over } });

  it('asks for the attestation when the record is missing or stale, then writes it once', async () => {
    const u = stale();
    const first = await api('/api/v1/auth/login', { body: { username: 'pilot', password: 'correct-horse' } });
    expect(first.status).toBe(403);
    const err = await errorOf(first);
    expect(err.code).toBe('forbidden');
    expect(err.details).toEqual({ reason: 'terms_required', termsVersion: TERMS_VERSION });
    expect(first.headers.get('set-cookie')).toBeNull();
    expect(JSON.stringify(err)).not.toMatch(/at-\d|rt-\d/);

    const second = await api('/api/v1/auth/login', {
      body: { username: 'pilot', password: 'correct-horse', ageBracket: '18p', termsVersion: TERMS_VERSION },
    });
    expect(second.status).toBe(200);
    expect(gt.count('PUT', '/auth/v1/admin/users/')).toBe(1);
    expect(u.app_metadata['termsVersion']).toBe(TERMS_VERSION);
    expect(u.app_metadata['acceptedAt']).toBe(1_800_000_000_000);
    expect(cookieOf(second)).toContain('dv-rt=');

    // A user without any ab at all behaves the same.
    gt.users.clear();
    gt.addUser({ username: 'pilot', app_metadata: {} });
    expect((await api('/api/v1/auth/login', { body: { username: 'pilot', password: 'correct-horse' } })).status).toBe(403);
  });

  it('route 60 refuses a refresh for the same stale user', async () => {
    const u = stale();
    // Mint a refresh token directly through the stub's password grant.
    const grant = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY },
      body: JSON.stringify({ email: u.email, password: u.password }),
    });
    const { refresh_token } = (await grant.json()) as { refresh_token: string };
    const res = await api('/api/v1/auth/refresh', { method: 'POST', headers: { Cookie: `dv-rt=${refresh_token}` } });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).details).toEqual({ reason: 'terms_required', termsVersion: TERMS_VERSION });
    expect(cookieOf(res)).toContain('Max-Age=0');
  });

  it('an under-18 answer deletes the user when the admin path can delete', async () => {
    stale();
    const res = await api('/api/v1/auth/login', {
      body: { username: 'pilot', password: 'correct-horse', ageBracket: '13_15', termsVersion: TERMS_VERSION },
    });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('age_blocked');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(gt.count('DELETE', '/auth/v1/admin/users/')).toBe(1);
    expect(gt.users.size).toBe(0);
  });

  it('without getDelete the bracket is written and a pending-delete line carries only the user id', async () => {
    // With getDelete false the record is unreadable, so the account counts as missing.
    const u = gt.addUser({ username: 'pilot', app_metadata: {} });
    const res = await api('/api/v1/auth/login', {
      admin: UPDATE_ONLY,
      body: { username: 'pilot', password: 'correct-horse', ageBracket: '13_15', termsVersion: TERMS_VERSION },
    });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('age_blocked');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(gt.count('DELETE', '/auth/v1/admin/users/')).toBe(0);
    expect(gt.count('PUT', '/auth/v1/admin/users/')).toBe(1);
    expect(u.app_metadata['ab']).toBe('13_15');
    const pending = logs.filter((l) => l.startsWith('age_blocked_pending_delete'));
    expect(pending).toEqual([`age_blocked_pending_delete user=${u.id}`]);
    for (const l of [...logs, ...consoleLines]) expect(l).not.toContain('pilot');
  });

  it('with an all-false admin path the attestation is asked every time and never stored', async () => {
    gt.addUser({ username: 'pilot', app_metadata: { ab: '18p', termsVersion: TERMS_VERSION } });
    const res = await api('/api/v1/auth/login', {
      admin: NONE,
      body: { username: 'pilot', password: 'correct-horse', ageBracket: '18p', termsVersion: TERMS_VERSION },
    });
    expect(res.status).toBe(200);
    expect(gt.count('PUT', '/auth/v1/admin/users/')).toBe(0);
    expect(gt.count('GET', '/auth/v1/admin/users/')).toBe(0);
    expect(logs.filter((l) => l === 'terms_attested_unstored').length).toBe(1);
    const without = await api('/api/v1/auth/login', { admin: NONE, body: { username: 'pilot', password: 'correct-horse' } });
    expect(without.status).toBe(403);
    // Route 60 with that session's cookie: the record is unreadable, so the cookie suffices.
    const refreshed = await api('/api/v1/auth/refresh', { admin: NONE, method: 'POST', headers: { Cookie: `dv-rt=${rtFrom(res)}` } });
    expect(refreshed.status).toBe(200);
  });

  it('a current record signs in directly and a stale version in the body is a bad request', async () => {
    gt.addUser({ username: 'pilot', app_metadata: { ab: '18p', termsVersion: TERMS_VERSION, acceptedAt: 5 } });
    expect((await api('/api/v1/auth/login', { body: { username: 'pilot', password: 'correct-horse' } })).status).toBe(200);
    gt.users.clear();
    gt.addUser({ username: 'pilot', app_metadata: {} });
    const bad = await api('/api/v1/auth/login', {
      body: { username: 'pilot', password: 'correct-horse', ageBracket: '18p', termsVersion: 'interim-0' },
    });
    expect(bad.status).toBe(400);
    expect(bad.headers.get('set-cookie')).toBeNull();
  });

  it('a wrong password never reaches the record or the deletion', async () => {
    gt.addUser({ username: 'pilot', app_metadata: {} });
    const res = await api('/api/v1/auth/login', {
      body: { username: 'pilot', password: 'wrong-pass', ageBracket: '13_15', termsVersion: TERMS_VERSION },
    });
    expect(res.status).toBe(401);
    expect(gt.count('DELETE', '/auth/v1/admin/users/')).toBe(0);
    expect(gt.users.size).toBe(1);
  });

  it('accepts the 6-character passwords of accounts created before this milestone', async () => {
    gt.addUser({ username: 'oldie', password: 'abc123', app_metadata: { ab: '18p', termsVersion: TERMS_VERSION } });
    expect((await api('/api/v1/auth/login', { body: { username: 'oldie', password: 'abc123' } })).status).toBe(200);
  });
});

describe('AC-4 refresh cookie', () => {
  it('sign-up, sign-in and refresh set an HttpOnly dv-rt and put no refresh token in a body', async () => {
    const signup = await api('/api/v1/auth/signup', { body: signupBody(), admin: CREATE_ONLY });
    expect(signup.status).toBe(200);
    const login = await api('/api/v1/auth/login', {
      body: { username: 'pilot', password: 's3cret-pass', ageBracket: '18p', termsVersion: TERMS_VERSION },
      admin: NONE,
    });
    expect(login.status).toBe(200);
    const refresh = await api('/api/v1/auth/refresh', { method: 'POST', headers: { Cookie: `dv-rt=${rtFrom(login)}` }, admin: NONE });
    expect(refresh.status).toBe(200);
    for (const res of [signup, login, refresh]) {
      const cookie = cookieOf(res);
      expect(cookie).toMatch(/^dv-rt=rt-\d+;/);
      for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/v1/auth', 'Max-Age=2592000']) expect(cookie).toContain(attr);
      const text = await res.text();
      expect(text).not.toMatch(/refresh/i);
      expect(text).not.toContain('rt-');
      const body = JSON.parse(text) as { user: { id: string; username: string }; session: { accessToken: string; expiresIn: number } };
      expect(body.user.username).toBe('pilot');
      expect(body.session.accessToken).toMatch(/^at-/);
      expect(body.session.expiresIn).toBe(3600);
      expect(Object.keys(body.session).sort()).toEqual(['accessToken', 'expiresIn']);
    }
  });

  it('the old refresh token body field is ignored, a missing cookie is 401 and logout clears the cookie', async () => {
    const noCookie = await api('/api/v1/auth/refresh', { method: 'POST', raw: { body: JSON.stringify({ refreshToken: 'rt-1' }), contentType: 'application/json' } });
    expect(noCookie.status).toBe(401);
    expect(gt.requests.length).toBe(0);
    gt.addUser({ username: 'pilot', app_metadata: { ab: '18p', termsVersion: TERMS_VERSION } });
    const login = await api('/api/v1/auth/login', { body: { username: 'pilot', password: 'correct-horse' } });
    const { session } = (await login.json()) as { session: { accessToken: string } };
    const out = await api('/api/v1/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}` } });
    expect(out.status).toBe(200);
    expect(((await out.json()) as { ok: boolean }).ok).toBe(true);
    expect(cookieOf(out)).toMatch(/^dv-rt=;.*Max-Age=0/);
    expect(gt.count('POST', '/auth/v1/logout')).toBe(1);
  });

  it('logout without a bearer is 401 and me returns the user', async () => {
    expect((await api('/api/v1/auth/logout', { method: 'POST' })).status).toBe(401);
    expect((await api('/api/v1/auth/me')).status).toBe(401);
    expect(gt.requests.length).toBe(0);
    gt.addUser({ username: 'pilot', app_metadata: { ab: '18p', termsVersion: TERMS_VERSION } });
    const login = await api('/api/v1/auth/login', { body: { username: 'pilot', password: 'correct-horse' } });
    const { session } = (await login.json()) as { session: { accessToken: string } };
    const me = await api('/api/v1/auth/me', { headers: { Authorization: `Bearer ${session.accessToken}` } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { username: string } }).user.username).toBe('pilot');
  });
});

describe('AC-5 error mapping, body limits, password and username hygiene', () => {
  it('maps an upstream 429, 503 and a weak-password 422', async () => {
    gt.setOverride((r) => (r.path.startsWith('/auth/v1/token') ? { status: 429, body: { msg: 'rate limit' }, headers: { 'Retry-After': '30' } } : undefined));
    const login = await api('/api/v1/auth/login', { body: { username: 'pilot', password: 'whatever1' } });
    expect(login.status).toBe(429);
    const err = await errorOf(login);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterMs).toBe(30000);

    gt.setOverride((r) => (r.path === '/auth/v1/admin/users' ? { status: 503, body: { msg: 'down' } } : undefined));
    const down = await api('/api/v1/auth/signup', { body: signupBody(), admin: CREATE_ONLY });
    expect(down.status).toBe(503);
    expect((await errorOf(down)).code).toBe('upstream_unavailable');

    gt.setOverride((r) => (r.path === '/auth/v1/signup' ? { status: 422, body: { code: 422, error_code: 'weak_password', msg: 'Password is known to be weak' } } : undefined));
    const weak = await api('/api/v1/auth/signup', { body: signupBody(), admin: UPDATE_ONLY });
    expect(weak.status).toBe(400);
    const werr = await errorOf(weak);
    expect(werr.code).toBe('bad_request');
    expect(JSON.stringify(werr)).not.toContain('weak');
  });

  it('maps a taken username to 409 and a non-JSON upstream body to 503', async () => {
    gt.addUser({ username: 'pilot' });
    const taken = await api('/api/v1/auth/signup', { body: signupBody(), admin: CREATE_ONLY });
    expect(taken.status).toBe(409);
    gt.setOverride(() => ({ status: 400, body: undefined }));
    gt.setOverride((r) => (r.path.startsWith('/auth/v1/token') ? { status: 502, body: 'bad gateway' } : undefined));
    expect((await api('/api/v1/auth/login', { body: { username: 'pilot', password: 'whatever1' } })).status).toBe(503);
  });

  it('413 for 9 KiB without Content-Length, 415 for text/plain, 400 for a 7-character password', async () => {
    const big = JSON.stringify({ username: 'pilot', password: 'x'.repeat(9 * 1024) });
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const res = await call('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
      env: ENV,
      app: app(),
    } as RequestInit & { env: Partial<Env>; app: ReturnType<typeof app> });
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe('payload_too_large');

    const plain = await api('/api/v1/auth/signup', { raw: { body: JSON.stringify(signupBody()), contentType: 'text/plain' } });
    expect(plain.status).toBe(415);
    const json = await api('/api/v1/auth/login', { raw: { body: JSON.stringify({ username: 'pilot', password: 'x' }), contentType: 'application/json; charset=utf-8' } });
    expect(json.status).toBe(401);

    const short = await api('/api/v1/auth/signup', { body: signupBody({ password: '1234567' }) });
    expect(short.status).toBe(400);
    expect(gt.requests.filter((r) => r.path === '/auth/v1/admin/users').length).toBe(0);
  });

  it('refuses reserved names, the display name and denylisted terms with 0 upstream calls', async () => {
    const denied = [
      'admin',
      'moderator',
      'deeversethabay',
      (ipDenylist as { terms: string[] }).terms[0]!.replace(/[^a-z0-9]/gi, '').toLowerCase(),
    ];
    for (const name of denied) {
      const res = await api('/api/v1/auth/signup', { body: signupBody({ username: name }) });
      expect(res.status, name).toBe(400);
      expect((await errorOf(res)).code).toBe('bad_request');
    }
    expect(gt.requests.length).toBe(0);
    expect((await api('/api/v1/auth/signup', { body: signupBody({ username: 'ok_name_1' }), admin: CREATE_ONLY })).status).toBe(200);
  });
});

describe('AC-6 the sign-up switch', () => {
  it('off: route 58 is feature_disabled with 0 upstream calls while 59 and 62 work, and boot reports false', async () => {
    gt.addUser({ username: 'pilot', app_metadata: { ab: '18p', termsVersion: TERMS_VERSION } });
    const off: Partial<Env> = { AUTH_PASSWORD_SIGNUP: 'off' };
    const signup = await api('/api/v1/auth/signup', { body: signupBody(), env: off });
    expect(signup.status).toBe(404);
    expect((await errorOf(signup)).code).toBe('feature_disabled');
    expect(gt.requests.length).toBe(0);
    const login = await api('/api/v1/auth/login', { body: { username: 'pilot', password: 'correct-horse' }, env: off });
    expect(login.status).toBe(200);
    const { session } = (await login.json()) as { session: { accessToken: string } };
    expect((await api('/api/v1/auth/me', { headers: { Authorization: `Bearer ${session.accessToken}` }, env: off })).status).toBe(200);
    const boot = (await (await api('/api/v1/boot', { env: off })).json()) as { flags: Record<string, boolean> };
    expect(boot.flags['auth.password']).toBe(false);
  });

  it('on: boot reports true exactly when route 58 would accept a sign-up', async () => {
    const flag = async (env: Partial<Env>, admin: AdminPath): Promise<boolean> =>
      ((await (await api('/api/v1/boot', { env, admin })).json()) as { flags: Record<string, boolean> }).flags['auth.password'] === true;
    expect(await flag({}, CREATE_ONLY)).toBe(true);
    expect(await flag({}, UPDATE_ONLY)).toBe(true);
    expect(await flag({}, NONE)).toBe(false);
    expect(await flag({ LEGAL_CONTACT: undefined }, CREATE_ONLY)).toBe(false);
    expect(await flag({ SUPABASE_SECRET_KEY: undefined }, CREATE_ONLY)).toBe(false);
    expect(await flag({ SUPABASE_URL: undefined }, CREATE_ONLY)).toBe(false);
    expect(await flag({ AUTH_PASSWORD_SIGNUP: 'ON' }, CREATE_ONLY)).toBe(false);
    // FLAGS_JSON cannot turn it on.
    expect(await flag({ FLAGS_JSON: '{"auth.password":true}', AUTH_PASSWORD_SIGNUP: 'off' }, CREATE_ONLY)).toBe(false);
  });

  it('on with create but without LEGAL_CONTACT: route 58 is feature_disabled with 0 upstream calls', async () => {
    const res = await api('/api/v1/auth/signup', { body: signupBody(), admin: CREATE_ONLY, env: { LEGAL_CONTACT: undefined } });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('feature_disabled');
    expect(gt.requests.length).toBe(0);
  });
});

describe('AC-7 admin-path combinations', () => {
  it('create: one admin create call with the metadata and one password grant; the session is the grant', async () => {
    const res = await api('/api/v1/auth/signup', { body: signupBody(), admin: CREATE_ONLY });
    expect(res.status).toBe(200);
    expect(gt.count('POST', '/auth/v1/admin/users')).toBe(1);
    expect(gt.count('POST', '/auth/v1/token?grant_type=password')).toBe(1);
    expect(gt.count('POST', '/auth/v1/signup')).toBe(0);
    const create = gt.requests.find((r) => r.path === '/auth/v1/admin/users');
    expect(create?.body?.['app_metadata']).toMatchObject({ ab: '18p', termsVersion: TERMS_VERSION });
    expect(create?.body?.['email_confirm']).toBe(true);
    const body = (await res.json()) as { session: { accessToken: string } };
    expect(body.session.accessToken).toBe('at-1');
  });

  it('updateMeta only: one public sign-up call and one admin metadata write', async () => {
    const res = await api('/api/v1/auth/signup', { body: signupBody(), admin: UPDATE_ONLY });
    expect(res.status).toBe(200);
    expect(gt.count('POST', '/auth/v1/signup')).toBe(1);
    expect(gt.count('PUT', '/auth/v1/admin/users/')).toBe(1);
    expect(gt.count('POST', '/auth/v1/admin/users')).toBe(0);
    expect(gt.find('pilot')?.app_metadata).toMatchObject({ ab: '18p', termsVersion: TERMS_VERSION, acceptedAt: 1_800_000_000_000 });
  });

  it('updateMeta only: a failed metadata write answers 503, deletes nothing and sets no cookie', async () => {
    gt.setOverride((r) => (r.method === 'PUT' ? { status: 500, body: { msg: 'boom' } } : undefined));
    const res = await api('/api/v1/auth/signup', { body: signupBody(), admin: UPDATE_ONLY });
    expect(res.status).toBe(503);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(gt.count('DELETE', '/auth/v1/admin/users/')).toBe(0);
    expect(gt.users.size).toBe(1);
  });

  it('none: 404 feature_disabled with 0 upstream calls; 13_15 is still 403 age_blocked', async () => {
    const res = await api('/api/v1/auth/signup', { body: signupBody(), admin: NONE });
    expect(res.status).toBe(404);
    expect(gt.requests.length).toBe(0);
    const under = await api('/api/v1/auth/signup', { body: signupBody({ ageBracket: '13_15' as AgeBracket }), admin: NONE });
    expect(under.status).toBe(403);
    expect(gt.requests.length).toBe(0);
  });

  it('without SUPABASE_SECRET_KEY routes 58, 64 and 65 answer feature_disabled', async () => {
    const env: Partial<Env> = { SUPABASE_SECRET_KEY: undefined };
    expect((await api('/api/v1/auth/signup', { body: signupBody(), env })).status).toBe(404);
    expect((await api('/api/v1/auth/me', { method: 'DELETE', headers: { Authorization: 'Bearer at-1' }, env })).status).toBe(404);
    expect((await api('/api/v1/auth/me/export', { headers: { Authorization: 'Bearer at-1' }, env })).status).toBe(404);
    expect(gt.requests.length).toBe(0);
    expect(logs).toContain('SKIP auth signup: SUPABASE_SECRET_KEY not set');
  });

  it('route 64 deletes after one admin delete and route 65 exports from one admin get, also from FR', async () => {
    const u = gt.addUser({ username: 'pilot', app_metadata: { ab: '18p', termsVersion: TERMS_VERSION, acceptedAt: 1234 } });
    const login = await api('/api/v1/auth/login', { body: { username: 'pilot', password: 'correct-horse' } });
    const { session } = (await login.json()) as { session: { accessToken: string } };
    const auth = { Authorization: `Bearer ${session.accessToken}` };

    const getsBefore = gt.count('GET', '/auth/v1/admin/users/');
    const exp = await api('/api/v1/auth/me/export', { headers: auth, country: 'FR' });
    expect(exp.status).toBe(200);
    expect(await exp.json()).toEqual({
      username: 'pilot',
      ageBracket: '18p',
      termsVersion: TERMS_VERSION,
      acceptedAt: 1234,
      createdAt: Date.parse('2026-10-19T00:00:00.000Z'),
    });
    expect(gt.count('GET', '/auth/v1/admin/users/') - getsBefore).toBe(1);

    // GET /auth/me is geo-gated; DELETE is not.
    expect((await api('/api/v1/auth/me', { headers: auth, country: 'FR' })).status).toBe(451);
    const del = await api('/api/v1/auth/me', { method: 'DELETE', headers: auth, country: 'FR' });
    expect(del.status).toBe(204);
    expect(cookieOf(del)).toContain('Max-Age=0');
    expect(gt.count('DELETE', '/auth/v1/admin/users/')).toBe(1);
    expect(gt.users.has(u.id)).toBe(false);
  });

  it('route 65 for an account without a current 18p record answers 403 terms_required', async () => {
    gt.addUser({ username: 'pilot', app_metadata: {} });
    // Sign in with an attestation but without the ability to store it, then export with the full admin path.
    const login = await api('/api/v1/auth/login', {
      admin: NONE,
      body: { username: 'pilot', password: 'correct-horse', ageBracket: '18p', termsVersion: TERMS_VERSION },
    });
    const { session } = (await login.json()) as { session: { accessToken: string } };
    const res = await api('/api/v1/auth/me/export', { headers: { Authorization: `Bearer ${session.accessToken}` }, country: 'FR' });
    expect(res.status).toBe(403);
    const err = await errorOf(res);
    expect(err.code).toBe('forbidden');
    expect(err.details).toEqual({ reason: 'terms_required', termsVersion: TERMS_VERSION });
  });

  it('routes 64 and 65 answer feature_disabled with an admin path that cannot get and delete', async () => {
    expect((await api('/api/v1/auth/me', { method: 'DELETE', headers: { Authorization: 'Bearer at-1' }, admin: CREATE_ONLY })).status).toBe(404);
    expect((await api('/api/v1/auth/me/export', { headers: { Authorization: 'Bearer at-1' }, admin: CREATE_ONLY })).status).toBe(404);
    expect(logs).toContain('SKIP auth delete: admin path not recorded');
  });

  it('the shipped ADMIN_PATH has a member true exactly when spec/03 section 7 holds a row naming it', () => {
    const section = spec03.slice(spec03.indexOf('## 7.'));
    const rows = section.split('\n').filter((l) => l.startsWith('|'));
    for (const member of ['create', 'updateMeta', 'getDelete'] as const) {
      const recorded = rows.some((r) => r.includes(`ADMIN_PATH.${member}`));
      expect(ADMIN_PATH[member], member).toBe(recorded);
    }
  });
});

describe('AC-9 a Supabase bearer opens nothing else', () => {
  it('changes neither status nor body on any other registered route; route 63 is 404 in prod', async () => {
    gt.addUser({ username: 'pilot', app_metadata: { ab: '18p', termsVersion: TERMS_VERSION } });
    const login = await api('/api/v1/auth/login', { body: { username: 'pilot', password: 'correct-horse' } });
    const { session } = (await login.json()) as { session: { accessToken: string } };
    const bearer = { Authorization: `Bearer ${session.accessToken}` };
    const routes: [string, string][] = [
      ['GET', '/api/v1/health'],
      ['GET', '/api/v1/boot'],
      ['POST', '/api/v1/t'],
      ['GET', '/api/v1/genai/status'],
      ['GET', '/api/v1/legal/terms'],
      ['GET', '/api/v1/legal/dmca'],
      ['POST', '/api/v1/reports/browser'],
      ['GET', '/api/v1/cutscenes/nope'],
      ['POST', '/api/v1/admin/cutscenes/prewarm'],
      ['POST', '/api/v1/hooks/fal'],
      ['GET', '/api/v1/nope'],
    ];
    for (const [method, path] of routes) {
      const plain = await api(path, { method, body: method === 'POST' ? {} : undefined });
      const withToken = await api(path, { method, body: method === 'POST' ? {} : undefined, headers: bearer });
      const a = await plain.text();
      const b = await withToken.text();
      expect(withToken.status, path).toBe(plain.status);
      // requestId differs per call; compare the rest.
      const strip = (s: string): string => s.replace(/"requestId":"[^"]*"/g, '');
      expect(strip(b), path).toBe(strip(a));
    }
    expect((await api('/api/v1/genai/status', { env: { ENVIRONMENT: 'prod' } })).status).toBe(404);
    expect((await api('/api/v1/genai/status', { env: { ENVIRONMENT: 'staging' } })).status).toBe(200);
  });
});

describe('/account redirect', () => {
  it('GET /account answers 308 to /account/ without COOP or COEP', async () => {
    const res = await call('/account', { app: app() });
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/account/');
    expect(res.headers.get('cross-origin-opener-policy')).toBeNull();
    expect(res.headers.get('cross-origin-embedder-policy')).toBeNull();
    expect(await res.text()).toBe('');
  });
});

describe('unconfigured Supabase', () => {
  it('returns feature_disabled for sign-in when the project vars are missing', async () => {
    const res = await api('/api/v1/auth/login', { body: { username: 'pilot', password: 'whatever1' }, env: { SUPABASE_URL: undefined, SUPABASE_ANON_KEY: undefined } });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('feature_disabled');
  });
});

describe('GET /api/v1/genai/status', () => {
  it('reports mock mode without a fal key', async () => {
    const res = await call('/api/v1/genai/status', { env: { FAL_MODE: 'mock' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; falConfigured: boolean };
    expect(body.mode).toBe('mock');
    expect(body.falConfigured).toBe(false);
  });

  it('reports configured when FAL_KEY is present', async () => {
    const res = await call('/api/v1/genai/status', { env: { FAL_MODE: 'live', FAL_KEY: 'k' } });
    const body = (await res.json()) as { falConfigured: boolean };
    expect(body.falConfigured).toBe(true);
  });
});
