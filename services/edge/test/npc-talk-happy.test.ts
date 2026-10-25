import { afterEach, describe, expect, it } from 'vitest';
import { setServerEventSinkForTests } from '../src/telemetry/server.ts';
import { context, find, FIXTURES, heroSoul, names, request, seedSouls, talkSetup, textOf, type Talk } from './talk-helpers.ts';

// M06a3 AC-1: the recorded happy stream through route 31. Event order, the AI disclosure, the price of the usage, the unpriced fallback model.
let t: Talk;
afterEach(() => {
  t.dispose();
  setServerEventSinkForTests(null);
});

describe('route 31, the happy path', () => {
  it('streams meta, line.delta+, line.done, effects, done and charges the usage at the F-034 Haiku prices', async () => {
    t = await talkSetup({ fixture: 'happy' });
    const costs: Record<string, unknown>[] = [];
    setServerEventSinkForTests((name, props) => {
      if (name === 'genai.cost') costs.push(props);
    });
    const { res, frames } = await t.say(request());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('X-DV-Npc-Mode')).toBe('fixture');

    const order = names(frames);
    expect(order[0]).toBe('meta');
    expect(order.slice(-3)).toEqual(['line.done', 'effects', 'done']);
    const deltas = order.slice(1, -3);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.every((n) => n === 'line.delta')).toBe(true);

    const meta = find(frames, 'meta')!.data as { disclosure: { aiCharacter: boolean; disclaimer: string }; model: string; turnIndex: number; turnsLeft: number; voice: string; npcId: string; soulVersion: number };
    expect(meta.disclosure.aiCharacter).toBe(true);
    expect(meta).toMatchObject({ model: 'haiku', turnIndex: 0, voice: 'text', npcId: 'npc_test', soulVersion: 1 });
    expect(meta.turnsLeft).toBe(5); // npc_test allows 6 turns per encounter

    // the streamed text is the line, and line.done carries the validated line
    expect(textOf(frames)).toBe('Good day. Please confirm the lot is clear.');
    expect(find(frames, 'line.done')!.data).toEqual({ text: 'Good day. Please confirm the lot is clear.', words: 8 });
    expect(find(frames, 'effects')!.data).toEqual({ mood: 'neutral', gesture: 'nod' });

    // 180 fresh input at $0.10, 1,500 written to the 1 h cache at $0.20, 60 output at $0.50 per million: 18 + 300 + 30 micros
    const done = find(frames, 'done')!.data as { costMicros: number; turnsLeft: number; closed: boolean };
    expect(done).toEqual({ costMicros: 348, turnsLeft: 5, closed: false });
    expect(costs).toEqual([{ vendor: 'anthropic', model: 'claude-haiku-5-5', usdMicros: 348, cacheHit: false, tier: 'local' }]);
    expect(t.h.logs.filter((l) => l.includes('genai.cost.unpriced'))).toEqual([]);
    // the async moderation (M06b1) ran in fixture mode and found nothing: no stub line, no case
    expect(t.h.logs).not.toContain('moderation: lands in M06b1');
    expect(t.h.port.moderationCases()).toEqual([]);
  });

  it('proposes an offered mission, clamps affinity and counts the memory write', async () => {
    t = await talkSetup({ fixture: 'happy-effects' });
    await seedSouls({ extra: { npc_giver: { version: 1, compiled: { ...heroSoul(), roles: { hero: false, questGiver: true, vendor: false, fighter: false, tycoonActor: false, racer: false }, dialogue: { modelTier: 'haiku', maxTurnsPerEncounter: 6 } } } } });
    const ctx = context({ offers: { missionIds: ['m_first'], raceIds: [], dealIds: [] } });
    const { frames } = await t.say(request({ npcId: 'npc_giver', context: ctx }), { npcId: 'npc_giver' });
    expect(find(frames, 'effects')!.data).toEqual({
      action: { kind: 'offer_mission', arg: 'm_first' },
      mood: 'proud',
      gesture: 'point',
      memoryWrite: { count: 1 },
      affinityDelta: 10,
    });
  });

  it('charges a hero turn served by a model that is not in F-034 at the Opus 5.5 rates and logs it once', async () => {
    t = await talkSetup({ fixture: 'hero-fallback-served' });
    await seedSouls({ extra: { npc_hero: { version: 1, compiled: heroSoul() } } });
    const { frames } = await t.say(request({ npcId: 'npc_hero' }), { npcId: 'npc_hero' });
    expect(find(frames, 'meta')!.data).toMatchObject({ model: 'sonnet' });
    // 300 input at $4, 1,500 cache read at $0.20, 80 output at $20 per million: 1,200 + 300 + 1,600
    expect(find(frames, 'done')!.data).toMatchObject({ costMicros: 3100 });
    const unpriced = t.h.logs.filter((l) => l.includes('genai.cost.unpriced'));
    expect(unpriced).toHaveLength(1);
    expect(JSON.parse(unpriced[0]!)).toEqual({ event: 'genai.cost.unpriced', model: 'claude-fallback-served-1' });
  });

  it('charges a Sonnet-served hero turn at the Sonnet prices without the unpriced line', async () => {
    t = await talkSetup({ fixture: 'hero-sonnet' });
    await seedSouls({ extra: { npc_hero: { version: 1, compiled: heroSoul() } } });
    const { frames } = await t.say(request({ npcId: 'npc_hero' }), { npcId: 'npc_hero' });
    // 300 input at $2, 1,500 cache read at $0.10, 80 output at $10 per million: 600 + 150 + 800
    expect(find(frames, 'done')!.data).toMatchObject({ costMicros: 1550 });
    expect(t.h.logs.filter((l) => l.includes('genai.cost.unpriced'))).toEqual([]);
  });

  it('stores the pair: the second turn of the encounter sees the first in its history and reads the cache', async () => {
    t = await talkSetup({ fixture: (r) => (r.turnIndex === 0 ? FIXTURES['happy'] : FIXTURES['happy-cached']) });
    const first = await t.say(request());
    const encounterId = (find(first.frames, 'meta')!.data as { encounterId: string }).encounterId;
    expect(encounterId).toMatch(/^[0-9a-f-]{36}$/);
    t.h.clock.t += 2000;
    const second = await t.say(request({ encounterId, turn: { text: 'and the weather?', intent: 'smalltalk' } }));
    expect(find(second.frames, 'meta')!.data).toMatchObject({ turnIndex: 1, encounterId, turnsLeft: 4 });
    // 160 input at $0.10 plus 1,500 cache read at $0.01 plus 55 output at $0.50 per million: 16 + 15 + 28 (27.5 rounded up)
    expect(find(second.frames, 'done')!.data).toMatchObject({ costMicros: 59 });
  });
});
