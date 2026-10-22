import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import type { SpendEvent } from '@dv/shared';
import { NPC_GUARDRAILS } from '@dv/shared';
import type { AudioChunk, VoiceCatalog } from '@dv/shared/contracts/c10-npc';
import bundled from '../src/generated/npc-fixtures.json';
import { speakableSentences, setCatalogForTests, setTtsFetchForTests } from '../src/npc/tts-router.ts';
import { buildStream } from '../src/npc/upstream-fixture.ts';
import { parseWithTimestamps } from '../src/npc/tts-elevenlabs.ts';
import { setQueueSinksForTests } from '../src/ops/queue.ts';
import { fakeAi, withAi, type FakeAi } from './ai-helpers.ts';
import { find, quotaUsage, request, seedSouls, talkSetup, type Frame, type Talk } from './talk-helpers.ts';

// M06a4 AC-5: a t1 soul with voice setting `all` streams audio per sentence after its text and reserves one voice_line; a kill scope `voice`,
// an exhausted voice_line quota, ks:tts:all and setting `off` each give text only; a P0 profile never gets t2.
let t: Talk;
let ai: FakeAi;
afterEach(() => {
  setCatalogForTests(null);
  setTtsFetchForTests(null);
  t.dispose();
});

const LINE = 'Please confirm the lot is clear. Then sign the checklist.';
const turn = buildStream({
  model: 'claude-haiku-5-5',
  answer: { line: LINE, emotion: 'neutral', gesture: 'nod', action: 'none', action_arg: null, affinity_delta: 0, memory_writes: [], end_conversation: false },
  inputTokens: 180,
  cacheReadTokens: 1500,
  outputTokens: 60,
});

const npcTest = (bundled.souls as Record<string, { compiled: Record<string, unknown> }>)['npc_test']!.compiled as { voice: object; roles: object };
const voiced = (tier: 't1' | 't2', hero = false): Record<string, unknown> => ({
  ...npcTest,
  voice: { ...npcTest.voice, tier },
  roles: { ...npcTest.roles, hero },
});

async function voicedTalk(opts: { tier?: 't1' | 't2'; hero?: boolean; env?: Record<string, unknown> } = {}): Promise<void> {
  ai = fakeAi();
  t = await talkSetup({ fixture: () => turn, env: { ...withAi(ai), ...opts.env } });
  await seedSouls({ extra: { npc_voiced: { version: 1, compiled: voiced(opts.tier ?? 't1', opts.hero ?? false) } } });
}

const say = (over: Parameters<typeof request>[0] = {}): Promise<{ frames: Frame[] }> => t.say(request({ npcId: 'npc_voiced', ...over }), { npcId: 'npc_voiced' });
const audioOf = (frames: Frame[]): AudioChunk[] => frames.filter((f) => f.data['audio'] !== undefined).map((f) => f.data['audio'] as AudioChunk);
const auraCalls = (): string[] => ai.calls.filter((c) => c.model.startsWith('@cf/deepgram/')).map((c) => String(c.inputs['text']));
const meta = (frames: Frame[]): { voice: string } => find(frames, 'meta')!.data as { voice: string };

