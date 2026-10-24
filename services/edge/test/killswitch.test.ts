import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RosterFlags } from '@dv/shared';
import type { DialogueEvent } from '@dv/shared/contracts/c10-npc';
import { isKilled } from '../src/flags/roster.ts';
import type { EncounterDO } from '../src/npc/EncounterDO.ts';
import { sseStream, watchKill } from '../src/npc/sse.ts';
import { uuidv7 } from '../src/uuidv7.ts';
import { harness, type Harness } from './npc-helpers.ts';

// AC-6: a roster kill stops an open stream within 1 s, refuses the next begin, shows in /roster inside 10 s although KV is stale, and is audited once.
let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.dispose());

const meta = { event: 'meta', data: { encounterId: 'e', turnIndex: 0, npcId: 'npc_test', soulVersion: 1, model: 'haiku', voice: 't0', turnsLeft: 11, disclosure: { aiCharacter: true, disclaimer: 'none' }, gov: 0 } } as unknown as Extract<DialogueEvent, { event: 'meta' }>;

/** A KV whose copy of roster:flags is old and never updated by the test (puts are counted and dropped). */
function staleKv(): { kv: KVNamespace; puts: string[] } {
  const puts: string[] = [];
  const old = JSON.stringify({ etag: 'old', killed: {}, updatedAt: 1 } satisfies RosterFlags);
  const kv = {
    get: (key: string) => Promise.resolve(key === 'roster:flags' ? JSON.parse(old) : null),
    put: (key: string) => (puts.push(key), Promise.resolve()),
    list: () => Promise.resolve({ keys: [], list_complete: true }),
  } as unknown as KVNamespace;
  return { kv, puts };
}

async function openStream(npcId = 'npc_test') {
  const pid = uuidv7();
  await h.port.profiles.ensureLocal(pid, `dkt-${pid}`);
  const encounterId = uuidv7();
  const stub = env.ENCOUNTER.get(env.ENCOUNTER.idFromName(`enc:${pid}:${npcId}:${encounterId}`)) as DurableObjectStub<EncounterDO>;
  const begun = await stub.begin({ profileId: pid, npcId, encounterId, soulVersion: 1, turn: { text: 'hi' } });
  expect(begun.ok).toBe(true);
  const watch = watchKill(() => stub.status(), 100);
  const stream = sseStream({
    meta,
    knot: 'busy',
    killed: watch.signal,
    firstTokenMs: 30_000,
    upstream: async function* (signal) {
      yield { event: 'line.delta', data: { seq: 0, text: 'Yo,' } } as DialogueEvent;
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })); // hangs until aborted
    },
    onAbort: (reason) => stub.abort(0, reason),
  });
  return { pid, stub, stream, watch, encounterId };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  const reader = stream.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const r = await reader.read();
    if (r.done) return out;
    for (const m of dec.decode(r.value).matchAll(/^event: (.+)$/gm)) out.push(m[1]!);
  }
}

