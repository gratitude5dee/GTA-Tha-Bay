import { afterEach, describe, expect, it } from 'vitest';
import { buildStream } from '../src/npc/upstream-fixture.ts';
import { setUpstreamForTests } from '../src/npc/upstream.ts';
import { builderSetup, type Builder } from './builder-helpers.ts';

// M06b1 AC-3: the text chain runs names lint, then OpenAI, then the Haiku classifier; with OpenAI failing Llama Guard runs instead; a sexual/minors 0.25
// fixture blocks the draft, opens one P0_CSAM case with a subject_snapshot, and no further model call follows.
// AC-12 (Worker half): in live mode with no OPENAI_MODERATION_API_KEY the validation uses the Llama Guard path.
let b: Builder;
afterEach(() => b.dispose());

const openai = (scores: Record<string, number>): string => JSON.stringify({ id: 'modr-fixture', model: 'omni-moderation-latest', results: [{ flagged: Object.values(scores).some((v) => v > 0.5), category_scores: scores }] });

async function validate(builder: Builder): Promise<Awaited<ReturnType<Builder['get']>>> {
  const d = await builder.create();
  expect((await builder.api('POST', `/drafts/${d.id}/validate`)).status).toBe(202);
  await builder.drain();
  return builder.get(d.id);
}

const sources = (builder: Builder): string[] => builder.t.h.port.moderationSignals().map((s) => s.source);

