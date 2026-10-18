/**
 * Thin fal queue client for the staff-side spike [research/genai-pipeline-fal.md section 4.1].
 *   POST https://queue.fal.run/{endpoint_id}  -> { request_id, status_url, response_url }
 *   poll status_url until COMPLETED (metrics.inference_time, error, error_type), then GET response_url.
 * Polling only (no public webhook receiver yet). Every submit carries X-Fal-Object-Lifecycle-Preference; a designated
 * step also sends X-Fal-Store-IO: 0. Calls run one at a time (new accounts get 2 concurrent requests). Never imported
 * by browser code. `fetch`, `sleep` and `now` are injectable for tests.
 */
import { sha256Hex } from '../../ci/lib/common.ts';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface QueueDeps {
  key: string;
  fetch: FetchFn;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  lifecycleHeader: string;
  pollMs?: number;
  timeoutMs?: number;
  /** Backoff schedule (ms) for 429 concurrent_requests_limit. */
  retryBackoffMs?: number[];
}

export interface QueueRun {
  endpointId: string;
  requestId: string | null;
  /** HTTP status of the submit, or of the result GET after a completed request. */
  httpStatus: number;
  queueWaitMs: number | null;
  runMs: number | null;
  totalMs: number;
  inferenceTimeS: number | null;
  errorType: string | null;
  error: string | null;
  result: unknown;
  /** True when the result GET succeeded. */
  retrievable: boolean;
  retries429: number;
}

export interface DownloadedFile {
  /** JSON path of the output, for example `images.0` or `video`. */
  name: string;
  contentType: string | null;
  fileSize: number;
  /** Whether the CDN response carried a Content-Length header (U-AST-3). */
  contentLengthHeader: boolean;
  sha256: string;
  bytes: Uint8Array;
  ext: string;
}

export function queueHeaders(deps: Pick<QueueDeps, 'key' | 'lifecycleHeader'>, storeIo0: boolean): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Key ${deps.key}`,
    'Content-Type': 'application/json',
    'X-Fal-Object-Lifecycle-Preference': deps.lifecycleHeader,
  };
  if (storeIo0) h['X-Fal-Store-IO'] = '0';
  return h;
}

interface StatusBody { status?: string; metrics?: { inference_time?: number }; error?: unknown; error_type?: unknown; queue_position?: number }

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : v == null ? null : JSON.stringify(v);
}

export async function runQueued(deps: QueueDeps, endpointId: string, params: Record<string, unknown>, opts: { storeIo0?: boolean } = {}): Promise<QueueRun> {
  const t0 = deps.now();
  const base: QueueRun = {
    endpointId, requestId: null, httpStatus: 0, queueWaitMs: null, runMs: null, totalMs: 0, inferenceTimeS: null,
    errorType: null, error: null, result: null, retrievable: false, retries429: 0,
  };
  const done = (patch: Partial<QueueRun>): QueueRun => ({ ...base, ...patch, totalMs: deps.now() - t0 });
  const headers = queueHeaders(deps, !!opts.storeIo0);

  let submit: Response | undefined;
  const backoff = deps.retryBackoffMs ?? [2000, 4000, 8000, 16000];
  for (let attempt = 0; ; attempt++) {
    try {
      submit = await deps.fetch(`https://queue.fal.run/${endpointId}`, { method: 'POST', headers, body: JSON.stringify(params) });
    } catch (e) {
      return done({ errorType: 'network', error: (e as Error).message });
    }
    const retry = submit.status === 429 && attempt < backoff.length;
    if (!retry) break;
    base.retries429 = attempt + 1;
    await deps.sleep(backoff[attempt] as number);
  }
  const subBody = (await submit.json().catch(() => null)) as Record<string, unknown> | null;
  if (!submit.ok || !subBody || typeof subBody.request_id !== 'string') {
    const detail = subBody && 'detail' in subBody ? str(subBody.detail) : null;
    return done({ httpStatus: submit.status, errorType: str(subBody?.error_type) ?? `http_${submit.status}`, error: detail ?? str(subBody?.error) });
  }
  const requestId = subBody.request_id;
  const statusUrl = String(subBody.status_url);
  const responseUrl = String(subBody.response_url);
  base.requestId = requestId;
  base.httpStatus = submit.status;

  const pollMs = deps.pollMs ?? 2000;
  const timeoutMs = deps.timeoutMs ?? 20 * 60_000;
  let firstRunning: number | null = null;
  let last: StatusBody = {};
  for (;;) {
    let res: Response;
    try {
      res = await deps.fetch(statusUrl, { headers: { Authorization: `Key ${deps.key}` } });
    } catch (e) {
      return done({ errorType: 'network', error: (e as Error).message });
    }
    last = ((await res.json().catch(() => ({}))) as StatusBody) ?? {};
    const status = last.status;
    if (status === 'IN_PROGRESS' && firstRunning === null) firstRunning = deps.now();
    if (status === 'COMPLETED') break;
    if (deps.now() - t0 > timeoutMs) return done({ errorType: 'timeout', error: `no COMPLETED after ${timeoutMs} ms` });
    await deps.sleep(pollMs);
  }
  const completedAt = deps.now();
  base.queueWaitMs = (firstRunning ?? completedAt) - t0;
  base.inferenceTimeS = typeof last.metrics?.inference_time === 'number' ? last.metrics.inference_time : null;
  base.runMs = base.inferenceTimeS !== null ? Math.round(base.inferenceTimeS * 1000) : completedAt - (firstRunning ?? t0);
  base.errorType = str(last.error_type);
  base.error = str(last.error);

  let result: Response;
  try {
    result = await deps.fetch(responseUrl, { headers: { Authorization: `Key ${deps.key}` } });
  } catch (e) {
    return done({ errorType: base.errorType ?? 'network', error: base.error ?? (e as Error).message });
  }
  const body = (await result.json().catch(() => null)) as unknown;
  base.httpStatus = result.status;
  if (!result.ok && !base.errorType) {
    const d = body && typeof body === 'object' && 'detail' in body ? str((body as { detail: unknown }).detail) : null;
    base.errorType = `http_${result.status}`;
    base.error = d;
  }
  return done({ result: body, retrievable: result.ok });
}

