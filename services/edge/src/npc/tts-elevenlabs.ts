import type { VoiceCatalogEntry } from '@dv/shared/contracts/c10-npc';
import type { Env } from '../env.ts';
import type { SpokenSentence } from './tts-workers-ai.ts';

/**
 * t2 and t3: one sentence through ElevenLabs `POST /v1/text-to-speech/{voice_id}/stream/with-timestamps?output_format=pcm_16000`
 * [research/ai-npc-runtime.md section 5.2, F-051]. The answer carries `audio_base64` and `alignment {characters,
 * character_start_times_seconds, character_end_times_seconds}`. The exact framing of the streamed body (one JSON document or newline
 * separated documents) is UNVERIFIED (U-NPC-08): this reader accepts both. Nothing here is reached in v1: Q-20 keeps t2 off
 * (`ks:tts:elevenlabs` is on by default), the catalog has no t2 entry, and `ELEVENLABS_API_KEY` is not set. Tested with a stub `fetch` only.
 */
export const ELEVENLABS_ORIGIN = 'https://api.elevenlabs.io';
export const ELEVENLABS_MODEL = 'eleven_flash_v2_5';
const TIMEOUT_MS = 6000;

interface Piece {
  audio_base64?: unknown;
  alignment?: { characters?: unknown; character_start_times_seconds?: unknown; character_end_times_seconds?: unknown } | null;
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const nums = (v: unknown): number[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : null);

/** Parses the with-timestamps body: concatenated audio and joined alignment, or null when it holds no audio. */
export function parseWithTimestamps(body: string): { bytes: Uint8Array; alignment: NonNullable<SpokenSentence['alignment']> } | null {
  const pieces: Piece[] = [];
  const whole = body.trim();
  try {
    const one = JSON.parse(whole) as Piece | Piece[];
    pieces.push(...(Array.isArray(one) ? one : [one]));
  } catch {
    for (const line of whole.split('\n')) {
      const l = line.trim();
      if (l === '') continue;
      try {
        pieces.push(JSON.parse(l) as Piece);
      } catch {
        return null;
      }
    }
  }
  const parts: Uint8Array[] = [];
  let chars = '';
  const startS: number[] = [];
  const endS: number[] = [];
  for (const p of pieces) {
    if (typeof p.audio_base64 === 'string' && p.audio_base64 !== '') parts.push(fromBase64(p.audio_base64));
    const a = p.alignment;
    const c = a?.characters;
    const s = nums(a?.character_start_times_seconds);
    const e = nums(a?.character_end_times_seconds);
    if (Array.isArray(c) && s !== null && e !== null && c.length === s.length && c.length === e.length) {
      chars += (c as string[]).join('');
      startS.push(...s);
      endS.push(...e);
    }
  }
  const total = parts.reduce((n, x) => n + x.length, 0);
  if (total === 0) return null;
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const x of parts) {
    bytes.set(x, at);
    at += x.length;
  }
  return { bytes, alignment: { chars, startS, endS } };
}

export async function speakElevenLabs(
  env: Pick<Env, 'ELEVENLABS_API_KEY'>,
  entry: VoiceCatalogEntry,
  text: string,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<SpokenSentence | null> {
  const key = env.ELEVENLABS_API_KEY;
  if (key === undefined || key === '') return null;
  const t0 = now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(`${ELEVENLABS_ORIGIN}/v1/text-to-speech/${encodeURIComponent(entry.providerVoiceId)}/stream/with-timestamps?output_format=pcm_16000`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: entry.model === 'none' ? ELEVENLABS_MODEL : entry.model }),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const parsed = parseWithTimestamps(await res.text());
    if (parsed === null) return null;
    return { codec: 'pcm_s16le_16000', bytes: parsed.bytes, ...(parsed.alignment.chars === '' ? {} : { alignment: parsed.alignment }), ms: now() - t0 };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
