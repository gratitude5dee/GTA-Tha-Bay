import { env as testEnv } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/env.ts';
import { call } from './helpers.ts';

const H12 = '0123456789ab';
const KEY_TYPED = `assets/data/media-test/default.${H12}.json`;
const KEY_UNTYPED = `assets/data/media-test/default.cdef01234567.glb`;
const BYTES = new TextEncoder().encode('0123456789abcdefghij');
const CACHE = 'public, max-age=31536000, immutable';
const media = (): R2Bucket => (testEnv as unknown as Env).MEDIA;

beforeAll(async () => {
  await media().put(KEY_TYPED, BYTES, { httpMetadata: { contentType: 'application/json', cacheControl: CACHE } });
  await media().put(KEY_UNTYPED, BYTES);
});

describe('GET /media/<key>', () => {
  it('serves the object with its stored metadata, CORS and isolation headers', async () => {
    const res = await call(`/media/${KEY_TYPED}`);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
    expect(res.headers.get('etag')).toMatch(/^"/);
    expect(res.headers.get('cache-control')).toBe(CACHE);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('content-length')).toBe(String(BYTES.length));
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(res.headers.get('content-encoding')).toBeNull();
  });

  it('falls back to the type of the extension when none was stored', async () => {
    const res = await call(`/media/${KEY_UNTYPED}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
    await res.arrayBuffer();
  });

  it('answers a single range with 206 and Content-Range', async () => {
    const res = await call(`/media/${KEY_TYPED}`, { headers: { Range: 'bytes=0-9' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-9/${BYTES.length}`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES.slice(0, 10));

    const suffix = await call(`/media/${KEY_TYPED}`, { headers: { Range: 'bytes=-5' } });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get('content-range')).toBe(`bytes 15-19/${BYTES.length}`);
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(BYTES.slice(-5));

    const open = await call(`/media/${KEY_TYPED}`, { headers: { Range: 'bytes=15-' } });
    expect(open.status).toBe(206);
    expect(new Uint8Array(await open.arrayBuffer())).toEqual(BYTES.slice(15));
  });

  it('answers multi-range, malformed and unsatisfiable ranges with 416', async () => {
    for (const range of ['bytes=0-1,4-5', 'bytes=999-', 'bytes=5-2', 'items=0-1']) {
      const res = await call(`/media/${KEY_TYPED}`, { headers: { Range: range } });
      expect(res.status, range).toBe(416);
      expect(res.headers.get('content-range')).toBe(`bytes */${BYTES.length}`);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    }
  });

  it('answers 304 to a matching If-None-Match on GET and HEAD', async () => {
    const first = await call(`/media/${KEY_TYPED}`);
    const etag = first.headers.get('etag');
    await first.arrayBuffer();
    expect(etag).not.toBeNull();
    const get = await call(`/media/${KEY_TYPED}`, { headers: { 'If-None-Match': etag as string } });
    expect(get.status).toBe(304);
    expect(await get.text()).toBe('');
    const head = await call(`/media/${KEY_TYPED}`, { method: 'HEAD', headers: { 'If-None-Match': etag as string } });
    expect(head.status).toBe(304);
  });

  it('answers HEAD without a body', async () => {
    const res = await call(`/media/${KEY_TYPED}`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(BYTES.length));
    expect(await res.text()).toBe('');
  });

  it('answers a missing key with 404, no-store and CORS', async () => {
    const res = await call(`/media/assets/data/nothing/default.${H12}.json`);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const ranged = await call(`/media/assets/data/nothing/default.${H12}.json`, { headers: { Range: 'bytes=0-1' } });
    expect(ranged.status).toBe(404);
  });

  it('answers keys outside the grammar with 404 and no bucket call', async () => {
    const calls: string[] = [];
    const spy = new Proxy(media(), {
      get(target, prop, receiver) {
        if (prop === 'get' || prop === 'head') calls.push(String(prop));
        const v = Reflect.get(target, prop, receiver) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const env = { MEDIA: spy } as unknown as Partial<Env>;
    for (const path of ['/media/..%2Fx', '/media/assets/data/x/default.ABCDEF012345.json', '/media/', '/media/private/x']) {
      const res = await call(path, { env });
      expect(res.status, path).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(calls).toEqual([]);
  });

  it('answers other methods with 405 and a preflight with 204', async () => {
    const post = await call(`/media/${KEY_TYPED}`, { method: 'POST', body: 'x' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
    const pre = await call(`/media/${KEY_TYPED}`, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'GET', Origin: 'https://other.test' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS');
    expect(pre.headers.get('access-control-allow-headers')).toBe('Range, If-None-Match, If-Modified-Since');
    expect(pre.headers.get('access-control-max-age')).toBe('86400');
    const bad = await call(`/media/${KEY_TYPED}`, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'DELETE' } });
    expect(bad.status).toBe(405);
  });

  it('ignores navigation mode and the geo gate', async () => {
    const nav = await call(`/media/${KEY_TYPED}`, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
    expect(nav.status).toBe(200);
    expect(nav.headers.get('content-type')).toBe('application/json');
    await nav.arrayBuffer();
    const fr = await call(`/media/${KEY_TYPED}`, { country: 'FR' });
    expect(fr.status).toBe(200);
    await fr.arrayBuffer();
  });

  it('MEDIA_ROUTE=off answers 503', async () => {
    const res = await call(`/media/${KEY_TYPED}`, { env: { MEDIA_ROUTE: 'off' } });
    expect(res.status).toBe(503);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('a binding exception answers 500 with the media headers', async () => {
    const broken = { get: () => Promise.reject(new Error('boom')), head: () => Promise.reject(new Error('boom')) } as unknown as R2Bucket;
    const res = await call(`/media/${KEY_TYPED}`, { env: { MEDIA: broken } });
    expect(res.status).toBe(500);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  });
});

interface Spy {
  bucket: R2Bucket;
  calls: string[];
}

/** The real local bucket behind a Proxy that records `get` and `head`. */
function spyOn(target: R2Bucket): Spy {
  const calls: string[] = [];
  const bucket = new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === 'get' || prop === 'head') calls.push(String(prop));
      const v = Reflect.get(t, prop, receiver) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { bucket, calls };
}

function stubBucket(getError: Error): { bucket: R2Bucket; calls: string[] } {
  const calls: string[] = [];
  const bucket = {
    get: () => {
      calls.push('get');
      return Promise.reject(getError);
    },
    head: () => {
      calls.push('head');
      return Promise.resolve({ size: 20 });
    },
  } as unknown as R2Bucket;
  return { bucket, calls };
}

describe('bucket calls of a ranged read (M01d3)', () => {
  const ranged = (range: string, bucket: R2Bucket, extra: Record<string, string> = {}): Promise<Response> =>
    call(`/media/${KEY_TYPED}`, { headers: { Range: range, ...extra }, env: { MEDIA: bucket } });

  it('a satisfiable range costs one get and no head', async () => {
    for (const [range, expected, bytes] of [
      ['bytes=0-9', 'bytes 0-9/20', BYTES.slice(0, 10)],
      ['bytes=-5', 'bytes 15-19/20', BYTES.slice(15)],
      ['bytes=15-', 'bytes 15-19/20', BYTES.slice(15)],
    ] as const) {
      const spy = spyOn(media());
      const res = await ranged(range, spy.bucket);
      expect(res.status, range).toBe(206);
      expect(res.headers.get('content-range')).toBe(expected);
      expect(res.headers.get('content-length')).toBe(String(bytes.length));
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
      expect(spy.calls, range).toEqual(['get']);
    }
  });

  it('twenty one-byte slices return the object with 20 gets and no head', async () => {
    const spy = spyOn(media());
    const out = new Uint8Array(20);
    for (let i = 0; i < 20; i++) {
      const res = await ranged(`bytes=${i}-${i}`, spy.bucket);
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe(`bytes ${i}-${i}/20`);
      out.set(new Uint8Array(await res.arrayBuffer()), i);
    }
    expect(out).toEqual(BYTES);
    expect(spy.calls.filter((c) => c === 'get')).toHaveLength(20);
    expect(spy.calls.filter((c) => c === 'head')).toHaveLength(0);
  });

  it('a matching If-None-Match with a Range answers 304 after one get', async () => {
    const first = await call(`/media/${KEY_TYPED}`);
    const etag = first.headers.get('etag') as string;
    await first.arrayBuffer();
    const spy = spyOn(media());
    const res = await ranged('bytes=0-9', spy.bucket, { 'If-None-Match': etag });
    expect(res.status).toBe(304);
    expect(spy.calls).toEqual(['get']);
  });

  it('a rejected header costs one head and answers 416 with the size', async () => {
    for (const range of ['bytes=0-1,4-5', 'bytes=5-2']) {
      const spy = spyOn(media());
      const res = await ranged(range, spy.bucket);
      expect(res.status, range).toBe(416);
      expect(res.headers.get('content-range')).toBe('bytes */20');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(spy.calls, range).toEqual(['head']);
    }
  });

  it('a start past the end answers 416 with the size, get first and at most one head', async () => {
    const spy = spyOn(media());
    const res = await ranged('bytes=999-', spy.bucket);
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */20');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(spy.calls[0]).toBe('get');
    expect(spy.calls.filter((c) => c === 'head').length).toBeLessThanOrEqual(1);
  });

  it('an InvalidRange (10039) exception from get falls back to one head', async () => {
    const stub = stubBucket(new Error('get: Requested byte range is not satisfiable (10039)'));
    const res = await ranged('bytes=999-', stub.bucket);
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */20');
    expect(stub.calls).toEqual(['get', 'head']);
  });

  it('any other exception from a ranged get answers 500 with the media headers and no head', async () => {
    const stub = stubBucket(new Error('boom'));
    const res = await ranged('bytes=0-9', stub.bucket);
    expect(res.status).toBe(500);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(stub.calls).toEqual(['get']);
  });

  it('a range on a missing key answers 404 after one get; a rejected header on one answers 404 after one head', async () => {
    const missing = `/media/assets/data/nothing/default.${H12}.json`;
    const spy = spyOn(media());
    const res = await call(missing, { headers: { Range: 'bytes=0-1' }, env: { MEDIA: spy.bucket } });
    expect(res.status).toBe(404);
    expect(spy.calls).toEqual(['get']);
    const spy2 = spyOn(media());
    const res2 = await call(missing, { headers: { Range: 'bytes=0-1,4-5' }, env: { MEDIA: spy2.bucket } });
    expect(res2.status).toBe(404);
    expect(spy2.calls).toEqual(['head']);
  });
});

describe('the unlock clips of FirstGestureUnlock (M04c)', () => {
  it('/media/blank.mp4 and /media/blank.webm come from the static assets, not from R2', async () => {
    const seen: string[] = [];
    const ASSETS = {
      fetch: (r: Request) => {
        seen.push(new URL(r.url).pathname);
        return Promise.resolve(new Response('clip'));
      },
    } as unknown as Fetcher;
    for (const name of ['blank.mp4', 'blank.webm']) {
      const res = await call(`/media/${name}`, { env: { ASSETS } });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('clip');
    }
    expect(seen).toEqual(['/media/blank.mp4', '/media/blank.webm']);
    // any other key under /media/ still goes through the R2 key grammar
    const other = await call('/media/blank.gif', { env: { ASSETS } });
    expect(other.status).toBe(404);
    expect(seen).toHaveLength(2);
  });
});
