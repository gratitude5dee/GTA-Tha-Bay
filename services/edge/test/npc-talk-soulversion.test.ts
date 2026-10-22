import { afterEach, describe, expect, it } from 'vitest';
import { HTTP_FOR } from '@dv/shared';
import { find, request, seedSouls, talkSetup, type Talk } from './talk-helpers.ts';

// M06a3 AC-5: a soulVersion two versions old is a 409 conflict that names the current version; the previous version is still served.
let t: Talk;
afterEach(() => t.dispose());

describe('soulVersion', () => {
  it('answers 409 conflict with details.soulVersion for a version two behind', async () => {
    t = await talkSetup({ fixture: 'happy' });
    await seedSouls({ npcTestVersion: 3 });
    t.recordCalls();
    const res = await t.post(request({ soulVersion: 1 }));
    expect(res.status).toBe(HTTP_FOR.conflict);
    const body = (await res.json()) as { error: { code: string; details?: { reason?: string; soulVersion?: number } } };
    expect(body.error.code).toBe('conflict');
    expect(body.error.details).toEqual({ reason: 'soul_version', soulVersion: 3 });
    expect(t.calls).toHaveLength(0);
  });

  it('serves the current and the previous version, and says which one it used', async () => {
    t = await talkSetup({ fixture: 'happy' });
    await seedSouls({ npcTestVersion: 3 });
    for (const [version, offset] of [[3, 0], [2, 3000]] as const) {
      t.h.clock.t += offset;
      const { res, frames } = await t.say(request({ soulVersion: version }));
      expect(res.status).toBe(200);
      expect(find(frames, 'meta')!.data).toMatchObject({ soulVersion: version });
    }
  });

  it('answers 409 for a version from the future and 404 for an unknown NPC', async () => {
    t = await talkSetup({ fixture: 'happy' });
    expect((await t.post(request({ soulVersion: 2 }))).status).toBe(HTTP_FOR.conflict);
    const missing = await t.post(request({ npcId: 'npc_nobody' }), { npcId: 'npc_nobody' });
    expect(missing.status).toBe(HTTP_FOR.not_found);
  });
});
