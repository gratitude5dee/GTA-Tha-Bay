import { describe, expect, it } from 'vitest';
import { limitWords, normalizeTurnJson, validateTurn, wordCount } from '../../src/npc/executor.ts';
import type { ExecutorScene, ExecutorSoul, NpcTurnOutput } from '../../src/npc/executor.ts';
import { validateNpcTurn } from '../../src/npc/validate.ts';

// M06a3 AC-10 (executor part): the clamps, the offers rule and the action rules of 04-npc.md section 5.4 item 5.
const soul = (over: Partial<ExecutorSoul> = {}): ExecutorSoul => ({
  roles: { hero: false, questGiver: true, vendor: false, fighter: false, tycoonActor: false, racer: true },
  archetype: 'civilian',
  temperament: 'calm',
  maxWordsPerLine: 20,
  ...over,
});
const scene = (over: Partial<ExecutorScene> = {}): ExecutorScene => ({
  mode: 'story',
  offers: { missionIds: ['m_first'], raceIds: ['r_one'], dealIds: [] },
  ...over,
});
const turn = (over: Partial<NpcTurnOutput> = {}): NpcTurnOutput => ({
  line: 'Good day.', emotion: 'neutral', gesture: 'none', action: 'none', action_arg: null, affinity_delta: 0, memory_writes: [], end_conversation: false, ...over,
});

describe('validateTurn', () => {
  it('clamps affinity_delta to -10..10 and drops it at 0', () => {
    expect(validateTurn(turn({ affinity_delta: 99 }), soul(), scene()).effects.affinityDelta).toBe(10);
    expect(validateTurn(turn({ affinity_delta: -99 }), soul(), scene()).effects.affinityDelta).toBe(-10);
    expect(validateTurn(turn({ affinity_delta: 3.9 }), soul(), scene()).effects.affinityDelta).toBe(3);
    expect(validateTurn(turn({ affinity_delta: 0 }), soul(), scene()).effects.affinityDelta).toBeUndefined();
  });

  it('keeps at most 2 memory writes of at most 240 characters, scrubs contact data and clamps importance', () => {
    const long = 'x'.repeat(400);
    const r = validateTurn(
      turn({
        memory_writes: [
          { kind: 'promise', text: long, importance: 99 },
          { kind: 'player_fact', text: 'Reach me at jane@example.org', importance: 0 },
          { kind: 'event', text: 'third', importance: 5 },
        ],
      }),
      soul(),
      scene(),
    );
    expect(r.memoryWrites).toHaveLength(2);
    expect(r.memoryWrites[0]!.text).toHaveLength(240);
    expect(r.memoryWrites[0]!.importance).toBe(10);
    expect(r.memoryWrites[1]!.text).toBe('Reach me at [removed]');
    expect(r.memoryWrites[1]!.importance).toBe(1);
    expect(r.effects.memoryWrite).toEqual({ count: 2 });
  });

  it('accepts an offer only when action_arg is in the scene offers and the role allows it', () => {
    expect(validateTurn(turn({ action: 'offer_mission', action_arg: 'm_first' }), soul(), scene()).effects.action).toEqual({ kind: 'offer_mission', arg: 'm_first' });
    expect(validateTurn(turn({ action: 'offer_mission', action_arg: 'm_other' }), soul(), scene()).effects.action).toBeUndefined();
    expect(validateTurn(turn({ action: 'offer_mission', action_arg: null }), soul(), scene()).effects.action).toBeUndefined();
    expect(validateTurn(turn({ action: 'offer_mission', action_arg: 'm_first' }), soul({ roles: { ...soul().roles, questGiver: false } }), scene()).effects.action).toBeUndefined();
    expect(validateTurn(turn({ action: 'offer_race', action_arg: 'r_one' }), soul(), scene()).effects.action).toEqual({ kind: 'offer_race', arg: 'r_one' });
    expect(validateTurn(turn({ action: 'offer_deal', action_arg: 'd1' }), soul({ roles: { ...soul().roles, tycoonActor: true } }), scene()).effects.action).toBeUndefined();
  });

  it('allows attack and call_police only for a volatile or police NPC in the story mode', () => {
    for (const kind of ['attack', 'call_police'] as const) {
      expect(validateTurn(turn({ action: kind }), soul(), scene()).effects.action).toBeUndefined();
      expect(validateTurn(turn({ action: kind }), soul({ temperament: 'volatile' }), scene()).effects.action).toEqual({ kind, arg: null });
      expect(validateTurn(turn({ action: kind }), soul({ archetype: 'police' }), scene()).effects.action).toEqual({ kind, arg: null });
      expect(validateTurn(turn({ action: kind }), soul({ temperament: 'volatile' }), scene({ mode: 'sandbox' })).effects.action).toBeUndefined();
    }
  });

  it('honours end_conversation and a forced end', () => {
    expect(validateTurn(turn({ end_conversation: true }), soul(), scene()).effects.endConversation).toBe(true);
    expect(validateTurn(turn(), soul(), scene()).effects.endConversation).toBeUndefined();
    expect(validateTurn(turn(), soul(), scene({ forceEnd: true })).effects.endConversation).toBe(true);
  });

  it('reports mood and gesture, and omits a neutral gesture', () => {
    const r = validateTurn(turn({ emotion: 'amused', gesture: 'laugh' }), soul(), scene());
    expect(r.effects).toMatchObject({ mood: 'amused', gesture: 'laugh' });
    expect(validateTurn(turn(), soul(), scene()).effects.gesture).toBeUndefined();
  });
});

describe('limitWords', () => {
  it('keeps a line within the limit plus 5 words as it is', () => {
    const line = Array.from({ length: 25 }, () => 'word').join(' ');
    expect(limitWords(line, 20)).toEqual({ text: line, truncated: false });
  });

  it('cuts at a sentence boundary when one fits', () => {
    const a = 'One two three four five six seven eight.';
    const b = 'Nine ten eleven twelve thirteen fourteen fifteen sixteen.';
    const r = limitWords(`${a} ${b} Seventeen eighteen.`, 10);
    expect(r.truncated).toBe(true);
    expect(r.text).toBe(a);
  });

  it('cuts to the limit with an ellipsis when the first sentence is too long', () => {
    const r = limitWords(Array.from({ length: 60 }, (_, i) => `w${i}`).join(' '), 10);
    expect(r.truncated).toBe(true);
    expect(wordCount(r.text.replace('…', ''))).toBe(10);
    expect(r.text.endsWith('…')).toBe(true);
  });
});

describe('normalizeTurnJson', () => {
  it('lower-cases the enum fields so a case change from the model still validates', () => {
    const raw = { ...turn(), emotion: 'Happy', gesture: 'NOD', action: 'None', memory_writes: [{ kind: 'Promise', text: 'a', importance: 1 }] };
    expect(validateNpcTurn(raw).length).toBeGreaterThan(0);
    expect(validateNpcTurn(normalizeTurnJson(raw))).toEqual([]);
  });
});
