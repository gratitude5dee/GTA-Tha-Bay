import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env.ts';
import { CRON_SCHEDULE } from '../src/ops/scheduled.ts';
import { uuidv7 } from '../src/uuidv7.ts';
import { harness, type Harness } from './npc-helpers.ts';

// AC-10: the three retention crons delete expired rows and objects only. Time is the harness clock, moved forward in days.
const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.dispose());

const run = async (job: string): Promise<Record<string, unknown>> => {
  const res = await h.api(`/api/v1/_test/run-scheduled?job=${job}`, { method: 'POST' });
  expect(res.status).toBe(200);
  return ((await res.json()) as { ran: Record<string, unknown>[] }).ran[0]!;
};
const emb = (): Float32Array => new Float32Array(1024).fill(0.1);
const mem = (text: string) => ({ kind: 'event' as const, text, importance: 5, gameTime: 1, source: 'dialogue' as const, embedding: emb() });
const exists = async (key: string): Promise<boolean> => (await env.PRIVATE.head(key)) !== null;

async function profile(): Promise<string> {
  const pid = uuidv7();
  await h.port.profiles.ensureLocal(pid, `dkt-${pid}`);
  return pid;
}

describe('transcripts (03:10): expired rows and objects go, fresh ones stay', () => {
  it('deletes encounter_transcripts past expires_at with their PRIVATE objects, and exports older than 7 days', async () => {
    const pid = await profile();
    const t0 = h.clock.t;
    const mk = async (id: string, expiresAt: number): Promise<string> => {
      const key = `transcripts/${id}.jsonl`;
      await env.PRIVATE.put(key, '{}\n');
      await h.port.maintenance.recordTranscript({ encounter_id: id, profile_id: pid, npc_id: 'npc_a', r2_key: key, turns: 1, usd_micros: 1, closed_at: t0, expires_at: expiresAt });
      return key;
    };
    const expiredA = await mk(`ret-a-${uuidv7()}`, t0 + 30 * DAY);
    const expiredB = await mk(`ret-b-${uuidv7()}`, t0 + 30 * DAY + 5);
    const fresh = await mk(`ret-c-${uuidv7()}`, t0 + 60 * DAY);
    const oldExport = `exports/${pid}/${t0}.zip`;
    const newExport = `exports/${pid}/${t0 + 29 * DAY}.zip`;
    await env.PRIVATE.put(oldExport, 'zip');
    await env.PRIVATE.put(newExport, 'zip');

    h.clock.t = t0 + 31 * DAY;
    const result = await run('transcripts');
    expect(result).toMatchObject({ job: 'transcripts', ran: true, rows: 2, objects: 2, exports: 1 });
    expect(await exists(expiredA)).toBe(false);
    expect(await exists(expiredB)).toBe(false);
    expect(await exists(fresh)).toBe(true);
    expect(await exists(oldExport)).toBe(false);
    expect(await exists(newExport)).toBe(true);
    expect((await h.port.maintenance.transcriptKeys(pid)).sort()).toEqual([fresh]);
    // Repeating it deletes nothing more.
    expect(await run('transcripts')).toMatchObject({ rows: 0, objects: 0, exports: 0 });
  });
});

describe('memory (03:20): npc_memory 180 days after last access, npc_relationship 180 days unseen', () => {
  it('deletes the expired memory and the long-unseen relationship, keeps the fresh ones, and a memory that is read lives on', async () => {
    const pid = await profile();
    const t0 = h.clock.t;
    await h.port.npcMemory.write(pid, 'npc_old', [mem('old')]);
    await h.port.npcMemory.write(pid, 'npc_read', [mem('read now and then')]);
    const patch = { summaryUpdate: 's', memories: [], affinityDelta: 1, trustDelta: 1, flagsPatch: {}, soulVersion: 1, reflection: false };
    await h.port.npcMemory.applySummary(pid, 'npc_old', patch);

    h.clock.t = t0 + 170 * DAY;
    await h.port.npcMemory.write(pid, 'npc_new', [mem('new')]);
    await h.port.npcMemory.applySummary(pid, 'npc_new', patch);
    expect(await h.port.npcMemory.topK(pid, 'npc_read', emb(), 1, 6)).toHaveLength(1); // access resets the 180 days

    h.clock.t = t0 + 181 * DAY;
    expect(await run('memory')).toMatchObject({ job: 'memory', ran: true, memories: 1, relationships: 1 });
    expect(await h.port.npcMemory.topK(pid, 'npc_old', emb(), 1, 6)).toEqual([]);
    expect((await h.port.npcMemory.topK(pid, 'npc_new', emb(), 1, 6)).map((m) => m.text)).toEqual(['new']);
    expect((await h.port.npcMemory.topK(pid, 'npc_read', emb(), 1, 6)).map((m) => m.text)).toEqual(['read now and then']);
    expect(await h.port.npcMemory.relationship(pid, 'npc_old')).toBeNull();
    expect(await h.port.npcMemory.relationship(pid, 'npc_new')).not.toBeNull();
  });
});

