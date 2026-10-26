import type { Page, Route } from '@playwright/test';

/**
 * The local Worker (`wrangler dev`) serves a QA build's `/media-local/` folder through its static-asset server, which ignores `Range`
 * and answers every request with `200` and the whole file. Players get clips from the media route instead (`/media/*` on R2,
 * `services/edge/src/routes/media.ts`), which answers a `Range` request with `206` and that byte range.
 *
 * The difference matters on WebKit (GStreamer): when a fragmented MP4 is still arriving after its `moov` was parsed, the demuxer
 * asks for the last 16 bytes (`Range: bytes=<size-16>-`, the `mfro` box that points at the `mfra` index). A `200` to that request
 * fails the load with `MEDIA_ERR_SRC_NOT_SUPPORTED` ("Received unexpected 200 HTTP status code for range request"), which the
 * CutscenePlayer reads as `codec` and the clip falls back (BD-FIX-CUTFLAKE-01). On a busy runner the download lags behind the demuxer.
 *
 * `serveMediaRanges` answers every ranged request for a clip rendition the way the media route does: the bytes asked for with `206`
 * and `Content-Range`, or `416` when the range cannot be served. A request without `Range` and an upstream `206` pass through
 * unchanged. Register it before a spec's own routes of the same files: Playwright runs the last registered handler first, and a
 * spec's `route.fallback()` then reaches this one.
 */
export const CLIP_RENDITION = /\.(mp4|webm)(\?.*)?$/;

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

export async function answerRange(route: Route): Promise<void> {
  const range = route.request().headers()['range'];
  if (range === undefined) return route.fallback();
  try {
    await fulfillRange(route, range);
  } catch {
    // The media element dropped the request while it was being answered (a seek, a skip, a released element): the browser no longer
    // waits for it, so there is nothing to answer. Any other failure leaves the request failed in the page, where the player sees it.
    await route.abort().catch(() => undefined);
  }
}

async function fulfillRange(route: Route, range: string): Promise<void> {
  const upstream = await route.fetch();
  if (upstream.status() !== 200) return route.fulfill({ response: upstream });
  const body = await upstream.body();
  const headers = { ...upstream.headers() };
  delete headers['content-length'];
  delete headers['content-encoding'];
  headers['accept-ranges'] = 'bytes';
  const r = byteRange(range, body.length);
  if (r === null) return route.fulfill({ status: 416, headers: { ...headers, 'content-range': `bytes */${body.length}` }, body: '' });
  return route.fulfill({
    status: 206,
    headers: { ...headers, 'content-range': `bytes ${r.start}-${r.end}/${body.length}` },
    body: body.subarray(r.start, r.end + 1),
  });
}

export async function serveMediaRanges(page: Page): Promise<void> {
  await page.route(CLIP_RENDITION, answerRange);
}
