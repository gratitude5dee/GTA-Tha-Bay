import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * M06a4 AC-10, suite `npc-tts`: one fixed sentence voiced by Aura-1 and by Aura-2 through the staging Worker's `AI` binding (the staging-only route
 * POST /api/v1/_test/npc/tts). For each model it records the container sniffed from the first bytes, the size and the wall time of three calls, and writes
 * tests/reports/npc/tts.json. That file settles U-NPC-05: Aura-1 stays the default voice of config/voice-catalog.json when it answers mp3 inside the
 * latency bound; otherwise the Aura-2 `mp3` entries move to the front of the catalog (spec/03 section 7, 04-npc.md section 5.7).
 *
 * The suite needs the staging Worker deployed with this milestone (and its `ai` binding). Before that the route answers 404 and the suite prints a
 * SKIP line. It is not part of the default `test:staging` run. `--render-creator` (tools/soul/src/creator-voices.ts) renders the creator samples.
 */
const base = process.env['DV_STAGING_URL'] ?? 'https://tha-bay-web-staging.gratitude-8f4.workers.dev';
const root = path.resolve(import.meta.dirname, '..', '..');
const SENTENCE = 'Please confirm the lot is clear, then sign the checklist.';
const LATENCY_BOUND_MS = 2000;

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

async function playToken(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as { kty: string; crv: string; x: string; y: string };
  const pid = crypto.randomUUID();
  const ts = Date.now();
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(`pt-req|${pid}|${ts}`)));
  const res = await fetch(new URL('/api/v1/id/play-token', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pid, jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, ts, sig: b64url(sig), age: '18p' }),
  });
  if (!res.ok) throw new Error(`play-token answered ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

interface Reading {
  model: string;
  speaker: string;
  ok: boolean;
  container: string;
  bytes: number;
  ms: number | null;
}

async function probe(token: string, model: 'aura-1' | 'aura-2', speaker: string): Promise<Response> {
  return fetch(new URL(`/api/v1/_test/npc/tts?model=${model}&speaker=${speaker}`, base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `PlayToken ${token}` },
    body: JSON.stringify({ text: SENTENCE }),
  });
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

describe('npc tts on staging', () => {
  it('voices one sentence with Aura-1 and Aura-2 and records codec, size and latency', { timeout: 120_000 }, async (ctx) => {
    const token = await playToken();
    const first = await probe(token, 'aura-1', 'orion');
    if (first.status === 404 || first.status === 503 || first.status === 405) {
      console.log(`SKIP npc-tts: the staging Worker answers ${first.status} for /api/v1/_test/npc/tts (deploy M06a4 with the AI binding first; U-NPC-05 stays open)`);
      ctx.skip();
      return;
    }
    const results: { model: string; speaker: string; readings: Reading[]; msMedian: number; container: string; bytes: number }[] = [];
    for (const [model, speaker] of [['aura-1', 'orion'], ['aura-1', 'luna'], ['aura-2', 'orion'], ['aura-2', 'luna']] as const) {
      const readings: Reading[] = [];
      for (let i = 0; i < 3; i++) {
        const res = i === 0 && model === 'aura-1' && speaker === 'orion' ? first : await probe(token, model, speaker);
        expect(res.status, `${model}/${speaker}`).toBe(200);
        readings.push((await res.json()) as Reading);
      }
      const okMs = readings.filter((r) => r.ok && r.ms !== null).map((r) => r.ms as number);
      results.push({ model, speaker, readings, msMedian: okMs.length === 0 ? -1 : median(okMs), container: readings[0]?.container ?? 'unknown', bytes: readings[0]?.bytes ?? 0 });
    }
    const aura1 = results.filter((r) => r.model === 'aura-1');
    const aura2 = results.filter((r) => r.model === 'aura-2');
    const aura1Suitable = aura1.every((r) => r.container === 'mp3' && r.msMedian >= 0 && r.msMedian <= LATENCY_BOUND_MS);
    const report = {
      probedAt: new Date().toISOString(),
      host: base,
      sentence: SENTENCE,
      chars: SENTENCE.length,
      latencyBoundMs: LATENCY_BOUND_MS,
      results,
      u_npc_05: {
        aura1: { speakersAnswered: aura1.map((r) => `${r.speaker}:${r.container}`), msMedian: aura1.map((r) => r.msMedian) },
        aura2: { speakersAnswered: aura2.map((r) => `${r.speaker}:${r.container}`), msMedian: aura2.map((r) => r.msMedian) },
        decision: aura1Suitable ? 'keep the Aura-1 entries first in config/voice-catalog.json' : 'move the Aura-2 mp3 entries before the Aura-1 entries in config/voice-catalog.json',
      },
    };
    mkdirSync(path.join(root, 'tests/reports/npc'), { recursive: true });
    writeFileSync(path.join(root, 'tests/reports/npc/tts.json'), `${JSON.stringify(report, null, 2)}\n`);
    // Aura-2's mp3 encoding is verified in the model documentation; the staging answer must agree.
    for (const r of aura2) {
      expect(r.container, `aura-2/${r.speaker}`).toBe('mp3');
      expect(r.bytes).toBeGreaterThan(1000);
    }
  });
});
