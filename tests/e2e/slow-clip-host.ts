import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The trickle of a loaded runner's local Worker: 64 KB pieces, 30 ms apart (BD-FIX-CUTFLAKE-01). */
export const CLIP_PIECE_BYTES = 65_536;
export const CLIP_PIECE_GAP_MS = 30;

const TYPES: Record<string, string> = { json: 'application/json', mp4: 'video/mp4', webm: 'video/webm', webp: 'image/webp', vtt: 'text/vtt' };

/** One request the host answered: its `Range` header (null when it had none) and how many pieces the body went out in. */
export interface ClipRead {
  name: string;
  range: string | null;
  pieces: number;
}

export interface SlowClipHost {
  origin: string;
  /** Every `Range` header the host was sent, in order. */
  ranges: string[];
  /** Every file request the host answered, in order. */
  reads: ClipRead[];
  close(): Promise<void>;
}

/**
 * A second origin that serves the files of `dir` as a loaded runner's local Worker serves a clip (BD-FIX-CUTFLAKE-01): it ignores
 * `Range` (200 and the whole file, like the static-asset server of `wrangler dev`), and the browser's own download, a request without
 * `Range`, goes out in 64 KB pieces 30 ms apart, so the clip is still arriving after the browser has parsed its `moov`. It records every
 * `Range` header it is sent and every read.
 *
 * A request that carries `Range` reaches this host only as the upstream read of `serveMediaRanges` (`tests/e2e/media-ranges.ts`), which
 * answers every ranged read of a rendition and stands in for the production media route (`services/edge/src/routes/media.ts`: one
 * ranged R2 `get` of the bytes asked for, not slowed by a download of the same object still in flight). That read gets the whole file
 * in one piece, still `200` with `Range` ignored, so a range that reached the browser unanswered would still fail WebKit's load as
 * before. Paced too, each of WebKit's back-to-back ranged reads (the `mfro` tail, the `mfra`, the rest from byte 131072) waited for a
 * second paced download of the whole 1.25 MB (0.6 s each) before the range layer could answer, and the three of them took 1.8 s of the
 * player's 2.5 s start window: on a loaded machine the clip fell back with `start_stall` (BD-FIX-CUTSCENE-START-01).
 */
export async function slowClipHost(dir: string): Promise<SlowClipHost> {
  const ranges: string[] = [];
  const reads: ClipRead[] = [];
  const server = createServer((req, res) => {
    const name = (req.url ?? '/').split('?')[0]?.replace(/^\/+/, '') ?? '';
    const type = TYPES[name.split('.').pop() ?? ''];
    const cors = { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Headers': 'Range' }).end();
      return;
    }
    if (!/^[\w.-]+$/.test(name) || type === undefined) {
      res.writeHead(404, cors).end();
      return;
    }
    const range = typeof req.headers.range === 'string' ? req.headers.range : null;
    if (range !== null) ranges.push(range);
    const read: ClipRead = { name, range, pieces: 0 };
    reads.push(read);
    const body = readFileSync(`${dir}${dir.endsWith('/') ? '' : '/'}${name}`);
    res.writeHead(200, { ...cors, 'Content-Type': type, 'Content-Length': String(body.length) });
    if (range !== null) {
      read.pieces = 1;
      res.end(body);
      return;
    }
    let at = 0;
    const next = (): void => {
      if (res.destroyed) return;
      if (at >= body.length) {
        res.end();
        return;
      }
      res.write(body.subarray(at, at + CLIP_PIECE_BYTES));
      read.pieces++;
      at += CLIP_PIECE_BYTES;
      setTimeout(next, CLIP_PIECE_GAP_MS);
    };
    next();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    ranges,
    reads,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
