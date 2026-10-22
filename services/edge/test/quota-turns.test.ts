import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SpendEvent } from '@dv/shared';
import { assertMicros } from '../src/budget/BudgetGovernorDO.ts';
import { limitsFor } from '../src/budget/QuotaDO.ts';
import { netQuota, playerQuota, type QuotaRpc } from '../src/budget/quota.ts';
import { setClockForTests } from '../src/clock.ts';
import { setQueueSinksForTests } from '../src/ops/queue.ts';
import { setServerEventSinkForTests } from '../src/telemetry/server.ts';

// AC-2: the exact per-player daily quotas, the per-NPC cap, the cost cap, the UTC rollover and the quota.block event.
const DAY0 = Date.UTC(2026, 9, 22, 12, 0, 0); // 2026-10-22 12:00 UTC
let clock = DAY0;
let blocks: Record<string, string | number | boolean>[] = [];
let spend: SpendEvent[] = [];
let n = 0;
const fresh = (): QuotaRpc => playerQuota(env, `pid-${++n}-${crypto.randomUUID()}`);
const npcs = ['npc_a', 'npc_b', 'npc_c', 'npc_d', 'npc_e'];

beforeEach(() => {
  clock = DAY0;
  blocks = [];
  spend = [];
  setClockForTests(() => clock);
  setServerEventSinkForTests((name, props) => {
    if (name === 'quota.block') blocks.push(props);
  });
  setQueueSinksForTests({ spend: (e) => spend.push(e) });
});
afterEach(() => {
  setClockForTests(null);
  setServerEventSinkForTests(null);
  setQueueSinksForTests({ spend: null });
});

