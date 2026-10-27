import { env as testEnv } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/env.ts';
import { call } from './helpers.ts';

const KEY = 'assets/data/media-test/default.0123456789ab.json';
const BYTES = new TextEncoder().encode('0123456789abcdefghij');
const media = (): R2Bucket => (testEnv as unknown as Env).MEDIA;

beforeAll(async () => {
  await media().put(KEY, BYTES, { httpMetadata: { contentType: 'application/json' } });
});

interface Limiter {
  binding: RateLimit;
  keys: string[];
}

function limiter(success: boolean | 'throw'): Limiter {
  const keys: string[] = [];
  const binding = {
    limit: ({ key }: { key: string }) => {
      keys.push(key);
      if (success === 'throw') return Promise.reject(new Error('limiter down'));
      return Promise.resolve({ success });
    },
  } as unknown as RateLimit;
  return { binding, keys };
}

function spied(): { bucket: R2Bucket; calls: string[] } {
  const calls: string[] = [];
  const bucket = new Proxy(media(), {
    get(t, prop, receiver) {
      if (prop === 'get' || prop === 'head') calls.push(String(prop));
      const v = Reflect.get(t, prop, receiver) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { bucket, calls };
}

const from = (ip: string): Record<string, string> => ({ 'CF-Connecting-IP': ip });

describe('MEDIA_ROUTE=throttle', () => {
  it('a denied GET answers 429 with the media and isolation headers and no bucket call', async () => {
    const lim = limiter(false);
    const spy = spied();
    const res = await call(`/media/${KEY}`, { headers: from('203.0.113.7'), env: { MEDIA_ROUTE: 'throttle', RL_MEDIA: lim.binding, MEDIA: spy.bucket } });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('10');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(spy.calls).toEqual([]);
    expect(lim.keys).toHaveLength(1);
  });

  it('a denied HEAD answers 429 too, and a key outside the grammar is limited before it is checked', async () => {
    const lim = limiter(false);
    const env = { MEDIA_ROUTE: 'throttle' as const, RL_MEDIA: lim.binding };
    expect((await call(`/media/${KEY}`, { method: 'HEAD', headers: from('203.0.113.7'), env })).status).toBe(429);
    const res = await call('/media/private/x', { headers: from('203.0.113.7'), env });
    expect(res.status).toBe(429);
  });

  it('keys are the daily-salted /24 hash and never carry the address', async () => {
    const lim = limiter(true);
    const env = { MEDIA_ROUTE: 'throttle' as const, RL_MEDIA: lim.binding };
    for (const ip of ['203.0.113.7', '203.0.113.99', '198.51.100.7']) {
      const res = await call(`/media/${KEY}`, { headers: from(ip), env });
      await res.arrayBuffer();
    }
    const [a, b, c] = lim.keys;
    expect(lim.keys).toHaveLength(3);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    for (const key of lim.keys) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toContain('203.0.113');
    }
  });

  it('an allowing limiter serves the object', async () => {
    const lim = limiter(true);
    const res = await call(`/media/${KEY}`, { headers: from('203.0.113.7'), env: { MEDIA_ROUTE: 'throttle', RL_MEDIA: lim.binding } });
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });

  it('fails open when limit() throws or the binding is absent', async () => {
    const thrown = await call(`/media/${KEY}`, { headers: from('203.0.113.7'), env: { MEDIA_ROUTE: 'throttle', RL_MEDIA: limiter('throw').binding } });
    expect(thrown.status).toBe(200);
    await thrown.arrayBuffer();
    const absent = await call(`/media/${KEY}`, { headers: from('203.0.113.7'), env: { MEDIA_ROUTE: 'throttle', RL_MEDIA: undefined } });
    expect(absent.status).toBe(200);
    await absent.arrayBuffer();
  });

  it('a preflight is answered without a limit() call, and a wrong method is 405 without one', async () => {
    const lim = limiter(false);
    const env = { MEDIA_ROUTE: 'throttle' as const, RL_MEDIA: lim.binding };
    const pre = await call(`/media/${KEY}`, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'GET', ...from('203.0.113.7') }, env });
    expect(pre.status).toBe(204);
    const post = await call(`/media/${KEY}`, { method: 'POST', body: 'x', headers: from('203.0.113.7'), env });
    expect(post.status).toBe(405);
    expect(lim.keys).toEqual([]);
  });

  it('a ranged GET is limited as well', async () => {
    const lim = limiter(false);
    const res = await call(`/media/${KEY}`, { headers: { Range: 'bytes=0-9', ...from('203.0.113.7') }, env: { MEDIA_ROUTE: 'throttle', RL_MEDIA: lim.binding } });
    expect(res.status).toBe(429);
  });
});

describe('the other MEDIA_ROUTE states', () => {
  it.each([['on'], [undefined]] as const)('%s never calls the limiter', async (state) => {
    const lim = limiter(false);
    const env: Partial<Env> = { RL_MEDIA: lim.binding, MEDIA_ROUTE: state };
    for (const init of [{}, { method: 'HEAD' }, { headers: { Range: 'bytes=0-9' } }]) {
      const res = await call(`/media/${KEY}`, { ...init, env });
      expect([200, 206]).toContain(res.status);
      await res.arrayBuffer();
    }
    expect(lim.keys).toEqual([]);
  });

  it('off answers 503 without a limiter call', async () => {
    const lim = limiter(false);
    const res = await call(`/media/${KEY}`, { env: { MEDIA_ROUTE: 'off', RL_MEDIA: lim.binding } });
    expect(res.status).toBe(503);
    expect(lim.keys).toEqual([]);
  });
});
