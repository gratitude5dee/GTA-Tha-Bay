import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Route } from '@playwright/test';
import { afterEach, describe, expect, it } from 'vitest';
import { answerRange } from '../e2e/media-ranges.ts';
import { CLIP_PIECE_BYTES, slowClipHost, type SlowClipHost } from '../e2e/slow-clip-host.ts';

/**
 * BD-FIX-CUTSCENE-START-01: the second origin of `cutscene-player.spec.ts` "a clip that is still arriving plays". The browser's own
 * download of the clip trickles (the case the test is about), and the range layer's upstream read of a ranged request does not wait on
 * that trickle, as the media route's ranged R2 read does not. `Range` stays ignored by the host itself (200 and the whole file).
 */
const DIR = fileURLToPath(new URL('../fixtures/cutscenes/fixture-a/', import.meta.url));
const CLIP = readFileSync(`${DIR}v768.mp4`);

/** A Playwright `Route` for one request of `url`, as far as `answerRange` uses it; `fetch` goes to the network like `route.fetch()`. */
function fakeRoute(url: string, range: string | undefined): { route: Route; out: { fulfilled?: { status?: number; headers?: Record<string, string>; body?: string | Buffer }; fellBack: boolean } } {
  const out: { fulfilled?: { status?: number; headers?: Record<string, string>; body?: string | Buffer }; fellBack: boolean } = { fellBack: false };
  const route = {
    request: () => ({ headers: () => (range === undefined ? {} : { range }) }),
    fallback: () => {
      out.fellBack = true;
      return Promise.resolve();
    },
    abort: () => Promise.resolve(),
    fetch: async () => {
      const res = await fetch(url, { headers: range === undefined ? {} : { Range: range } });
      const body = Buffer.from(await res.arrayBuffer());
      const headers = Object.fromEntries(res.headers.entries());
      return { status: () => res.status, body: () => Promise.resolve(body), headers: () => headers };
    },
    fulfill: (o: { status?: number; headers?: Record<string, string>; body?: string | Buffer }) => {
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
    host = await slowClipHost(DIR);
    const res = await fetch(`${host.origin}/v768.mp4`);
    const body = Buffer.from(await res.arrayBuffer());
    expect(res.status).toBe(200);
    expect(body.equals(CLIP)).toBe(true);
    expect(host.reads).toEqual([{ name: 'v768.mp4', range: null, pieces: Math.ceil(CLIP.length / CLIP_PIECE_BYTES) }]);
    expect(host.ranges).toEqual([]);
  });

  it('ignores Range (200 and the whole file) and sends a ranged read in one piece, recording its header', async () => {
    host = await slowClipHost(DIR);
    const res = await fetch(`${host.origin}/v768.mp4`, { headers: { Range: `bytes=${CLIP.length - 16}-` } });
    const body = Buffer.from(await res.arrayBuffer());
    expect(res.status).toBe(200);
    expect(body.equals(CLIP)).toBe(true);
    expect(host.reads).toEqual([{ name: 'v768.mp4', range: `bytes=${CLIP.length - 16}-`, pieces: 1 }]);
    expect(host.ranges).toEqual([`bytes=${CLIP.length - 16}-`]);
  });

  it("through the range layer, WebKit's tail read is a 206 of the last 16 bytes, read from the host in one piece", async () => {
    host = await slowClipHost(DIR);
    const tail = `bytes=${CLIP.length - 16}-`;
    const { route, out } = fakeRoute(`${host.origin}/v768.mp4`, tail);
    await answerRange(route);
    expect(out.fellBack).toBe(false);
    expect(out.fulfilled?.status).toBe(206);
    expect(out.fulfilled?.headers?.['content-range']).toBe(`bytes ${CLIP.length - 16}-${CLIP.length - 1}/${CLIP.length}`);
    expect(Buffer.from(out.fulfilled?.body ?? '').equals(CLIP.subarray(CLIP.length - 16))).toBe(true);
    expect(host.reads).toEqual([{ name: 'v768.mp4', range: tail, pieces: 1 }]);
  });

  it('a request without Range passes the range layer by, to the trickle', async () => {
    host = await slowClipHost(DIR);
    const { route, out } = fakeRoute(`${host.origin}/v768.mp4`, undefined);
    await answerRange(route);
    expect(out).toEqual({ fellBack: true });
    expect(host.reads).toEqual([]);
  });

  it('answers a preflight and refuses names outside its folder', async () => {
    host = await slowClipHost(DIR);
    expect((await fetch(`${host.origin}/v768.mp4`, { method: 'OPTIONS' })).status).toBe(204);
    expect((await fetch(`${host.origin}/..%2Fmanifest.json`)).status).toBe(404);
    expect((await fetch(`${host.origin}/notes.txt`)).status).toBe(404);
    expect(host.reads).toEqual([]);
  });
});
