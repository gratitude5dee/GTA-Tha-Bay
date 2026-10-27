import { contentTypeOf, isMediaKey } from '@dv/shared';
import { now } from '../clock.ts';
import type { Env } from '../env.ts';
import { dailySalt, netHashOf } from '../id/nethash.ts';
import { allowed } from '../ratelimit.ts';
import { parseRangeHeader, servedRange } from './media-range.ts';

/**
 * Public R2 media through the app Worker (M01d2, DL-713): GET, HEAD and OPTIONS on /media/<key>, from the MEDIA binding only.
 * Geo-exempt (offline single-player is never geo-blocked). Every response, errors included, carries the CORS headers.
 */

const ALLOW = 'GET, HEAD, OPTIONS';
const PREFIX = '/media/';
/** The R2 error code InvalidRange ends the exception message (spec/03 section 6, row M01d3). */
const INVALID_RANGE = /\(10039\)\s*$/;

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

/** A rejected or unsatisfiable range: the only path that calls `head`, for the size in `Content-Range`. */
async function unsatisfiable(env: Env, key: string): Promise<Response> {
  const head = await env.MEDIA.head(key);
  if (head === null) return plain(404, {}, true);
  return plain(416, { 'Content-Range': `bytes */${head.size}` }, true);
}

/** Under "throttle": the per-network incident limit (RL_MEDIA). True when the request must be refused. Fails open. */
async function throttled(request: Request, env: Env): Promise<boolean> {
  if (!env.RL_MEDIA) return false;
  try {
    const key = netHashOf(request.headers.get('CF-Connecting-IP'), await dailySalt(env.QUOTA_NET_SALT_SECRET, now()));
    return !(await allowed(env.RL_MEDIA, key));
  } catch {
    return false;
  }
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

    if (env.MEDIA_ROUTE === 'throttle' && (await throttled(request, env))) {
      return plain(429, { 'Retry-After': '10' }, true);
    }

    // The raw path after /media/, never decoded: '%' is not in the grammar.
    const key = url.pathname.slice(PREFIX.length);
    if (!isMediaKey(key)) return plain(404, {}, true);

    const spec = method === 'GET' && request.headers.has('Range') ? parseRangeHeader(request.headers.get('Range') ?? '') : null;
    if (method === 'GET' && request.headers.has('Range') && spec === null) return unsatisfiable(env, key);

    let obj: R2Object | null;
    try {
      obj = await env.MEDIA.get(key, spec ? { onlyIf: request.headers, range: spec } : { onlyIf: request.headers });
    } catch (err) {
      // InvalidRange (10039) is the one expected failure of a ranged read; the size comes from one head, as for a rejected header.
      if (spec && INVALID_RANGE.test(err instanceof Error ? err.message : '')) return unsatisfiable(env, key);
      throw err;
    }
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
    if (spec) {
      const served = servedRange(spec, body.size);
      if (!served) {
        // Dropped unread: cancelling the stream logs a workerd error (BD-M01d2-01).
        return plain(416, { 'Content-Range': `bytes */${body.size}` }, true);
      }
      headers.set('Content-Range', `bytes ${served.start}-${served.end}/${body.size}`);
      headers.set('Content-Length', String(served.length));
      return new Response(body.body, { status: 206, headers });
    }
    headers.set('Content-Length', String(body.size));
    return new Response(body.body, { status: 200, headers });
  } catch {
    return plain(500, {}, true);
  }
}
