import type * as Fs from 'node:fs';
import type * as Http from 'node:http';
import * as threads from 'node:worker_threads';
import { SAFE_SEGMENT } from './media-ranges.ts';

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
  /** Every file request the host answered, in order (`pieces` is final once the response has ended). */
  reads: ClipRead[];
  /**
   * The file this host serves for `url`, or null for a URL of another origin or a name it does not serve. The range layer reads a
   * ranged request's bytes from it (`serveMediaRanges(page, host.file)`), as the media route reads R2.
   */
  file(url: string): string | null;
  close(): Promise<void>;
}

type HostConfig = { dir: string; types: Record<string, string>; safe: string; pieceBytes: number; gapMs: number };
type HostMessage = { t: 'listening'; port: number } | { t: 'read'; i: number; name: string; range: string | null } | { t: 'pieces'; i: number; pieces: number } | { t: 'closed' };

/**
 * The server, run on its own thread: the worker's script is this function's source, so it names nothing from outside. Paced writes,
 * preflights and 404s as `slowClipHost` describes; it reports each read to the thread that started it.
 */
function serveClips(cfg: HostConfig): void {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { createServer } = require('node:http') as typeof Http;
  const { readFileSync } = require('node:fs') as typeof Fs;
  const { parentPort } = require('node:worker_threads') as typeof threads;
  /* eslint-enable @typescript-eslint/no-require-imports */
  const port = parentPort;
  if (port === null) return;
  const safe = new RegExp(cfg.safe);
  let n = 0;
  const server = createServer((req, res) => {
    const name = (req.url ?? '/').split('?')[0]?.replace(/^\/+/, '') ?? '';
    const type = cfg.types[name.split('.').pop() ?? ''];
    const cors = { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Headers': 'Range' }).end();
      return;
    }
    if (!safe.test(name) || type === undefined) {
      res.writeHead(404, cors).end();
      return;
    }
    const range = typeof req.headers.range === 'string' ? req.headers.range : null;
    const i = n++;
    let pieces = 0;
    port.postMessage({ t: 'read', i, name, range } satisfies HostMessage);
    res.on('close', () => port.postMessage({ t: 'pieces', i, pieces } satisfies HostMessage));
    const body = readFileSync(`${cfg.dir}${cfg.dir.endsWith('/') ? '' : '/'}${name}`);
    res.writeHead(200, { ...cors, 'Content-Type': type, 'Content-Length': String(body.length) });
    if (range !== null) {
      pieces = 1;
      res.end(body);
      return;
    }
    let at = 0;
    const next = (): void => {
      if (res.destroyed) return;
      if (at >= body.length) {
        port.postMessage({ t: 'pieces', i, pieces } satisfies HostMessage);
        res.end();
        return;
      }
      res.write(body.subarray(at, at + cfg.pieceBytes));
      pieces++;
      at += cfg.pieceBytes;
      setTimeout(next, cfg.gapMs);
    };
    next();
  });
  port.on('message', (m: unknown) => {
    if (m !== 'close') return;
    server.closeAllConnections();
    server.close(() => port.postMessage({ t: 'closed' } satisfies HostMessage));
  });
  server.listen(0, '127.0.0.1', () => {
    const a = server.address();
    port.postMessage({ t: 'listening', port: typeof a === 'object' && a !== null ? a.port : 0 } satisfies HostMessage);
  });
}

/**
 * A second origin that serves the files of `dir` as a loaded runner's local Worker serves a clip (BD-FIX-CUTFLAKE-01): it ignores
 * `Range` (200 and the whole file, like the static-asset server of `wrangler dev`), and the browser's own download, a request without
 * `Range`, goes out in 64 KB pieces 30 ms apart, so the clip is still arriving after the browser has parsed its `moov`. It records every
 * `Range` header it is sent and every read.
 *
 * A ranged read of a clip does not reach this host in the test that uses it: the range layer (`serveMediaRanges(page, host.file)`)
 * answers it from the file, as the production media route answers it with one ranged R2 read, not slowed by a download of the same
 * object in flight. One that does reach it gets the whole file in one piece, still `200`, so a range that reached the browser
 * unanswered would still fail WebKit's load. The server runs on a thread of its own (BD-FIX-CUTSCENE-START-01): on the Playwright
 * worker's thread, which on a loaded runner ran hundreds of milliseconds to seconds late, its answers (the manifest, the poster, each
 * piece of the clip) waited behind every other event of that thread.
 */
export async function slowClipHost(dir: string): Promise<SlowClipHost> {
  const ranges: string[] = [];
  const reads: ClipRead[] = [];
  const cfg: HostConfig = { dir, types: TYPES, safe: SAFE_SEGMENT.source, pieceBytes: CLIP_PIECE_BYTES, gapMs: CLIP_PIECE_GAP_MS };
  const worker = new threads.Worker(`(${serveClips.toString()})(require('node:worker_threads').workerData)`, { eval: true, workerData: cfg });
  const byIndex = new Map<number, ClipRead>();
  let closed: () => void = () => undefined;
  const port = await new Promise<number>((resolve, reject) => {
    worker.once('error', reject);
    worker.on('message', (m: HostMessage) => {
      if (m.t === 'listening') resolve(m.port);
      else if (m.t === 'read') {
        const read: ClipRead = { name: m.name, range: m.range, pieces: 0 };
        byIndex.set(m.i, read);
        reads.push(read);
        if (m.range !== null) ranges.push(m.range);
      } else if (m.t === 'pieces') {
        const read = byIndex.get(m.i);
        if (read) read.pieces = m.pieces;
      } else closed();
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const pathOf = (name: string): string | null => (SAFE_SEGMENT.test(name) && TYPES[name.split('.').pop() ?? ''] !== undefined ? `${dir}${dir.endsWith('/') ? '' : '/'}${name}` : null);
  return {
    origin,
    ranges,
    reads,
    file: (url) => {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        return null;
      }
      return u.origin === origin ? pathOf(u.pathname.replace(/^\/+/, '')) : null;
    },
    close: async () => {
      await new Promise<void>((resolve) => {
        closed = resolve;
        worker.postMessage('close');
        setTimeout(resolve, 2000).unref();
      });
      await worker.terminate();
    },
  };
}
