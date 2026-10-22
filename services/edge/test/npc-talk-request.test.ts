import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { HTTP_FOR } from '@dv/shared';
import type { EncounterDO } from '../src/npc/EncounterDO.ts';
import { setModerationForTests } from '../src/npc/safety.ts';
import { dropSoulCache } from '../src/npc/souls.ts';
import { playToken } from './npc-helpers.ts';
import { context, find, FIXTURES, request, talkSetup, textOf, type Talk } from './talk-helpers.ts';

// Route 31 around the model call: the request checks, the input prefilter, the effects, the end of an encounter, the crisis signal.
let t: Talk;
afterEach(() => t.dispose());

const errorOf = async (res: Response): Promise<{ code: string; details?: Record<string, unknown> }> => ((await res.json()) as { error: { code: string; details?: Record<string, unknown> } }).error;
const rot13 = (s: string): string => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

describe('request checks', () => {
  it('needs a play token', async () => {
    t = await talkSetup();
    const none = await t.post(request(), { token: null });
    expect(none.status).toBe(HTTP_FOR.unauthorized);
    const bad = await t.post(request(), { token: 'pt1.AAAA.BBBB' });
    expect(bad.status).toBe(HTTP_FOR.unauthorized);
  });

  it('answers 400 for a bad body, a mismatched id and a bad encounter id; 405 for a GET; 404 for another path', async () => {
    t = await talkSetup();
    const post = (body: unknown, npcId = 'npc_test'): Promise<Response> => t.post(body as never, { npcId });
    expect((await post({ nonsense: true })).status).toBe(400);
    expect((await post(request({ npcId: 'npc_other' }))).status).toBe(400);
    expect((await post(request({ encounterId: 'not-a-uuid' }))).status).toBe(400);
    expect((await post(request({ turn: {} }))).status).toBe(400);
    expect((await post(request({ turn: { text: 'x'.repeat(281) } }))).status).toBe(400);
    expect((await post({ ...request(), extra: 1 })).status).toBe(400);
    const get = await t.h.api('/api/v1/npc/npc_test/talk');
    expect(get.status).toBe(405);
    const other = await t.h.api('/api/v1/npc/npc_test/intent', { method: 'POST' });
    expect(other.status).toBe(404);
  });

  it('answers feature_disabled while npc.dialogue is off, and the staff flag wins over the var', async () => {
    t = await talkSetup({ env: { FLAGS_JSON: '{}' } });
    const off = await t.post(request());
    expect(off.status).toBe(HTTP_FOR.feature_disabled);
    expect((await errorOf(off)).code).toBe('feature_disabled');
    await env.FLAGS.put('flags:features', JSON.stringify({ 'npc.dialogue': true }));
    const on = await t.post(request());
    expect(on.status).toBe(200);
    await t.read(on);
  });

  it('answers rate_limited when the RL_TALK binding refuses', async () => {
    t = await talkSetup({ env: { RL_TALK: { limit: () => Promise.resolve({ success: false }) } as RateLimit } });
    const res = await t.post(request());
    expect(res.status).toBe(HTTP_FOR.rate_limited);
    expect((await errorOf(res)).code).toBe('rate_limited');
  });

  it('answers upstream_unavailable in live mode without a key, and replays fixtures in any other mode', async () => {
    t = await talkSetup({ env: { ANTHROPIC_MODE: 'live' } });
    const res = await t.post(request());
    expect(res.status).toBe(HTTP_FOR.upstream_unavailable);
    expect((await errorOf(res)).code).toBe('upstream_unavailable');
    t.dispose();
    t = await talkSetup({ env: { ANTHROPIC_MODE: undefined } });
    const fixture = await t.post(request());
    expect(fixture.headers.get('X-DV-Npc-Mode')).toBe('fixture');
    await t.read(fixture);
  });

  it('does not read the bundled soul in live mode: a soul missing from PRIVATE is unavailable', async () => {
    t = await talkSetup({ env: { ANTHROPIC_MODE: 'live', ANTHROPIC_API_KEY: 'sk-test-not-a-key' } });
    await env.PRIVATE.delete('souls/index.json');
    dropSoulCache();
    const res = await t.post(request());
    expect(res.status).toBe(HTTP_FOR.not_found);
  });
});

