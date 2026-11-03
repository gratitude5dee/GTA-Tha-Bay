import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';

/**
 * The local Worker (`wrangler dev`) serves a QA build's `/media-local/` folder through its static-asset server, which ignores `Range`
 * and answers every request with `200` and the whole file. Players get clips from the media route instead (`/media/*` on R2,
 * `services/edge/src/routes/media.ts`), which answers a `Range` request with `206` and that byte range, read with one ranged R2 `get`.
 *
 * The difference matters on WebKit (GStreamer): when a fragmented MP4 is still arriving after its `moov` was parsed, the demuxer
 * asks for the last 16 bytes (`Range: bytes=<size-16>-`, the `mfro` box that points at the `mfra` index). A `200` to that request
 * fails the load with `MEDIA_ERR_SRC_NOT_SUPPORTED` ("Received unexpected 200 HTTP status code for range request"), which the
 * CutscenePlayer reads as `codec` and the clip falls back (BD-FIX-CUTFLAKE-01). On a busy runner the download lags behind the demuxer.
 *
 * `serveMediaRanges` answers every ranged request for a clip rendition the way the media route does: the bytes asked for with `206`
 * and `Content-Range`, or `416` when the range cannot be served. It reads them from the file that the upstream serves for that URL
 * (`localClipFile`: the built `apps/web/dist/media-local/` the local Worker serves), with one positioned read of the range, as the
 * media route reads R2: it neither downloads the whole file again from the upstream for each range nor moves more than the range
 * through the Playwright worker (BD-FIX-CUTSCENE-START-01). A clip it has no file for is read whole from the upstream and cut, as
 * before. A request without `Range` and an upstream `206` pass through unchanged. Register it before a spec's own routes of the same
 * files: Playwright runs the last registered handler first, and a spec's `route.fallback()` then reaches this one.
 */
export const CLIP_RENDITION = /\.(mp4|webm)(\?.*)?$/;

/** The built QA folder that the local Worker serves as `/media-local/`. */
export const DIST_MEDIA_LOCAL = fileURLToPath(new URL('../../apps/web/dist/media-local/', import.meta.url));

/** The file on disk that the upstream serves for `url`, or null when the range layer has none and reads the upstream. */
export type ClipFiles = (url: string) => string | null;

/** One ranged read the layer answered: the URL, the `Range` header, the status and where the bytes came from. */
export interface RangeAnswer {
  url: string;
  range: string;
  status: number;
  from: 'file' | 'upstream';
}

const TYPES: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm' };

/** A file name or path segment the layer and the test hosts serve: letters, digits, `_`, `.` and `-`, never `.` or `..` alone. */
export const SAFE_SEGMENT = /^(?!\.{1,2}$)[\w.-]+$/;

/**
 * The page's own clips: `http://localhost:<DV_E2E_PORT>/media-local/<path>` is `apps/web/dist/media-local/<path>`, the file the local
 * Worker serves for it (playwright.config.ts puts the port in the environment of the runner and its workers). Null for any other URL
 * and for a path with a segment outside `SAFE_SEGMENT`.
 */
export function localClipFile(url: string, origin = `http://localhost:${process.env['DV_E2E_PORT'] ?? '8790'}`, root = DIST_MEDIA_LOCAL): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const prefix = '/media-local/';
  if (u.origin !== origin || !u.pathname.startsWith(prefix)) return null;
  const rel = u.pathname.slice(prefix.length).split('/');
  if (!rel.every((s) => SAFE_SEGMENT.test(s))) return null;
  return `${root}${root.endsWith('/') ? '' : '/'}${rel.join('/')}`;
}