describe('voice on route 31, t1', () => {
  it('streams mp3 chunks for each sentence after its text, in order, and reserves one voice_line', async () => {
    await voicedTalk();
    const spend: SpendEvent[] = [];
    setQueueSinksForTests({ spend: (e) => spend.push(e) });
    const { frames } = await say();
    expect(meta(frames).voice).toBe('t1');

    const kinds = frames.map((f) => (f.event === 'line.delta' ? (f.data['audio'] !== undefined ? 'audio' : 'text') : f.event));
    const firstAudio = kinds.indexOf('audio');
    expect(kinds.slice(0, firstAudio).every((k) => k === 'meta' || k === 'text')).toBe(true);
    expect(kinds.slice(firstAudio)).toEqual([...Array(4).fill('audio'), 'line.done', 'effects', 'done']);

    const audio = audioOf(frames);
    expect(audio.map((a) => [a.sentence, a.codec, a.last])).toEqual([[0, 'mp3', false], [0, 'mp3', true], [1, 'mp3', false], [1, 'mp3', true]]);
    expect(audio.every((a) => a.alignment === undefined)).toBe(true);
    // 15,003 bytes of stub audio per sentence in 12 KB chunks
    expect(atob(audio[0]!.b64)).toHaveLength(12_288);
    expect(atob(audio[1]!.b64)).toHaveLength(15_003 - 12_288);
    // seq numbers keep counting across text and audio
    const seqs = frames.filter((f) => f.event === 'line.delta').map((f) => f.data['seq'] as number);
    expect(seqs).toEqual(seqs.map((_, i) => i));

    expect(auraCalls()).toEqual(['Please confirm the lot is clear.', 'Then sign the checklist.']);
    const call = ai.calls.find((c) => c.model.startsWith('@cf/deepgram/'))!;
    expect(call.model).toBe('@cf/deepgram/aura-1');
    expect(call.inputs['encoding']).toBe('mp3');
    expect(typeof call.inputs['speaker']).toBe('string');

    expect((await quotaUsage(t.pid))['voice_line']).toBe(1);
    // 56 characters at Aura-1's 15 micros each
    const tts = spend.filter((e) => e.kind === 'tts');
    expect(tts).toHaveLength(1);
    expect(tts[0]).toMatchObject({ vendor: 'workers_ai', model: '@cf/deepgram/aura-1', usdMicros: 56 * 15 });
  });

  it('gives the same voice to the same NPC every time', async () => {
    await voicedTalk();
    await say();
    const speakers = ai.calls.filter((c) => c.model.startsWith('@cf/deepgram/')).map((c) => c.inputs['speaker']);
    expect(new Set(speakers).size).toBe(1);
  });

  it('leaves the text alone when Aura fails', async () => {
    await voicedTalk();
    ai.fail.tts = true;
    const { frames } = await say();
    expect(audioOf(frames)).toEqual([]);
    expect(find(frames, 'line.done')!.data).toMatchObject({ text: LINE });
    expect(find(frames, 'done')).toBeDefined();
  });

  it('a short line is voiced as one sentence', () => {
    expect(speakableSentences('Noted.')).toEqual(['Noted.']);
    expect(speakableSentences('Good day. Please confirm the lot is clear.')).toEqual(['Good day. Please confirm the lot is clear.']);
    expect(speakableSentences('Please confirm the lot is clear. Ok.')).toEqual(['Please confirm the lot is clear. Ok.']);
    expect(speakableSentences('')).toEqual([]);
  });
});

describe('what keeps a line text only', () => {
  const expectTextOnly = (frames: Frame[]): void => {
    expect(meta(frames).voice).toBe('text');
    expect(audioOf(frames)).toEqual([]);
    expect(auraCalls()).toEqual([]);
    expect(find(frames, 'line.done')!.data).toMatchObject({ text: LINE });
  };

  it('voice setting off', async () => {
    await voicedTalk();
    const { frames } = await say({ context: { ...request().context, voice: 'off' } });
    expectTextOnly(frames);
    expect((await quotaUsage(t.pid))['voice_line']).toBeUndefined();
  });

  it('the voice kill scope of the roster', async () => {
    await voicedTalk();
    const res = await t.h.api('/api/v1/admin/roster/npc_voiced/kill', { method: 'POST', ops: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: ['voice'], reason: 'quality', ticketId: 'T-2' }) });
    expect(res.status).toBe(200);
    const { frames } = await say();
    expectTextOnly(frames);
  });

  it('ks:tts:all', async () => {
    await voicedTalk();
    await env.FLAGS.put('ks:tts:all', JSON.stringify({ on: true, reason: 'test', by: 'test', ts: 1, expiresAt: null }));
    try {
      const { frames } = await say();
      expectTextOnly(frames);
    } finally {
      await env.FLAGS.delete('ks:tts:all');
    }
  });

  it('an exhausted voice_line quota', async () => {
    await voicedTalk();
    const q = env.QUOTA.get(env.QUOTA.idFromName(`q:p:${t.pid}`)) as unknown as { reserve(r: { kind: 'voice_line'; npcId: string; estMicros: number }): Promise<{ ok: boolean }> };
    for (let i = 0; i < NPC_GUARDRAILS.quotas.p0.voiceLines; i++) expect((await q.reserve({ kind: 'voice_line', npcId: 'npc_voiced', estMicros: 1650 })).ok).toBe(true);
    const { frames } = await say();
    expectTextOnly(frames);
    expect((await quotaUsage(t.pid))['voice_line']).toBe(NPC_GUARDRAILS.quotas.p0.voiceLines);
  });

  it('a soul without a voice (tier text)', async () => {
    ai = fakeAi();
    t = await talkSetup({ fixture: () => turn, env: withAi(ai) });
    const { frames } = await t.say(request());
    expectTextOnly(frames);
  });
});