describe('the input prefilter', () => {
  it('blocks a slur with moderation_blocked before the model', async () => {
    t = await talkSetup();
    t.recordCalls();
    const res = await t.post(request({ turn: { text: `you ${rot13('puvax')}`, intent: 'insult' } }));
    expect(res.status).toBe(HTTP_FOR.moderation_blocked);
    expect(t.calls).toHaveLength(0);
  });

  it('lets a self-harm phrase through, forces the end and flags the crisis card', async () => {
    t = await talkSetup({ fixture: 'happy' });
    const { frames } = await t.say(request({ turn: { text: 'I want to kill myself', intent: 'smalltalk' } }));
    expect(find(frames, 'meta')!.data).toMatchObject({ safety: 'crisis' });
    expect(find(frames, 'effects')!.data).toMatchObject({ endConversation: true });
    expect(find(frames, 'done')!.data).toMatchObject({ closed: true });
  });

  it('removes contact data and tells the model so, and never sends the raw text', async () => {
    t = await talkSetup({ fixture: 'happy' });
    t.recordCalls();
    await t.say(request({ turn: { text: 'call me on 415-555-0134 or jane@example.org', intent: 'smalltalk' } }));
    const messages = t.calls[0]!.call.body['messages'] as { content: string }[];
    const scene = messages[messages.length - 1]!.content;
    expect(scene).toContain('pii_removed="true"');
    expect(scene).toContain('call me on [removed] or [removed]');
    expect(JSON.stringify(t.calls[0]!.call.body)).not.toContain('415-555-0134');
  });
});

