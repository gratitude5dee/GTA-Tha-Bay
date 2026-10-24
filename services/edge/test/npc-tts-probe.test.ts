import { afterEach, describe, expect, it } from 'vitest';
import { playToken } from './npc-helpers.ts';
import { fakeAi, withAi } from './ai-helpers.ts';
import { talkSetup, type Talk } from './talk-helpers.ts';

// M06a4 AC-10 (Worker side): the staging probe route answers the container, size and time of one Aura call and never the audio.
let t: Talk;
afterEach(() => t.dispose());

const post = async (path: string, body: unknown, token: string | null): Promise<Response> =>
  t.h.api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token === null ? {} : { Authorization: `PlayToken ${token}` }) }, body: JSON.stringify(body) });

describe('POST /api/v1/_test/npc/tts', () => {
  it('voices one sentence with the chosen model and speaker and answers readings only', async () => {
    const ai = fakeAi();
    t = await talkSetup({ env: withAi(ai) });
    const token = await playToken(t.pid, `dkt-${t.pid}`, t.h.clock.t);
    const res = await post('/api/v1/_test/npc/tts?model=aura-2&speaker=luna', { text: 'Please confirm the lot is clear.' }, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { model: string; speaker: string; ok: boolean; bytes: number; container: string; ms: number | null };
    expect(body).toMatchObject({ model: '@cf/deepgram/aura-2-en', speaker: 'luna', ok: true });
    expect(body.bytes).toBeGreaterThan(0);
    expect(['mp3', 'wav', 'ogg', 'flac', 'unknown']).toContain(body.container);
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]?.model).toBe('@cf/deepgram/aura-2-en');
  });

  it('answers ok:false when the model fails, and refuses a missing token, a bad speaker and long text', async () => {
    const ai = fakeAi();
    ai.fail.tts = true;
    t = await talkSetup({ env: withAi(ai) });
    const token = await playToken(t.pid, `dkt-${t.pid}`, t.h.clock.t);
    const failed = await post('/api/v1/_test/npc/tts?model=aura-1&speaker=orion', { text: 'Hello there.' }, token);
    expect(((await failed.json()) as { ok: boolean }).ok).toBe(false);
    expect((await post('/api/v1/_test/npc/tts?model=aura-1&speaker=orion', { text: 'Hello.' }, null)).status).toBeGreaterThanOrEqual(400);
    expect((await post('/api/v1/_test/npc/tts?model=aura-1&speaker=Or1on!', { text: 'Hello.' }, token)).status).toBe(400);
    expect((await post('/api/v1/_test/npc/tts?model=aura-1&speaker=orion', { text: 'x'.repeat(201) }, token)).status).toBe(400);
    expect((await post('/api/v1/_test/npc/tts?model=nope&speaker=orion', { text: 'Hello.' }, token)).status).toBe(400);
  });
});
