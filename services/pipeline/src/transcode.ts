/**
 * The real `TranscodePort` and `SignPort` (M05c3, DL-232): thin HTTP clients of the Transcoder Container
 * (`services/pipeline/transcoder/server.ts`). The Worker addresses one container instance per cutscene key through the
 * `TRANSCODER` binding; this file only maps requests and responses, so it runs unchanged against a stub in tests.
 *
 * The container never publishes anything: it returns the files, and the cutscene steps write them to R2.
 */
import type { SignedFile, SignPort, TranscodedFile, TranscodePort, TranscodeResult } from './ports.ts';

/** What a Container Durable Object stub offers (`getByName(key)` of `@cloudflare/containers`): `fetch` into the container. */
export interface ContainerFetcher {
  fetch(request: Request): Promise<Response>;
}

/** Hostname the Container class forwards to the instance; any value works, the path is what the server routes on. */
export const CONTAINER_ORIGIN = 'http://transcoder';

type C2paState = TranscodeResult['origC2pa'];

/** The `/ladder` response of server.ts. */
export interface LadderWire {
  recipe: 'cut@1';
  width: number;
  height: number;
  frames: number;
  fps: number;
  durationS: number;
  hasAudio: boolean;
  origC2pa: C2paState;
  renditions: Record<string, string>;
  files: { file: string; contentType: string; codecs?: string; kbps?: number; bytes: string }[];
}

/** The `/resign` request and response of server.ts. */
export interface ResignWireRequest {
  file: string;
  contentType: string;
  rendition: string;
  orig: string;
}
export interface ResignWireResponse {
  bytes: string;
  c2pa: C2paState;
}

const CHUNK = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const C2PA_STATES: readonly string[] = ['valid', 'valid-untrusted', 'absent', 'invalid'];

async function failure(what: string, res: Response): Promise<Error> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 200);
  } catch {
    /* the body is only context */
  }
  return new Error(`${what} answered HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
}

function isLadder(v: unknown): v is LadderWire {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Partial<LadderWire>;
  return o.recipe === 'cut@1' && typeof o.width === 'number' && typeof o.height === 'number' && typeof o.frames === 'number' && Array.isArray(o.files)
    && typeof o.renditions === 'object' && o.renditions !== null && typeof o.origC2pa === 'string' && C2PA_STATES.includes(o.origC2pa);
}

/** Maps the `/ladder` response to a `TranscodeResult`. Throws when the shape is wrong or a named rendition has no file. */
export function ladderToResult(wire: unknown): TranscodeResult {
  if (!isLadder(wire)) throw new Error('the transcoder answered with an unknown shape');
  const files: TranscodedFile[] = wire.files.map((f) => ({
    file: f.file,
    bytes: fromBase64(f.bytes),
    contentType: f.contentType,
    ...(f.codecs !== undefined ? { codecs: f.codecs } : {}),
    ...(f.kbps !== undefined ? { kbps: f.kbps } : {}),
  }));
  for (const [id, file] of Object.entries(wire.renditions)) {
    if (!files.some((f) => f.file === file)) throw new Error(`rendition ${id} names ${file}, which the transcoder did not return`);
  }
  if (!('v768' in wire.renditions) && !('v1080' in wire.renditions)) throw new Error('the transcoder returned no v768 or v1080 rendition');
  // Speech detection needs Workers AI in the Worker; the container withholds the audio track, so nothing here can carry speech (BD-M05c3-08).
  return { recipe: 'cut@1', files, width: wire.width, height: wire.height, frames: wire.frames, renditions: wire.renditions, speechDetected: false, origC2pa: wire.origC2pa };
}

/** The `/health` response of server.ts. */
export interface HealthWire {
  ok: boolean;
  signer: boolean;
}

async function health(container: ContainerFetcher): Promise<HealthWire | string> {
  try {
    const res = await container.fetch(new Request(`${CONTAINER_ORIGIN}/health`));
    if (!res.ok) return `the container answered /health with HTTP ${res.status}`;
    const wire = (await res.json()) as Partial<HealthWire>;
    return { ok: wire.ok === true, signer: wire.signer === true };
  } catch (e) {
    return `the container did not answer /health (${e instanceof Error ? e.message.slice(0, 120) : 'error'})`;
  }
}

export class ContainerTranscodePort implements TranscodePort {
  private readonly container: ContainerFetcher;
  constructor(container: ContainerFetcher) {
    this.container = container;
  }

  async ready(): Promise<string | null> {
    const h = await health(this.container);
    return typeof h === 'string' ? h : h.ok ? null : 'the container reports it is not ok';
  }

  async transcode(orig: Uint8Array): Promise<TranscodeResult> {
    const res = await this.container.fetch(new Request(`${CONTAINER_ORIGIN}/ladder`, { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: new Uint8Array(orig) }));
    if (!res.ok) throw await failure('transcode /ladder', res);
    return ladderToResult(await res.json());
  }
}

export class ContainerSignPort implements SignPort {
  private readonly container: ContainerFetcher;
  constructor(container: ContainerFetcher) {
    this.container = container;
  }

  async ready(): Promise<string | null> {
    const h = await health(this.container);
    if (typeof h === 'string') return h;
    return h.signer ? null : 'the container holds no C2PA signing key (secrets C2PA_CERT_CHAIN_PEM and C2PA_KEY_PEM)';
  }

  async resign(rendition: { file: string; bytes: Uint8Array; contentType: string }, orig: Uint8Array): Promise<SignedFile> {
    const body: ResignWireRequest = { file: rendition.file, contentType: rendition.contentType, rendition: toBase64(rendition.bytes), orig: toBase64(orig) };
    const res = await this.container.fetch(new Request(`${CONTAINER_ORIGIN}/resign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    if (!res.ok) throw await failure('resign /resign', res);
    const wire = (await res.json()) as Partial<ResignWireResponse>;
    if (typeof wire.bytes !== 'string' || typeof wire.c2pa !== 'string' || !C2PA_STATES.includes(wire.c2pa)) throw new Error('the transcoder answered /resign with an unknown shape');
    // A claim that does not validate is never published: the step fails and retries, the original stays private.
    if (wire.c2pa === 'invalid' || wire.c2pa === 'absent') throw new Error(`the re-signed ${rendition.file} reads back as c2pa ${wire.c2pa}`);
    return { bytes: fromBase64(wire.bytes), c2pa: wire.c2pa as C2paState, resigned: true };
  }
}

/** A port that fails with the reason when the container is not bound: the job refuses before it spends (see `preflight`). */
export function containerPorts(binding: { getByName(name: string): ContainerFetcher } | undefined, key: string): { transcode: TranscodePort; sign: SignPort } | null {
  if (binding === undefined) return null;
  const stub = binding.getByName(key);
  return { transcode: new ContainerTranscodePort(stub), sign: new ContainerSignPort(stub) };
}
