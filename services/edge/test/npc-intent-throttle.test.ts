import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { HTTP_FOR, NPC_GUARDRAILS } from '@dv/shared';
import type { NpcIntent, NPCIntentRequest, NPCIntentResponse } from '@dv/shared/contracts/c10-npc';
import { parseIntentRequest } from '../src/npc/intent.ts';
import type { FixtureRequest } from '../src/npc/upstream-fixture.ts';
import { playToken } from './npc-helpers.ts';
import { heroSoul, seedSouls, talkSetup, type Talk } from './talk-helpers.ts';
import bad from './fixtures/anthropic/intent-bad-target.sse?raw';
import goTo from './fixtures/anthropic/intent-go-to.sse?raw';
import happy from './fixtures/anthropic/intent-happy.sse?raw';
import invalidGoal from './fixtures/anthropic/intent-invalid-goal.sse?raw';
import notJson from './fixtures/anthropic/intent-not-json.sse?raw';
import error529 from './fixtures/anthropic/error-529.sse?raw';

// M06c AC-4 (server half): route 32 answers a hero's intent request. Identical situations inside ten minutes come from the cache with no
// upstream call; a model result that is invalid or does not fit the soul and the scene becomes continue_schedule (source 'default').
let t: Talk;
afterEach(() => t.dispose());

const FIX: Record<string, string> = { happy, 'go-to': goTo, 'invalid-goal': invalidGoal, 'bad-target': bad, 'not-json': notJson, 'error-529': error529 };
const HERO = 'npc_hero';

async function setup(fixture: keyof typeof FIX = 'happy', over: Parameters<typeof talkSetup>[0] = {}, record = true): Promise<Talk> {
  const talk = await talkSetup({ fixture: (_req: FixtureRequest) => FIX[fixture] as string, ...over });
  await seedSouls({ extra: { [HERO]: { version: 1, compiled: heroSoul() } } });
  if (record) talk.recordCalls();
  return talk;
}

/** Waits for `p` while the virtual clock of the fixture pacing and the route timeout runs. */
async function drive<T>(p: Promise<T>, maxMs = 20_000): Promise<T> {
  let done = false;
  void p.then(() => void (done = true), () => void (done = true));
  for (let ms = 0; ms < maxMs && !done; ms += 100) await t.clock.advance(100);
  return p;
}

let uniq = 0;
/** A request whose scene no other test used, so a cache entry of an earlier test cannot answer it. */
function req(over: Partial<NPCIntentRequest['situation']> = {}, npcId = HERO): NPCIntentRequest {
  return {
    npcId,
    soulVersion: 1,
    trigger: 'block_boundary',
    situation: {
      clockT: 36_000, chunkKey: '9/256/256', poiId: 'poi.potrero-hill.test-lot', activeBlock: 10 + ++uniq,
      nearby: [{ key: 'player:0', kind: 'player', distM: 22 }], events: [], relation: { trust: 12, met: true }, ...over,
    },
  };
}

async function post(body: unknown, init: { npcId?: string; token?: string | null } = {}): Promise<Response> {
  const token = init.token === undefined ? await playToken(t.pid, t.dkt, t.h.clock.t) : init.token;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== null) headers['Authorization'] = `PlayToken ${token}`;
  return t.h.api(`/api/v1/npc/${init.npcId ?? HERO}/intent`, { method: 'POST', headers, body: JSON.stringify(body) });
}
const ask = async (r: NPCIntentRequest): Promise<NPCIntentResponse> => (await (await drive(post(r))).json()) as NPCIntentResponse;
const DEFAULT: NpcIntent = { goal: 'continue_schedule', target: null, urgency: 'low', bark: null, until: 'next_block' };