/** Output objects of a result: every object with a string `url`, with its JSON path. */
export function findOutputs(result: unknown): { name: string; url: string; contentType?: string; fileName?: string }[] {
  const out: { name: string; url: string; contentType?: string; fileName?: string }[] = [];
  const walk = (v: unknown, p: string): void => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, p ? `${p}.${i}` : String(i)));
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.url === 'string' && /^https?:\/\//.test(o.url)) {
        const item: { name: string; url: string; contentType?: string; fileName?: string } = { name: p || 'output', url: o.url };
        if (typeof o.content_type === 'string') item.contentType = o.content_type;
        if (typeof o.file_name === 'string') item.fileName = o.file_name;
        out.push(item);
      } else for (const [k, x] of Object.entries(o)) walk(x, p ? `${p}.${k}` : k);
    }
  };
  walk(result, '');
  return out;
}

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac',
  'model/gltf-binary': 'glb', 'application/octet-stream': 'bin',
};

export function extFor(contentType: string | null, url: string, fileName?: string): string {
  const fromName = fileName?.match(/\.([A-Za-z0-9]{2,5})$/)?.[1];
  if (fromName) return fromName.toLowerCase();
  const fromUrl = new URL(url).pathname.match(/\.([A-Za-z0-9]{2,5})$/)?.[1];
  if (fromUrl) return fromUrl.toLowerCase();
  return EXT[(contentType ?? '').split(';')[0]?.trim() ?? ''] ?? 'bin';
}

/** Downloads one output at once (fal CDN copies expire). No Authorization header goes to the CDN. */
export async function download(fetchFn: FetchFn, o: { name: string; url: string; contentType?: string; fileName?: string }): Promise<DownloadedFile | { name: string; error: string }> {
  try {
    const res = await fetchFn(o.url);
    if (!res.ok) return { name: o.name, error: `HTTP ${res.status}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') ?? o.contentType ?? null;
    return {
      name: o.name,
      contentType,
      fileSize: bytes.length,
      contentLengthHeader: res.headers.get('content-length') !== null,
      sha256: sha256Hex(bytes),
      bytes,
      ext: extFor(contentType, o.url, o.fileName),
    };
  } catch (e) {
    return { name: o.name, error: (e as Error).message };
  }
}