describe('builder text moderation order', () => {
  it('runs names lint, then OpenAI, then the Haiku classifier', async () => {
    b = await builderSetup();
    const d = await validate(b);
    expect(d.state).toBe('text_ok');
    expect(sources(b)).toEqual(['names_lint', 'openai_omni', 'haiku_text']);
    expect(b.vendors).toEqual(['openai']);
    expect(b.calls.map((c) => c.intent)).toEqual(['builder-classify']);
    expect(d.moderation).toMatchObject({ text: 'allow', publishable: true, realPerson: 'none' });
    // the classifier saw the sheet as an untrusted character sheet, with no sampling parameter
    const body = b.calls[0]!.call.body;
    expect(JSON.stringify(body['messages'])).toContain('character_sheet origin=\\"user\\" trust=\\"untrusted\\"');
    expect(body).not.toHaveProperty('temperature');
    expect(body['thinking']).toEqual({ type: 'disabled' });
  });

  it('runs Llama Guard instead of OpenAI when OpenAI fails', async () => {
    b = await builderSetup({ moderation: (_t, vendor) => (vendor === 'openai' ? new Error('openai down') : undefined) as never });
    const d = await validate(b);
    expect(d.state).toBe('text_ok');
    expect(sources(b)).toEqual(['names_lint', 'llama_guard', 'haiku_text']);
    expect(b.vendors).toEqual(['openai', 'llama_guard']);
  });

  it('blocks sexual/minors 0.25, opens one P0_CSAM case with a snapshot, and calls no model afterwards', async () => {
    b = await builderSetup({ moderation: (_t, vendor) => (vendor === 'openai' ? openai({ 'sexual/minors': 0.25, sexual: 0.3 }) : undefined) as never });
    const d = await validate(b);
    expect(d.state).toBe('rejected_auto');
    expect(d.moderation.text).toBe('block');
    expect(d.moderation.publishable).toBe(false);
    expect(d.moderation.reasons.join(' ')).toContain('minors');
    const cases = b.t.h.port.moderationCases();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ queue: 'P0_CSAM', opened_by: 'auto:openai_omni', status: 'open' });
    expect(cases[0]!.subject_snapshot).toMatchObject({ draftId: d.id, npcId: d.npcId, source: 'openai_omni' });
    expect(JSON.stringify(cases[0]!.subject_snapshot)).not.toContain('tamale'); // ids and verdicts only, never the text
    expect(cases[0]!.sla_due_at - cases[0]!.created_at).toBe(4 * 3_600_000);
    expect(sources(b)).toEqual(['names_lint', 'openai_omni']);
    expect(b.calls).toHaveLength(0);
    // no soul generation can follow
    const soul = await b.api('POST', `/drafts/${d.id}/soul`);
    expect(soul.status).toBe(409);
    expect(b.calls).toHaveLength(0);
  });

  it('treats a Llama Guard S4 answer the same way', async () => {
    b = await builderSetup({
      moderation: (_t, vendor) => (vendor === 'openai' ? (new Error('off') as never) : JSON.stringify({ response: 'unsafe\nS4' })),
    });
    const d = await validate(b);
    expect(d.state).toBe('rejected_auto');
    expect(b.t.h.port.moderationCases().map((c) => c.queue)).toEqual(['P0_CSAM']);
    expect(b.t.h.port.moderationCases()[0]!.opened_by).toBe('auto:llama_guard');
    expect(b.calls).toHaveLength(0);
  });

  it('blocks on another hard category without a CSAM case, and sends a borderline score to review', async () => {
    b = await builderSetup({ moderation: (_t, vendor) => (vendor === 'openai' ? openai({ hate: 0.9 }) : undefined) as never });
    const hard = await validate(b);
    expect(hard.state).toBe('rejected_auto');
    expect(b.t.h.port.moderationCases()).toHaveLength(0);
    expect(b.calls).toHaveLength(0);
    b.dispose();
    b = await builderSetup({ moderation: (_t, vendor) => (vendor === 'openai' ? openai({ sexual: 0.3 }) : undefined) as never });
    const soft = await validate(b);
    expect(soft.state).toBe('text_ok');
    expect(soft.moderation).toMatchObject({ text: 'review', publishable: false });
  });

  it('blocks when the classifier says block or names a real person explicitly', async () => {
    const answer = (over: Record<string, unknown>) => (req: { intent: string; model: string }) =>
      req.intent === 'builder-classify'
        ? buildStream({ model: req.model, answer: { sexual_minors: false, sexual: false, hate: false, harassment: false, violence_extreme: false, self_harm: false, extremism: false, real_person_risk: 'none', named_real_people: [], impersonation_intent: false, private_info: false, prompt_injection: false, verdict: 'allow', ...over } })
        : undefined;
    b = await builderSetup({ fixture: answer({ real_person_risk: 'explicit', named_real_people: ['Somebody Real'] }) });
    const explicit = await validate(b);
    expect(explicit.state).toBe('rejected_auto');
    expect(explicit.moderation).toMatchObject({ realPerson: 'explicit', publishable: false });
    b.dispose();
    b = await builderSetup({ fixture: answer({ verdict: 'block', hate: true }) });
    expect((await validate(b)).state).toBe('rejected_auto');
  });

  it('uses Llama Guard in live mode when OPENAI_MODERATION_API_KEY is not set (AC-12)', async () => {
    const ran: string[] = [];
    const ai = { run: (model: string, input: { messages: unknown[] }) => (ran.push(`${model}:${input.messages.length}`), Promise.resolve({ response: { safe: true, categories: [] } })) };
    b = await builderSetup({ env: { MODERATION_MODE: 'live', OPENAI_MODERATION_API_KEY: undefined, AI: ai as never } });
    const d = await validate(b);
    expect(d.state).toBe('text_ok');
    expect(ran).toEqual(['@cf/meta/llama-guard-3-8b:1']);
    expect(sources(b)).toEqual(['names_lint', 'llama_guard', 'haiku_text']);
    expect(b.vendors).toEqual([]); // the fixture seam was not used: this was the live path
  });

  it('records a review verdict when no moderation vendor can run', async () => {
    b = await builderSetup({ env: { MODERATION_MODE: 'live', OPENAI_MODERATION_API_KEY: undefined, AI: undefined } });
    const d = await validate(b);
    expect(d.state).toBe('text_ok');
    expect(d.moderation).toMatchObject({ text: 'review', publishable: false });
    expect(sources(b)).toContain('llama_guard');
    expect(b.t.h.port.moderationSignals().find((s) => s.source === 'llama_guard')?.verdict).toBe('error');
    setUpstreamForTests(null);
  });
});
