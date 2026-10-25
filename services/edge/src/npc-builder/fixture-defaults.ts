import type { LlmSoul } from '@dv/shared/npc';
import { buildStream, type FixtureRequest } from '../npc/upstream-fixture.ts';
import { BUILDER, BUILDER_FIXTURE_NPC } from './bundle.ts';

/**
 * What the builder's model calls answer in fixture mode when no test chose another stream (a Preview, `wrangler dev`, the e2e Worker): a classifier
 * that allows, a plain original character that fits any district of the bundled place list, a judge that passes every probe, and a neutral line
 * for the character's own turns. Recorded-style, not recorded: no key was available to record real answers.
 */
/** An original character that passes the schema and the lints for the given district (places come from the bundled list). */
export function defaultLlmSoul(district: string): LlmSoul {
  const pois = BUILDER.pois[district] ?? [];
  const home = pois[0] ?? 'poi.mission.24th-st.apt-ro';
  const work = pois[1] ?? home;
  const block = (from: string, to: string, activity: LlmSoul['schedule'][number]['activity'], place: string, interruptible: boolean, priority: number): LlmSoul['schedule'][number] =>
    ({ days: 'daily', from, to, activity, place, interruptible, priority }) as LlmSoul['schedule'][number];
  return {
    shortBio: 'A made-up neighbourhood regular who knows everybody on the block and talks to anyone who stops.',
    speech: {
      register: ['friendly', 'quick', 'dry'],
      dialectNotes: null,
      lexicon: [{ term: 'the block', gloss: 'the few streets this character calls home', freq: 'often' }],
      catchphrases: ['Take your time.'],
      avoid: ['long speeches'],
      verbosity: 'normal',
      maxWordsPerLine: 24,
      profanity: 'mild',
      languages: ['en'],
    },
    personality: {
      traits: ['curious', 'patient', 'stubborn'],
      values: ['neighbours', 'a fair price'],
      motivations: ['keep the block lively'],
      fears: ['a quiet week'],
      humor: 'dry and gentle',
      temperament: 'warm',
    },
    knowledge: { knows: ['who lives on the block', 'where the good food is'], doesNotKnow: ['anything outside the neighbourhood'], era: 'present' },
    locations: { home: home as LlmSoul['locations']['home'], hangouts: (work === home ? [] : [work]) as LlmSoul['locations']['hangouts'] },
    schedule: [
      block('00:00', '09:00', 'sleep', home, false, 9),
      block('09:00', '10:00', 'eat', home, true, 3),
      block('10:00', '17:00', 'work', work, true, 5),
      block('17:00', '23:00', 'socialize', work, true, 4),
      block('23:00', '24:00', 'idle', home, true, 2),
    ],
    goals: ['work', 'socialize'],
    visual_brief: 'Person in their thirties with a patched denim jacket over a striped shirt, scuffed canvas shoes, a knitted cap pulled low and a tote bag full of takeout menus, a relaxed and watchful expression.',
    rails: { forbiddenTopics: ['real people'], never: ['claim to be a real person', 'ask for personal contact details'], deflectionStyle: 'changes the subject to the block and asks what the player needs' },
    sections: {
      identity: 'A made-up regular of the neighbourhood, written for this game. They know the block, its stoops and its rumours, and they are happy to talk to anyone who stops.',
      voice: 'Friendly and quick, with a dry edge.\n- Do: answer the question and add one small detail.\n- Do: keep lines short.\n- Do not: lecture.',
      personality: 'Warm, curious and a little stubborn. They enjoy a good rumour and a fair deal, and they get quiet when a week is slow.',
      knowledge: 'They know the people and places of the block and little else. They do not follow anything beyond the neighbourhood.',
      placesAndSchedule: 'They sleep at home, eat a late breakfast, spend the day at their usual spot and stay out until late.',
      rails: 'They never claim to be a real person, never ask for contact details and steer away from anything that is not the block and its people.',
      exampleLines: [
        { tag: 'greeting', text: 'Hey there. Pull up a stoop, the block is slow today.' },
        { tag: 'greeting', text: 'Back again? Good, I was running out of people to talk to.' },
        { tag: 'mission', text: 'If you hear about anything happening on the block, tell me first.' },
        { tag: 'mission', text: 'Ask around for me and I will make it worth your while.' },
        { tag: 'deflect', text: 'That is not my business. What do you actually need?' },
        { tag: 'deflect', text: 'Ha, no. Ask me about the block instead.' },
        { tag: 'threat', text: 'Careful now. I know everybody here, and they know me.' },
        { tag: 'farewell', text: 'Go on, take care of yourself out there.' },
        { tag: 'farewell', text: 'See you around the block.' },
      ],
    },
    realPersonSuspected: false,
    namedPeople: [],
  };
}

const CLASSIFIER_ALLOW = {
  sexual_minors: false,
  sexual: false,
  hate: false,
  harassment: false,
  violence_extreme: false,
  self_harm: false,
  extremism: false,
  real_person_risk: 'none',
  named_real_people: [],
  impersonation_intent: false,
  private_info: false,
  prompt_injection: false,
  verdict: 'allow',
};

/** The stream a fixture-mode builder call gets, or null when the request is not a builder call (the dialogue defaults then apply). */
export function builderDefaultFixture(req: FixtureRequest): string | null {
  if (req.npcId === BUILDER_FIXTURE_NPC) {
    const [kind, arg = ''] = req.intent.split(':');
    if (kind === 'builder-classify') return buildStream({ model: req.model, answer: CLASSIFIER_ALLOW, inputTokens: 900, outputTokens: 90 });
    if (kind === 'builder-soul' || kind === 'builder-repair') return buildStream({ model: req.model, answer: defaultLlmSoul(arg) as unknown as Record<string, unknown>, inputTokens: 2400, outputTokens: 1800, chunk: 400 });
    if (kind === 'builder-judge') return buildStream({ model: req.model, answer: { rails: 2, in_voice: 2 }, inputTokens: 500, outputTokens: 12 });
    return null;
  }
  if (/^u_[a-z0-9]{8,32}$/.test(req.npcId)) {
    return buildStream({
      model: req.model,
      answer: {
        line: 'Hey there. This is a recorded line, not a live model.',
        emotion: 'neutral',
        gesture: 'nod',
        action: 'none',
        action_arg: null,
        affinity_delta: 0,
        memory_writes: [],
        end_conversation: false,
      },
      inputTokens: 700,
      outputTokens: 40,
      firstDelayMs: 200,
      chunkDelayMs: 30,
    });
  }
  return null;
}
