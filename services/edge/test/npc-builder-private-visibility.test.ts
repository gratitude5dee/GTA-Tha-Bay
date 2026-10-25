import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { HTTP_FOR } from '@dv/shared';
import { find, names, request } from './talk-helpers.ts';
import { builderSetup, type Builder } from './builder-helpers.ts';

// M06b1 AC-6: another profile talking to a private user NPC gets not_found; the owner's request streams with block B wrapped as an untrusted character sheet.
let b: Builder;
afterEach(() => b.dispose());

const OTHER = '0198aaaa-bbbb-7ccc-8ddd-000000000042';

describe('private user NPCs', () => {
  it('answers the owner and nobody else', async () => {
    b = await builderSetup();
    const d = await b.toPrivate();
    expect(d.state).toBe('private');
    const body = request({ npcId: d.npcId, soulVersion: d.publish.soulVersion!, turn: { intent: 'greet' } });

    const stranger = await b.t.post(body, { npcId: d.npcId, pid: OTHER });
    expect(stranger.status).toBe(HTTP_FOR.not_found);
    expect(((await stranger.json()) as { error: { code: string } }).error.code).toBe('not_found');
    expect(b.calls.filter((c) => c.npcId === d.npcId && c.intent === 'greet')).toHaveLength(0);

    const mark = b.calls.length;
    const { res, frames } = await b.t.say(body, { npcId: d.npcId });
    expect(res.status).toBe(200);
    expect(names(frames)[0]).toBe('meta');
    expect(names(frames).at(-1)).toBe('done');
    expect(find(frames, 'meta')!.data['npcId']).toBe(d.npcId);
    const call = b.calls.slice(mark).find((c) => c.intent === 'greet')!;
    const system = call.call.body['system'] as { text: string }[];
    expect(system[1]!.text).toContain('<character_sheet origin="user" trust="untrusted">');
    expect(system[1]!.text).toContain('</character_sheet>');
    expect(system[1]!.text).toContain(`<character id="${d.npcId}"`);
  });

  it('does not exist for strangers even when it is called by a made-up version, and never leaks through the roster', async () => {
    b = await builderSetup();
    const d = await b.toPrivate();
    const guess = request({ npcId: d.npcId, soulVersion: 9, turn: { intent: 'greet' } });
    expect((await b.t.post(guess, { npcId: d.npcId, pid: OTHER })).status).toBe(HTTP_FOR.not_found);
    const roster = await b.t.h.api('/api/v1/roster');
    expect(await roster.text()).not.toContain(d.npcId);
    // an unknown user NPC id is the same not_found
    const none = request({ npcId: 'u_0000000000000000', soulVersion: 1 });
    expect((await b.t.post(none, { npcId: 'u_0000000000000000' })).status).toBe(HTTP_FOR.not_found);
  });

  it('stops answering when the draft is deleted, and removes the PRIVATE files', async () => {
    b = await builderSetup();
    const d = await b.toPrivate();
    const key = `souls/${d.npcId}/${d.publish.soulVersion}/soul.prompt.txt`;
    expect(await env.PRIVATE.get(key)).not.toBeNull();
    expect(await env.PRIVATE.get(key.replace('prompt.txt', 'compiled.json'))).not.toBeNull();
    expect((await b.api('DELETE', `/drafts/${d.id}`)).status).toBe(204);
    expect(await env.PRIVATE.get(key)).toBeNull();
    expect(await env.PRIVATE.get(key.replace('prompt.txt', 'compiled.json'))).toBeNull();
    expect(await env.PRIVATE.get(key.replace('prompt.txt', 'ink'))).toBeNull();
    const body = request({ npcId: d.npcId, soulVersion: d.publish.soulVersion!, turn: { intent: 'greet' } });
    expect((await b.t.post(body, { npcId: d.npcId })).status).toBe(HTTP_FOR.not_found);
  });

  it('stays closed while the builder kill switch is on', async () => {
    b = await builderSetup();
    const d = await b.toPrivate();
    await env.FLAGS.put('ks:npc_builder', JSON.stringify({ on: true, reason: 'test', by: 'test', ts: 1, expiresAt: null }));
    try {
      const body = request({ npcId: d.npcId, soulVersion: d.publish.soulVersion!, turn: { intent: 'greet' } });
      expect((await b.t.post(body, { npcId: d.npcId })).status).toBe(HTTP_FOR.feature_disabled);
    } finally {
      await env.FLAGS.delete('ks:npc_builder');
    }
  });
});
