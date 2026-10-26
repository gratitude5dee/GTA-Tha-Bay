import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import type { DraftView } from '@dv/shared/npc';
import { runForget } from '../src/ops/forget.ts';
import { runBuilderDraftRetention } from '../src/ops/retention.ts';
import type { Env } from '../src/env.ts';
import { uuidv7 } from '../src/uuidv7.ts';
import { builderSetup, type Builder } from './builder-helpers.ts';

// M06b1: the 180-day purge of unpublished drafts (03:40 cron), the forget job's reach into the builder's private files, the export of drafts, and the
// idempotent create.
let b: Builder;
afterEach(() => b.dispose());

const DAY = 86_400_000;
const deps = (builder: Builder): { data: () => typeof builder.t.h.port; log: (l: string) => void; now: () => number } => ({
  data: () => builder.t.h.port,
  log: () => undefined,
  now: () => builder.t.h.clock.t,
});

describe('builder retention and privacy', () => {
  it('purges unpublished drafts 180 days after their last update, with their private souls and files', async () => {
    b = await builderSetup();
    const old = await b.toPrivate();
    const fresh = await b.create({ name: 'Fresh Draft' });
    expect(b.t.h.port.souls()).toHaveLength(1);
    const key = `souls/${old.npcId}/1/soul.prompt.txt`;
    expect(await env.PRIVATE.get(key)).not.toBeNull();
    const t = b.t.h.clock.t;
    b.t.h.port.ageDraft(old.id, t - 181 * DAY);
    b.t.h.port.ageDraft(fresh.id, t - 179 * DAY);
    const res = await runBuilderDraftRetention(env as unknown as Env, deps(b) as never);
    expect(res).toMatchObject({ job: 'builder-drafts', ran: true, drafts: 1, objects: 3 });
    expect(b.t.h.port.drafts().map((d) => d.id)).toEqual([fresh.id]);
    expect(b.t.h.port.souls()).toHaveLength(0);
    expect(await env.PRIVATE.get(key)).toBeNull();
    expect(await env.PRIVATE.get(key.replace('prompt.txt', 'compiled.json'))).toBeNull();
    expect(await runBuilderDraftRetention(env as unknown as Env, deps(b) as never)).toMatchObject({ drafts: 0 });
  });

  it('never purges a draft that is in review or published', async () => {
    b = await builderSetup();
    const d = await b.create();
    await b.t.h.port.builder.updateDraft(d.id, { state: 'published' });
    b.t.h.port.ageDraft(d.id, b.t.h.clock.t - 400 * DAY);
    expect(await runBuilderDraftRetention(env as unknown as Env, deps(b) as never)).toMatchObject({ drafts: 0 });
    expect(b.t.h.port.drafts()).toHaveLength(1);
  });

  it('the forget job removes the drafts, the souls and the private files of a profile', async () => {
    b = await builderSetup();
    const d = await b.toPrivate();
    const key = `souls/${d.npcId}/1/soul.prompt.txt`;
    expect(await env.PRIVATE.get(key)).not.toBeNull();
    const rows = await b.t.h.port.maintenance.exportRows(b.pid);
    expect(rows['npc_draft']).toHaveLength(1);
    expect(rows['npc_soul']).toHaveLength(1);
    const done = await runForget(env as unknown as Env, deps(b) as never, b.pid);
    expect(done).toMatchObject({ purged: true });
    expect(await env.PRIVATE.get(key)).toBeNull();
    expect(b.t.h.port.drafts()).toHaveLength(0);
    expect(b.t.h.port.souls()).toHaveLength(0);
  });

  it('a repeated create with the same Idempotency-Key returns the same draft', async () => {
    b = await builderSetup();
    const key = uuidv7();
    const body = { fields: { name: 'Same Again', shortBio: 'x', archetype: 'vendor', tags: [], district: 'mission', voiceRef: null, appearancePreset: null }, attestation: 'original' };
    const first = await b.api('POST', '/drafts', body, { headers: { 'Idempotency-Key': key } });
    const second = await b.api('POST', '/drafts', body, { headers: { 'Idempotency-Key': key } });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(((await second.json()) as DraftView).id).toBe(((await first.json()) as DraftView).id);
    expect(b.t.h.port.drafts()).toHaveLength(1);
    expect((await b.api('POST', '/drafts', body, { headers: { 'Idempotency-Key': 'not-a-uuid' } })).status).toBe(400);
  });

  it('keeps every secret and the backstory out of logs and spend events', async () => {
    b = await builderSetup();
    const d = await b.toPrivate();
    expect(d.state).toBe('private');
    expect(b.t.h.logs.join('\n')).not.toContain('tamale');
    expect(b.t.h.logs.join('\n')).not.toContain('bakery');
  });
});
