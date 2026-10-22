import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { HTTP_FOR, NPC_GUARDRAILS } from '@dv/shared';
import { find, names, quotaUsage, request, talkSetup, type Talk } from './talk-helpers.ts';

// M06a3 AC-6: a P0 profile at 150 turns today gets 429 quota_exhausted with no upstream call. Also: the per-NPC cap, the day roll-over,
// and a refused begin (busy, cadence, turn cap) that does not spend the player's turn.
let t: Talk;
afterEach(() => t.dispose());

const quota = (pid: string): { reserve(r: { kind: 'turn'; npcId: string; estMicros: number }): Promise<{ ok: boolean }> } =>
  env.QUOTA.get(env.QUOTA.idFromName(`q:p:${pid}`)) as never;

/** Spends `n` turns of the daily quota across several NPC ids (the per-NPC cap is 40). */
async function spend(pid: string, n: number): Promise<void> {
  const q = quota(pid);
  for (let i = 0; i < n; i++) expect((await q.reserve({ kind: 'turn', npcId: `npc_fill${Math.floor(i / 30)}`, estMicros: 0 })).ok).toBe(true);
}

describe('quota on route 31', () => {
  it('answers 429 quota_exhausted at 150 turns today, before any upstream call', async () => {
    t = await talkSetup({ fixture: 'happy' });
    t.recordCalls();
    await spend(t.pid, NPC_GUARDRAILS.quotas.p0.turns);
    const res = await t.post(request());
    expect(res.status).toBe(HTTP_FOR.quota_exhausted);
    const body = (await res.json()) as { error: { code: string; retryAfterMs?: number } };
    expect(body.error.code).toBe('quota_exhausted');
    expect(body.error.retryAfterMs).toBeGreaterThan(0);
    expect(t.calls).toHaveLength(0);
  });

  it('serves the 150th turn and refuses the 151st', async () => {
    t = await talkSetup({ fixture: 'happy' });
    await spend(t.pid, NPC_GUARDRAILS.quotas.p0.turns - 1);
    const last = await t.say(request());
    expect(names(last.frames).at(-1)).toBe('done');
    t.h.clock.t += 2000;
    expect((await t.post(request())).status).toBe(HTTP_FOR.quota_exhausted);
  });

  it('refuses the 41st turn with one NPC in a day (the per-NPC cap)', async () => {
    t = await talkSetup({ fixture: 'happy' });
    const q = quota(t.pid);
    for (let i = 0; i < NPC_GUARDRAILS.quotas.p0.perNpc; i++) await q.reserve({ kind: 'turn', npcId: 'npc_test', estMicros: 0 });
    expect((await t.post(request())).status).toBe(HTTP_FOR.quota_exhausted);
  });

  it('starts a new day at 00:00 UTC', async () => {
    t = await talkSetup({ fixture: 'happy' });
    await spend(t.pid, NPC_GUARDRAILS.quotas.p0.turns);
    expect((await t.post(request())).status).toBe(HTTP_FOR.quota_exhausted);
    t.h.clock.t = Date.UTC(2031, 0, 2, 0, 0, 1);
    const { res } = await t.say(request());
    expect(res.status).toBe(200);
  });

  it('leaves the quota alone when the encounter refuses the turn (busy, cadence)', async () => {
    t = await talkSetup({ fixture: 'slow-3s' });
    const first = await t.post(request());
    expect(first.status).toBe(200);
    const meta = await (async () => {
      const reader = first.body!.getReader();
      const text = new TextDecoder().decode((await reader.read()).value);
      reader.releaseLock();
      return JSON.parse(/^data: (.+)$/m.exec(text)![1]!) as { encounterId: string };
    })();
    // a second turn while the first streams: busy
    const busy = await t.post(request({ encounterId: meta.encounterId }));
    expect(busy.status).toBe(HTTP_FOR.conflict);
    expect(((await busy.json()) as { error: { details?: { reason?: string } } }).error.details).toEqual({ reason: 'busy' });
    await t.read(first);
    // the busy refusal did not spend a turn: one turn is counted
    expect((await quotaUsage(t.pid))['turn']).toBe(1);
  });

  it('answers a cadence refusal with rate_limited and no spent turn', async () => {
    t = await talkSetup({ fixture: 'happy' });
    const first = await t.say(request());
    const encounterId = (find(first.frames, 'meta')!.data as { encounterId: string }).encounterId;
    t.h.clock.t += 500; // under the 1.5 s cadence
    const res = await t.post(request({ encounterId }));
    expect(res.status).toBe(HTTP_FOR.rate_limited);
    expect((await quotaUsage(t.pid))['turn']).toBe(1);
  });
});