/** One `bytes=a-b`, `bytes=a-` or `bytes=-n` against a known size, as the media route parses it; null when it cannot be served. */
export function byteRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a = '', b = ''] = m;
  if (a === '' && b === '') return null;
  if (a === '') {
    const n = Number(b);
    if (!Number.isSafeInteger(n) || n <= 0 || size === 0) return null;
    return { start: size - Math.min(n, size), end: size - 1 };
  }
  const start = Number(a);
  if (!Number.isSafeInteger(start) || start >= size) return null;
  if (b === '') return { start, end: size - 1 };
  const end = Number(b);
  if (!Number.isSafeInteger(end) || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

/** The bytes `header` names in `file`, read with one positioned read; `range` is null (and `body` empty) when it cannot be served. */
export function readRange(file: string, header: string): { size: number; range: { start: number; end: number } | null; body: Buffer } {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const range = byteRange(header, size);
    if (range === null) return { size, range, body: Buffer.alloc(0) };
    const body = Buffer.alloc(range.end - range.start + 1);
    let at = 0;
    while (at < body.length) {
      const n = readSync(fd, body, at, body.length - at, range.start + at);
      if (n === 0) break;
      at += n;
    }
    return { size, range, body: body.subarray(0, at) };
  } finally {
    closeSync(fd);
  }
}

/** The headers every answer of the media route carries (`baseHeaders`): CORS, the exposed range headers, `Accept-Ranges`. */
const MEDIA_HEADERS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'Content-Length, Content-Range, ETag, Accept-Ranges',
  'accept-ranges': 'bytes',
};

/**
 * Answers one ranged read from the file `files` names for its URL, or from the upstream when it names none or the file is not there;
 * `log` gets the answer. A request without `Range` goes on.
 */
export async function answerRange(route: Route, files: ClipFiles = localClipFile, log?: RangeAnswer[]): Promise<void> {
  const url = route.request().url();
  const range = route.request().headers()['range'];
  if (range === undefined) return route.fallback();
  try {
    const named = files(url);
    const file = named !== null && existsSync(named) ? named : null;
    const status = file !== null ? await fulfillFromFile(route, range, file) : await fulfillRange(route, range);
    log?.push({ url, range, status, from: file !== null ? 'file' : 'upstream' });
  } catch {
    // The media element dropped the request while it was being answered (a seek, a skip, a released element): the browser no longer
    // waits for it, so there is nothing to answer. Any other failure leaves the request failed in the page, where the player sees it.
    await route.abort().catch(() => undefined);
  }
}

async function fulfillFromFile(route: Route, range: string, file: string): Promise<number> {
  const { size, range: r, body } = readRange(file, range);
  if (r === null) {
    await route.fulfill({ status: 416, headers: { ...MEDIA_HEADERS, 'cache-control': 'no-store', 'content-range': `bytes */${size}` }, body: '' });
    return 416;
  }
  const type = TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream';
  await route.fulfill({ status: 206, headers: { ...MEDIA_HEADERS, 'content-type': type, 'content-range': `bytes ${r.start}-${r.end}/${size}` }, body });
  return 206;
}

/** A clip with no file on disk: the whole file from the upstream, then the range of it. */
async function fulfillRange(route: Route, range: string): Promise<number> {
  const upstream = await route.fetch();
  if (upstream.status() !== 200) {
    await route.fulfill({ response: upstream });
    return upstream.status();
  }
  const body = await upstream.body();
  const headers = { ...upstream.headers() };
  delete headers['content-length'];
  delete headers['content-encoding'];
  headers['accept-ranges'] = 'bytes';
  const r = byteRange(range, body.length);
  if (r === null) {
    await route.fulfill({ status: 416, headers: { ...headers, 'content-range': `bytes */${body.length}` }, body: '' });
    return 416;
  }
  await route.fulfill({ status: 206, headers: { ...headers, 'content-range': `bytes ${r.start}-${r.end}/${body.length}` }, body: body.subarray(r.start, r.end + 1) });
  return 206;
}

/**
 * Routes every clip rendition through `answerRange`. `files` places the clips of another origin (a test host's folder) beside the page's
 * own `/media-local/` files. Returns the ranged reads it answers, in order.
 */
export async function serveMediaRanges(page: Page, files?: ClipFiles): Promise<RangeAnswer[]> {
  const log: RangeAnswer[] = [];
  const where: ClipFiles = files ? (url) => files(url) ?? localClipFile(url) : localClipFile;
  await page.route(CLIP_RENDITION, (route) => answerRange(route, where, log));
  return log;
}