describe('PlayerQuotaDO daily quotas (AC-2)', () => {
  it('limits come from config/guardrails.yaml: P0 150/40/60/$0.05, linked 400/40/200/$0.15, a network 4x the P0 row', () => {
    expect(limitsFor('local', 'player')).toMatchObject({ turns: 150, perNpc: 40, voiceLines: 60, costCapUsdMicros: 50_000, builderText: 2, builderJob: 0 });
    expect(limitsFor('device', 'player')).toEqual(limitsFor('local', 'player'));
    expect(limitsFor('linked', 'player')).toMatchObject({ turns: 400, perNpc: 40, voiceLines: 200, costCapUsdMicros: 150_000, builderText: 10, builderJob: 0 });
    expect(limitsFor('local', 'net')).toMatchObject({ turns: 600, perNpc: 160, voiceLines: 240, costCapUsdMicros: 200_000 });
  });

  it('the 151st turn of the UTC day is quota; each refusal writes one quota.block point', async () => {
    const q = fresh();
    for (let i = 0; i < 150; i++) {
      const r = await q.reserve({ kind: 'turn', npcId: npcs[i % 4]!, estMicros: 100 }); // 4 NPCs x 37-38 turns: under 40 each
      expect(r.ok, `turn ${i + 1}`).toBe(true);
    }
    expect(blocks).toHaveLength(0);
    expect(await q.reserve({ kind: 'turn', npcId: 'npc_e', estMicros: 100 })).toEqual({ ok: false, reason: 'quota' });
    expect(blocks).toEqual([{ kind: 'turn', reason: 'quota', scope: 'player', tier: 'local' }]);
    expect(await q.reserve({ kind: 'turn', npcId: 'npc_e', estMicros: 100 })).toEqual({ ok: false, reason: 'quota' });
    expect(blocks).toHaveLength(2);
    expect((await q.usage())['turn']).toBe(150);
  });

  it('the 41st turn for one NPC is per_npc, and another NPC is still open', async () => {
    const q = fresh();
    for (let i = 0; i < 40; i++) expect((await q.reserve({ kind: 'turn', npcId: 'npc_a', estMicros: 10 })).ok).toBe(true);
    expect(await q.reserve({ kind: 'turn', npcId: 'npc_a', estMicros: 10 })).toEqual({ ok: false, reason: 'per_npc' });
    expect(blocks).toEqual([{ kind: 'turn', reason: 'per_npc', scope: 'player', tier: 'local' }]);
    expect((await q.reserve({ kind: 'turn', npcId: 'npc_b', estMicros: 10 })).ok).toBe(true);
    const usage = await q.usage();
    expect(usage['npc:npc_a']).toBe(40);
    expect(usage['turn']).toBe(41);
  });

  it('the reservation that would cross $0.05 is cost_cap; settling lower frees room', async () => {
    const q = fresh();
    const a = await q.reserve({ kind: 'turn', npcId: 'npc_a', estMicros: 30_000 });
    expect(a.ok).toBe(true);
    expect(await q.reserve({ kind: 'turn', npcId: 'npc_a', estMicros: 20_001 })).toEqual({ ok: false, reason: 'cost_cap' });
    expect(blocks).toEqual([{ kind: 'turn', reason: 'cost_cap', scope: 'player', tier: 'local' }]);
    expect((await q.reserve({ kind: 'turn', npcId: 'npc_a', estMicros: 20_000 })).ok).toBe(true); // exactly 50,000
    if (!a.ok) throw new Error('unreachable');
    await q.settle(a.reservationId, 1_000); // the first turn cost 1,000 micros, not 30,000
    expect((await q.usage())['cost_micros']).toBe(21_000);
    expect((await q.reserve({ kind: 'turn', npcId: 'npc_a', estMicros: 29_000 })).ok).toBe(true); // 50,000 again
    expect(await q.reserve({ kind: 'turn', npcId: 'npc_a', estMicros: 1 })).toEqual({ ok: false, reason: 'cost_cap' });
  });

  it('voice lines have their own 60/day count and share the dialogue cost cap', async () => {
    const q = fresh();
    for (let i = 0; i < 60; i++) expect((await q.reserve({ kind: 'voice_line', npcId: 'npc_a', estMicros: 10 })).ok).toBe(true);
    expect(await q.reserve({ kind: 'voice_line', npcId: 'npc_a', estMicros: 10 })).toEqual({ ok: false, reason: 'quota' });
    expect((await q.usage())['cost_micros']).toBe(600);
  });

  it('the counters reset at 00:00 UTC', async () => {
    const q = fresh();
    for (let i = 0; i < 3; i++) await q.reserve({ kind: 'turn', npcId: 'npc_a', estMicros: 40_000 });
    expect(await q.reserve({ kind: 'turn', npcId: 'npc_a', estMicros: 40_000 })).toEqual({ ok: false, reason: 'cost_cap' });
    clock = Date.UTC(2026, 9, 22, 23, 59, 59);
    expect(await q.reserve({ kind: 'turn', npcId: 'npc_a', estMicros: 40_000 })).toEqual({ ok: false, reason: 'cost_cap' });
    clock = Date.UTC(2026, 9, 23, 0, 0, 0);
    expect((await q.reserve({ kind: 'turn', npcId: 'npc_a', estMicros: 40_000 })).ok).toBe(true);
    expect(await q.usage()).toMatchObject({ turn: 1, cost_micros: 40_000, 'npc:npc_a': 1 });
  });

  it('a linked profile has 400 turns; builder_job is 0 for everyone; builder_text is 2 a day and one per draft per hour', async () => {
    const linked = fresh();
    for (let i = 0; i < 150; i++) await linked.reserve({ kind: 'turn', npcId: npcs[i % 5]!, estMicros: 10, tier: 'linked' });
    expect((await linked.reserve({ kind: 'turn', npcId: 'npc_a', estMicros: 10, tier: 'linked' })).ok).toBe(true);

    const q = fresh();
    expect(await q.reserve({ kind: 'builder_job', estMicros: 0 })).toEqual({ ok: false, reason: 'quota' });
    expect(await q.reserve({ kind: 'builder_job', estMicros: 0, tier: 'linked' })).toEqual({ ok: false, reason: 'quota' });
    expect((await q.reserve({ kind: 'builder_text', npcId: 'draft-1', estMicros: 4000 })).ok).toBe(true);
    expect(await q.reserve({ kind: 'builder_text', npcId: 'draft-1', estMicros: 4000 })).toEqual({ ok: false, reason: 'quota' }); // same draft within the hour
    clock += 3_600_001;
    expect((await q.reserve({ kind: 'builder_text', npcId: 'draft-1', estMicros: 4000 })).ok).toBe(true);
    expect(await q.reserve({ kind: 'builder_text', npcId: 'draft-2', estMicros: 4000 })).toEqual({ ok: false, reason: 'quota' }); // 2 a day
    // builder_text is counted apart from the dialogue cost cap
    expect((await q.usage())['cost_micros'] ?? 0).toBe(0);
  });

  it('settle is idempotent and enqueues one SpendEvent per settled turn', async () => {
    const q = fresh();
    const r = await q.reserve({ kind: 'turn', npcId: 'npc_a', estMicros: 500 });
    if (!r.ok) throw new Error('unreachable');
    await q.settle(r.reservationId, 420, { model: 'claude-haiku-5-5' });
    await q.settle(r.reservationId, 999);
    await q.settle('no-such-reservation', 5);
    expect(spend).toHaveLength(1);
    expect(spend[0]).toMatchObject({ vendor: 'anthropic', kind: 'dialogue', model: 'claude-haiku-5-5', usdMicros: 420, settled: true, requestId: r.reservationId, ts: DAY0 });
    expect((await q.usage())['cost_micros']).toBe(420);
    const free = await q.reserve({ kind: 'upload', estMicros: 0 });
    if (!free.ok) throw new Error('unreachable');
    await q.settle(free.reservationId, 0);
    expect(spend).toHaveLength(1); // nothing was spent, nothing is sent
  });

  it('money is integer USD micros: the estimate check is the governor\'s', () => {
    expect(() => assertMicros(1.5, 'estMicros')).toThrow(/integer/);
    expect(() => assertMicros(-1, 'estMicros')).toThrow(/integer/);
    expect(() => assertMicros(0, 'estMicros')).not.toThrow();
  });

  it('a network counter takes up to its cap and then refuses, with a quota.block point; the day resets it', async () => {
    const net = netQuota(env, `net-${crypto.randomUUID()}`);
    for (let i = 1; i <= 50; i++) expect(await net.take('play_token', 50)).toEqual({ ok: true, n: i });
    expect(await net.take('play_token', 50)).toEqual({ ok: false, n: 50 });
    expect(blocks).toEqual([{ kind: 'play_token', reason: 'net_cap', scope: 'net', tier: 'local' }]);
    expect(await net.peek('signup')).toBe(0);
    clock = Date.UTC(2026, 9, 23, 0, 0, 1);
    expect(await net.take('play_token', 50)).toEqual({ ok: true, n: 1 });
  });
});
