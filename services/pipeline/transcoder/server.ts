/**
 * The Transcoder Container's HTTP server (M05c3). One container instance serves one cutscene key (the Worker addresses it with
 * `getByName(key)`), so requests are handled one at a time with a scratch directory each. Runs on Node 22 with type stripping
 * (`node server.ts`); erasable TypeScript only, no dependency except the C2PA tool, which is imported when first needed.
 *
 *   GET  /ping     200 `ok` (the Container class pings it to learn the instance is up)
 *   GET  /health   200 `{ ok: true, signer: boolean }`: the Worker's preflight before it spends
 *   POST /ladder   body: the unmodified fal original (video/mp4). Runs ladder.sh (recipe cut@1) and answers LadderResponse.
 *   POST /resign   body: ResignRequest as JSON. Signs one rendition with our C2PA claim, the original as ingredient.
 *
 * The wire shapes are mirrored by services/pipeline/src/transcode.ts (the Worker side); a test starts this server against real
 * ffmpeg and checks both. Secrets reach the process as environment variables set by the Worker's container class
 * (`C2PA_CERT_CHAIN_PEM`, `C2PA_KEY_PEM`); nothing is logged but sizes and statuses.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type C2paState = 'valid' | 'valid-untrusted' | 'absent' | 'invalid';

export interface WireFile {
  file: string;
  contentType: string;
  codecs?: string;
  kbps?: number;
  /** Base64 of the file. */
  bytes: string;
}

export interface LadderResponse {
  recipe: 'cut@1';
  width: number;
  height: number;
  frames: number;
  fps: number;
  durationS: number;
  hasAudio: boolean;
  origC2pa: C2paState;
  /** Rendition id to file name, e.g. `{ v768: 'v768.mp4' }`. */
  renditions: Record<string, string>;
  files: WireFile[];
}

export interface ResignRequest {
  file: string;
  contentType: string;
  /** Base64 of the unsigned rendition. */
  rendition: string;
  /** Base64 of the unmodified original (the ingredient). */
  orig: string;
}

export interface ResignResponse {
  /** Base64 of the signed rendition. */
  bytes: string;
  c2pa: C2paState;
}

const LADDER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ladder.sh');
const MAX_BODY = 64 * 1024 * 1024;
const TRAINED = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';

function run(cmd: string, argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const b = c as Buffer;
    size += b.length;
    if (size > MAX_BODY) throw new HttpError(413, 'body_too_large');
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Probe {
  width: number;
  height: number;
  frames: number;
  fps: number;
  durationS: number;
  codec: string;
  hasAudio: boolean;
}

export async function probe(file: string): Promise<Probe> {
  const v = await run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_read_frames:format=duration', '-of', 'json', file]);
  if (v.code !== 0) throw new HttpError(422, 'unreadable_video');
  const j = JSON.parse(v.stdout) as { streams?: { codec_name: string; width: number; height: number; r_frame_rate: string; nb_read_frames: string }[]; format?: { duration?: string } };
  const s = j.streams?.[0];
  if (s === undefined) throw new HttpError(422, 'no_video_stream');
  const [num, den] = s.r_frame_rate.split('/').map(Number) as [number, number];
  const a = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]);
  return {
    width: s.width,
    height: s.height,
    frames: Number(s.nb_read_frames),
    fps: den > 0 ? num / den : 0,
    durationS: Number(j.format?.duration ?? 0),
    codec: s.codec_name,
    hasAudio: a.stdout.trim().length > 0,
  };
}

