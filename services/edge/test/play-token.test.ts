import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayTokenReq, PlayTokenRes } from '@dv/shared';
import { b64urlEncode, jwkThumbprint, resetSkipLog, verify } from '../src/id/playtoken.ts';
import { call, isUuidV7 } from './helpers.ts';
import { uuidv7 } from '../src/uuidv7.ts';
import { harness, playToken, PLAY_SECRET, type Harness } from './npc-helpers.ts';

const SECRET = `k1:${b64urlEncode(new Uint8Array(32).fill(7))}`;
const enc = new TextEncoder();

interface Proof {
  req: PlayTokenReq;
  thumbprint: string;
  privateKey: CryptoKey;
}

async function proof(opts: { ageMs?: number; age?: string; tamper?: boolean } = {}): Promise<Proof> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  const pid = uuidv7();
  const ts = Date.now() - (opts.ageMs ?? 0);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, enc.encode(`pt-req|${pid}|${ts}`)));
  if (opts.tamper) sig[0] = sig[0]! ^ 0xff;
  const clean = { kty: jwk.kty as string, crv: jwk.crv as string, x: jwk.x as string, y: jwk.y as string };
  return {
    req: { pid, jwk: clean, ts, sig: b64urlEncode(sig), age: (opts.age ?? '18p') as '18p' },
    thumbprint: await jwkThumbprint(clean),
    privateKey: pair.privateKey,
  };
}

function post(body: unknown, country = 'US', env: Record<string, string | undefined> = { PLAY_TOKEN_HMAC: SECRET }) {
  return call('/api/v1/id/play-token', {
    method: 'POST',
    country,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    env,
  });
}

async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  const id = res.headers.get('X-Request-Id');
  expect(isUuidV7(id)).toBe(true);
  const body = (await res.json()) as { error: { code: string; requestId: string } };
  expect(body.error.code).toBe(code);
  expect(body.error.requestId).toBe(id);
}

afterEach(() => {
  vi.restoreAllMocks();
  resetSkipLog();
});

describe('POST /api/v1/id/play-token (route 5)', () => {
  it('AC-5: a valid proof mints a token that verify() accepts', async () => {
    const p = await proof();
    const res = await post(p.req);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-Id')).not.toBeNull();
    const out = (await res.json()) as PlayTokenRes;
    expect(out.token.startsWith('pt1.')).toBe(true);
    const claims = await verify({ PLAY_TOKEN_HMAC: SECRET }, out.token);
    expect(claims).not.toBeNull();
    expect(claims!.pid).toBe(p.req.pid);
    expect(claims!.dkt).toBe(p.thumbprint);
    expect(claims!.age).toBe('18p');
    expect(claims!.v).toBe(1);
    expect(claims!.kid).toBe('k1');
    expect(claims!.exp - claims!.iat).toBe(86_400_000);
    expect(out.exp).toBe(claims!.exp);
  });

  it('AC-5: a proof 121 s old is 400 bad_request', async () => {
    await expectError(await post((await proof({ ageMs: 121_000 })).req), 400, 'bad_request');
  });

  it('AC-5: a tampered signature is 400 bad_request', async () => {
    await expectError(await post((await proof({ tamper: true })).req), 400, 'bad_request');
  });

  it('AC-5: age 16_17 is 403 age_blocked', async () => {
    await expectError(await post((await proof({ age: '16_17' })).req), 403, 'age_blocked');
  });

  it('AC-5: country FR is 451 region_blocked', async () => {
    await expectError(await post((await proof()).req, 'FR'), 451, 'region_blocked');
  });

  it('rejects malformed bodies and the wrong method', async () => {
    await expectError(await post({ pid: 'x' }), 400, 'bad_request');
    const p = await proof();
    await expectError(await post({ ...p.req, extra: 1 }), 400, 'bad_request');
    await expectError(await post({ ...p.req, pid: 'not-a-uuid' }), 400, 'bad_request');
    // A DER-shaped signature (wrong length) is refused: the Worker verifies raw r||s only.
    await expectError(await post({ ...p.req, sig: b64urlEncode(new Uint8Array(70).fill(48)) }), 400, 'bad_request');
    const get = await call('/api/v1/id/play-token', { country: 'US' });
    expect(get.status).toBe(405);
  });

  it('a token verifies under PLAY_TOKEN_HMAC_PREV but not under another key, and expired tokens fail', async () => {
    const p = await proof();
    const out = (await (await post(p.req)).json()) as PlayTokenRes;
    expect(await verify({ PLAY_TOKEN_HMAC: `k2:${b64urlEncode(new Uint8Array(32).fill(9))}`, PLAY_TOKEN_HMAC_PREV: SECRET }, out.token)).not.toBeNull();
    expect(await verify({ PLAY_TOKEN_HMAC: `k1:${b64urlEncode(new Uint8Array(32).fill(9))}` }, out.token)).toBeNull();
    expect(await verify({ PLAY_TOKEN_HMAC: SECRET }, out.token, out.exp + 1)).toBeNull();
    const [a, b, c] = out.token.split('.');
    expect(await verify({ PLAY_TOKEN_HMAC: SECRET }, `${a}.${b}.${c!.slice(0, -2)}AA`)).toBeNull();
  });

  it('AC-6: without PLAY_TOKEN_HMAC the answer is 503 upstream_unavailable and the SKIP line is logged once', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const env = { PLAY_TOKEN_HMAC: undefined };
    await expectError(await post((await proof()).req, 'US', env), 503, 'upstream_unavailable');
    await expectError(await post((await proof()).req, 'US', env), 503, 'upstream_unavailable');
    const skips = log.mock.calls.filter((c) => String(c[0]).includes('SKIP play-token: PLAY_TOKEN_HMAC not set'));
    expect(skips).toHaveLength(1);
  });
});

