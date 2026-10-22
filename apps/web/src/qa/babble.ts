/**
 * QA builds only (M06a4): a synthetic stand-in for a spoken line, so `?npc=local` can show the whole voice path (TtsPlayer on the voice bus,
 * ducking, the mouth shapes) in a browser with no Worker and no Workers AI. It is not speech: one voiced burst per word, a pitch taken from the
 * letters, 16 kHz mono PCM. Real Aura audio arrives from the Worker for any soul whose voice tier is `t1`.
 */
import type { AudioChunk } from '@dv/shared/contracts/c10-npc';

const RATE = 16000;
const CHUNK_BYTES = 12_288;

function wordBurst(word: string): Float32Array {
  const dur = Math.min(0.5, 0.09 + 0.05 * word.length);
  const n = Math.floor(dur * RATE);
  const f0 = 105 + (Array.from(word).reduce((a, c) => a + c.charCodeAt(0), 0) % 7) * 14;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.pow(Math.sin((Math.PI * i) / n), 0.6);
    const syll = 0.65 + 0.35 * Math.sin(2 * Math.PI * 5 * t);
    const tone = Math.sin(2 * Math.PI * f0 * t) + 0.5 * Math.sin(2 * Math.PI * 2 * f0 * t) + 0.3 * Math.sin(2 * Math.PI * 3 * f0 * t);
    out[i] = 0.3 * env * syll * tone;
  }
  return out;
}

/** PCM s16le for a sentence: its words as bursts, 50 ms of silence between them. */
export function babblePcm(sentence: string): Uint8Array {
  const parts: Float32Array[] = [];
  const gap = new Float32Array(Math.floor(0.05 * RATE));
  for (const w of sentence.split(/\s+/).filter((x) => x !== '')) parts.push(wordBurst(w), gap);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(total * 2);
  const view = new DataView(bytes.buffer);
  let at = 0;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) view.setInt16((at + i) * 2, Math.max(-1, Math.min(1, p[i] as number)) * 32767, true);
    at += p.length;
  }
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The `AudioChunk`s of a line, sentence by sentence, as the Worker's TtsRouter would send them. */
export function babbleChunks(line: string): AudioChunk[] {
  const sentences = line.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter((s) => s !== '') ?? [line];
  const out: AudioChunk[] = [];
  sentences.forEach((s, sentence) => {
    const pcm = babblePcm(s);
    const total = Math.max(1, Math.ceil(pcm.length / CHUNK_BYTES));
    for (let c = 0; c < total; c++) {
      out.push({ sentence, codec: 'pcm_s16le_16000', b64: toBase64(pcm.subarray(c * CHUNK_BYTES, (c + 1) * CHUNK_BYTES)), last: c === total - 1 });
    }
  });
  return out;
}
