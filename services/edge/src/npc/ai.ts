import type { Env } from '../env.ts';

/**
 * Workers AI calls of the NPC runtime (M06a4): bge-m3 embeddings for memory and Aura text-to-speech. Both go through the `AI` binding,
 * which needs no key. Every function returns null (never throws) when the binding is absent, the call fails or takes longer than its
 * budget, so a turn goes on without memory or voice. Neither the text nor the audio is ever logged.
 *
 * Shapes (spec/03 section 7, checked against developers.cloudflare.com/workers-ai/models on 2026-10-22):
 *  - `@cf/baai/bge-m3` takes `{ text: string | string[] }` and returns `{ shape: [n, 1024], data: number[][] }`.
 *  - `@cf/deepgram/aura-1` and `aura-2-en` take `{ text, speaker, encoding }` (`encoding: 'mp3'` is listed for both). With
 *    `returnRawResponse: true` the binding returns a `Response`; without it a `ReadableStream`. Both are read to bytes here.
 */
export const EMBED_MODEL = '@cf/baai/bge-m3';
export const EMBED_DIM = 1024;
export const EMBED_TIMEOUT_MS = 2500;
export const TTS_TIMEOUT_MS = 6000;

interface AiRun {
  run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const h = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(h);
        resolve(v);
      },
      () => {
        clearTimeout(h);
        resolve(null);
      },
    );
  });
}

/** One bge-m3 vector per text, in order, or null when anything about the call or the answer is wrong. */
export async function embedTexts(env: Pick<Env, 'AI'>, texts: readonly string[]): Promise<Float32Array[] | null> {
  if (env.AI === undefined || texts.length === 0) return texts.length === 0 ? [] : null;
  const ai = env.AI as unknown as AiRun;
  const out = await withTimeout(Promise.resolve().then(() => ai.run(EMBED_MODEL, { text: [...texts] })), EMBED_TIMEOUT_MS);
  const data = (out as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length !== texts.length) return null;
  const vectors: Float32Array[] = [];
  for (const row of data as unknown[]) {
    if (!Array.isArray(row) || row.length !== EMBED_DIM) return null;
    const v = new Float32Array(EMBED_DIM);
    for (let i = 0; i < EMBED_DIM; i++) {
      const x = Number(row[i]);
      if (!Number.isFinite(x)) return null;
      v[i] = x;
    }
    vectors.push(v);
  }
  return vectors;
}

export async function embedText(env: Pick<Env, 'AI'>, text: string): Promise<Float32Array | null> {
  const r = await embedTexts(env, [text]);
  return r === null ? null : (r[0] ?? null);
}

async function toBytes(out: unknown): Promise<Uint8Array | null> {
  if (out instanceof Response) return new Uint8Array(await out.arrayBuffer());
  if (out instanceof ReadableStream) return new Uint8Array(await new Response(out).arrayBuffer());
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (out instanceof Uint8Array) return out;
  const audio = (out as { audio?: unknown } | null)?.audio;
  if (typeof audio === 'string') {
    const bin = atob(audio);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return null;
}

export interface AuraResult {
  bytes: Uint8Array;
  /** Wall time of the call, ms. The staging probe records it. */
  ms: number;
}

/** One Aura sentence as mp3 bytes, or null on any failure (binding absent, error, timeout, empty answer). */
export async function auraSpeak(env: Pick<Env, 'AI'>, model: string, speaker: string, text: string, now: () => number = Date.now): Promise<AuraResult | null> {
  if (env.AI === undefined) return null;
  const ai = env.AI as unknown as AiRun;
  const t0 = now();
  const bytes = await withTimeout(
    Promise.resolve()
      .then(() => ai.run(model, { text, speaker, encoding: 'mp3' }, { returnRawResponse: true }))
      .then(toBytes),
    TTS_TIMEOUT_MS,
  );
  if (bytes === null || bytes.length === 0) return null;
  return { bytes, ms: now() - t0 };
}

/** Standard base64 of bytes, in slices that keep the argument list of `String.fromCharCode` small. */
export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
