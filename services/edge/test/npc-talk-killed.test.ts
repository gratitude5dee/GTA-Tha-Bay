import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { HTTP_FOR } from '@dv/shared';
import { find, names, request, talkSetup, type Talk } from './talk-helpers.ts';

// M06a3 AC-4: a killed NPC answers kill_switched JSON before any upstream call; a kill during a turn ends the stream with fallback{killed}.
let t: Talk;
afterEach(() => t.dispose());

const kill = (npcId = 'npc_test'): Promise<Response> =>
  t.h.api(`/api/v1/admin/roster/${npcId}/kill`, { method: 'POST', ops: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: ['all'], reason: 'quality', ticketId: 'T-1' }) });

describe('kill switches on route 31', () => {
  it('answers kill_switched JSON before any upstream call when the NPC was killed first', async () => {
    t = await talkSetup({ fixture: 'happy' });
    t.recordCalls();
    expect((await kill()).status).toBe(200);
    const res = await t.post(request());
    expect(res.status).toBe(HTTP_FOR.kill_switched);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('kill_switched');
    expect(t.calls).toHaveLength(0);
  });

  it('ends an open stream with fallback{killed} when the NPC is killed during the turn', async () => {
    t = await talkSetup({ fixture: 'slow-3s' });
    t.recordCalls();
    const res = await t.post(request());
    expect(res.status).toBe(200);
    const frames = await t.read(res, {
      at: {
        1000: async () => {
          expect((await kill()).status).toBe(200);
        },
      },
    });
    expect(names(frames)).toEqual(['meta', 'fallback', 'done']);
    expect(find(frames, 'fallback')!.data).toMatchObject({ reason: 'killed' });
    expect(find(frames, 'fallback')!.at).toBeLessThan(2500);
    expect(t.calls).toHaveLength(1);
  });

  it('refuses a new turn of an open encounter that was killed', async () => {
    t = await talkSetup({ fixture: 'happy' });
    const first = await t.say(request());
    const encounterId = (find(first.frames, 'meta')!.data as { encounterId: string }).encounterId;
    await kill();
    t.h.clock.t += 2000;
    const res = await t.post(request({ encounterId }));
    expect(res.status).toBe(HTTP_FOR.kill_switched);
  });

  it('answers kill_switched for the likeness kill switch of the NPC and budget_offline for the Anthropic ones', async () => {
    t = await talkSetup({ fixture: 'happy' });
    t.recordCalls();
    const on = JSON.stringify({ on: true, reason: 'test', by: 'test', ts: 1, expiresAt: null });
    await env.FLAGS.put('ks:likeness:npc_test', on);
    expect((await t.post(request())).status).toBe(HTTP_FOR.kill_switched);
    await env.FLAGS.delete('ks:likeness:npc_test');
    for (const name of ['ks:anthropic', 'ks:genai:all']) {
      await env.FLAGS.put(name, on);
      expect((await t.post(request())).status, name).toBe(HTTP_FOR.budget_offline);
      await env.FLAGS.delete(name);
    }
    // an expired record is not in force
    await env.FLAGS.put('ks:anthropic', JSON.stringify({ on: true, reason: 'test', by: 'test', ts: 1, expiresAt: 1000 }));
    const res = await t.post(request());
    expect(res.status).toBe(200);
    await t.read(res);
    expect(t.calls).toHaveLength(1);
  });
});
