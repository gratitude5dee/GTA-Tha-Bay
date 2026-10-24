import { afterEach, describe, expect, it } from 'vitest';
import type { MemoryKind } from '@dv/shared/contracts/c10-npc';
import { retrieve } from '../src/npc/memory.ts';
import { fakeAi, stubVector, withAi } from './ai-helpers.ts';
import { find, request, talkSetup, type Talk } from './talk-helpers.ts';

// M06a4 AC-2: the next turn's <memory> holds at most 6 hits in topK order plus the summary; a failing DataPort leaves it empty and the turn streams.
let t: Talk;
afterEach(() => t.dispose());

const f32 = (text: string): Float32Array => Float32Array.from(stubVector(text));

/** Ten memories of the pair: m00 is about the player's words ("hello there", axis 19), the rest are about other things. */
async function seed(): Promise<string[]> {
  const texts: string[] = [];
  const rows: { kind: MemoryKind; text: string; importance: number; gameTime: number; source: 'dialogue'; embedding: Float32Array }[] = [];
  for (let i = 0; i < 10; i++) {
    const text = i === 0 ? 'hello there' : `memory number ${i} about something else`;
    texts.push(text);
    rows.push({ kind: 'event', text, importance: 1 + i, gameTime: 7200 - i * 100, source: 'dialogue', embedding: f32(text) });
  }
  await t.h.port.profiles.ensureLocal(t.pid, t.dkt);
  await t.h.port.npcMemory.write(t.pid, 'npc_test', rows);
  await t.h.port.npcMemory.applySummary(t.pid, 'npc_test', {
    summaryUpdate: 'They have met at the lot before.',
    memories: [],
    affinityDelta: 2,
    trustDelta: 2,
    flagsPatch: {},
    soulVersion: 1,
    reflection: false,
  });
  return texts;
}

const lastUserMessage = (): string => {
  const messages = t.calls[0]!.call.body['messages'] as { role: string; content: unknown }[];
  return String(messages.at(-1)!.content);
};

describe('memory in the prompt', () => {
  it('puts at most 6 hits in topK order and the relationship summary into <memory>', async () => {
    const ai = fakeAi();
    t = await talkSetup({ fixture: 'happy', env: withAi(ai) });
    t.recordCalls();
    await seed();
    const q = f32('hello there');
    const expected = (await t.h.port.npcMemory.topK(t.pid, 'npc_test', q, 7200, 6)).map((h) => h.text);
    expect(expected).toHaveLength(6);
    expect(expected[0]).toBe('hello there');

    const { frames } = await t.say(request({ turn: { text: 'hello there' } }));
    expect(find(frames, 'done')).toBeDefined();
    const msg = lastUserMessage();
    expect(msg).toContain('<memory summary="They have met at the lot before.">');
    const hits = [...msg.matchAll(/<m k="[a-z_]+">([^<]*)<\/m>/g)].map((m) => m[1]);
    expect(hits).toHaveLength(6);
    expect(hits).toEqual(expected);
  });

  it('uses the intent label and the mission id as the query when the turn has no text', async () => {
    const ai = fakeAi();
    t = await talkSetup({ fixture: 'happy', env: withAi(ai) });
    t.recordCalls();
    await seed();
    await t.say(request({ turn: { intent: 'greet' }, context: { ...request().context, missionId: 'm_first' } }));
    const queries = ai.calls.filter((c) => c.model === '@cf/baai/bge-m3').map((c) => (c.inputs['text'] as string[])[0]);
    expect(queries).toContain('greet m_first');
  });

  it('streams the turn with an empty <memory> when the DataPort throws', async () => {
    const ai = fakeAi();
    t = await talkSetup({ fixture: 'happy', env: withAi(ai) });
    t.recordCalls();
    await seed();
    (t.h.port.npcMemory as { topK: unknown }).topK = () => Promise.reject(new Error('database down'));
    (t.h.port.npcMemory as { relationship: unknown }).relationship = () => Promise.reject(new Error('database down'));
    const { res, frames } = await t.say(request({ turn: { text: 'hello there' } }));
    expect(res.status).toBe(200);
    expect(find(frames, 'done')).toBeDefined();
    expect(lastUserMessage()).toContain('<memory summary=""></memory>');
  });

  it('streams the turn with an empty <memory> when the embedding call fails, keeping the summary', async () => {
    const ai = fakeAi();
    ai.fail.embed = true;
    t = await talkSetup({ fixture: 'happy', env: withAi(ai) });
    t.recordCalls();
    await seed();
    const { frames } = await t.say(request({ turn: { text: 'hello there' } }));
    expect(find(frames, 'done')).toBeDefined();
    expect(lastUserMessage()).toContain('<memory summary="They have met at the lot before."></memory>');
  });

  it('reads no memory for a token that is not 18p, and none without a database', async () => {
    const ai = fakeAi();
    t = await talkSetup({ fixture: 'happy', env: withAi(ai) });
    await seed();
    const input = { profileId: t.pid, npcId: 'npc_test', context: { clockT: 7200, missionId: null }, text: 'hello there', intent: undefined };
    expect(await retrieve(withAi(ai) as never, t.h.port, { ...input, age: '13-17' })).toEqual({ summary: '', hits: [] });
    expect(await retrieve(withAi(ai) as never, null, { ...input, age: '18p' })).toEqual({ summary: '', hits: [] });
    expect((await retrieve(withAi(ai) as never, t.h.port, { ...input, age: '18p' })).hits).toHaveLength(6);
  });
});
