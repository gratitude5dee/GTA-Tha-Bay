import { contentTypeOf, isMediaKey } from '@dv/shared';
import type { Env } from '../env.ts';

/**
 * Public R2 media through the app Worker (M01d2, DL-713): GET, HEAD and OPTIONS on /media/<key>, from the MEDIA binding only.
 * Geo-exempt (offline single-player is never geo-blocked). Every response, errors included, carries the CORS headers.
 */

const ALLOW = 'GET, HEAD, OPTIONS';
const PREFIX = '/media/';

type RangeSpec = { offset: number; length?: number } | { suffix: number };
type RangeParse = { ok: true; range: RangeSpec } | { ok: false };

/** One `bytes=a-b`, `bytes=a-` or `bytes=-n` against a known size. Anything else, or unsatisfiable, is not ok. */
export function parseRange(header: string, size: number): RangeParse {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return { ok: false };
  const [, a = '', b = ''] = m;
  if (a === '' && b === '') return { ok: false };
  if (a === '') {
    const n = Number(b);
    if (!Number.isSafeInteger(n) || n <= 0 || size === 0) return { ok: false };
    return { ok: true, range: { suffix: Math.min(n, size) } };
  }
  const start = Number(a);
  if (!Number.isSafeInteger(start) || start >= size) return { ok: false };
  if (b === '') return { ok: true, range: { offset: start } };
  const end = Number(b);
  if (!Number.isSafeInteger(end) || end < start) return { ok: false };
  return { ok: true, range: { offset: start, length: Math.min(end, size - 1) - start + 1 } };
}

function baseHeaders(): Headers {
  const h = new Headers();
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, ETag, Accept-Ranges');
  h.set('Accept-Ranges', 'bytes');
  return h;
}

function plain(status: number, extra: Record<string, string> = {}, noStore = false): Response {
  const h = baseHeaders();
  if (noStore) h.set('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(null, { status, headers: h });
}

function extensionOf(key: string): string {
  const name = key.slice(key.lastIndexOf('/') + 1);
  return name.slice(name.lastIndexOf('.') + 1);
}

function objectHeaders(obj: R2Object, key: string): Headers {
  const h = baseHeaders();
  obj.writeHttpMetadata(h);
  h.delete('Content-Encoding');
  h.set('ETag', obj.httpEtag);
  if (!h.has('Content-Type')) {
    let type = 'application/octet-stream';
    try {
      type = contentTypeOf(extensionOf(key));
    } catch {
      // unknown extension: keep the octet-stream fallback
    }
    h.set('Content-Type', type);
  }
  return h;
}

function hasConditional(request: Request): boolean {
  return request.headers.has('If-None-Match') || request.headers.has('If-Modified-Since');
}

export async function handleMedia(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    if (env.MEDIA_ROUTE === 'off') return plain(503, { 'Retry-After': '300' }, true);
    const method = request.method;
    if (method === 'OPTIONS') {
      const want = request.headers.get('Access-Control-Request-Method');
      if (want !== 'GET' && want !== 'HEAD') return plain(405, { Allow: ALLOW });
      return plain(204, {
        'Access-Control-Allow-Methods': ALLOW,
        'Access-Control-Allow-Headers': 'Range, If-None-Match, If-Modified-Since',
        'Access-Control-Max-Age': '86400',
      });
    }
    if (method !== 'GET' && method !== 'HEAD') return plain(405, { Allow: ALLOW });

    // The raw path after /media/, never decoded: '%' is not in the grammar.
    const key = url.pathname.slice(PREFIX.length);
    if (!isMediaKey(key)) return plain(404, {}, true);

    const rangeHeader = method === 'GET' ? request.headers.get('Range') : null;
    let range: RangeSpec | undefined;
    let size = 0;
    if (rangeHeader !== null) {
      const head = await env.MEDIA.head(key);
      if (head === null) return plain(404, {}, true);
      size = head.size;
      const parsed = parseRange(rangeHeader, size);
      if (!parsed.ok) return plain(416, { 'Content-Range': `bytes */${size}` }, true);
      range = parsed.range;
    }

    const obj = await env.MEDIA.get(key, range ? { onlyIf: request.headers, range } : { onlyIf: request.headers });
    if (obj === null) return plain(404, {}, true);
    const headers = objectHeaders(obj, key);
    if (!('body' in obj) || !(obj as R2ObjectBody).body) {
      // A failed precondition: 304 for If-None-Match / If-Modified-Since, otherwise 412.
      if (hasConditional(request)) return new Response(null, { status: 304, headers });
      return plain(412, {}, true);
    }
    const body = obj as R2ObjectBody;
    if (method === 'HEAD') {
      headers.set('Content-Length', String(body.size));
      return new Response(null, { status: 200, headers });
    }
    if (range) {
      let start: number;
      let length: number;
      if ('suffix' in range) {
        length = range.suffix;
        start = size - length;
      } else {
        start = range.offset;
        length = range.length ?? size - start;
      }
      headers.set('Content-Range', `bytes ${start}-${start + length - 1}/${size}`);
      headers.set('Content-Length', String(length));
      return new Response(body.body, { status: 206, headers });
    }
    headers.set('Content-Length', String(body.size));
    return new Response(body.body, { status: 200, headers });
  } catch {
    return plain(500, {}, true);
  }
}