describe('route 32: the answer', () => {
  it('asks Haiku once with the soul-built schema and returns the intent', async () => {
    t = await setup('happy');
    const res = await drive(post(req()));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as NPCIntentResponse;
    expect(body).toEqual({ intent: { goal: 'idle', target: null, urgency: 'low', bark: 'idle', until: '2m' }, cached: false, source: 'llm' });
    expect(t.calls).toHaveLength(1);
    const sent = t.calls[0]!.call.body as Record<string, unknown>;
    expect(sent['model']).toBe('claude-haiku-5-5');
    expect(sent['thinking']).toEqual({ type: 'disabled' });
    expect(sent).not.toHaveProperty('temperature');
    expect(sent).not.toHaveProperty('top_p');
    const format = ((sent['output_config'] as { format: { type: string; schema: { properties: { goal: { enum: string[] } } } } }).format);
    expect(format.type).toBe('json_schema');
    expect(format.schema.properties.goal.enum).toEqual(['test_target', 'idle', 'continue_schedule', 'approach_player', 'avoid_player', 'go_to']);
    // the scene is data inside tags; no player text exists in the request
    expect(JSON.stringify(sent['messages'])).toContain('<scene trigger=\\"block_boundary\\"');
    expect(t.calls[0]!.req).toMatchObject({ npcId: HERO, intent: 'intent', hero: true });
  });

  it('answers an identical situation from the cache with no upstream call', async () => {
    t = await setup('happy');
    const first = req();
    expect((await ask(first)).source).toBe('llm');
    // the same moment of a different minute, distances inside the same 10 m bucket: the same situation
    const again: NPCIntentRequest = { ...first, trigger: 'player_near', situation: { ...first.situation, clockT: first.situation.clockT + 5_000, nearby: [{ key: 'player:0', kind: 'player', distM: 24 }] } };
    const second = await ask(again);
    expect(second).toEqual({ intent: { goal: 'idle', target: null, urgency: 'low', bark: 'idle', until: '2m' }, cached: true, source: 'cache' });
    expect(t.calls).toHaveLength(1);
  });

  it('asks again for a different situation and after the ten minutes are over', async () => {
    t = await setup('happy');
    const first = req();
    await ask(first);
    await ask(req({ events: ['car_crash'] }));
    expect(t.calls).toHaveLength(2);
    expect((await ask(first)).cached).toBe(true);
    expect(t.calls).toHaveLength(2);
    t.h.clock.t += 601_000;
    const later = await ask(first);
    expect(later.cached).toBe(false);
    expect(t.calls).toHaveLength(3);
  });

  it('keeps a go_to inside the soul places and a target out of nowhere', async () => {
    t = await setup('go-to');
    const ok = await ask(req());
    expect(ok.intent).toMatchObject({ goal: 'go_to', target: 'poi.potrero-hill.test-lot', urgency: 'med', until: '30s' });
    t.dispose();
    t = await setup('bad-target');
    const bad = await ask(req());
    expect(bad).toEqual({ intent: DEFAULT, cached: false, source: 'default' });
  });
});

describe('route 32: an invalid result becomes continue_schedule', () => {
  it('for a goal the soul does not have', async () => {
    t = await setup('invalid-goal');
    const r = req();
    expect(await ask(r)).toEqual({ intent: DEFAULT, cached: false, source: 'default' });
    // and the default is not cached: the next identical request asks again
    expect((await ask(r)).source).toBe('default');
    expect(t.calls).toHaveLength(2);
  });

  it('for text that is not JSON, and for an upstream error', async () => {
    t = await setup('not-json');
    expect(await ask(req())).toEqual({ intent: DEFAULT, cached: false, source: 'default' });
    t.dispose();
    t = await setup('error-529');
    expect(await ask(req())).toEqual({ intent: DEFAULT, cached: false, source: 'default' });
  });

  it('without a key in live mode, and while the budget or a kill switch holds the model off', async () => {
    t = await setup('happy', { env: { ANTHROPIC_MODE: 'live' } }, false);
    expect(await ask(req())).toEqual({ intent: DEFAULT, cached: false, source: 'default' });
    expect(t.calls).toHaveLength(0);
    t.dispose();
    t = await setup('happy');
    await env.FLAGS.put('ks:anthropic', JSON.stringify({ on: true, reason: 'test', by: 'test', at: 0 }));
    expect(await ask(req())).toEqual({ intent: DEFAULT, cached: false, source: 'default' });
    expect(t.calls).toHaveLength(0);
  });
});

