import { createMessageBatch } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env.ts';
import { env as testEnv } from 'cloudflare:test';
import type { DraftView } from '@dv/shared/npc';
import { buildStream } from '../src/npc/upstream-fixture.ts';
import { defaultLlmSoul } from '../src/npc-builder/fixture-defaults.ts';
import { EDGES, canMove, move } from '../src/npc-builder/states.ts';
import { BACKSTORY, FIELDS, builderSetup, type Builder } from './builder-helpers.ts';

// M06b1 AC-2: every transition of the state machine up to `private` is driven, and the illegal ones answer 409 with the current state.
// M06b1 AC-8 (Worker half): a generation that fails the lints once triggers exactly one repair call; one that fails twice ends in `soul_failed`.
let b: Builder;
afterEach(() => b.dispose());

interface ErrBody {
  error: { code: string; details: { state?: string; reason?: string; rev?: number; lint: { rule: string }[] } };
}
const body = (res: Response): Promise<ErrBody> => res.json() as Promise<ErrBody>;

/** Records the state each write puts a draft in, in order. */
function watchStates(builder: Builder): string[] {
  const seen: string[] = [];
  const store = builder.t.h.port.builder;
  const update = store.updateDraft.bind(store);
  store.updateDraft = (id, patch, guard) => {
    if (patch.state !== undefined) seen.push(patch.state);
    return update(id, patch, guard);
  };
  return seen;
}

