import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/index.ts';
import { call } from './helpers.ts';
import { harness, playToken, PLAY_SECRET, type Harness } from './npc-helpers.ts';

// M06a4 AC-4: DELETE /me/npc-memory?npcId= removes one NPC's rows, without npcId it removes the rest; both answer 204.
let h: Harness;
afterEach(() => h.dispose());

const A = '0198aaaa-0000-7000-8000-00000000b001';
const B = '0198aaaa-0000-7000-8000-00000000b002';
const vec = (axis: number): Float32Array => {
  const v = new Float32Array(1024);
  v[axis] = 1;
  return v;
};

async function seedPlayer(pid: string, npcs: string[]): Promise<void> {
  await h.port.profiles.ensureLocal(pid, `dkt-${pid}`);
  for (const [i, npc] of npcs.entries()) {
    await h.port.npcMemory.write(pid, npc, [{ kind: 'event', text: `memory of ${npc}`, importance: 3, gameTime: 1, source: 'dialogue', embedding: vec(i) }]);
    await h.port.npcMemory.applySummary(pid, npc, { summaryUpdate: `notes on ${npc}`, memories: [], affinityDelta: 1, trustDelta: 1, flagsPatch: {}, soulVersion: 1, reflection: false });
  }
}

const del = async (pid: string, query = ''): Promise<Response> =>
  h.api(`/api/v1/me/npc-memory${query}`, { method: 'DELETE', headers: { Authorization: `PlayToken ${await playToken(pid, `dkt-${pid}`, h.clock.t)}` } });

const rows = async (pid: string): Promise<{ memory: string[]; relationship: string[] }> => {
  const r = await h.port.maintenance.exportRows(pid);
  return {
    memory: (r['npc_memory'] ?? []).map((x) => String(x['npc_id'])).sort(),
    relationship: (r['npc_relationship'] ?? []).map((x) => String(x['npc_id'])).sort(),
  };
};

describe('route 52, forget NPC memory', () => {
  it('removes only the named NPC first, then the rest, and answers 204 both times', async () => {
    h = harness();
    await seedPlayer(A, ['npc_test', 'npc_other', 'npc_third']);
    await seedPlayer(B, ['npc_test']);

    const one = await del(A, '?npcId=npc_test');
    expect(one.status).toBe(204);
    expect(await one.text()).toBe('');
    expect(await rows(A)).toEqual({ memory: ['npc_other', 'npc_third'], relationship: ['npc_other', 'npc_third'] });
    expect(await rows(B)).toEqual({ memory: ['npc_test'], relationship: ['npc_test'] }); // another player's rows stay

    const rest = await del(A);
    expect(rest.status).toBe(204);
    expect(await rows(A)).toEqual({ memory: [], relationship: [] });
    expect(await rows(B)).toEqual({ memory: ['npc_test'], relationship: ['npc_test'] });
  });

  it('answers 204 when there is nothing to delete', async () => {
    h = harness();
    await h.port.profiles.ensureLocal(A, `dkt-${A}`);
    expect((await del(A, '?npcId=npc_test')).status).toBe(204);
    expect((await del(A)).status).toBe(204);
  });

  it('refuses a missing token, a bad token and a malformed npcId', async () => {
    h = harness();
    await seedPlayer(A, ['npc_test']);
    expect((await h.api('/api/v1/me/npc-memory', { method: 'DELETE' })).status).toBe(401);
    expect((await h.api('/api/v1/me/npc-memory', { method: 'DELETE', headers: { Authorization: 'PlayToken nope' } })).status).toBe(401);
    expect((await del(A, '?npcId=Not%20An%20Id')).status).toBe(400);
    expect(await rows(A)).toEqual({ memory: ['npc_test'], relationship: ['npc_test'] });
  });

  it('only answers DELETE, and answers 204 on a Worker with no database', async () => {
    h = harness();
    expect((await h.api('/api/v1/me/npc-memory', { method: 'GET' })).status).toBe(405);
    const app = createApp({ data: () => null });
    const token = await playToken(A, `dkt-${A}`, Date.now());
    const res = await call('/api/v1/me/npc-memory?npcId=npc_test', {
      app,
      method: 'DELETE',
      country: 'US',
      headers: { Authorization: `PlayToken ${token}` },
      env: { PLAY_TOKEN_HMAC: PLAY_SECRET },
    });
    expect(res.status).toBe(204);
  });
});