describe('the answer', () => {
  it('cuts a line over the word limit at a sentence boundary', async () => {
    t = await talkSetup({ fixture: 'long-line' });
    const { frames } = await t.say(request());
    const line = (find(frames, 'line.done')!.data as { text: string; words: number });
    // npc_test allows 16 words, so 21 at most: the 12 alpha words fit, the next sentence does not
    expect(line.text).toBe(`${Array.from({ length: 12 }, () => 'alpha').join(' ')}.`);
    expect(line.words).toBe(12);
  });

  it('decodes escapes and surrogate pairs split across chunks, with no broken character at any step', async () => {
    t = await talkSetup({ fixture: 'escapes' });
    const { frames } = await t.say(request());
    const expected = 'Say "hello" \\ there\nsecond line \u{1f600} done.';
    expect(textOf(frames)).toBe(expected);
    expect(find(frames, 'line.done')!.data).toMatchObject({ text: expected.replace(/\s+/g, ' ') });
    // a delta never ends in the first half of a surrogate pair
    for (const f of frames.filter((x) => x.event === 'line.delta')) expect(/[\ud800-\udbff]$/.test(String(f.data['text']))).toBe(false);
  });

  it('closes the encounter when the NPC ends it: the next turn needs a new encounter', async () => {
    t = await talkSetup({ fixture: 'end-conversation' });
    const first = await t.say(request());
    expect(find(first.frames, 'effects')!.data).toMatchObject({ endConversation: true });
    expect(find(first.frames, 'done')!.data).toMatchObject({ closed: true });
    const encounterId = (find(first.frames, 'meta')!.data as { encounterId: string }).encounterId;
    t.h.clock.t += 2000;
    const again = await t.post(request({ encounterId }));
    expect(again.status).toBe(HTTP_FOR.conflict);
    expect((await errorOf(again)).details).toEqual({ reason: 'turn_cap' });
  });

  it('adds the wrap-up note on the last turn and closes the encounter at the cap', async () => {
    t = await talkSetup({ fixture: 'happy-cached' });
    t.recordCalls();
    let encounterId: string | undefined;
    let last: Awaited<ReturnType<Talk['say']>> | undefined;
    for (let i = 0; i < 6; i++) {
      t.h.clock.t += 2000;
      last = await t.say(request(encounterId === undefined ? {} : { encounterId }));
      encounterId = (find(last.frames, 'meta')!.data as { encounterId: string }).encounterId;
    }
    const scenes = t.calls.map((c) => (c.call.body['messages'] as { content: string }[]).at(-1)!.content);
    expect(scenes.slice(0, 5).some((s) => s.includes('<system_note>'))).toBe(false);
    expect(scenes[5]).toContain('<system_note>');
    expect(find(last!.frames, 'effects')!.data).toMatchObject({ endConversation: true });
    expect(find(last!.frames, 'done')!.data).toMatchObject({ turnsLeft: 0, closed: true });
  });

  it('carries the crisis flag of the asynchronous moderation on the next turn only', async () => {
    t = await talkSetup({ fixture: 'happy' });
    setModerationForTests({
      check: async (_deps, input) => {
        await input.flagCrisis();
      },
    });
    const first = await t.say(request());
    expect(find(first.frames, 'meta')!.data).not.toHaveProperty('safety');
    const encounterId = (find(first.frames, 'meta')!.data as { encounterId: string }).encounterId;
    setModerationForTests(null);
    t.h.clock.t += 2000;
    const second = await t.say(request({ encounterId }));
    expect(find(second.frames, 'meta')!.data).toMatchObject({ safety: 'crisis' });
    t.h.clock.t += 2000;
    const third = await t.say(request({ encounterId }));
    expect(find(third.frames, 'meta')!.data).not.toHaveProperty('safety');
  });

  it('writes the transcript when the encounter closes', async () => {
    t = await talkSetup({ fixture: 'end-conversation' });
    const first = await t.say(request());
    const encounterId = (find(first.frames, 'meta')!.data as { encounterId: string }).encounterId;
    const obj = await env.PRIVATE.get(`transcripts/${encounterId}.jsonl`);
    expect(obj).not.toBeNull();
    const rows = (await obj!.text()).trim().split('\n').map((l) => JSON.parse(l) as { role: string; content: string });
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
    expect(rows[0]!.content).toContain('<scene ');
    expect(rows[1]!.content).toContain('"line"');
    const stub = env.ENCOUNTER.get(env.ENCOUNTER.idFromName(`enc:${t.pid}:npc_test:${encounterId}`)) as DurableObjectStub<EncounterDO>;
    expect((await stub.status()).closed).toBe(true);
  });

  it('reports the token counts of the caller\'s own encounter through the staging test route, never text', async () => {
    t = await talkSetup({ fixture: (r) => (r.turnIndex === 0 ? FIXTURES['happy'] : FIXTURES['happy-cached']) });
    const a = await t.say(request());
    const encounterId = (find(a.frames, 'meta')!.data as { encounterId: string }).encounterId;
    t.h.clock.t += 2000;
    await t.say(request({ encounterId }));
    const token = await playToken(t.pid, `dkt-${t.pid}`, t.h.clock.t);
    const res = await t.h.api(`/api/v1/_test/npc/usage?npc=npc_test&encounter=${encounterId}`, { headers: { Authorization: `PlayToken ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { turns: { cacheRead: number; cacheWrite: number; inTok: number }[] };
    expect(body.turns.map((x) => x.cacheRead)).toEqual([0, 1500]);
    expect(body.turns[0]!.cacheWrite).toBe(1500);
    expect(JSON.stringify(body)).not.toContain('line');
    // another player cannot read it
    const other = await playToken('0198aaaa-bbbb-7ccc-8ddd-eeeeffff0001', 'dkt-other', t.h.clock.t);
    const none = await t.h.api(`/api/v1/_test/npc/usage?npc=npc_test&encounter=${encounterId}`, { headers: { Authorization: `PlayToken ${other}` } });
    expect(((await none.json()) as { turns: unknown[] }).turns).toEqual([]);
  });

  it('keeps the context exact: mode and offers reach the scene as given', async () => {
    t = await talkSetup({ fixture: 'happy' });
    t.recordCalls();
    await t.say(request({ context: context({ mode: 'tycoon', offers: { missionIds: [], raceIds: ['r_x'], dealIds: [] } }) }));
    const scene = (t.calls[0]!.call.body['messages'] as { content: string }[]).at(-1)!.content;
    expect(scene).toContain('mode="tycoon"');
    expect(scene).toContain('race:r_x');
  });
});
