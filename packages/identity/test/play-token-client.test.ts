import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { PlayTokenReq } from '@dv/shared';
import { LocalIdentity, PlayTokenClient, idbStore, toRawSignature, RETRY_BLOCK_MS } from '../src/index.ts';

function b64urlToBytes(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

async function setup(opts: { reply?: () => Promise<Response>; region?: () => 'ok' | 'blocked' | undefined } = {}) {
  let t = 1_700_000_000_000;
  const calls: { url: string; body: PlayTokenReq }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string) as PlayTokenReq });
    return opts.reply
      ? opts.reply()
      : new Response(JSON.stringify({ token: `pt1.abc.${calls.length}`, exp: t + 86_400_000 }), { status: 200 });
  });
  const id = await LocalIdentity.open({
    store: idbStore(new IDBFactory()),
    fetch: fetchMock as unknown as typeof fetch,
    now: () => t,
    ...(opts.region ? { region: opts.region } : {}),
  });
  return { id, calls, fetchMock, advance: (ms: number) => (t += ms), now: () => t };
}

describe('PlayTokenClient via LocalIdentity', () => {
  it('AC-4: one POST in an hour, a verifiable proof, PlayToken header each time', async () => {
    const s = await setup();
    await s.id.attestAge('18p');
    const results = [await s.id.authHeader()];
    s.advance(20 * 60_000);
    results.push(await s.id.authHeader());
    s.advance(20 * 60_000);
    results.push(await s.id.authHeader());
    expect(s.calls).toHaveLength(1);
    for (const r of results) expect(r?.Authorization).toMatch(/^PlayToken pt1\./);
    const { body, url } = s.calls[0]!;
    expect(url).toBe('/api/v1/id/play-token');
    expect(body.age).toBe('18p');
    expect(body.pid).toBe(s.id.current().profileId);
    const pub = await crypto.subtle.importKey('jwk', body.jwk as JsonWebKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const sig = b64urlToBytes(body.sig);
    expect(sig.length).toBe(64);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig as BufferSource, new TextEncoder().encode(`pt-req|${body.pid}|${body.ts}`));
    expect(ok).toBe(true);
  });

  it('refreshes five minutes before expiry', async () => {
    const s = await setup();
    await s.id.attestAge('18p');
    await s.id.authHeader();
    s.advance(86_400_000 - 5 * 60_000 + 1);
    await s.id.authHeader();
    expect(s.calls).toHaveLength(2);
  });

  it('shares one request between concurrent callers', async () => {
    const s = await setup();
    await s.id.attestAge('18p');
    await Promise.all([s.id.authHeader(), s.id.authHeader(), s.id.authHeader()]);
    expect(s.calls).toHaveLength(1);
  });

  for (const [name, reply] of [
    ['404', () => Promise.resolve(new Response('{}', { status: 404 }))],
    ['503', () => Promise.resolve(new Response('{}', { status: 503 }))],
    ['network error', () => Promise.reject(new Error('offline'))],
    ['garbage body', () => Promise.resolve(new Response('{"x":1}', { status: 200 }))],
  ] as const) {
    it(`AC-4: ${name} gives null and no second POST within 60 s`, async () => {
      const s = await setup({ reply });
      await s.id.attestAge('18p');
      expect(await s.id.authHeader()).toBeNull();
      s.advance(RETRY_BLOCK_MS - 1);
      expect(await s.id.authHeader()).toBeNull();
      expect(s.calls).toHaveLength(1);
      s.advance(2);
      expect(await s.id.authHeader()).toBeNull();
      expect(s.calls).toHaveLength(2);
    });
  }

  it('is null when the boot config says the region is blocked, and for any bracket but 18p', async () => {
    const s = await setup({ region: () => 'blocked' });
    expect(await s.id.authHeader()).toBeNull();
    await s.id.attestAge('18p');
    expect(await s.id.authHeader()).toBeNull();
    expect(s.fetchMock).not.toHaveBeenCalled();
  });
});

describe('toRawSignature', () => {
  it('passes 64 raw bytes through and converts a DER signature', () => {
    const raw = new Uint8Array(64).map((_, i) => i + 1);
    expect(toRawSignature(raw)).toBe(raw);
    // DER: r has a high bit (leading 0x00), s is short.
    const r = new Uint8Array(32).fill(0x80);
    const s = new Uint8Array(31).fill(0x11);
    const der = new Uint8Array([0x30, 2 + 33 + 2 + 31, 0x02, 33, 0, ...r, 0x02, 31, ...s]);
    const out = toRawSignature(der);
    expect(out.length).toBe(64);
    expect([...out.subarray(0, 32)]).toEqual([...r]);
    expect([...out.subarray(32)]).toEqual([0, ...s]);
  });

  it('rejects anything else', () => {
    expect(() => toRawSignature(new Uint8Array(10))).toThrow();
    expect(() => toRawSignature(new Uint8Array(70).fill(1))).toThrow();
  });

  it('a client whose signer returns garbage ends in null', async () => {
    const fetchMock = vi.fn();
    const client = new PlayTokenClient({
      signer: {
        profileId: () => 'p',
        ageBracket: () => '18p',
        publicJwk: () => ({}),
        sign: () => Promise.resolve(new Uint8Array(10)),
      },
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(await client.authHeader()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
