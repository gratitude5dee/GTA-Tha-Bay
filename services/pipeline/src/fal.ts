/**
 * fal.ai queue client, header set, and webhook verification (research/genai-pipeline-fal.md sections 4.1 and 4.2).
 * Server-side only: FAL_KEY is a Worker secret and fal is never called from a browser (fal ToS 4(b)).
 * Nothing here runs against the live service until ADR-GENAI-01 is `cleared` (the gate refuses first).
 */
import type { FalPort, FalResult, FalStatus, FalSubmission, FalSubmitOptions } from './ports.ts';

export const FAL_WEBHOOK_HEADERS = {
  requestId: 'X-Fal-Webhook-Request-Id',
  userId: 'X-Fal-Webhook-User-Id',
  timestamp: 'X-Fal-Webhook-Timestamp',
  signature: 'X-Fal-Webhook-Signature',
} as const;

export const FAL_JWKS_URL = 'https://rest.fal.ai/.well-known/jwks.json';
/** Allowed clock skew between fal's timestamp and ours, in seconds. */
export const FAL_WEBHOOK_SKEW_S = 300;
/** JWKS cache lifetime, in milliseconds (research: cache keys 24 h at most). */
export const FAL_JWKS_TTL_MS = 24 * 60 * 60 * 1000;
export const FAL_DONE_EVENT = 'fal-done';

export interface Jwk {
  kty: string;
  crv?: string;
  x: string;
  kid?: string;
}
export interface Jwks {
  keys: Jwk[];
}
export interface JwksSource {
  get(): Promise<Jwks>;
}

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The message fal signs: request id, user id, timestamp and the SHA-256 hex of the body, one per line. */
export async function webhookMessage(h: { requestId: string; userId: string; timestamp: string }, body: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  const bodyHex = toHex(await crypto.subtle.digest('SHA-256', body));
  return encoder.encode([h.requestId, h.userId, h.timestamp, bodyHex].join('\n')) as Uint8Array<ArrayBuffer>;
}

/** ED25519 check against any key of the JWKS, with a +-300 s skew window. */
export async function verifyFalWebhook(headers: Headers, rawBody: ArrayBuffer, jwks: Jwks, nowMs: number): Promise<boolean> {
  const requestId = headers.get(FAL_WEBHOOK_HEADERS.requestId);
  const userId = headers.get(FAL_WEBHOOK_HEADERS.userId);
  const timestamp = headers.get(FAL_WEBHOOK_HEADERS.timestamp);
  const signature = headers.get(FAL_WEBHOOK_HEADERS.signature);
  if (!requestId || !userId || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > FAL_WEBHOOK_SKEW_S) return false;
  const sig = fromHex(signature);
  if (sig === null) return false;
  const message = await webhookMessage({ requestId, userId, timestamp }, rawBody);
  for (const k of jwks.keys) {
    if (k.kty !== 'OKP' || (k.crv !== undefined && k.crv !== 'Ed25519')) continue;
    try {
      // fal's `x` values carry '=' padding; WebCrypto's JWK import wants none.
      const key = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: k.x.replace(/=+$/, '') }, { name: 'Ed25519' }, false, ['verify']);
      if (await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, message)) return true;
    } catch {
      // a malformed key is skipped; the next key may match
    }
  }
  return false;
}

export function staticJwksSource(jwks: Jwks): JwksSource {
  return { get: () => Promise.resolve(jwks) };
}

export interface JwksCacheStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/** Live source: the fal JWKS, cached in memory and in a store (KV) for at most 24 h. */
export function liveJwksSource(opts: { fetch: typeof fetch; now: () => number; store?: JwksCacheStore }): JwksSource {
  let memo: { at: number; jwks: Jwks } | null = null;
  return {
    async get(): Promise<Jwks> {
      const now = opts.now();
      if (memo !== null && now - memo.at < FAL_JWKS_TTL_MS) return memo.jwks;
      const cached = opts.store ? await opts.store.get('fal:jwks') : null;
      if (cached !== null) {
        const parsed = JSON.parse(cached) as { at: number; jwks: Jwks };
        if (now - parsed.at < FAL_JWKS_TTL_MS) {
          memo = parsed;
          return parsed.jwks;
        }
      }
      const res = await opts.fetch(FAL_JWKS_URL);
      if (!res.ok) throw new Error(`fal jwks ${res.status}`);
      const jwks = (await res.json()) as Jwks;
      memo = { at: now, jwks };
      if (opts.store) await opts.store.put('fal:jwks', JSON.stringify(memo), Math.floor(FAL_JWKS_TTL_MS / 1000));
      return jwks;
    },
  };
}

export interface WorkflowInstanceLike {
  sendEvent(event: { type: string; payload: unknown }): Promise<void>;
}

export interface WebhookDeps {
  jwks: JwksSource;
  now: () => number;
  /** Looks up the Workflow instance by id; null (or a throw) when there is none. */
  getInstance(id: string): Promise<WorkflowInstanceLike | null>;
  /** Called once per rejected delivery (raises alarm A11 in M14b). */
  onInvalid?(reason: string): void;
}

export interface WebhookResult {
  status: 200 | 400 | 401;
  delivered: boolean;
  reason?: string;
}

const WF_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/;

