import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { HTTP_FOR } from '@dv/shared';
import { find, FIXTURES, heroSoul, names, request, seedSouls, talkSetup, type Talk } from './talk-helpers.ts';

// M06a3 AC-7: governor levels and the Sonnet 429 re-issue. A hero at level 0 is Sonnet; at level 1 it is Haiku with the same system blocks;
// at level 3 there is no call; a Sonnet request the gateway answers with 429 is re-issued once as the Haiku request.
let t: Talk;
afterEach(() => t.dispose());

const forceLevel = async (level: 0 | 1 | 2 | 3): Promise<void> => {
  const gov = env.GOVERNOR.get(env.GOVERNOR.idFromName(`gov:${env.ENVIRONMENT}`)) as unknown as { forceLevel(l: number, by: string, reason: string): Promise<void> };
  await gov.forceLevel(level, 'test', 'governor suite');
};
const hero = (): Promise<void> => seedSouls({ extra: { npc_hero: { version: 1, compiled: heroSoul() } } });
const talkHero = (): ReturnType<Talk['say']> => t.say(request({ npcId: 'npc_hero' }), { npcId: 'npc_hero' });

describe('governor and model routing', () => {
  it('routes a hero to Sonnet at level 0 and to Haiku with the same system blocks at level 1', async () => {
    t = await talkSetup({ fixture: (r) => (r.model === 'claude-sonnet-5-5' ? FIXTURES['hero-sonnet'] : FIXTURES['happy']) });
    await hero();
    t.recordCalls();
    const l0 = await talkHero();
    expect(find(l0.frames, 'meta')!.data).toMatchObject({ model: 'sonnet', gov: 0 });
    const sonnet = t.calls[0]!;
    expect(sonnet.call.body).toMatchObject({ model: 'claude-sonnet-5-5', thinking: { type: 'between_tools' }, fallbacks: 'default' });
    expect(sonnet.call.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect((sonnet.call.body['output_config'] as { effort: string }).effort).toBe('low');

    await forceLevel(1);
    t.h.clock.t += 2000;
    const l1 = await talkHero();
    expect(find(l1.frames, 'meta')!.data).toMatchObject({ model: 'haiku', gov: 1 });
    const haiku = t.calls[1]!;
    expect(haiku.call.body['model']).toBe('claude-haiku-5-5');
    expect(haiku.call.body['thinking']).toEqual({ type: 'disabled' });
    expect(haiku.call.body).not.toHaveProperty('fallbacks');
    expect(haiku.call.betas).toEqual([]);
    expect(haiku.call.body['system']).toEqual(sonnet.call.body['system']);
    expect(haiku.call.body['output_config']).toEqual(sonnet.call.body['output_config']);
  });

  it('routes a hero to Haiku while ks:anthropic:sonnet is on', async () => {
    t = await talkSetup({ fixture: 'happy' });
    await hero();
    await env.FLAGS.put('ks:anthropic:sonnet', JSON.stringify({ on: true, reason: 'test', by: 'test', ts: 1, expiresAt: null }));
    const { frames } = await talkHero();
    expect(find(frames, 'meta')!.data).toMatchObject({ model: 'haiku' });
  });

  it('answers 503 budget_offline at level 3 without calling the model', async () => {
    t = await talkSetup({ fixture: 'happy' });
    t.recordCalls();
    await forceLevel(3);
    const res = await t.post(request());
    expect(res.status).toBe(HTTP_FOR.budget_offline);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('budget_offline');
    expect(t.calls).toHaveLength(0);
  });

  it('keeps serving at level 2 (voice is capped, text is not)', async () => {
    t = await talkSetup({ fixture: 'happy' });
    await forceLevel(2);
    const { frames } = await t.say(request());
    expect(find(frames, 'meta')!.data).toMatchObject({ gov: 2 });
    expect(names(frames).at(-1)).toBe('done');
  });

  it('re-issues a Sonnet request that got 429 once, at once, as the Haiku request', async () => {
    t = await talkSetup({ fixture: (r) => (r.model === 'claude-sonnet-5-5' ? FIXTURES['error-429'] : FIXTURES['happy']) });
    await hero();
    t.recordCalls();
    const { frames } = await talkHero();
    expect(names(frames).at(-1)).toBe('done');
    expect(names(frames)).toContain('line.done');
    expect(t.calls).toHaveLength(2);
    const [first, second] = t.calls;
    expect(first!.call.body['model']).toBe('claude-sonnet-5-5');
    expect(second!.call.body['model']).toBe('claude-haiku-5-5');
    expect(second!.call.body['thinking']).toEqual({ type: 'disabled' });
    expect(second!.call.body).not.toHaveProperty('fallbacks');
    expect(second!.call.betas).toEqual([]);
    expect(second!.call.body['system']).toEqual(first!.call.body['system']);
    // the re-issue happened right after the error answer, inside the 4 s window (virtual time moves in 100 ms steps)
    expect(find(frames, 'line.done')!.at).toBeLessThan(4000);
  });

  it('does not re-issue twice: a Haiku 429 inside the window is retried once after retry-after, then given up', async () => {
    t = await talkSetup({ fixture: 'error-429' });
    t.recordCalls();
    const { frames } = await t.say(request());
    expect(t.calls).toHaveLength(2); // the first call and exactly one retry
    expect(names(frames).slice(-2)).toEqual(['fallback', 'done']);
    expect(find(frames, 'fallback')!.data).toMatchObject({ reason: 'upstream' });
  });

  it('gives up at once when retry-after does not fit the 4 s window, and never retries a spend-limit 400', async () => {
    t = await talkSetup({ fixture: 'error-429-long' });
    t.recordCalls();
    const a = await t.say(request());
    expect(t.calls).toHaveLength(1);
    expect(find(a.frames, 'fallback')!.data).toMatchObject({ reason: 'upstream' });
    t.dispose();
    t = await talkSetup({ fixture: 'error-400-spend-limit' });
    t.recordCalls();
    const b = await t.say(request());
    expect(t.calls).toHaveLength(1);
    expect(find(b.frames, 'fallback')!.data).toMatchObject({ reason: 'upstream' });
  });
});
