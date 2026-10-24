import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RosterFlags } from '@dv/shared';
import type { ServerDataPort } from '@dv/shared/data-port';
import { createApp } from '../src/index.ts';
import { dropRosterCache } from '../src/flags/roster.ts';
import { call } from './helpers.ts';
import { harness, OPS_TOKEN, type Harness } from './npc-helpers.ts';

// AC-8: ETag and 304 on route 30, a new ETag after a kill, KV only as the fallback when the Postgres read fails, and the 10 s isolate cache.
let h: Harness;
beforeEach(async () => {
  h = harness();
  await env.FLAGS.delete('roster:flags');
});
afterEach(async () => {
  h.dispose();
  await env.FLAGS.delete('roster:flags');
});

const kill = (npc: string, scope = ['all']) =>
  h.api(`/api/v1/admin/roster/${npc}/kill`, { method: 'POST', ops: true, body: JSON.stringify({ scope, reason: 'quality', ticketId: 'T-1' }) });

/** A port whose roster read fails (the database is down) and counts the attempts. */
function failingRoster(base: ServerDataPort, counter: { calls: number }): ServerDataPort {
  return Object.assign(Object.create(base) as ServerDataPort, {
    roster: { ...base.roster, flags: () => (counter.calls++, Promise.reject(new Error('database unavailable'))) },
  });
}

describe('GET /api/v1/roster (route 30)', () => {
  it('serves RosterFlags with an ETag and answers 304 to If-None-Match while nothing changes; a kill changes the ETag', async () => {
    const first = await h.api('/api/v1/roster');
    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toBe('no-cache');
    const etag = first.headers.get('ETag')!;
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
    const body = (await first.json()) as RosterFlags;
    expect(body).toMatchObject({ killed: {}, etag: etag.slice(1, -1) });

    const again = await h.api('/api/v1/roster', { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    expect(again.headers.get('ETag')).toBe(etag);
    expect(await again.text()).toBe('');
    expect((await h.api('/api/v1/roster', { headers: { 'If-None-Match': `W/${etag}` } })).status).toBe(304);
    expect((await h.api('/api/v1/roster', { headers: { 'If-None-Match': '"other", ' + etag } })).status).toBe(304);
    expect((await h.api('/api/v1/roster', { headers: { 'If-None-Match': '"other"' } })).status).toBe(200);

    expect((await kill('npc_test')).status).toBe(200);
    const after = await h.api('/api/v1/roster', { headers: { 'If-None-Match': etag } });
    expect(after.status).toBe(200);
    expect(after.headers.get('ETag')).not.toBe(etag);
    expect(((await after.json()) as RosterFlags).killed['npc_test']).toBeDefined();

    // Killing another NPC, or changing a scope, moves the ETag again.
    const e1 = after.headers.get('ETag');
    await kill('npc_other', ['voice']);
    const e2 = (await h.api('/api/v1/roster')).headers.get('ETag');
    expect(e2).not.toBe(e1);
  });

  it('reads Postgres at most once per isolate per 10 s', async () => {
    const counter = { calls: 0 };
    const port = h.port;
    const orig = port.roster.flags.bind(port.roster);
    port.roster.flags = () => (counter.calls++, orig());
    for (let i = 0; i < 5; i++) await h.api('/api/v1/roster');
    expect(counter.calls).toBe(1);
    h.clock.t += 9_000;
    await h.api('/api/v1/roster');
    expect(counter.calls).toBe(1);
    h.clock.t += 1_001;
    await h.api('/api/v1/roster');
    expect(counter.calls).toBe(2);
  });

  it('serves the KV copy (200) when the Postgres read fails, and logs the window', async () => {
    expect((await kill('npc_test')).status).toBe(200); // writes roster:flags
    const copy = (await env.FLAGS.get('roster:flags', { type: 'json' })) as RosterFlags;
    expect(copy.killed['npc_test']).toBeDefined();
    dropRosterCache();

    const counter = { calls: 0 };
    const app = createApp({ data: () => failingRoster(h.port, counter), now: () => h.clock.t, log: (l) => h.logs.push(l) });
    const res = await call('/api/v1/roster', { app, country: 'US' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-DV-Roster-Source')).toBe('kv');
    expect(((await res.json()) as RosterFlags).killed['npc_test']).toBeDefined();
    expect(counter.calls).toBe(1);
    expect(h.logs.some((l) => l.includes('"roster.source"') && l.includes('"kv"'))).toBe(true);
    // Cached for 10 s like any read: the failing database is not hit again.
    await call('/api/v1/roster', { app, country: 'US' });
    expect(counter.calls).toBe(1);
  });

  it('with the database down and no KV copy the answer is 503, never an empty list', async () => {
    const app = createApp({ data: () => failingRoster(h.port, { calls: 0 }), now: () => h.clock.t });
    const res = await call('/api/v1/roster', { app, country: 'US' });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('upstream_unavailable');
  });

  it('with no database configured (local run, Preview) the KV copy or an empty list is served', async () => {
    const app = createApp({ data: () => null, now: () => h.clock.t });
    const empty = await call('/api/v1/roster', { app, country: 'US' });
    expect(empty.status).toBe(200);
    expect(empty.headers.get('X-DV-Roster-Source')).toBe('none');
    await env.FLAGS.put('roster:flags', JSON.stringify({ etag: 'abc', killed: { npc_x: { scope: ['all'], standIn: 'character/y' } }, updatedAt: 5 }));
    dropRosterCache();
    const copy = await call('/api/v1/roster', { app, country: 'US' });
    expect(((await copy.json()) as RosterFlags).killed['npc_x']).toBeDefined();
  });

  it('is geo gated like the other API routes, and HEAD answers headers only', async () => {
    expect((await h.api('/api/v1/roster', { country: 'DE' })).status).toBe(451);
    const head = await h.api('/api/v1/roster', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('ETag')).not.toBeNull();
    expect(await head.text()).toBe('');
  });

  it('POST is refused', async () => {
    expect((await h.api('/api/v1/roster', { method: 'POST', headers: { Authorization: `Bearer ${OPS_TOKEN}` } })).status).toBe(405);
  });
});