/** Route 29: verify, wake the instance, answer fast (fal waits 15 s for a 2xx). */
export async function handleFalWebhook(request: Request, deps: WebhookDeps): Promise<WebhookResult> {
  const body = await request.arrayBuffer();
  let jwks: Jwks;
  try {
    jwks = await deps.jwks.get();
  } catch {
    deps.onInvalid?.('jwks_unavailable');
    return { status: 401, delivered: false, reason: 'jwks_unavailable' };
  }
  if (!(await verifyFalWebhook(request.headers, body, jwks, deps.now()))) {
    deps.onInvalid?.('bad_signature');
    return { status: 401, delivered: false, reason: 'bad_signature' };
  }
  const wf = new URL(request.url).searchParams.get('wf');
  if (wf === null || !WF_ID.test(wf)) return { status: 400, delivered: false, reason: 'bad_wf' };
  let payload: { request_id?: unknown; status?: unknown };
  try {
    payload = JSON.parse(new TextDecoder().decode(body)) as typeof payload;
  } catch {
    return { status: 400, delivered: false, reason: 'bad_body' };
  }
  let instance: WorkflowInstanceLike | null = null;
  try {
    instance = await deps.getInstance(wf);
  } catch {
    instance = null;
  }
  // An unknown or finished instance still answers 2xx so that fal stops retrying.
  if (instance === null) return { status: 200, delivered: false, reason: 'no_instance' };
  try {
    await instance.sendEvent({ type: FAL_DONE_EVENT, payload: { request_id: payload.request_id ?? null, status: payload.status ?? null } });
  } catch {
    return { status: 200, delivered: false, reason: 'instance_not_waiting' };
  }
  return { status: 200, delivered: true };
}

/** Headers fal's queue accepts on a submit (research section 4.1). */
export function falSubmitHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Key ${key}`,
    'Content-Type': 'application/json',
    'X-Fal-Object-Lifecycle-Preference': JSON.stringify({ expiration_duration_seconds: 86400 }),
    'X-Fal-Request-Start-Timeout': '3600',
  };
}

/**
 * Queue client over fetch. It exists so the pipeline has a live adapter to bind; the live run waits for ADR-GENAI-01 `cleared`
 * and the M05c3 first paid run, which also fills in the output shape (the `video.url` path below is UNVERIFIED) and `keyframe`.
 */
export class LiveFalPort implements FalPort {
  constructor(private readonly opts: { key: string; fetch: typeof fetch }) {}

  async submit(endpointId: string, input: Record<string, unknown>, o: FalSubmitOptions): Promise<FalSubmission> {
    const u = new URL(`https://queue.fal.run/${endpointId}`);
    u.searchParams.set('fal_webhook', o.webhookUrl);
    const res = await this.opts.fetch(u, { method: 'POST', body: JSON.stringify(input), headers: falSubmitHeaders(this.opts.key) });
    if (!res.ok) throw new Error(`fal submit ${res.status}`); // 429 concurrent_requests_limit: the step retries with backoff
    const j = (await res.json()) as { request_id: string; status_url: string; response_url: string; cancel_url: string };
    return { requestId: j.request_id, statusUrl: j.status_url, responseUrl: j.response_url, cancelUrl: j.cancel_url };
  }

  async status(sub: FalSubmission): Promise<FalStatus> {
    const res = await this.opts.fetch(sub.statusUrl, { headers: { Authorization: `Key ${this.opts.key}` } });
    if (!res.ok) throw new Error(`fal status ${res.status}`);
    const j = (await res.json()) as { status: FalStatus['status']; error?: string; error_type?: string };
    return { status: j.status, ...(j.error !== undefined ? { error: j.error } : {}), ...(j.error_type !== undefined ? { errorType: j.error_type } : {}) };
  }

  async result(sub: FalSubmission): Promise<FalResult> {
    const res = await this.opts.fetch(sub.responseUrl, { headers: { Authorization: `Key ${this.opts.key}` } });
    if (!res.ok) throw new Error(`fal result ${res.status}`);
    const j = (await res.json()) as { video?: { url?: string; content_type?: string } };
    const url = j.video?.url; // UNVERIFIED output shape for the video providers: confirmed in M05c3
    if (typeof url !== 'string') throw new Error('fal result has no video url');
    return { videoUrl: url, contentType: j.video?.content_type ?? 'video/mp4' };
  }

  async cancel(sub: FalSubmission): Promise<void> {
    await this.opts.fetch(sub.cancelUrl, { method: 'PUT', headers: { Authorization: `Key ${this.opts.key}` } });
  }

  async fetchFile(url: string): Promise<Uint8Array> {
    const res = await this.opts.fetch(url);
    if (!res.ok) throw new Error(`fal file ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async fetchStream(url: string): Promise<{ body: ReadableStream<Uint8Array>; size: number | null; contentType: string }> {
    const res = await this.opts.fetch(url);
    if (!res.ok || res.body === null) throw new Error(`fal file ${res.status}`);
    const len = res.headers.get('Content-Length');
    const size = len !== null && /^\d+$/.test(len) ? Number(len) : null;
    return { body: res.body, size, contentType: res.headers.get('Content-Type') ?? 'video/mp4' };
  }

  keyframe(): Promise<{ sha256: string }> {
    return Promise.reject(new Error('LiveFalPort.keyframe lands with the first live run (M05c3)'));
  }
}
