import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { HTTP_FOR } from '@dv/shared';
import { setModerationFixtureForTests } from '../src/npc-builder/moderation-openai.ts';
import { find, request, talkSetup, type Talk } from './talk-helpers.ts';

// M06b1 AC-13 (and the replacement of the M06a3 logging stub): the asynchronous moderation of the player's text. A self-harm/intent 0.6 turn makes the next
// meta event carry safety: 'crisis' once; a sexual/minors 0.25 turn closes the encounter and opens one P0_CSAM case.
let t: Talk;
afterEach(() => {
  setModerationFixtureForTests(null);
  t.dispose();
});

const openai = (scores: Record<string, number>): string => JSON.stringify({ results: [{ flagged: true, category_scores: scores }] });
const scored = (text: string): string => {
  if (text.includes('zzcrisis')) return openai({ 'self-harm/intent': 0.6 });
  if (text.includes('zzminors')) return openai({ 'sexual/minors': 0.25 });
  return openai({});
};

const encounterStatus = async (pid: string, npcId: string, id: string): Promise<{ closed: boolean }> =>
  (env.ENCOUNTER.get(env.ENCOUNTER.idFromName(`enc:${pid}:${npcId}:${id}`)) as unknown as { status(): Promise<{ closed: boolean }> }).status();

describe('asynchronous moderation of player text', () => {
  it('sets the crisis flag for the next turn only, and does not close the encounter', async () => {
    t = await talkSetup({ fixture: 'happy' });
    setModerationFixtureForTests((text) => scored(text));
    const first = await t.say(request({ turn: { text: 'zzcrisis one' } }));
    expect(first.res.status).toBe(200);
    expect(find(first.frames, 'meta')!.data['safety']).toBeUndefined();
    const encounterId = String(find(first.frames, 'meta')!.data['encounterId']);
    t.h.clock.t += 2000;
    const second = await t.say(request({ encounterId, turn: { text: 'fine thanks' } }));
    expect(find(second.frames, 'meta')!.data['safety']).toBe('crisis');
    t.h.clock.t += 2000;
    const third = await t.say(request({ encounterId, turn: { text: 'still fine' } }));
    expect(find(third.frames, 'meta')!.data['safety']).toBeUndefined();
    expect(t.h.port.moderationCases()).toHaveLength(0);
    expect((await encounterStatus(t.pid, 'npc_test', encounterId)).closed).toBe(false);
  });

  it('closes the encounter and opens one P0_CSAM case for sexual/minors 0.25', async () => {
    t = await talkSetup({ fixture: 'happy' });
    setModerationFixtureForTests((text) => scored(text));
    const turn = await t.say(request({ turn: { text: 'zzminors hello' } }));
    expect(turn.res.status).toBe(200);
    const encounterId = String(find(turn.frames, 'meta')!.data['encounterId']);
    const cases = t.h.port.moderationCases();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ queue: 'P0_CSAM', reason: 'chat_text_csam', opened_by: 'auto:openai_omni', status: 'open' });
    expect(cases[0]!.subject_snapshot).toMatchObject({ encounterId, turnIndex: 0, npcId: 'npc_test', source: 'openai_omni' });
    expect(JSON.stringify(cases[0]!.subject_snapshot)).not.toContain('zzminors');
    expect(t.h.port.moderationSignals().map((s) => s.verdict)).toEqual(['quarantine']);
    expect((await encounterStatus(t.pid, 'npc_test', encounterId)).closed).toBe(true);
    // the encounter takes no further turn
    t.h.clock.t += 2000;
    const next = await t.post(request({ encounterId, turn: { text: 'hello again' } }));
    expect(next.status).toBe(HTTP_FOR.conflict);
    // another turn of the same player in a new encounter is not blocked by the closed one
    const fresh = await t.say(request({ turn: { text: 'a clean turn' } }));
    expect(fresh.res.status).toBe(200);
    expect(t.h.port.moderationCases()).toHaveLength(1);
  });

  it('uses Llama Guard when OpenAI is not available: S4 closes the encounter, S11 sets the crisis flag', async () => {
    t = await talkSetup({ fixture: 'happy' });
    setModerationFixtureForTests((text, vendor) => {
      if (vendor === 'openai') return new Error('openai down');
      if (text.includes('zzminors')) return JSON.stringify({ response: 'unsafe\nS4' });
      if (text.includes('zzcrisis')) return JSON.stringify({ response: { safe: false, categories: ['S11'] } });
      return JSON.stringify({ response: 'safe' });
    });
    const crisis = await t.say(request({ turn: { text: 'zzcrisis' } }));
    const id = String(find(crisis.frames, 'meta')!.data['encounterId']);
    t.h.clock.t += 2000;
    expect(find((await t.say(request({ encounterId: id, turn: { text: 'ok' } }))).frames, 'meta')!.data['safety']).toBe('crisis');
    const minors = await t.say(request({ turn: { text: 'zzminors' } }));
    expect(t.h.port.moderationCases().map((c) => c.opened_by)).toEqual(['auto:llama_guard']);
    expect((await encounterStatus(t.pid, 'npc_test', String(find(minors.frames, 'meta')!.data['encounterId']))).closed).toBe(true);
  });

  it('decides nothing when no vendor answers', async () => {
    t = await talkSetup({ fixture: 'happy' });
    setModerationFixtureForTests(() => new Error('down'));
    const turn = await t.say(request({ turn: { text: 'zzminors hello' } }));
    expect(turn.res.status).toBe(200);
    expect(t.h.port.moderationCases()).toHaveLength(0);
  });
});