describe('stub-profiles (03:30): local profiles unseen for 180 days, and soft-deleted ones the forget job missed', () => {
  it('purges the stale stub with its objects, keeps the active one, and finishes a forgotten profile an hour after it was marked', async () => {
    const t0 = h.clock.t;
    const stale = await profile();
    await env.PRIVATE.put(`saves/${stale}/core.json`, '{}');
    await h.port.npcMemory.write(stale, 'npc_a', [mem('x')]);

    h.clock.t = t0 + 170 * DAY;
    const active = await profile();
    const forgotten = await profile();
    const justForgotten = await profile();
    await env.PRIVATE.put(`saves/${forgotten}/core.json`, '{}');
    h.clock.t = t0 + 180 * DAY + 10 * 60_000;
    await h.port.profiles.forget({ profileId: forgotten, tier: 'local', requestId: 'r' });
    h.clock.t = t0 + 181 * DAY;
    await h.port.profiles.forget({ profileId: justForgotten, tier: 'local', requestId: 'r' });
    h.clock.t = t0 + 181 * DAY + 5 * 60_000;

    expect(await run('stub-profiles')).toMatchObject({ job: 'stub-profiles', ran: true, profiles: 2 });
    expect(h.port.rowsFor(stale)).toEqual({});
    expect(await exists(`saves/${stale}/core.json`)).toBe(false);
    expect(h.port.rowsFor(forgotten)).toEqual({});
    expect(await exists(`saves/${forgotten}/core.json`)).toBe(false);
    expect(h.port.rowsFor(active)['profiles']).toBe(1);
    expect(h.port.rowsFor(justForgotten)['profiles']).toBe(1); // marked five minutes ago: the queue job still owns it
  });
});

describe('the crons', () => {
  it('map the three expressions to their jobs, with the 03:10 run keeping catalog-sync and ledger-export', () => {
    expect(CRON_SCHEDULE).toEqual({
      '10 3 * * *': ['catalog-sync', 'ledger-export', 'transcripts'],
      '20 3 * * *': ['memory'],
      '30 3 * * *': ['stub-profiles'],
    });
  });

  it('a scheduled event runs the jobs of its expression', async () => {
    const pid = await profile();
    await h.port.npcMemory.write(pid, 'npc_a', [mem('soon expired')]);
    h.clock.t += 181 * DAY;
    const ctx = createExecutionContext();
    await h.app.scheduled(createScheduledController({ cron: '20 3 * * *', scheduledTime: Date.now() }), env as unknown as Env, ctx);
    await waitOnExecutionContext(ctx);
    const done = h.logs.map((l) => JSON.parse(l) as { event: string; cron?: string }).find((l) => l.event === 'cron.done');
    expect(done?.cron).toBe('20 3 * * *');
    expect(h.logs.some((l) => l.includes('retention.memory'))).toBe(true);
    expect(await h.port.npcMemory.topK(pid, 'npc_a', emb(), 1, 6)).toEqual([]);
  });

  it('without a database every job is skipped, not failed', async () => {
    const { createApp } = await import('../src/index.ts');
    const { call } = await import('./helpers.ts');
    const app = createApp({ data: () => null, now: () => h.clock.t });
    for (const job of ['transcripts', 'memory', 'stub-profiles']) {
      const res = await call(`/api/v1/_test/run-scheduled?job=${job}`, { method: 'POST', app, country: 'US' });
      expect(((await res.json()) as { ran: { ran: boolean; skipped?: string }[] }).ran[0]).toMatchObject({ ran: false, skipped: 'no_database' });
    }
  });
});
