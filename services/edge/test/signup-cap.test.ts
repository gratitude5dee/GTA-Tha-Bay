import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TERMS_VERSION } from '../../../config/terms.ts';
import type { AdminPath } from '../src/deps.ts';
import type { Env } from '../src/env.ts';
import { createApp } from '../src/index.ts';
import { call } from './helpers.ts';
import { ANON_KEY, installGoTrue, SB, SECRET_KEY } from './gotrue-stub.ts';
import { harness, type Harness } from './npc-helpers.ts';

// AC-13: route 58 completes at most 3 sign-ups per network per UTC day (PlayerQuotaDO q:n:<netHash>); the 4th is 429 with 0 upstream calls.
const CREATE_ONLY: AdminPath = { create: true, updateMeta: false, getDelete: false };
const ENV: Partial<Env> = {
  SUPABASE_URL: SB,
  SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SECRET_KEY: SECRET_KEY,
  AUTH_PASSWORD_SIGNUP: 'on',
  LEGAL_CONTACT: 'privacy@example.test',
  ENVIRONMENT: 'staging',
  RL_AUTH: undefined,
  RL_AUTH_USER: undefined,
};

let h: Harness;
let gt: ReturnType<typeof installGoTrue>;
beforeEach(() => {
  h = harness();
  gt = installGoTrue();
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
afterEach(() => {
  gt.restore();
  vi.restoreAllMocks();
  h.dispose();
});

function signup(username: string, ip: string, over: Record<string, unknown> = {}): Promise<Response> {
  const app = createApp({ adminPath: CREATE_ONLY, data: () => h.port, now: () => h.clock.t, log: (l) => h.logs.push(l) });
  return call('/api/v1/auth/signup', {
    method: 'POST',
    app,
    country: 'US',
    env: ENV,
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ username, password: 's3cret-pass', ageBracket: '18p', termsVersion: TERMS_VERSION, ...over }),
  });
}
const upstreamCreates = (): number => gt.count('POST', '/auth/v1/admin/users');

describe('route 58 sign-up cap per network (AC-13)', () => {
  it('three sign-ups from one network pass; the fourth is 429 rate_limited with retryAfterMs to the next UTC midnight and 0 upstream calls; another network still signs up', async () => {
    expect((await signup('pilot_one', '198.51.100.10')).status).toBe(200);
    expect((await signup('pilot_two', '198.51.100.11')).status).toBe(200); // same /24
    expect((await signup('pilot_three', '198.51.100.12')).status).toBe(200);
    expect(upstreamCreates()).toBe(3);

    const requestsBefore = gt.requests.length;
    const fourth = await signup('pilot_four', '198.51.100.13');
    expect(fourth.status).toBe(429);
    const body = (await fourth.json()) as { error: { code: string; retryAfterMs: number } };
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.retryAfterMs).toBe(Date.UTC(2031, 0, 2) - h.clock.t);
    expect(gt.requests.length).toBe(requestsBefore); // 0 upstream calls
    expect(upstreamCreates()).toBe(3);

    expect((await signup('pilot_other_net', '203.0.113.4')).status).toBe(200);
    expect(upstreamCreates()).toBe(4);
  });

  it('only completed sign-ups count: bad bodies and upstream refusals leave the allowance alone', async () => {
    expect((await signup('x', '192.0.2.10')).status).toBe(400); // username too short
    expect((await signup('pilot_age', '192.0.2.10', { ageBracket: '16_17' })).status).toBe(403);
    expect((await signup('pilot_terms', '192.0.2.10', { termsVersion: 'old' })).status).toBe(400);
    gt.setOverride((r) => (r.path === '/auth/v1/admin/users' ? { status: 422, body: { error_code: 'email_exists', msg: 'exists' } } : undefined));
    expect((await signup('pilot_taken', '192.0.2.10')).status).toBeGreaterThanOrEqual(400);
    gt.setOverride(undefined);
    for (const u of ['a_pilot', 'b_pilot', 'c_pilot']) expect((await signup(u, '192.0.2.10')).status, u).toBe(200);
    expect((await signup('d_pilot', '192.0.2.10')).status).toBe(429);
  });

  it('the allowance returns at 00:00 UTC', async () => {
    for (const u of ['a_pilot', 'b_pilot', 'c_pilot']) await signup(u, '192.0.3.10');
    expect((await signup('d_pilot', '192.0.3.10')).status).toBe(429);
    h.clock.t = Date.UTC(2031, 0, 2, 0, 0, 5);
    expect((await signup('d_pilot', '192.0.3.10')).status).toBe(200);
  });
});