// ---- M06a1: trust on first use, dual-key rotation, the per-network cap and the P0 guard on /me (AC-1) ----
describe('AC-1 play token: TOFU binding, rotation window, network cap', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });
  afterEach(() => h.dispose());

  /** A route 5 request whose proof is dated by the harness clock. */
  async function signed(pid: string, pair?: CryptoKeyPair, at = h.clock.t): Promise<{ req: PlayTokenReq; thumbprint: string; pair: CryptoKeyPair }> {
    const keys = pair ?? ((await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair);
    const jwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey;
    const clean = { kty: jwk.kty as string, crv: jwk.crv as string, x: jwk.x as string, y: jwk.y as string };
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, enc.encode(`pt-req|${pid}|${at}`)));
    return { req: { pid, jwk: clean, ts: at, sig: b64urlEncode(sig), age: '18p' }, thumbprint: await jwkThumbprint(clean), pair: keys };
  }
  const mint = (req: PlayTokenReq, ip?: string) =>
    h.api('/api/v1/id/play-token', { method: 'POST', body: JSON.stringify(req), headers: { 'content-type': 'application/json', ...(ip ? { 'CF-Connecting-IP': ip } : {}) }, env: { PLAY_TOKEN_HMAC: PLAY_SECRET } });

  it('the first server write binds K1 to the pid; the same pid under K2 gets 403; K1 still works', async () => {
    const pid = uuidv7();
    const k1 = await signed(pid);
    expect((await mint(k1.req)).status).toBe(200);
    expect(await h.port.profiles.ensureLocal(pid, k1.thumbprint)).toBe('exists'); // a device_keys row binds K1's thumbprint
    expect((await h.port.profiles.get({ profileId: pid, tier: 'local', requestId: 'r' }))?.tier).toBe('local');

    const k2 = await signed(pid);
    expect(k2.thumbprint).not.toBe(k1.thumbprint);
    await expectError(await mint(k2.req), 403, 'forbidden');
    expect(await h.port.profiles.ensureLocal(pid, k2.thumbprint)).toBe('key_mismatch');

    h.clock.t += 5_000;
    expect((await mint((await signed(pid, k1.pair)).req)).status).toBe(200);
  });

  it('a key already bound to another pid cannot claim a new pid', async () => {
    const k1 = await signed(uuidv7());
    expect((await mint(k1.req)).status).toBe(200);
    const stolen = await signed(uuidv7(), k1.pair);
    await expectError(await mint(stolen.req), 403, 'forbidden');
  });

  it('a token verified on /me binds on first use, and a token for the bound pid under another key is 403', async () => {
    const pid = uuidv7();
    const good = await playToken(pid, 'dkt-one', h.clock.t);
    const res = await h.api('/api/v1/me', { headers: { Authorization: `PlayToken ${good}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profileId: pid, tier: 'local', providers: [] });
    const other = await playToken(pid, 'dkt-two', h.clock.t);
    await expectError(await h.api('/api/v1/me', { headers: { Authorization: `PlayToken ${other}` } }), 403, 'forbidden');
  });

  it('a token signed with PLAY_TOKEN_HMAC_PREV verifies inside its 24 h window and fails after it', async () => {
    const OLD = `k0:${b64urlEncode(new Uint8Array(32).fill(4))}`;
    const t0 = h.clock.t;
    const token = await playToken(uuidv7(), 'dkt', t0, { secret: OLD });
    const rotated = { PLAY_TOKEN_HMAC: PLAY_SECRET, PLAY_TOKEN_HMAC_PREV: OLD };
    expect(await verify(rotated, token, t0 + 23 * 3_600_000)).not.toBeNull();
    expect(await verify(rotated, token, t0 + 25 * 3_600_000)).toBeNull();
    expect(await verify({ PLAY_TOKEN_HMAC: PLAY_SECRET }, token, t0 + 1000)).toBeNull(); // PREV dropped: refused at once
    const viaRoute = await h.api('/api/v1/me', { headers: { Authorization: `PlayToken ${token}` }, env: rotated });
    expect(viaRoute.status).toBe(200);
  });

  it('a token without the 18p attestation, a stranger token and a missing header are 401 and store nothing', async () => {
    const pid = uuidv7();
    const young = await playToken(pid, 'dkt', h.clock.t, { age: '16_17' });
    await expectError(await h.api('/api/v1/me', { headers: { Authorization: `PlayToken ${young}` } }), 401, 'unauthorized');
    const foreign = await playToken(pid, 'dkt', h.clock.t, { secret: `k1:${b64urlEncode(new Uint8Array(32).fill(1))}` });
    await expectError(await h.api('/api/v1/me', { headers: { Authorization: `PlayToken ${foreign}` } }), 401, 'unauthorized');
    await expectError(await h.api('/api/v1/me'), 401, 'unauthorized');
    await expectError(await h.api('/api/v1/me', { headers: { Authorization: 'Bearer abc' } }), 401, 'unauthorized');
    expect(await h.port.profiles.get({ profileId: pid, tier: 'local', requestId: 'r' })).toBeNull();
  });

  it('the 51st token from one network in a UTC day is 429 with retryAfterMs to midnight; another network still gets one', async () => {
    for (let i = 0; i < 50; i++) expect((await mint((await signed(uuidv7())).req, '203.0.113.5')).status, `token ${i + 1}`).toBe(200);
    const over = await mint((await signed(uuidv7())).req, '203.0.113.200'); // same /24
    expect(over.status).toBe(429);
    const body = (await over.json()) as { error: { code: string; retryAfterMs: number } };
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.retryAfterMs).toBe(Date.UTC(2031, 0, 2) - h.clock.t);
    expect((await mint((await signed(uuidv7())).req, '198.51.100.9')).status).toBe(200);
    h.clock.t = Date.UTC(2031, 0, 2, 0, 0, 5);
    expect((await mint((await signed(uuidv7())).req, '203.0.113.5')).status).toBe(200);
  });
});