describe('draft state machine', () => {
  it('drives draft -> validating -> text_ok -> soul_generating -> soul_ready -> probing -> private', async () => {
    b = await builderSetup();
    const seen = watchStates(b);
    const d = await b.create();
    expect(d.state).toBe('draft');
    expect((await b.api('POST', `/drafts/${d.id}/validate`)).status).toBe(202);
    await b.drain();
    expect((await b.get(d.id)).state).toBe('text_ok');
    expect((await b.api('POST', `/drafts/${d.id}/soul`)).status).toBe(202);
    await b.drain();
    const done = await b.get(d.id);
    expect(done.state).toBe('private');
    expect(seen.slice(seen.indexOf('validating'))).toEqual(['validating', 'text_ok', 'soul_generating', 'soul_ready', 'probing', 'private']);
    expect(done.probes).toEqual({ passed: 5, total: 5, failures: [] });
    expect(done.soul?.frontmatter.origin).toBe('user');
    expect(done.jobs.map((j) => j.kind)).toEqual(['validate', 'soul']);
    expect(done.jobs.every((j) => j.state === 'done')).toBe(true);
    expect(done.moderation).toMatchObject({ text: 'allow', realPerson: 'none', publishable: true });
    // every written transition is an edge of the machine
    let from = 'draft';
    for (const to of seen) {
      expect(canMove(from as never, to as never) || (from === 'draft' && to === 'validating')).toBe(true);
      from = to;
    }
  });

  it('answers 409 with the current state for requests the state does not allow', async () => {
    b = await builderSetup();
    const d = await b.create();
    const soul = await b.api('POST', `/drafts/${d.id}/soul`);
    expect(soul.status).toBe(409);
    expect((await body(soul)).error).toMatchObject({ code: 'conflict', details: { state: 'draft' } });
    const preview = await b.api('POST', `/drafts/${d.id}/preview`, { turn: { intent: 'greet' } });
    expect(preview.status).toBe(409);
    expect((await body(preview)).error.details.state).toBe('draft');
    expect(b.calls).toHaveLength(0);
    await b.api('POST', `/drafts/${d.id}/validate`);
    await b.drain();
    // validate twice: the second finds text_ok
    const again = await b.api('POST', `/drafts/${d.id}/validate`);
    expect(again.status).toBe(409);
    expect((await body(again)).error.details.state).toBe('text_ok');
    // a draft in text_ok has not been probed, so it cannot preview either
    expect((await b.api('POST', `/drafts/${d.id}/preview`, { turn: { intent: 'greet' } })).status).toBe(409);
  });

  it('refuses an edit with a stale revision and resets a validated draft to draft on new text', async () => {
    b = await builderSetup();
    const d = await b.create();
    await b.api('POST', `/drafts/${d.id}/validate`);
    await b.drain();
    const ok = await b.get(d.id);
    expect(ok.state).toBe('text_ok');
    const stale = await b.api('PUT', `/drafts/${d.id}`, { rev: ok.rev - 1, backstory: 'x'.repeat(40) });
    expect(stale.status).toBe(409);
    expect((await body(stale)).error.details).toMatchObject({ reason: 'rev', rev: ok.rev });
    const edited = await b.api('PUT', `/drafts/${d.id}`, { rev: ok.rev, backstory: `${BACKSTORY} She also sells coffee.` });
    expect(edited.status).toBe(200);
    const view = (await edited.json()) as DraftView;
    expect(view.state).toBe('draft');
    expect(view.rev).toBe(ok.rev + 1);
    expect(view.moderation.text).toBeNull();
    // If-Match carries the revision too
    const viaHeader = await b.api('PUT', `/drafts/${d.id}`, { fields: { shortBio: 'Changed.' } }, { headers: { 'If-Match': String(view.rev) } });
    expect(viaHeader.status).toBe(200);
  });

  it('knows the edges of the diagram', () => {
    expect(EDGES.length).toBeGreaterThan(20);
    expect(canMove('draft', 'private')).toBe(false);
    expect(canMove('probing', 'private')).toBe(true);
    expect(() => move('draft', 'soul_ready')).toThrow(/illegal draft transition/);
    expect(move('soul_ready', 'probing')).toBe('probing');
  });

  it('repairs a failing generation once and counts exactly one repair call', async () => {
    const bad = { ...defaultLlmSoul('mission'), locations: { home: 'poi.mission.nowhere' as never, hangouts: [] } };
    b = await builderSetup({
      fixture: (req) => {
        if (req.intent === 'builder-soul:mission') return buildStream({ model: req.model, answer: bad as never });
        return undefined;
      },
    });
    const d = await b.toPrivate();
    expect(d.state).toBe('private');
    expect(b.calls.filter((c) => c.intent.startsWith('builder-soul')).length).toBe(1);
    expect(b.calls.filter((c) => c.intent.startsWith('builder-repair')).length).toBe(1);
    const repair = b.calls.find((c) => c.intent.startsWith('builder-repair'))!;
    const messages = repair.call.body['messages'] as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[2]!.content).toContain('L2');
  });

  it('ends in soul_failed after one failed repair, and the author can edit the soul back to health', async () => {
    const good = defaultLlmSoul('mission');
    const bad = { ...good, schedule: good.schedule.map((blk, i) => (i === 2 ? { ...blk, place: 'poi.mission.nowhere' as never } : blk)) };
    b = await builderSetup({ fixture: (req) => (req.intent.startsWith('builder-soul') || req.intent.startsWith('builder-repair') ? buildStream({ model: req.model, answer: bad as never }) : undefined) });
    const d = await b.toPrivate();
    expect(d.state).toBe('soul_failed');
    expect(d.lint.map((i) => i.rule)).toContain('L2');
    expect(b.calls.filter((c) => c.intent.startsWith('builder-repair')).length).toBe(1);
    expect(d.soul).not.toBeNull();
    // an edit that still points at the missing place is refused with the lint issues and changes nothing
    const refused = await b.api('PUT', `/drafts/${d.id}`, { rev: d.rev, soulEdits: { frontmatter: { shortBio: 'Fine.' } } });
    expect(refused.status).toBe(400);
    expect((await body(refused)).error.details.lint.some((i) => i.rule === 'L2')).toBe(true);
    expect((await b.get(d.id)).rev).toBe(d.rev);
    // the author puts the schedule right: the soul passes, becomes soul_ready, and the probes run on it
    const seen = watchStates(b);
    const fixed = await b.api('PUT', `/drafts/${d.id}`, { rev: d.rev, soulEdits: { frontmatter: { schedule: good.schedule } } });
    expect(fixed.status).toBe(200);
    expect(((await fixed.json()) as DraftView).state).toBe('soul_ready');
    await b.drain();
    const healthy = await b.get(d.id);
    expect(healthy.state).toBe('private');
    expect(healthy.lint).toEqual([]);
    expect(seen).toEqual(['soul_ready', 'probing', 'private']);
  });

  it('the queue consumer runs a validate job and acknowledges it', async () => {
    b = await builderSetup();
    const d = await b.create();
    await b.t.h.port.builder.updateDraft(d.id, { state: 'validating' }, { fromStates: ['draft'] });
    const batch = createMessageBatch('tha-bay-npc-builder-staging', [{ id: 'q1', timestamp: new Date(), attempts: 1, body: { type: 'validate', draftId: d.id, jobId: '0198aaaa-bbbb-7ccc-8ddd-eeeeffff0001' } }]);
    await b.t.h.app.queue(batch, testEnv as unknown as Env);
    expect((await b.get(d.id)).state).toBe('text_ok');
    // a job for a draft that is no longer where the job expects it is a no-op, not an error
    await b.t.h.app.queue(createMessageBatch('tha-bay-npc-builder-staging', [{ id: 'q2', timestamp: new Date(), attempts: 1, body: { type: 'validate', draftId: d.id, jobId: '0198aaaa-bbbb-7ccc-8ddd-eeeeffff0002' } }]), testEnv as unknown as Env);
    expect((await b.get(d.id)).state).toBe('text_ok');
  });

  it('only the owner sees a draft; another player gets not_found', async () => {
    b = await builderSetup();
    const d = await b.create();
    const other = await b.api('GET', `/drafts/${d.id}`, undefined, { as: '0198aaaa-bbbb-7ccc-8ddd-000000000099' });
    expect(other.status).toBe(404);
    const del = await b.api('DELETE', `/drafts/${d.id}`, undefined, { as: '0198aaaa-bbbb-7ccc-8ddd-000000000099' });
    expect(del.status).toBe(404);
    expect((await b.api('DELETE', `/drafts/${d.id}`)).status).toBe(204);
    expect((await b.api('GET', `/drafts/${d.id}`)).status).toBe(404);
    expect(FIELDS.name).toBe('Tomasa Quill');
  });
});
