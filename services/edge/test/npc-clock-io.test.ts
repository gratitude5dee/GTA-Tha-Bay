import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import type { NPCIntentResponse } from '@dv/shared/contracts/c10-npc';
import bundled from '../src/generated/npc-fixtures.json';
import { buildStream } from '../src/npc/upstream-fixture.ts';
import { fakeAi } from './ai-helpers.ts';
import { playToken } from './npc-helpers.ts';
import { find, heroSoul, names, request, seedSouls, talkSetup, type Frame, type Talk } from './talk-helpers.ts';
import error529 from './fixtures/anthropic/error-529.sse?raw';

// BD-FIX-FLAKE-TTS-01: the virtual clock of the talk suites stands still while the Worker waits on a binding. Each case slows one binding
// by real time, as a loaded workerd does, and expects what an unloaded run gives: the stream ends, the request is answered, the kill poll
// keeps its 250 virtual ms, and the wait costs no virtual time.
let t: Talk;
afterEach(() => t.dispose());

const realDelay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const LINE = 'Please confirm the lot is clear. Then sign the checklist.';
const turn = buildStream({
  model: 'claude-haiku-5-5',
  answer: { line: LINE, emotion: 'neutral', gesture: 'nod', action: 'none', action_arg: null, affinity_delta: 0, memory_writes: [], end_conversation: false },
  outputTokens: 60,
});
const npcTest = (bundled.souls as Record<string, { compiled: Record<string, unknown> }>)['npc_test']!.compiled as { voice: object; roles: object };
const textFrames = (frames: Frame[]): Frame[] => frames.filter((f) => f.event === 'line.delta' && f.data['text'] !== undefined);

/** ENCOUNTER whose `status` (the kill poll of an open stream) answers after `ms` of real time. */
function slowStatus(ms: number): DurableObjectNamespace {
  const ns = env.ENCOUNTER;
  return {
    idFromName: (name: string) => ns.idFromName(name),
    idFromString: (id: string) => ns.idFromString(id),
    get: (id: DurableObjectId) => {
      const stub = ns.get(id) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      return new Proxy(
        {},
        {
          get: (_o, prop) => {
            if (prop === 'then' || typeof prop === 'symbol') return undefined;
            if (prop === 'status') return async () => (await realDelay(ms), stub['status']!());
            return (...a: unknown[]) => stub[prop]!(...a);
          },
        },
      );
    },
  } as unknown as DurableObjectNamespace;
}

describe('the virtual clock waits for the Worker', () => {
  it('ends a voiced turn whose Aura calls take a second of real time, and the wait takes no virtual time', async () => {
    const ai = fakeAi();
    const slowAi = {
      async run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown> {
        if (model.startsWith('@cf/deepgram/')) await realDelay(1000);
        return (ai.ai as unknown as { run(m: string, i: unknown, o?: unknown): Promise<unknown> }).run(model, inputs, options);
      },
    };
    t = await talkSetup({ fixture: () => turn, env: { AI: slowAi as unknown as Ai } });
    await seedSouls({ extra: { npc_voiced: { version: 1, compiled: { ...npcTest, voice: { ...npcTest.voice, tier: 't1' } } } } });
    const { frames } = await t.say(request({ npcId: 'npc_voiced' }), { npcId: 'npc_voiced' });
    expect(names(frames).slice(-3)).toEqual(['line.done', 'effects', 'done']);
    expect(frames.filter((f) => f.data['audio'] !== undefined)).toHaveLength(4);
    // the second of Aura is not virtual time (the old clock ran out its 20 s budget on it)
    expect(find(frames, 'line.done')!.at - textFrames(frames).at(-1)!.at).toBeLessThan(500);
    // the Worker's own bindings and the suite's stub went through the gate
    for (const label of ['FLAGS.get', 'PRIVATE.get', 'ENCOUNTER.begin', 'ENCOUNTER.status', 'QUOTA.reserve', 'AI.run']) expect([...t.io.seen]).toContain(label);
  });

  it('delivers a kill within one poll when each poll takes real time', async () => {
    t = await talkSetup({ fixture: 'slow-3s', env: { ENCOUNTER: slowStatus(150) } });
    const res = await t.post(request());
    expect(res.status).toBe(200);
    const kill = (): Promise<Response> =>
      t.h.api('/api/v1/admin/roster/npc_test/kill', { method: 'POST', ops: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: ['all'], reason: 'quality', ticketId: 'T-1' }) });
    const frames = await t.read(res, { at: { 1000: async () => void expect((await kill()).status).toBe(200) } });
    expect(names(frames)).toEqual(['meta', 'fallback', 'done']);
    expect(find(frames, 'fallback')!.data).toMatchObject({ reason: 'killed' });
    expect(find(frames, 'fallback')!.at).toBeLessThanOrEqual(1250 + 100);
  });

  it('answers an intent request whose flag reads take real time (route 32, Cache API gated too)', async () => {
    const kv = env.FLAGS as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const slowFlags = {
      get: async (...a: unknown[]) => (await realDelay(700), kv['get']!(...a)),
      getWithMetadata: (...a: unknown[]) => kv['getWithMetadata']!(...a),
      put: (...a: unknown[]) => kv['put']!(...a),
      delete: (...a: unknown[]) => kv['delete']!(...a),
      list: (...a: unknown[]) => kv['list']!(...a),
    };
    t = await talkSetup({ fixture: () => error529, env: { FLAGS: slowFlags as unknown as KVNamespace } });
    await seedSouls({ extra: { npc_hero: { version: 1, compiled: heroSoul() } } });
    const token = await playToken(t.pid, t.dkt, t.h.clock.t);
    const body = {
      npcId: 'npc_hero',
      soulVersion: 1,
      trigger: 'block_boundary',
      situation: { clockT: 36_000, chunkKey: '9/256/256', poiId: 'poi.potrero-hill.test-lot', activeBlock: 23, nearby: [{ key: 'player:0', kind: 'player', distM: 22 }], events: [], relation: { trust: 12, met: true } },
    };
    const p = t.h.api('/api/v1/npc/npc_hero/intent', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `PlayToken ${token}` }, body: JSON.stringify(body) });
    let done = false;
    void p.then(
      () => void (done = true),
      () => void (done = true),
    );
    // the drive of npc-intent-throttle: 20 virtual seconds at most, which the 50 ms of the fixture's pacing never come near
    for (let ms = 0; ms < 20_000 && !done; ms += 100) await t.clock.advance(100);
    expect(done).toBe(true);
    expect(t.clock.t).toBeLessThanOrEqual(1000);
    expect(((await (await p).json()) as NPCIntentResponse).source).toBe('default');
    expect([...t.io.seen]).toContain('caches.default.match');
  });
});
