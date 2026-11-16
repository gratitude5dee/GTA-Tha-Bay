import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Route } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerRange, DIST_MEDIA_LOCAL, localClipFile, readRange, type RangeAnswer } from '../e2e/media-ranges.ts';
import { CLIP_PIECE_BYTES, slowClipHost, type SlowClipHost } from '../e2e/slow-clip-host.ts';

/**
 * BD-FIX-CUTSCENE-START-01: the second origin of `cutscene-player.spec.ts` "a clip that is still arriving plays" and the range layer in
 * front of it. The browser's own download of the clip trickles (the case the test is about); a ranged read is answered by the range
 * layer from the file, as the media route answers it with one ranged R2 read: the layer neither downloads the clip again from the
 * upstream nor moves more than the range. `Range` stays ignored by the host itself (200 and the whole file), whose server runs on a
 * thread of its own.
 */
const DIR = fileURLToPath(new URL('../fixtures/cutscenes/fixture-a/', import.meta.url));
const CLIP = readFileSync(`${DIR}v768.mp4`);
const TAIL = `bytes=${CLIP.length - 16}-`;

type Fulfilled = { status?: number; headers?: Record<string, string>; body?: string | Buffer };

/** A Playwright `Route` for one request of `url`, as far as `answerRange` uses it; `fetch` goes to the network like `route.fetch()`. */
function fakeRoute(url: string, range: string | undefined): { route: Route; out: { fulfilled?: Fulfilled; fellBack: boolean; fetched: number } } {
  const out: { fulfilled?: Fulfilled; fellBack: boolean; fetched: number } = { fellBack: false, fetched: 0 };
  const route = {
    request: () => ({ url: () => url, headers: () => (range === undefined ? {} : { range }) }),
    fallback: () => {
      out.fellBack = true;
      return Promise.resolve();
    },
    abort: () => Promise.resolve(),
    fetch: async () => {
      out.fetched++;
      const res = await fetch(url, { headers: range === undefined ? {} : { Range: range } });
      const body = Buffer.from(await res.arrayBuffer());
      const headers = Object.fromEntries(res.headers.entries());
      return { status: () => res.status, body: () => Promise.resolve(body), headers: () => headers };
    },
    fulfill: (o: Fulfilled) => {
      out.fulfilled = o;
      return Promise.resolve();
    },
  };
  return { route: route as unknown as Route, out };
}

describe('slowClipHost (BD-FIX-CUTSCENE-START-01)', () => {
  let host: SlowClipHost | null = null;
  afterEach(async () => {
    await host?.close();
    host = null;
  });

  it("trickles the browser's own download: 200 and the whole file, in 64 KB pieces", async () => {
    const h = (host = await slowClipHost(DIR));
    const res = await fetch(`${h.origin}/v768.mp4`);
    const body = Buffer.from(await res.arrayBuffer());
    expect(res.status).toBe(200);
    expect(body.equals(CLIP)).toBe(true);
    // the host's thread reports each read to this one as it goes
    await vi.waitFor(() => expect(h.reads).toEqual([{ name: 'v768.mp4', range: null, pieces: Math.ceil(CLIP.length / CLIP_PIECE_BYTES) }]));
    expect(h.ranges).toEqual([]);
  });

  it('ignores Range itself, as the asset server of wrangler dev does: 200 and the whole file, in one piece', async () => {
    const h = (host = await slowClipHost(DIR));
    const res = await fetch(`${h.origin}/v768.mp4`, { headers: { Range: TAIL } });
    const body = Buffer.from(await res.arrayBuffer());
    expect(res.status).toBe(200);
    expect(body.equals(CLIP)).toBe(true);
    await vi.waitFor(() => expect(h.reads).toEqual([{ name: 'v768.mp4', range: TAIL, pieces: 1 }]));
    expect(h.ranges).toEqual([TAIL]);
  });

  it('places its own URLs in its folder, and no other', async () => {
    const h = (host = await slowClipHost(DIR));
    expect(h.file(`${h.origin}/v768.mp4`)).toBe(`${DIR}v768.mp4`);
    expect(h.file(`${h.origin}/v768.mp4?x=1`)).toBe(`${DIR}v768.mp4`);
    expect(h.file('http://127.0.0.1:1/v768.mp4')).toBeNull();
    expect(h.file(`${h.origin}/..%2Fmanifest.json`)).toBeNull();
    expect(h.file(`${h.origin}/notes.txt`)).toBeNull();
  });

  it('answers a preflight and refuses names outside its folder', async () => {
    const h = (host = await slowClipHost(DIR));
    expect((await fetch(`${h.origin}/v768.mp4`, { method: 'OPTIONS' })).status).toBe(204);
    expect((await fetch(`${h.origin}/..%2Fmanifest.json`)).status).toBe(404);
    expect((await fetch(`${h.origin}/notes.txt`)).status).toBe(404);
    expect(h.reads).toEqual([]);
  });
});

