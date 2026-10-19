import { vi } from 'vitest';

/**
 * A small in-memory stand-in for Supabase Auth (GoTrue) used by the account tests (M00e). The Worker under test shares the
 * isolate with the tests, so a stubbed global `fetch` covers its outbound calls. No test ever reaches the live project.
 */

export const SB = 'https://sb.test';
export const ANON_KEY = 'anon-test-key';
export const SECRET_KEY = 'sb_secret_test';

export interface StubUser {
  id: string;
  email: string;
  password: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  created_at: string;
}

export interface Recorded {
  method: string;
  path: string;
  headers: Headers;
  body: Record<string, unknown> | null;
}

export type Override = (req: Recorded) => { status: number; body?: unknown; headers?: Record<string, string> } | undefined;

let seq = 0;
export function uuid(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

export function installGoTrue(): {
  users: Map<string, StubUser>;
  requests: Recorded[];
  setOverride: (fn: Override | undefined) => void;
  addUser: (u: Partial<StubUser> & { username: string; password?: string }) => StubUser;
  find: (username: string) => StubUser | undefined;
  count: (method: string, pathPrefix: string) => number;
  restore: () => void;
} {
  const users = new Map<string, StubUser>();
  const requests: Recorded[] = [];
  const access = new Map<string, string>();
  const refresh = new Map<string, string>();
  let override: Override | undefined;
  let tokenSeq = 0;

  const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}): Response =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  const publicUser = (u: StubUser) => ({ id: u.id, email: u.email, created_at: u.created_at, app_metadata: u.app_metadata, user_metadata: u.user_metadata });

  const grant = (u: StubUser) => {
    tokenSeq += 1;
    const at = `at-${tokenSeq}`;
    const rt = `rt-${tokenSeq}`;
    access.set(at, u.id);
    refresh.set(rt, u.id);
    return { access_token: at, refresh_token: rt, expires_in: 3600, token_type: 'bearer', user: publicUser(u) };
  };

  const byEmail = (email: string): StubUser | undefined => [...users.values()].find((u) => u.email === email);

  const addUser: ReturnType<typeof installGoTrue>['addUser'] = (u) => {
    const user: StubUser = {
      id: u.id ?? uuid(),
      email: u.email ?? `u_${u.username}@player.tha-bay.test`,
      password: u.password ?? 'correct-horse',
      app_metadata: u.app_metadata ?? {},
      user_metadata: u.user_metadata ?? { username: u.username },
      created_at: u.created_at ?? '2026-10-19T00:00:00.000Z',
    };
    users.set(user.id, user);
    return user;
  };

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    const headers = new Headers(init?.headers);
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === 'string' && init.body.length > 0) body = JSON.parse(init.body) as Record<string, unknown>;
    const rec: Recorded = { method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname + url.search, headers, body };
    requests.push(rec);
    if (!href.startsWith(SB)) return reply(500, { msg: 'unexpected host' });
    const forced = override?.(rec);
    if (forced) return reply(forced.status, forced.body ?? {}, forced.headers ?? {});

    const isAdmin = url.pathname.startsWith('/auth/v1/admin/');
    if (isAdmin && headers.get('apikey') !== SECRET_KEY) return reply(401, { msg: 'invalid key' });
    if (isAdmin && headers.has('authorization')) return reply(401, { msg: 'secret keys are not bearer tokens' });
    if (!isAdmin && headers.get('apikey') !== ANON_KEY) return reply(401, { msg: 'invalid key' });

    const p = url.pathname;
    if (rec.method === 'POST' && p === '/auth/v1/admin/users') {
      const email = String(body?.['email']);
      if (byEmail(email)) return reply(422, { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' });
      const u = addUser({
        username: String((body?.['user_metadata'] as { username?: string } | undefined)?.username ?? 'x'),
        email,
        password: String(body?.['password']),
        app_metadata: (body?.['app_metadata'] as Record<string, unknown> | undefined) ?? {},
        user_metadata: (body?.['user_metadata'] as Record<string, unknown> | undefined) ?? {},
      });
      return reply(200, publicUser(u));
    }
    const adminId = /^\/auth\/v1\/admin\/users\/([^/]+)$/.exec(p)?.[1];
    if (adminId) {
      const u = users.get(adminId);
      if (!u) return reply(404, { msg: 'User not found' });
      if (rec.method === 'GET') return reply(200, publicUser(u));
      if (rec.method === 'PUT') {
        u.app_metadata = { ...u.app_metadata, ...((body?.['app_metadata'] as Record<string, unknown> | undefined) ?? {}) };
        return reply(200, publicUser(u));
      }
      if (rec.method === 'DELETE') {
        users.delete(adminId);
        return reply(200, {});
      }
    }
    if (rec.method === 'POST' && p === '/auth/v1/signup') {
      const email = String(body?.['email']);
      if (byEmail(email)) return reply(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      if (String(body?.['password']).length < 6) return reply(422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
      const u = addUser({
        username: 'x',
        email,
        password: String(body?.['password']),
        app_metadata: { provider: 'email' },
        user_metadata: (body?.['data'] as Record<string, unknown> | undefined) ?? {},
      });
      return reply(200, grant(u));
    }
    if (rec.method === 'POST' && p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const u = byEmail(String(body?.['email']));
      if (!u || u.password !== body?.['password']) return reply(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return reply(200, grant(u));
    }
    if (rec.method === 'POST' && p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const id = refresh.get(String(body?.['refresh_token']));
      const u = id ? users.get(id) : undefined;
      if (!u) return reply(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      refresh.delete(String(body?.['refresh_token']));
      return reply(200, grant(u));
    }
    if (rec.method === 'GET' && p === '/auth/v1/user') {
      const token = headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
      const id = access.get(token);
      const u = id ? users.get(id) : undefined;
      return u ? reply(200, publicUser(u)) : reply(401, { code: 401, msg: 'invalid JWT' });
    }
    if (rec.method === 'POST' && p === '/auth/v1/logout') return reply(204);
    return reply(404, { msg: `unstubbed ${rec.method} ${p}` });
  });

  return {
    users,
    requests,
    setOverride: (fn) => {
      override = fn;
    },
    addUser,
    find: (username) => [...users.values()].find((u) => u.email === `u_${username}@player.tha-bay.test`),
    count: (method, pathPrefix) => requests.filter((r) => r.method === method && r.path.startsWith(pathPrefix)).length,
    restore: () => vi.unstubAllGlobals(),
  };
}
