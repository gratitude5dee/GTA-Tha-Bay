import { afterEach, describe, expect, it } from 'vitest';
import { HTTP_FOR, NPC_GUARDRAILS } from '@dv/shared';
import type { DraftView } from '@dv/shared/npc';
import { buildStream } from '../src/npc/upstream-fixture.ts';
import { setUpstreamForTests } from '../src/npc/upstream.ts';
import { defaultLlmSoul } from '../src/npc-builder/fixture-defaults.ts';
import { BACKSTORY, FIELDS, builderSetup, type Builder } from './builder-helpers.ts';

// M06b1 AC-1: a third soul generation in one UTC day, a second for the same draft within an hour, a 21st preview turn for a draft and a fourth live draft are
// each refused with quota_exhausted, and no upstream call is made for the refused request.
let b: Builder;
afterEach(() => b.dispose());

const code = async (res: Response): Promise<{ status: number; code: string; reason?: string }> => {
  const j = (await res.json()) as { error: { code: string; details?: { reason?: string } } };
  return { status: res.status, code: j.error.code, ...(j.error.details?.reason === undefined ? {} : { reason: j.error.details.reason }) };
};

async function validated(builder: Builder, name: string): Promise<DraftView> {
  const d = await builder.create({ name }, BACKSTORY);
  await builder.api('POST', `/drafts/${d.id}/validate`);
  await builder.drain();
  return builder.get(d.id);
}

describe('builder limits', () => {
  it('refuses the third soul generation of a UTC day, and allows one again the next day', async () => {
    b = await builderSetup();
    const [one, two, three] = [await validated(b, 'First One'), await validated(b, 'Second Two'), await validated(b, 'Third Three')];
    expect((await b.api('POST', `/drafts/${one.id}/soul`)).status).toBe(202);
    await b.drain();
    expect((await b.api('POST', `/drafts/${two.id}/soul`)).status).toBe(202);
    await b.drain();
    const before = b.calls.length;
    const refused = await b.api('POST', `/drafts/${three.id}/soul`);
    expect(await code(refused)).toEqual({ status: HTTP_FOR.quota_exhausted, code: 'quota_exhausted', reason: 'soul_generations' });
    expect(b.calls.length).toBe(before);
    expect((await b.get(three.id)).state).toBe('text_ok'); // the refusal moved nothing
    b.t.h.clock.t = Date.UTC(2031, 0, 2, 0, 0, 5);
    expect((await b.api('POST', `/drafts/${three.id}/soul`)).status).toBe(202);
    await b.drain();
    expect((await b.get(three.id)).state).toBe('private');
  });

  it('refuses a second generation for the same draft within the hour, and allows it after the hour', async () => {
    const good = defaultLlmSoul('mission');
    const bad = { ...good, locations: { home: 'poi.mission.nowhere' as never, hangouts: [] } };
    let broken = true;
    b = await builderSetup({ fixture: (req) => (broken && /^builder-(soul|repair)/.test(req.intent) ? buildStream({ model: req.model, answer: bad as never }) : undefined) });
    const d = await validated(b, 'Only One');
    await b.api('POST', `/drafts/${d.id}/soul`);
    await b.drain();
    expect((await b.get(d.id)).state).toBe('soul_failed');
    const before = b.calls.length;
    const again = await b.api('POST', `/drafts/${d.id}/soul`);
    expect((await code(again)).code).toBe('quota_exhausted');
    expect(again.status).toBe(HTTP_FOR.quota_exhausted);
    expect(b.calls.length).toBe(before);
    b.t.h.clock.t += NPC_GUARDRAILS.builderTextPerDraftMs + 1000;
    broken = false;
    expect((await b.api('POST', `/drafts/${d.id}/soul`)).status).toBe(202);
    await b.drain();
    expect((await b.get(d.id)).state).toBe('private');
  });

  it('gives a generation back when no model call could be made', async () => {
    b = await builderSetup({ env: { ANTHROPIC_MODE: 'live', ANTHROPIC_BUILDER_KEY: undefined } });
    setUpstreamForTests(null); // the real choice: live mode and no key
    const d = await validated(b, 'Nobody Home');
    // validation already asked the classifier; with no key it is skipped (non-publishable) and the draft moves on
    expect((await b.get(d.id)).state).toBe('text_ok');
    expect((await b.api('POST', `/drafts/${d.id}/soul`)).status).toBe(202);
    await b.drain();
    const failed = await b.get(d.id);
    expect(failed.state).toBe('soul_failed');
    expect(failed.lint[0]).toMatchObject({ rule: 'upstream' });
    // the day's count and the hour of the draft are free again
    expect(failed.limits.soulGenerationsLeft).toBe(NPC_GUARDRAILS.quotas.p0.builderText);
    expect((await b.api('POST', `/drafts/${d.id}/soul`)).status).toBe(202);
    await b.drain();
  });

  it('refuses the 21st preview turn of a draft in a day with no upstream call', async () => {
    b = await builderSetup();
    const d = await b.toPrivate();
    expect(d.state).toBe('private');
    expect(d.limits.previewTurnsLeft).toBe(NPC_GUARDRAILS.builder.previewTurnsPerDraftPerDay);
    const base = b.calls.length;
    for (let i = 0; i < NPC_GUARDRAILS.builder.previewTurnsPerDraftPerDay; i++) {
      const res = await b.api('POST', `/drafts/${d.id}/preview`, { turn: { intent: 'greet' } });
      expect(res.status).toBe(200);
      const frames = await b.t.read(res);
      expect(frames.map((f) => f.event)).toContain('done');
    }
    expect(b.calls.length - base).toBe(NPC_GUARDRAILS.builder.previewTurnsPerDraftPerDay);
    const refused = await b.api('POST', `/drafts/${d.id}/preview`, { turn: { intent: 'greet' } });
    expect(await code(refused)).toEqual({ status: HTTP_FOR.quota_exhausted, code: 'quota_exhausted', reason: 'preview_turns' });
    expect(b.calls.length - base).toBe(NPC_GUARDRAILS.builder.previewTurnsPerDraftPerDay);
    expect((await b.get(d.id)).limits.previewTurnsLeft).toBe(0);
    // the count is per draft: a second private draft still has its own twenty
    b.t.h.clock.t = Date.UTC(2031, 0, 2, 0, 0, 5);
    expect((await b.api('POST', `/drafts/${d.id}/preview`, { turn: { intent: 'greet' } })).status).toBe(200);
  });

  it('refuses the fourth live draft', async () => {
    b = await builderSetup();
    for (let i = 0; i < NPC_GUARDRAILS.builder.liveDraftsP0; i++) await b.create({ name: `Draft Number ${i}` });
    const before = b.calls.length;
    const refused = await b.api('POST', '/drafts', { fields: FIELDS, attestation: 'original' });
    expect(await code(refused)).toEqual({ status: HTTP_FOR.quota_exhausted, code: 'quota_exhausted', reason: 'live_drafts' });
    expect(b.calls.length).toBe(before);
    // deleting one makes room
    const list = (await (await b.api('GET', '/drafts')).json()) as DraftView[];
    expect(list).toHaveLength(3);
    expect((await b.api('DELETE', `/drafts/${list[0]!.id}`)).status).toBe(204);
    expect((await b.api('POST', '/drafts', { fields: FIELDS, attestation: 'original' })).status).toBe(201);
  });
});