describe('the range layer (BD-FIX-CUTSCENE-START-01)', () => {
  let host: SlowClipHost | null = null;
  afterEach(async () => {
    await host?.close();
    host = null;
  });

  it("answers WebKit's tail read of the host's clip from the file: 206 of the last 16 bytes, without asking the host", async () => {
    const h = (host = await slowClipHost(DIR));
    const log: RangeAnswer[] = [];
    const { route, out } = fakeRoute(`${h.origin}/v768.mp4`, TAIL);
    await answerRange(route, h.file, log);
    expect(out.fellBack).toBe(false);
    expect(out.fetched).toBe(0);
    expect(out.fulfilled?.status).toBe(206);
    expect(out.fulfilled?.headers?.['content-range']).toBe(`bytes ${CLIP.length - 16}-${CLIP.length - 1}/${CLIP.length}`);
    expect(out.fulfilled?.headers?.['accept-ranges']).toBe('bytes');
    expect(out.fulfilled?.headers?.['content-type']).toBe('video/mp4');
    expect(Buffer.from(out.fulfilled?.body ?? '').equals(CLIP.subarray(CLIP.length - 16))).toBe(true);
    expect(log).toEqual([{ url: `${h.origin}/v768.mp4`, range: TAIL, status: 206, from: 'file' }]);
  });

  it('an open range from the middle gets exactly the rest; a range past the end gets 416 with the size', async () => {
    const h = (host = await slowClipHost(DIR));
    const rest = fakeRoute(`${h.origin}/v768.mp4`, 'bytes=131072-');
    await answerRange(rest.route, h.file);
    expect(rest.out.fulfilled?.status).toBe(206);
    expect(Buffer.from(rest.out.fulfilled?.body ?? '').equals(CLIP.subarray(131_072))).toBe(true);
    const past = fakeRoute(`${h.origin}/v768.mp4`, `bytes=${CLIP.length}-`);
    await answerRange(past.route, h.file);
    expect(past.out.fulfilled?.status).toBe(416);
    expect(past.out.fulfilled?.headers?.['content-range']).toBe(`bytes */${CLIP.length}`);
    expect(rest.out.fetched + past.out.fetched).toBe(0);
  });

  it('a clip it has no file for is read whole from the upstream and cut, as before', async () => {
    const h = (host = await slowClipHost(DIR));
    const log: RangeAnswer[] = [];
    const { route, out } = fakeRoute(`${h.origin}/v768.mp4`, TAIL);
    await answerRange(route, () => null, log);
    expect(out.fetched).toBe(1);
    expect(out.fulfilled?.status).toBe(206);
    expect(Buffer.from(out.fulfilled?.body ?? '').equals(CLIP.subarray(CLIP.length - 16))).toBe(true);
    expect(log).toEqual([{ url: `${h.origin}/v768.mp4`, range: TAIL, status: 206, from: 'upstream' }]);
    await vi.waitFor(() => expect(h.reads).toEqual([{ name: 'v768.mp4', range: TAIL, pieces: 1 }]));
    // a file that is named but not there is read from the upstream too
    const missing = fakeRoute(`${h.origin}/v768.mp4`, TAIL);
    await answerRange(missing.route, () => `${DIR}absent.mp4`, log);
    expect(missing.out.fetched).toBe(1);
    expect(missing.out.fulfilled?.status).toBe(206);
    expect(log[1]?.from).toBe('upstream');
  });

  it('a request without Range passes the range layer by, to the trickle', async () => {
    const h = (host = await slowClipHost(DIR));
    const { route, out } = fakeRoute(`${h.origin}/v768.mp4`, undefined);
    await answerRange(route, h.file);
    expect(out).toEqual({ fellBack: true, fetched: 0 });
  });

  it("places the page's own /media-local/ clips in the built folder the local Worker serves, and nothing else", () => {
    const origin = 'http://localhost:8790';
    expect(localClipFile(`${origin}/media-local/cutscenes/fixture-a/v768.mp4`, origin)).toBe(`${DIST_MEDIA_LOCAL}cutscenes/fixture-a/v768.mp4`);
    expect(localClipFile(`${origin}/media-local/cutscenes/fixture-a/v768.mp4?v=2`, origin)).toBe(`${DIST_MEDIA_LOCAL}cutscenes/fixture-a/v768.mp4`);
    expect(localClipFile('http://localhost:9999/media-local/cutscenes/fixture-a/v768.mp4', origin)).toBeNull();
    expect(localClipFile(`${origin}/media/cutscenes/v768.mp4`, origin)).toBeNull();
    expect(localClipFile(`${origin}/media-local/cutscenes/../../index.html`, origin)).toBeNull();
    expect(localClipFile(`${origin}/media-local/cutscenes/a%2Fb.mp4`, origin)).toBeNull();
    expect(localClipFile('not a url', origin)).toBeNull();
  });

  it('reads only the bytes asked for, with the size for Content-Range', () => {
    expect(readRange(`${DIR}v768.mp4`, 'bytes=-16')).toEqual({ size: CLIP.length, range: { start: CLIP.length - 16, end: CLIP.length - 1 }, body: CLIP.subarray(CLIP.length - 16) });
    expect(readRange(`${DIR}v768.mp4`, 'bytes=0-99').body.equals(CLIP.subarray(0, 100))).toBe(true);
    expect(readRange(`${DIR}v768.mp4`, 'bytes=abc')).toEqual({ size: CLIP.length, range: null, body: Buffer.alloc(0) });
  });
});
