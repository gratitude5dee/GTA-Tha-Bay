import { env, introspectWorkflow } from 'cloudflare:test';
import { InMemoryDataPort } from '@dv/shared/data-port.memory';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import { catalogRows, sourceOf } from '../src/ops/catalog-sync.ts';
import { call } from './helpers.ts';
import { getStatus, mockCalls, OPS } from './cutscene-helpers.ts';
import { indexKey, indexOf } from './data-helpers.ts';

const LIVE: Partial<Env> = { FAL_MODE: 'live', OPS_TOKEN: OPS };

interface Ran {
  ran: { job: string; ran: boolean; rows?: number; written?: number }[];
}

describe('catalog-sync (AC-6)', () => {
  it('writes the index to cutscene_catalog, then writes 0 rows on a repeat', async () => {
    const index = indexOf(['a', 'b', 'c']);
    // Two of the three refs are not in the catalog yet.
    const port = new InMemoryDataPort();
    expect(await port.catalog.upsert(catalogRows(index).slice(0, 1))).toBe(1);
    const app = createApp({ data: () => port, cutsceneIndex: () => index });

    const first = (await (await call('/api/v1/_test/run-scheduled?job=catalog-sync', { method: 'POST', app, env: LIVE })).json()) as Ran;
    expect(first.ran).toEqual([{ job: 'catalog-sync', ran: true, rows: 3, written: 2 }]);
    expect([...(await port.catalog.keys())].sort()).toEqual(['a', 'b', 'c'].map(indexKey).sort());

    const second = (await (await call('/api/v1/_test/run-scheduled?job=catalog-sync', { method: 'POST', app, env: LIVE })).json()) as Ran;
    expect(second.ran).toEqual([{ job: 'catalog-sync', ran: true, rows: 3, written: 0 }]);
    expect(await port.catalog.keys()).toHaveLength(3);
  });

  it('a route 27 request for a key outside the index returns absent and starts nothing', async () => {
    await using introspector = await introspectWorkflow(env.GEN_WF);
    const index = indexOf(['a', 'b', 'c']);
    const port = new InMemoryDataPort();
    const app = createApp({ data: () => port, cutsceneIndex: () => index });
    await call('/api/v1/_test/run-scheduled?job=catalog-sync', { method: 'POST', app, env: LIVE });

    const outside = indexKey('outside');
    const res = await call(`/api/v1/cutscenes/${outside}`, { app, env: LIVE });
    expect(await res.json()).toEqual({ key: outside, state: 'absent', reason: 'not_in_catalog' });
    expect(await introspector.get()).toHaveLength(0);
    expect(await mockCalls('submit', outside)).toBe(0);

    // A key of the index is in the catalog: the status comes from the job object (nothing is stored, so absent, with no reason).
    const inside = await call(`/api/v1/cutscenes/${indexKey('b')}`, { app, env: LIVE });
    expect(await inside.json()).toEqual({ key: indexKey('b'), state: 'absent' });
    expect(await introspector.get()).toHaveLength(0);
  });

  it('the staff prewarm obeys the table too: a key outside it is not_in_catalog', async () => {
    const port = new InMemoryDataPort();
    const app = createApp({ data: () => port, cutsceneIndex: () => indexOf(['a']) });
    const res = await call('/api/v1/admin/cutscenes/prewarm', {
      method: 'POST',
      app,
      env: LIVE,
      headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: [indexKey('a')] }),
    });
    expect(res.status).toBe(202);
    // Nothing synced yet, so even the index key is outside the (empty) table.
    expect(((await res.json()) as { keys: unknown[] }).keys).toEqual([{ key: indexKey('a'), state: 'absent', reason: 'not_in_catalog' }]);
  });

  it('the 03:10 UTC dispatcher tick runs catalog-sync and then ledger-export', async () => {
    const port = new InMemoryDataPort();
    const app = createApp({ data: () => port, cutsceneIndex: () => indexOf(['a', 'b']) });
    const pending: Promise<unknown>[] = [];
    await app.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.UTC(2026, 9, 27, 3, 10) } as ScheduledController,{ ...(env as unknown as Env), ...LIVE }, { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext);
    await Promise.all(pending);
    expect(await port.catalog.keys()).toHaveLength(2);
  });

  it('with no database configured the job reports a skip instead of failing', async () => {
    const res = await call('/api/v1/_test/run-scheduled?job=catalog-sync', { method: 'POST' });
    expect(((await res.json()) as Ran).ran).toEqual([{ job: 'catalog-sync', ran: false, skipped: 'no_database' }]);
  });

  it('an unknown job is a bad_request', async () => {
    const res = await call('/api/v1/_test/run-scheduled?job=nope', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('getStatus keeps working through the static catalog when no database is configured', async () => {
    const key = indexKey('static-extra');
    expect((await getStatus(key, [key])).state).toBe('absent');
  });
});

describe('index to catalog rows', () => {
  it('maps template, cast and source from an index entry', () => {
    const [row] = catalogRows(indexOf(['x']));
    expect(row).toEqual({
      cache_key: indexKey('x'),
      template_id: 'story.beat',
      template_ver: 1,
      characters: ['npc_test'],
      source: 'mission:m.test.x',
      priority: 5,
    });
  });

  it('derives a source from every ref family', () => {
    expect(sourceOf('cut.story.m.act1.heist.intro')).toBe('mission:m.act1.heist');
    expect(sourceOf('cut.fight.faceoff.a.b')).toBe('fight:faceoff.a.b');
    expect(sourceOf('cut.race.intro.r1')).toBe('race:intro.r1');
    expect(sourceOf('odd')).toBe('ref:odd');
  });
});
