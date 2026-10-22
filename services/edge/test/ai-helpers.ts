import { env } from 'cloudflare:test';
import type { Env } from '../src/env.ts';
import vectors from './fixtures/ai/bge-m3.json';
import auraMp3 from './fixtures/ai/aura.mp3?raw';

/** A stub of the Workers AI binding for the M06a4 suites: bge-m3 from fixtures/ai/bge-m3.json, Aura from fixtures/ai/aura.mp3. */
export const AURA_BYTES = new TextEncoder().encode(auraMp3);

const DIM = 1024;
const TABLE = vectors.texts as Record<string, [number, number][]>;

/** The stub embedding of a text: its listed sparse vector, else a unit vector on an axis taken from its characters. */
export function stubVector(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  const listed = TABLE[text];
  if (listed !== undefined) {
    for (const [axis, value] of listed) v[axis] = value;
    return v;
  }
  let h = 7;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 997;
  v[100 + (h % 900)] = 1;
  return v;
}

export interface AiCall {
  model: string;
  inputs: Record<string, unknown>;
  options?: Record<string, unknown> | undefined;
}

export interface FakeAi {
  ai: Ai;
  calls: AiCall[];
  /** Make the next calls of a model fail (true) or answer again (false). */
  fail: { embed: boolean; tts: boolean };
}

export function fakeAi(): FakeAi {
  const calls: AiCall[] = [];
  const fail = { embed: false, tts: false };
  const ai = {
    run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown> {
      calls.push({ model, inputs, options });
      if (model === '@cf/baai/bge-m3') {
        if (fail.embed) return Promise.reject(new Error('embedding down'));
        const text = Array.isArray(inputs['text']) ? (inputs['text'] as string[]) : [String(inputs['text'])];
        return Promise.resolve({ shape: [text.length, DIM], data: text.map(stubVector) });
      }
      if (model.startsWith('@cf/deepgram/aura')) {
        if (fail.tts) return Promise.reject(new Error('tts down'));
        return Promise.resolve(options?.['returnRawResponse'] === true ? new Response(AURA_BYTES) : new Response(AURA_BYTES).body);
      }
      return Promise.reject(new Error(`unexpected model ${model}`));
    },
  } as unknown as Ai;
  return { ai, calls, fail };
}

/** The test environment with the AI stub bound. */
export const withAi = (f: FakeAi): Partial<Env> => ({ AI: f.ai });

export { env };
