import { afterEach, describe, expect, it } from 'vitest';
import { setNameRegistryForTests } from '../src/npc/safety.ts';
import { buildStream } from '../src/npc/upstream-fixture.ts';
import { defaultLlmSoul } from '../src/npc-builder/fixture-defaults.ts';
import { find, names, request } from './talk-helpers.ts';
import { BACKSTORY, builderSetup, type Builder } from './builder-helpers.ts';

// M06b1 AC-4: a backstory with an alias from the name registry makes the draft non-publishable, with the reason listed; the draft still reaches private,
// and its owner can talk to it.
let b: Builder;
afterEach(() => {
  setNameRegistryForTests(null);
  b.dispose();
});

const REGISTRY = [{ id: 'subj_fixture01', real: 'Jordan Fixture-Real', aliases: ['Fixture Alias Man'] }];

describe('real-person signals', () => {
  it('an alias hit in the backstory leaves the draft non-publishable but private, and the owner can talk to it', async () => {
    b = await builderSetup();
    setNameRegistryForTests(REGISTRY);
    const d = await b.create({ name: 'Marta Vale' }, `${BACKSTORY} Everybody calls her cousin Fixture Alias Man behind his back.`);
    await b.api('POST', `/drafts/${d.id}/validate`);
    await b.drain();
    const checked = await b.get(d.id);
    expect(checked.state).toBe('text_ok');
    expect(checked.moderation.publishable).toBe(false);
    expect(checked.moderation.realPerson).toBe('possible');
    expect(checked.moderation.reasons.join(' ')).toMatch(/real-name list/);
    // the matched name itself is nowhere in the view or in a signal
    expect(JSON.stringify(checked)).not.toContain('Fixture Alias Man');
    expect(JSON.stringify(b.t.h.port.moderationSignals())).not.toContain('Fixture Alias Man');
    expect(b.t.h.port.moderationSignals().find((s) => s.source === 'names_lint')).toMatchObject({ verdict: 'review' });
    await b.api('POST', `/drafts/${d.id}/soul`);
    await b.drain();
    const priv = await b.get(d.id);
    expect(priv.state).toBe('private');
    expect(priv.moderation.publishable).toBe(false);
    expect(priv.moderation.reasons.length).toBeGreaterThan(0);
    // private use works
    const talk = await b.t.say(request({ npcId: priv.npcId, soulVersion: priv.publish.soulVersion!, turn: { intent: 'greet' } }), { npcId: priv.npcId });
    expect(names(talk.frames)[0]).toBe('meta');
    expect(names(talk.frames).at(-1)).toBe('done');
    expect(find(talk.frames, 'meta')!.data['disclosure']).toMatchObject({ aiCharacter: true, disclaimer: 'fictional' });
    expect(find(talk.frames, 'line.done')).toBeDefined();
  });

  it('an alias in the name of the character is refused by the lint after generation, not published', async () => {
    b = await builderSetup();
    setNameRegistryForTests(REGISTRY);
    const d = await b.create({ name: 'Jordan Fixture-Real' }, BACKSTORY);
    await b.api('POST', `/drafts/${d.id}/validate`);
    await b.drain();
    const checked = await b.get(d.id);
    expect(checked.moderation.publishable).toBe(false);
    expect(checked.moderation.realPerson).toBe('possible');
    await b.api('POST', `/drafts/${d.id}/soul`);
    await b.drain();
    const failed = await b.get(d.id);
    expect(failed.state).toBe('soul_failed'); // L3: the name is a real-side name
    expect(failed.lint.some((i) => i.rule === 'L3')).toBe(true);
  });

  it('a real person named by the classifier, or suspected by the writer, makes the draft non-publishable', async () => {
    const classifier = { sexual_minors: false, sexual: false, hate: false, harassment: false, violence_extreme: false, self_harm: false, extremism: false, real_person_risk: 'possible', named_real_people: ['Someone Real'], impersonation_intent: false, private_info: false, prompt_injection: false, verdict: 'allow' };
    b = await builderSetup({ fixture: (req) => (req.intent === 'builder-classify' ? buildStream({ model: req.model, answer: classifier }) : undefined) });
    const d = await b.toPrivate();
    expect(d.state).toBe('private');
    expect(d.moderation).toMatchObject({ realPerson: 'possible', publishable: false });
    b.dispose();
    const suspicious = { ...defaultLlmSoul('mission'), realPersonSuspected: true, namedPeople: ['Someone Real'] };
    b = await builderSetup({ fixture: (req) => (req.intent.startsWith('builder-soul') ? buildStream({ model: req.model, answer: suspicious as never }) : undefined) });
    const flagged = await b.toPrivate();
    expect(flagged.state).toBe('private');
    expect(flagged.moderation).toMatchObject({ realPerson: 'possible', publishable: false });
    b.dispose();
    b = await builderSetup();
    const clean = await b.toPrivate();
    expect(clean.moderation.publishable).toBe(true);
  });
});
