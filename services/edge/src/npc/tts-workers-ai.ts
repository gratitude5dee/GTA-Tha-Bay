import type { VoiceCatalogEntry } from '@dv/shared/contracts/c10-npc';
import type { Env } from '../env.ts';
import { auraSpeak } from './ai.ts';

/** t1: one sentence through Workers AI Aura (`@cf/deepgram/aura-1`, or `aura-2-en` when the catalog default is moved to it), as mp3. */
export interface SpokenSentence {
  codec: 'mp3' | 'pcm_s16le_16000';
  bytes: Uint8Array;
  /** t2 only: per-character timing for the viseme mapper. */
  alignment?: { chars: string; startS: number[]; endS: number[] };
  /** Wall time of the provider call, ms. */
  ms: number;
}

export async function speakWorkersAi(env: Pick<Env, 'AI'>, entry: VoiceCatalogEntry, text: string, now: () => number = Date.now): Promise<SpokenSentence | null> {
  const r = await auraSpeak(env, entry.model, entry.providerVoiceId, text, now);
  return r === null ? null : { codec: 'mp3', bytes: r.bytes, ms: r.ms };
}