describe('t2 stays out of reach', () => {
  const t2Catalog: VoiceCatalog = {
    schema: 'voice-catalog/1',
    entries: [
      { voiceRef: 'voice/aura-luna', tier: 't1', engine: 'workers_ai', model: '@cf/deepgram/aura-1', providerVoiceId: 'luna', mode: 'synthetic', consentRecordId: null, allowedTiers: ['consented', 'parody', 'fictionalized'] },
      { voiceRef: 'voice/designed-hero', tier: 't2', engine: 'elevenlabs', model: 'eleven_flash_v2_5', providerVoiceId: 'designed-hero-id', mode: 'designed', consentRecordId: null, allowedTiers: ['consented', 'parody', 'fictionalized'] },
    ],
  };
  const released = JSON.stringify({ on: false, reason: 'ceiling raised', by: 'test', ts: 1, expiresAt: null });

  it('a P0 profile gets t1 even with ks:tts:elevenlabs off, a key and a t2 entry', async () => {
    setCatalogForTests(t2Catalog);
    const fetched: string[] = [];
    setTtsFetchForTests((url) => {
      fetched.push(String(url));
      return Promise.reject(new Error('no network in the suite'));
    });
    await voicedTalk({ tier: 't2', hero: true, env: { ELEVENLABS_API_KEY: 'xi-test' } });
    await env.FLAGS.put('ks:tts:elevenlabs', released);
    try {
      const { frames } = await say();
      expect(meta(frames).voice).toBe('t1');
      expect(auraCalls()).toHaveLength(2);
      expect(fetched).toEqual([]);
    } finally {
      await env.FLAGS.delete('ks:tts:elevenlabs');
    }
  });

  it('without the switch released or without a key a t2 soul speaks t1, and a catalog without a t2 entry cannot select it', async () => {
    setCatalogForTests(t2Catalog);
    await voicedTalk({ tier: 't2', hero: true });
    expect(meta((await say()).frames).voice).toBe('t1');
    setCatalogForTests(null);
    expect(meta((await say({ context: request().context })).frames).voice).toBe('t1');
  });
});

describe('the ElevenLabs reader', () => {
  it('reads one document and newline separated documents of audio and alignment', () => {
    const b64 = btoa('abc');
    const doc = { audio_base64: b64, alignment: { characters: ['h', 'i'], character_start_times_seconds: [0, 0.1], character_end_times_seconds: [0.1, 0.2] } };
    const one = parseWithTimestamps(JSON.stringify(doc))!;
    expect(new TextDecoder().decode(one.bytes)).toBe('abc');
    expect(one.alignment).toEqual({ chars: 'hi', startS: [0, 0.1], endS: [0.1, 0.2] });
    const many = parseWithTimestamps(`${JSON.stringify(doc)}\n${JSON.stringify(doc)}\n`)!;
    expect(new TextDecoder().decode(many.bytes)).toBe('abcabc');
    expect(many.alignment.chars).toBe('hihi');
    expect(parseWithTimestamps('not json')).toBeNull();
    expect(parseWithTimestamps('{}')).toBeNull();
  });
});
