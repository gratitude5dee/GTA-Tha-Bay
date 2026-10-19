import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeUsername, syntheticEmail } from '../src/routes/auth.ts';
import { call } from './helpers.ts';

const SB = 'https://sb.test';
const ENV = { SUPABASE_URL: SB, SUPABASE_ANON_KEY: 'anon-test-key' };

function authCall(path: string, init: Parameters<typeof call>[1] = {}) {
  return call(path, { ...init, env: ENV });
}

// The main worker shares this isolate (cloudflare:test SELF docs), so a global fetch stub covers
// its outbound GoTrue calls. Requests are recorded so tests can assert on paths and bodies.
let requests: { url: string; init: RequestInit }[];
let reply: (url: string) => { status: number; body: unknown };
const realFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  reply = () => ({ status: 500, body: { msg: 'unstubbed' } });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, init: init ?? {} });
    const r = reply(url);
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

const SESSION = {
  access_token: 'at-1',
  refresh_token: 'rt-1',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'user-1', user_metadata: { username: 'pilot' } },
};

describe('username mapping', () => {
  it('normalizes and validates usernames', () => {
    expect(normalizeUsername('  Pilot_9 ')).toBe('pilot_9');
    expect(normalizeUsername('ab')).toBe(null);
    expect(normalizeUsername('has space')).toBe(null);
    expect(normalizeUsername(42)).toBe(null);
    expect(syntheticEmail('pilot_9')).toBe('u_pilot_9@player.tha-bay.test');
  });
});

describe('POST /api/v1/auth/signup', () => {
  it('creates an account and returns the session', async () => {
    reply = (url) => (url === `${SB}/auth/v1/signup` ? { status: 200, body: SESSION } : { status: 500, body: {} });
    const res = await authCall('/api/v1/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username: 'Pilot', password: 's3cret' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { username: string }; session: { accessToken: string } };
    expect(body.user.username).toBe('pilot');
    expect(body.session.accessToken).toBe('at-1');
    expect(requests[0]?.url).toBe(`${SB}/auth/v1/signup`);
    const sent = JSON.parse(String(requests[0]?.init.body)) as { email: string; data: { username: string } };
    expect(sent.email).toBe('u_pilot@player.tha-bay.test');
    expect(sent.data.username).toBe('pilot');
  });

  it('maps a taken username to 409 conflict', async () => {
    reply = () => ({ status: 422, body: { msg: 'User already registered' } });
    const res = await authCall('/api/v1/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username: 'pilot', password: 's3cret' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('conflict');
  });

  it('rejects a bad username before calling upstream', async () => {
    const res = await authCall('/api/v1/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username: 'no way', password: 's3cret' }),
    });
    expect(res.status).toBe(400);
    expect(requests.length).toBe(0);
  });

  it('rejects a short password before calling upstream', async () => {
    const res = await authCall('/api/v1/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username: 'pilot', password: 'x' }),
    });
    expect(res.status).toBe(400);
    expect(requests.length).toBe(0);
  });

  it('returns feature_disabled when Supabase is not configured', async () => {
    const res = await call('/api/v1/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username: 'pilot', password: 's3cret' }),
      env: { SUPABASE_URL: '' },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('feature_disabled');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('signs in and returns tokens', async () => {
    reply = (url) =>
      url === `${SB}/auth/v1/token?grant_type=password` ? { status: 200, body: SESSION } : { status: 500, body: {} };
    const res = await authCall('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'pilot', password: 's3cret' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: { refreshToken: string } };
    expect(body.session.refreshToken).toBe('rt-1');
  });

  it('wrong password is 401', async () => {
    reply = () => ({ status: 400, body: { error: 'invalid_grant' } });
    const res = await authCall('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'pilot', password: 'wrong-pass' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/auth/me and POST logout/refresh', () => {
  it('me returns the user for a valid bearer', async () => {
    reply = (url) =>
      url === `${SB}/auth/v1/user`
        ? { status: 200, body: { id: 'user-1', user_metadata: { username: 'pilot' } } }
        : { status: 500, body: {} };
    const res = await authCall('/api/v1/auth/me', { headers: { Authorization: 'Bearer at-1' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { username: string } };
    expect(body.user.username).toBe('pilot');
  });

  it('me without a bearer is 401', async () => {
    const res = await authCall('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(requests.length).toBe(0);
  });

  it('refresh exchanges the refresh token', async () => {
    reply = (url) =>
      url === `${SB}/auth/v1/token?grant_type=refresh_token` ? { status: 200, body: SESSION } : { status: 500, body: {} };
    const res = await authCall('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: 'rt-1' }),
    });
    expect(res.status).toBe(200);
  });

  it('logout calls upstream and returns ok', async () => {
    reply = (url) => (url === `${SB}/auth/v1/logout` ? { status: 200, body: {} } : { status: 500, body: {} });
    const res = await authCall('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer at-1' },
    });
    expect(res.status).toBe(200);
    expect(requests[0]?.url).toBe(`${SB}/auth/v1/logout`);
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