/** RFC 6381 codec string from the avcC box (version, profile, compatibility, level). */
export function avcCodec(mp4: Buffer): string | undefined {
  const at = mp4.indexOf('avcC');
  if (at < 0) return undefined;
  return `avc1.${[...mp4.subarray(at + 5, at + 8)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

interface C2paBuilder {
  setIntent(i: { create: string }): void;
  addIngredient(json: string, asset: { buffer: Buffer; mimeType: string }): Promise<void>;
  sign(signer: unknown, input: { path: string; mimeType: string }, output: { path: string }): unknown;
}
interface C2paReader {
  json(): unknown;
}
interface C2paModule {
  LocalSigner: { newSigner(cert: Buffer, key: Buffer, alg: string): unknown };
  Builder: { newAsync(): Promise<C2paBuilder> };
  Reader: { fromAsset(a: { path: string; mimeType: string }): Promise<C2paReader | null> };
}

let c2paModule: Promise<C2paModule> | undefined;
function c2pa(): Promise<C2paModule> {
  // The specifier is a variable: the package is installed in the image only, so the type checker must not resolve it.
  const specifier = '@contentauth/c2pa-node';
  c2paModule ??= import(specifier) as Promise<C2paModule>;
  return c2paModule;
}

/** The C2PA state of a file: `absent` when it holds no manifest, `invalid` on a failing validation, `valid-untrusted` when only the signer is not on a trust list. */
export async function c2paState(file: string, mimeType: string): Promise<C2paState> {
  let reader: C2paReader | null;
  try {
    reader = await (await c2pa()).Reader.fromAsset({ path: file, mimeType });
  } catch {
    return 'absent';
  }
  if (reader === null) return 'absent';
  const doc = reader.json() as { validation_state?: string; validation_status?: { code: string }[] };
  const codes = (doc.validation_status ?? []).map((s) => s.code);
  const failing = codes.filter((c) => c !== 'signingCredential.untrusted');
  if (doc.validation_state === 'Invalid' || failing.length > 0) return 'invalid';
  return codes.includes('signingCredential.untrusted') ? 'valid-untrusted' : 'valid';
}

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cut-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const CONTENT_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.webp': 'image/webp', '.m4a': 'audio/mp4' };
const RENDITION_IDS: Record<string, string> = { 'v768.mp4': 'v768', 'v540.mp4': 'v540', 'v1080.mp4': 'v1080' };

export async function ladder(orig: Buffer): Promise<LadderResponse> {
  if (orig.length === 0) throw new HttpError(400, 'empty_body');
  return withScratch(async (dir) => {
    const input = path.join(dir, 'orig.mp4');
    await writeFile(input, orig);
    const p = await probe(input);
    // The H3 family writes H.264 at 24 fps; anything else means the model or the recipe changed (research section 7.2 qa-gate).
    if (p.codec !== 'h264') throw new HttpError(422, `unsupported_codec:${p.codec}`);
    if (Math.abs(p.fps - 24) > 0.01) throw new HttpError(422, `unsupported_fps:${p.fps}`);
    const out = path.join(dir, 'out');
    const r = await run('bash', [LADDER, input, out]);
    if (r.code !== 0) throw new HttpError(500, `ladder_failed:${r.stderr.trim().slice(-400)}`);
    const origState = await c2paState(input, 'video/mp4');
    const files: WireFile[] = [];
    const renditions: Record<string, string> = {};
    for (const name of (await readdir(out)).sort()) {
      if (name === 'a.m4a') continue; // audio stays in the container until speech review exists (BD-M05c3-08)
      const bytes = await readFile(path.join(out, name));
      const contentType = CONTENT_TYPES[path.extname(name)] ?? 'application/octet-stream';
      const f: WireFile = { file: name, contentType, bytes: bytes.toString('base64') };
      const id = RENDITION_IDS[name];
      if (id !== undefined) {
        f.codecs = avcCodec(bytes) ?? 'avc1.640028';
        f.kbps = Math.round((bytes.length * 8) / Math.max(p.durationS, 0.001) / 1000);
        renditions[id] = name;
      }
      files.push(f);
    }
    return { recipe: 'cut@1', width: p.width, height: p.height, frames: p.frames, fps: 24, durationS: p.durationS, hasAudio: p.hasAudio, origC2pa: origState, renditions, files };
  });
}

export async function resign(req: ResignRequest, env: NodeJS.ProcessEnv = process.env): Promise<ResignResponse> {
  const cert = env['C2PA_CERT_CHAIN_PEM'];
  const key = env['C2PA_KEY_PEM'];
  if (!cert || !key) throw new HttpError(503, 'c2pa_signer_not_configured');
  const orig = Buffer.from(req.orig, 'base64');
  return withScratch(async (dir) => {
    const input = path.join(dir, 'in.mp4');
    const output = path.join(dir, 'out.mp4');
    await writeFile(input, Buffer.from(req.rendition, 'base64'));
    const mod = await c2pa();
    const signer = mod.LocalSigner.newSigner(Buffer.from(cert), Buffer.from(key), 'es256');
    const builder = await mod.Builder.newAsync();
    builder.setIntent({ create: TRAINED });
    await builder.addIngredient(
      JSON.stringify({ title: 'orig.mp4', format: 'video/mp4', instance_id: `orig-${createHash('sha256').update(orig).digest('hex').slice(0, 12)}`, relationship: 'componentOf' }),
      { buffer: orig, mimeType: 'video/mp4' },
    );
    builder.sign(signer, { path: input, mimeType: req.contentType }, { path: output });
    const bytes = await readFile(output);
    return { bytes: bytes.toString('base64'), c2pa: await c2paState(output, req.contentType) };
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

export function createTranscoderServer(env: NodeJS.ProcessEnv = process.env) {
  let busy: Promise<unknown> = Promise.resolve();
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://transcoder');
    if (req.method === 'GET' && url.pathname === '/ping') return send(res, 200, 'ok');
    // The Worker's preflight: the container is up and tells whether it holds a signing key (never the key itself).
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, signer: Boolean(env['C2PA_CERT_CHAIN_PEM'] && env['C2PA_KEY_PEM']) });
    if (req.method !== 'POST' || (url.pathname !== '/ladder' && url.pathname !== '/resign')) return send(res, 404, { error: 'not_found' });
    // one job at a time: ffmpeg already uses every core the instance has
    busy = busy.then(async () => {
      try {
        const body = await readBody(req);
        if (url.pathname === '/ladder') return send(res, 200, await ladder(body));
        return send(res, 200, await resign(JSON.parse(body.toString('utf8')) as ResignRequest, env));
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        console.error(`transcoder ${url.pathname} ${status}: ${e instanceof Error ? e.message.slice(0, 200) : 'error'}`);
        return send(res, status, { error: e instanceof Error ? e.message : 'error' });
      }
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env['PORT'] ?? 8080);
  createTranscoderServer().listen(port, () => console.log(`transcoder listening on ${port}`));
}