describe('route 32: the quota is the turn quota', () => {
  const quota = (pid: string): { reserve(r: { kind: 'turn'; npcId: string; estMicros: number }): Promise<{ ok: boolean }> } =>
    env.QUOTA.get(env.QUOTA.idFromName(`q:p:${pid}`)) as never;

  it('spends one turn per intent that reaches the model and none for a cached answer', async () => {
    t = await setup('happy');
    const q = quota(t.pid);
    const r = req();
    await ask(r);
    await ask(r);
    // 150 turns a day for a P0 profile: one went to the intent, so 149 reservations remain
    let granted = 0;
    for (let i = 0; i < NPC_GUARDRAILS.quotas.p0.turns; i++) if ((await q.reserve({ kind: 'turn', npcId: `npc_fill${i % 5}`, estMicros: 0 })).ok) granted++;
    expect(granted).toBe(NPC_GUARDRAILS.quotas.p0.turns - 1);
  });

  it('degrades to continue_schedule when the day is spent, with no upstream call', async () => {
    t = await setup('happy');
    const q = quota(t.pid);
    for (let i = 0; i < NPC_GUARDRAILS.quotas.p0.turns; i++) await q.reserve({ kind: 'turn', npcId: `npc_fill${i % 5}`, estMicros: 0 });
    expect(await ask(req())).toEqual({ intent: DEFAULT, cached: false, source: 'default' });
    expect(t.calls).toHaveLength(0);
  });
});

describe('route 32: the request itself', () => {
  it('needs a play token', async () => {
    t = await setup('happy');
    const res = await post(req(), { token: null });
    expect(res.status).toBe(HTTP_FOR.unauthorized);
    expect(t.calls).toHaveLength(0);
  });

  it('refuses a body that is not an intent request, and a path that disagrees with it', async () => {
    t = await setup('happy');
    expect((await post({ nope: true })).status).toBe(HTTP_FOR.bad_request);
    expect((await post(req(), { npcId: 'npc_test' })).status).toBe(HTTP_FOR.bad_request);
    const long = req({ nearby: Array.from({ length: 9 }, (_, i) => ({ key: `npc:n${i}`, kind: 'npc' as const, distM: i })) });
    expect((await post(long)).status).toBe(HTTP_FOR.bad_request);
    expect((await t.h.api(`/api/v1/npc/${HERO}/intent`, { method: 'GET' })).status).toBe(405);
    expect(t.calls).toHaveLength(0);
  });

  it('is for heroes only, for souls that exist, and not for a killed NPC', async () => {
    t = await setup('happy');
    expect((await post(req({}, 'npc_test'), { npcId: 'npc_test' })).status).toBe(HTTP_FOR.bad_request);
    expect((await post(req({}, 'npc_nobody'), { npcId: 'npc_nobody' })).status).toBe(HTTP_FOR.not_found);
    const kill = await t.h.api(`/api/v1/admin/roster/${HERO}/kill`, { method: 'POST', ops: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: ['all'], reason: 'quality', ticketId: 'T-2' }) });
    expect(kill.status).toBe(200);
    expect((await post(req())).status).toBe(HTTP_FOR.kill_switched);
    expect(t.calls).toHaveLength(0);
  });

  it('refuses a soul version that is neither current nor the one before', async () => {
    t = await setup('happy');
    const r = req();
    expect((await post({ ...r, soulVersion: 7 })).status).toBe(HTTP_FOR.conflict);
  });

  it('validates every field of the situation', () => {
    const good = req();
    expect(typeof parseIntentRequest(good)).toBe('object');
    for (const [name, mutate] of Object.entries({
      trigger: (r: Record<string, unknown>) => void (r['trigger'] = 'whenever'),
      chunkKey: (r: Record<string, unknown>) => void ((r['situation'] as Record<string, unknown>)['chunkKey'] = '9/x/y'),
      poiId: (r: Record<string, unknown>) => void ((r['situation'] as Record<string, unknown>)['poiId'] = 'somewhere'),
      events: (r: Record<string, unknown>) => void ((r['situation'] as Record<string, unknown>)['events'] = ['party']),
      relation: (r: Record<string, unknown>) => void ((r['situation'] as Record<string, unknown>)['relation'] = { trust: 'high', met: true }),
      distance: (r: Record<string, unknown>) => void ((r['situation'] as Record<string, unknown>)['nearby'] = [{ key: 'player:0', kind: 'player', distM: -1 }]),
    })) {
      const copy = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
      mutate(copy);
      expect(typeof parseIntentRequest(copy), name).toBe('string');
    }
  });
});
