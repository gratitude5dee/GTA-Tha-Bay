import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { setNameRegistryForTests } from '../src/npc/safety.ts';
import { find, heroSoul, names, request, seedSouls, talkSetup, type Talk } from './talk-helpers.ts';

// M06a3 AC-9: a line that names someone from the name registry becomes fallback{moderation, deflect}; no line.done reaches the client.
let t: Talk;
afterEach(() => t.dispose());

const REGISTRY = [{ id: 'subj_zab', real: 'Quentin Zabriskie', aliases: ['Q-Zab'] }];

describe('the NameRegistry check of the output', () => {
  it('replaces a line that names a real-side entry with fallback{moderation, deflect}', async () => {
    t = await talkSetup({ fixture: 'name-hit' });
    setNameRegistryForTests(REGISTRY);
    const { frames } = await t.say(request());
    expect(names(frames)).not.toContain('line.done');
    expect(names(frames)).not.toContain('effects');
    expect(names(frames).slice(-2)).toEqual(['fallback', 'done']);
    expect(find(frames, 'fallback')!.data).toEqual({ reason: 'moderation', knot: 'deflect' });
  });

  it('matches an alias and a differently spaced spelling', async () => {
    t = await talkSetup({ fixture: 'name-hit' });
    setNameRegistryForTests([{ id: 'subj_zab', real: 'Somebody Else', aliases: ['quentin  zabriskie'] }]);
    const { frames } = await t.say(request());
    expect(find(frames, 'fallback')!.data).toMatchObject({ reason: 'moderation' });
  });

  it('lets the line through when no entry matches, and when the registry is empty', async () => {
    t = await talkSetup({ fixture: 'name-hit' });
    setNameRegistryForTests([{ id: 'subj_x', real: 'Someone Unrelated' }]);
    const a = await t.say(request());
    expect(names(a.frames)).toContain('line.done');
    setNameRegistryForTests([]);
    t.h.clock.t += 2000;
    const b = await t.say(request());
    expect(names(b.frames)).toContain('line.done');
  });

  it('allows the name of a consented subject whose scope includes name', async () => {
    t = await talkSetup({ fixture: 'name-hit' });
    const base = heroSoul() as { likeness: object };
    const consented = {
      ...base,
      tier: 'consented',
      basis: 'real_person',
      likeness: { ...base.likeness, basis: 'real_person', subjectId: 'subj_zab', consentRecordId: 'consent_1', consentScopes: ['name'], disclaimer: 'courtesy' },
      roles: { hero: false, questGiver: false, vendor: false, fighter: false, tycoonActor: false, racer: false },
      dialogue: { modelTier: 'haiku', maxTurnsPerEncounter: 6 },
    };
    await seedSouls({ extra: { npc_consented: { version: 1, compiled: consented } } });
    setNameRegistryForTests(REGISTRY);
    const { frames } = await t.say(request({ npcId: 'npc_consented' }), { npcId: 'npc_consented' });
    expect(names(frames)).toContain('line.done');
    expect(find(frames, 'meta')!.data).toMatchObject({ disclosure: { aiCharacter: true, disclaimer: 'courtesy' } });
  });

  it('reads the registry from the PRIVATE object names/real.json', async () => {
    t = await talkSetup({ fixture: 'name-hit' });
    await env.PRIVATE.put('names/real.json', JSON.stringify({ schema: 'names/1', entries: REGISTRY }));
    const { frames } = await t.say(request());
    expect(find(frames, 'fallback')!.data).toMatchObject({ reason: 'moderation' });
  });
});