describe('POST /api/v1/admin/roster/:npcId/kill (route 46)', () => {
  it('ends an open stream with fallback{killed} within 1 s, refuses the next begin, lists the NPC in /roster, and writes one audit row', async () => {
    const { kv, puts } = staleKv();
    const { stub, stream, watch } = await openStream();
    const events: string[] = [];
    const reading = readAll(stream).then((e) => events.push(...e));

    // Before the kill the NPC is not listed.
    const before = (await (await h.api('/api/v1/roster', { env: { FLAGS: kv } })).json()) as RosterFlags;
    expect(before.killed).toEqual({});

    const t0 = Date.now();
    const res = await h.api('/api/v1/admin/roster/npc_test/kill', {
      method: 'POST',
      ops: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: ['all'], reason: 'quality', ticketId: 'T-1' }),
      env: { FLAGS: kv },
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { npcId: string; killed: boolean; scope: string[]; openEncounters: number; audited: boolean };
    expect(out).toMatchObject({ npcId: 'npc_test', killed: true, scope: ['all'], openEncounters: 1, audited: true });

    await reading;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(events).toEqual(['meta', 'line.delta', 'fallback', 'done']);
    watch.stop();

    expect(await stub.begin({ profileId: 'x', npcId: 'npc_test', encounterId: 'x', soulVersion: 1, turn: {} })).toEqual({ ok: false, reason: 'killed' });

    // /roster shows the kill at once (the route dropped this isolate's cache) and still after 10 s of mocked time; KV was only written, never read.
    const first = (await (await h.api('/api/v1/roster', { env: { FLAGS: kv } })).json()) as RosterFlags;
    expect(first.killed['npc_test']).toEqual({ scope: ['all'], standIn: 'character/generic_stand_in' });
    h.clock.t += 10_000;
    const later = await h.api('/api/v1/roster', { env: { FLAGS: kv } });
    expect(((await later.json()) as RosterFlags).killed['npc_test']).toBeDefined();
    expect(later.headers.get('X-DV-Roster-Source')).toBe('postgres');
    expect(puts).toEqual(['roster:flags']); // the fallback copy was rewritten (this stub drops it: KV is stale and nothing depends on it)

    const audit = h.port.auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: 'ops-token', role: 'ops', action: 'roster.kill', targetKind: 'npc', targetId: 'npc_test', details: { scope: ['all'], reason: 'quality', ticketId: 'T-1' } });
    expect(h.logs.some((l) => l.includes('purge: lands in M10b'))).toBe(true);
  });

  it('isKilled follows the same source: a scoped kill blocks only its scope, "all" blocks every scope', async () => {
    await h.port.roster.kill({ profileId: null, tier: 'local', requestId: 'r' }, 'npc_scoped', { scope: ['voice'], reason: 'quality', ticketId: 'T', standIn: 'character/x' as never });
    await h.port.roster.kill({ profileId: null, tier: 'local', requestId: 'r' }, 'npc_all', { scope: ['all'], reason: 'legal', ticketId: 'T', standIn: 'character/x' as never });
    const deps = { data: () => h.port, now: () => h.clock.t, log: () => undefined };
    const e = env as unknown as Parameters<typeof isKilled>[0];
    expect(await isKilled(e, deps, 'npc_scoped', 'voice')).toBe(true);
    expect(await isKilled(e, deps, 'npc_scoped', 'spawn')).toBe(false);
    expect(await isKilled(e, deps, 'npc_all', 'fighter')).toBe(true);
    expect(await isKilled(e, deps, 'npc_other', 'all')).toBe(false);
  });

  it('is staff only and validates its input', async () => {
    const post = (body: unknown, extra: { ops?: boolean; bearer?: string } = {}) =>
      h.api('/api/v1/admin/roster/npc_test/kill', { method: 'POST', body: JSON.stringify(body), ...extra });
    const good = { scope: ['all'], reason: 'safety', ticketId: 'T-9' };
    expect((await post(good)).status).toBe(401);
    expect((await post(good, { bearer: 'Bearer wrong' })).status).toBe(401);
    expect((await post({ ...good, scope: [] }, { ops: true })).status).toBe(400);
    expect((await post({ ...good, scope: ['everything'] }, { ops: true })).status).toBe(400);
    expect((await post({ ...good, reason: 'because' }, { ops: true })).status).toBe(400);
    expect((await post({ ...good, ticketId: '' }, { ops: true })).status).toBe(400);
    expect((await post({ ...good, standIn: 'not-an-asset-ref' }, { ops: true })).status).toBe(400);
    const badNpc = await h.api('/api/v1/admin/roster/NPC%20X/kill', { method: 'POST', ops: true, body: JSON.stringify(good) });
    expect(badNpc.status).toBe(400);
    expect(h.port.auditRows()).toHaveLength(0);
    expect((await h.api('/api/v1/admin/roster/npc_test/kill', { method: 'POST', ops: true, body: JSON.stringify({ ...good, standIn: 'character/pal' }) })).status).toBe(200);
    expect((await h.port.roster.flags()).killed['npc_test']?.standIn).toBe('character/pal');
  });

  it('answers 503 when no database is configured, and still stops nothing silently', async () => {
    const app = (await import('../src/index.ts')).createApp({ data: () => null, now: () => h.clock.t });
    const { call } = await import('./helpers.ts');
    const res = await call('/api/v1/admin/roster/npc_test/kill', { method: 'POST', app, country: 'US', headers: { Authorization: 'Bearer ops-test-token' }, body: JSON.stringify({ scope: ['all'], reason: 'safety', ticketId: 'T' }), env: { OPS_TOKEN: 'ops-test-token' } });
    expect(res.status).toBe(503);
  });
});
