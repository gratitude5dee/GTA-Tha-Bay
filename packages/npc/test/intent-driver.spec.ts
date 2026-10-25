import { describe, expect, it } from 'vitest';
import type { NpcIntent, NPCIntentRequest, NPCIntentResponse } from '@dv/shared/contracts/c10-npc';
import { IntentDriver, attachIntentDriver, type IntentMessage, type IntentOutcome } from '../src/client/intent-driver.ts';

const intent = (over: Partial<NpcIntent> = {}): NpcIntent => ({ goal: 'idle', target: null, urgency: 'low', bark: 'idle', until: '2m', ...over });
const answer = (i: NpcIntent = intent(), source: NPCIntentResponse['source'] = 'llm'): NPCIntentResponse => ({ intent: i, cached: source === 'cache', source });

let rid = 0;
const msg = (npcId: string): IntentMessage => {
  const req: NPCIntentRequest = {
    npcId, soulVersion: 1, trigger: 'block_boundary',
    situation: { clockT: 1, chunkKey: '9/256/256', poiId: null, activeBlock: 0, nearby: [], events: [], relation: { trust: 0, met: false } },
  };
  return { rid: ++rid, req };
};

/** A fetch the test settles by hand, so "in flight" can be held open. */
function fakeNet() {
  const calls: { url: string; resolve(r: Response): void; signal: AbortSignal | undefined; body: unknown; settled: boolean }[] = [];
  const fetchFn = ((url: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const call = { url, resolve: (r: Response): void => ((call.settled = true), resolve(r)), signal: init?.signal ?? undefined, body: JSON.parse(String(init?.body ?? '{}')) as unknown, settled: false };
      calls.push(call);
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
  const ok = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  return { calls, fetchFn, ok };
}

function driver(over: Partial<ConstructorParameters<typeof IntentDriver>[0]> = {}) {
  const net = fakeNet();
  const clock = { t: 1_000_000 };
  const delivered: { npcId: string; intent: NpcIntent; rid: number }[] = [];
  const d = new IntentDriver({
    fetch: net.fetchFn,
    auth: () => Promise.resolve({ Authorization: 'PlayToken t' }),
    now: () => clock.t,
    online: () => true,
    tier: () => 'desktop',
    deliver: (npcId, i, r) => void delivered.push({ npcId, intent: i, rid: r }),
    ...over,
  });
  return { d, net, clock, delivered };
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('IntentDriver throttles (AC-4)', () => {
  it('keeps one request in flight: a second hero is dropped until the first answers', async () => {
    const s = driver();
    const a = s.d.offer(msg('hero_a'));
    const b = await s.d.offer(msg('hero_b'));
    expect(b).toEqual({ sent: false, drop: 'in_flight' });
    await tick();
    expect(s.net.calls).toHaveLength(1);
    s.net.calls[0]?.resolve(s.net.ok(answer()));
    expect(await a).toEqual({ sent: true, result: 'applied' });
    // the slot is free again
    s.clock.t += 5_000;
    const c = s.d.offer(msg('hero_b'));
    await tick();
    expect(s.net.calls).toHaveLength(2);
    s.net.calls[1]?.resolve(s.net.ok(answer()));
    expect((await c).sent).toBe(true);
  });

  it('does not send a second request for the same NPC within 60 s, and does after', async () => {
    const s = driver();
    const first = s.d.offer(msg('hero_a'));
    await tick();
    s.net.calls[0]?.resolve(s.net.ok(answer()));
    await first;
    s.clock.t += 59_000;
    expect(await s.d.offer(msg('hero_a'))).toEqual({ sent: false, drop: 'npc_gap' });
    s.clock.t += 2_000;
    const again = s.d.offer(msg('hero_a'));
    await tick();
    expect(s.net.calls).toHaveLength(2);
    s.net.calls[1]?.resolve(s.net.ok(answer()));
    expect((await again).sent).toBe(true);
  });

  it('lets at most six requests leave the client in a minute', async () => {
    const s = driver();
    const outcomes: IntentOutcome[] = [];
    for (let i = 0; i < 8; i++) {
      const p = s.d.offer(msg(`hero_${i}`));
      await tick();
      s.net.calls[s.net.calls.length - 1]?.resolve(s.net.ok(answer()));
      outcomes.push(await p);
      s.clock.t += 5_000;
    }
    expect(outcomes.filter((o) => o.sent)).toHaveLength(6);
    expect(outcomes.slice(6)).toEqual([{ sent: false, drop: 'rate' }, { sent: false, drop: 'rate' }]);
    expect(s.net.calls).toHaveLength(6);
    // a minute after the first one left, a slot opens
    s.clock.t += 30_000;
    const p = s.d.offer(msg('hero_9'));
    await tick();
    expect(s.net.calls).toHaveLength(7);
    s.net.calls[6]?.resolve(s.net.ok(answer()));
    expect((await p).sent).toBe(true);
  });

  it('8 requests in 60 s for 3 NPCs: at most 6 leave, at most 1 in flight, never a repeat inside 60 s', async () => {
    const s = driver();
    let peak = 0;
    const open = (): void => {
      peak = Math.max(peak, s.net.calls.filter((c) => !c.settled).length);
    };
    const out: IntentOutcome[] = [];
    const ids = ['hero_a', 'hero_b', 'hero_c', 'hero_a', 'hero_b', 'hero_c', 'hero_a', 'hero_b'];
    const pending: Promise<IntentOutcome>[] = [];
    for (const [i, id] of ids.entries()) {
      pending.push(s.d.offer(msg(id)));
      await tick();
      open();
      s.net.calls[s.net.calls.length - 1]?.resolve(s.net.ok(answer()));
      s.clock.t += 7_000 + i;
    }
    for (const p of pending) out.push(await p);
    expect(out.filter((o) => o.sent).length).toBeLessThanOrEqual(6);
    expect(s.net.calls.length).toBeLessThanOrEqual(6);
    expect(peak).toBeLessThanOrEqual(1);
    // each NPC left once in this minute
    const sentTo = s.net.calls.map((c) => (c.body as NPCIntentRequest).npcId);
    expect(new Set(sentTo).size).toBe(sentTo.length);
  });

  it('ignores a request id it has seen', async () => {
    const s = driver();
    const m = msg('hero_a');
    const p = s.d.offer(m);
    await tick();
    s.net.calls[0]?.resolve(s.net.ok(answer()));
    await p;
    expect(await s.d.offer(m)).toEqual({ sent: false, drop: 'stale' });
  });
});

describe('IntentDriver switches (AC-8)', () => {
  it('sends nothing at mobile-low', async () => {
    const s = driver({ tier: () => 'mobile-low' });
    for (const id of ['a', 'b', 'c']) expect(await s.d.offer(msg(id))).toEqual({ sent: false, drop: 'tier' });
    expect(s.net.calls).toHaveLength(0);
  });

  it('sends nothing while offline, and nothing without a play token', async () => {
    const off = driver({ online: () => false });
    expect(await off.d.offer(msg('a'))).toEqual({ sent: false, drop: 'offline' });
    expect(off.net.calls).toHaveLength(0);
    const anon = driver({ auth: () => Promise.resolve(null) });
    expect(await anon.d.offer(msg('a'))).toEqual({ sent: false, drop: 'no_auth' });
    expect(anon.net.calls).toHaveLength(0);
    // a request that never left does not use up the NPC's minute or the client's budget
    expect(anon.d.stats.sent).toBe(0);
  });

  it('sends intents at the other tiers', async () => {
    for (const tier of ['desktop-ultra', 'desktop', 'xr-visionpro', 'xr-quest', 'mobile']) {
      const s = driver({ tier: () => tier });
      const p = s.d.offer(msg('a'));
      await tick();
      expect(s.net.calls, tier).toHaveLength(1);
      s.net.calls[0]?.resolve(s.net.ok(answer()));
      await p;
    }
  });
});

describe('IntentDriver answers', () => {
  it('delivers a valid intent to the sim with the request id, to the route of the NPC', async () => {
    const s = driver();
    const m = msg('hero_a');
    const p = s.d.offer(m);
    await tick();
    expect(s.net.calls[0]?.url).toBe('/api/v1/npc/hero_a/intent');
    s.net.calls[0]?.resolve(s.net.ok(answer(intent({ goal: 'go_to', target: 'poi.potrero-hill.test-lot' }))));
    expect(await p).toEqual({ sent: true, result: 'applied' });
    expect(s.delivered).toEqual([{ npcId: 'hero_a', intent: intent({ goal: 'go_to', target: 'poi.potrero-hill.test-lot' }), rid: m.rid }]);
  });

  it('passes a cached answer on, and leaves a default answer to the schedule', async () => {
    const s = driver();
    let p = s.d.offer(msg('a'));
    await tick();
    s.net.calls[0]?.resolve(s.net.ok(answer(intent(), 'cache')));
    expect(await p).toEqual({ sent: true, result: 'cache' });
    p = s.d.offer(msg('b'));
    await tick();
    s.net.calls[1]?.resolve(s.net.ok(answer(intent({ goal: 'continue_schedule', bark: null, until: 'next_block' }), 'default')));
    expect(await p).toEqual({ sent: true, result: 'default' });
    expect(s.delivered).toHaveLength(1);
  });

  it('ignores an HTTP error, an answer that is not an intent, and a request that times out', async () => {
    const s = driver({ limits: { timeoutMs: 30 } });
    let p = s.d.offer(msg('a'));
    await tick();
    s.net.calls[0]?.resolve(s.net.ok({ error: { code: 'rate_limited' } }, 429));
    expect(await p).toEqual({ sent: true, result: 'failed' });
    p = s.d.offer(msg('b'));
    await tick();
    s.net.calls[1]?.resolve(s.net.ok({ intent: { goal: 'dance', urgency: 'extreme' }, cached: false, source: 'llm' }));
    expect(await p).toEqual({ sent: true, result: 'failed' });
    p = s.d.offer(msg('c'));
    expect(await p).toEqual({ sent: true, result: 'failed' });
    expect(s.delivered).toHaveLength(0);
    expect(s.d.stats.failed).toBe(3);
  });
});

describe('attachIntentDriver', () => {
  it('offers every request the sim publishes on sys.npc.intents', async () => {
    const s = driver();
    let cb: ((v: unknown) => void) | null = null;
    const off = attachIntentDriver({ subscribe: (_k, f) => ((cb = f), () => void (cb = null)) }, s.d);
    (cb as unknown as (v: unknown) => void)(msg('hero_a'));
    (cb as unknown as (v: unknown) => void)({ nonsense: true });
    await tick();
    expect(s.net.calls).toHaveLength(1);
    s.net.calls[0]?.resolve(s.net.ok(answer()));
    off();
    expect(cb).toBeNull();
  });
});
