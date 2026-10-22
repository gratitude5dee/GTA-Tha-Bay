import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readZip } from '@dv/shared/zip';
import { handleJob } from '../src/ops/jobs.ts';
import { runForget, type CredentialHandler } from '../src/ops/forget.ts';
import { setQueueSinksForTests } from '../src/ops/queue.ts';
import type { Env } from '../src/env.ts';
import { uuidv7 } from '../src/uuidv7.ts';
import { harness, playToken, type Harness } from './npc-helpers.ts';

// AC-9: DELETE /me hides the profile at once; the forget job leaves no row keyed by it and no object under its R2 prefixes.
// (The ordering of match_npc_memories is proved in supabase/tests/memory_match.sql by `pnpm check:db`.)
let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.dispose());

const emb = (i: number): Float32Array => {
  const v = new Float32Array(1024);
  v[i] = 1;
  return v;
};

async function seeded() {
  const pid = uuidv7();
  const auth = { Authorization: `PlayToken ${await playToken(pid, 'dkt-forget', h.clock.t)}` };
  expect((await h.api('/api/v1/me', { headers: auth })).status).toBe(200); // first use creates the profile
  await h.port.npcMemory.write(pid, 'npc_test', [{ kind: 'event', text: 'crashed the cable car', importance: 6, gameTime: 100, source: 'dialogue', embedding: emb(1) }]);
  await h.port.npcMemory.applySummary(pid, 'npc_test', { summaryUpdate: 'Met once.', memories: [], affinityDelta: 3, trustDelta: 1, flagsPatch: { met: true }, soulVersion: 1, reflection: false });
  const transcriptKey = `transcripts/${uuidv7()}.jsonl`;
  await env.PRIVATE.put(transcriptKey, '{"i":0,"role":"user","content":"hi"}\n');
  await h.port.maintenance.recordTranscript({ encounter_id: transcriptKey.slice(12, -6), profile_id: pid, npc_id: 'npc_test', r2_key: transcriptKey, turns: 1, usd_micros: 10, closed_at: h.clock.t, expires_at: h.clock.t + 30 * 86_400_000 });
  await env.PRIVATE.put(`saves/${pid}/core.json`, '{}');
  await env.PRIVATE.put(`saves/${pid}/story/1.json`, '{}');
  return { pid, auth, transcriptKey };
}

const objectsFor = async (pid: string, transcriptKey: string): Promise<string[]> => [
  ...(await env.PRIVATE.list({ prefix: `exports/${pid}/` })).objects.map((o) => o.key),
  ...(await env.PRIVATE.list({ prefix: `saves/${pid}/` })).objects.map((o) => o.key),
  ...(await env.PRIVATE.head(transcriptKey) ? [transcriptKey] : []),
];

describe('GET /api/v1/me/export and DELETE /api/v1/me (route 14)', () => {
  it('export: 202 pending while the job is queued, then 200 ready with an authenticated download of a ZIP of the rows and the transcripts', async () => {
    const { pid, auth, transcriptKey } = await seeded();
    const first = await h.api('/api/v1/me/export', { headers: auth });
    expect(first.status).toBe(202);
    expect(((await first.json()) as { state: string }).state).toBe('pending');
    expect(h.jobs).toEqual([{ type: 'export', profileId: pid, exportId: String(h.clock.t) }]);
    // asking again while the job is queued does not queue a second one
    expect((await h.api('/api/v1/me/export', { headers: auth })).status).toBe(202);
    expect(h.jobs).toHaveLength(1);

    await handleJob(env as unknown as Env, { data: () => h.port, now: () => h.clock.t, log: () => undefined } as never, h.jobs[0]!);
    const ready = await h.api('/api/v1/me/export', { headers: auth });
    expect(ready.status).toBe(200);
    const info = (await ready.json()) as { state: string; url: string; expiresAt: number };
    expect(info).toMatchObject({ state: 'ready', url: `/api/v1/me/export?download=${h.clock.t}`, expiresAt: h.clock.t + 7 * 86_400_000 });

    const dl = await h.api(info.url, { headers: auth });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('Content-Type')).toBe('application/zip');
    const entries = readZip(new Uint8Array(await dl.arrayBuffer()));
    const names = entries.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['tables/profiles.json', 'tables/npc_memory.json', 'tables/npc_relationship.json', 'tables/encounter_transcripts.json', transcriptKey, 'README.txt']));
    const memory = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === 'tables/npc_memory.json')!.data)) as { text: string }[];
    expect(memory.map((m) => m.text)).toEqual(['crashed the cable car']);
    expect(JSON.stringify(memory)).not.toContain('embedding');
    expect(await env.PRIVATE.head(`exports/${pid}/pending`)).toBeNull();

    // Another profile cannot download it, and the link dies after 7 days.
    const other = { Authorization: `PlayToken ${await playToken(uuidv7(), 'dkt-other', h.clock.t)}` };
    expect((await h.api(info.url, { headers: other })).status).toBe(404);
    expect((await h.api('/api/v1/me/export?download=abc', { headers: auth })).status).toBe(400);
    h.clock.t += 8 * 86_400_000;
    const stale = { Authorization: `PlayToken ${await playToken(pid, 'dkt-forget', h.clock.t)}` };
    expect((await h.api(info.url, { headers: stale })).status).toBe(404);
  });

  it('delete: 202 queued, the profile is gone for the API at once, and the forget job removes every row and object', async () => {
    const { pid, auth, transcriptKey } = await seeded();
    await h.api('/api/v1/me/export', { headers: auth });
    await handleJob(env as unknown as Env, { data: () => h.port, now: () => h.clock.t, log: () => undefined } as never, h.jobs.shift()!);
    expect(Object.keys(h.port.rowsFor(pid)).sort()).toEqual(['device_keys', 'encounter_transcripts', 'npc_memory', 'npc_relationship', 'profiles']);
    expect((await objectsFor(pid, transcriptKey)).length).toBe(4); // export, two saves, transcript

    const del = await h.api('/api/v1/me', { method: 'DELETE', headers: auth });
    expect(del.status).toBe(202);
    expect(await del.json()).toEqual({ state: 'queued' });
    expect(h.jobs).toEqual([{ type: 'forget', profileId: pid }]);
    expect(await h.port.profiles.get({ profileId: pid, tier: 'local', requestId: 'r' })).toBeNull(); // hidden at once
    expect((await h.api('/api/v1/me', { headers: auth })).status).toBe(404);
    expect(h.port.rowsFor(pid)['profiles']).toBe(1); // rows are still there until the job runs

    await handleJob(env as unknown as Env, { data: () => h.port, now: () => h.clock.t, log: () => undefined } as never, h.jobs[0]!);
    expect(h.port.rowsFor(pid)).toEqual({}); // no row keyed by the profile remains in any table
    expect(await objectsFor(pid, transcriptKey)).toEqual([]); // and its R2 prefixes are empty

    // The job and the request are both safe to repeat.
    await handleJob(env as unknown as Env, { data: () => h.port, now: () => h.clock.t, log: () => undefined } as never, h.jobs[0]!);
    expect((await h.api('/api/v1/me', { method: 'DELETE', headers: auth })).status).toBe(202);
  });

  it('delete without a queue runs the job inline and answers 200 done', async () => {
    const { pid, auth, transcriptKey } = await seeded();
    setQueueSinksForTests({ jobs: null });
    const res = await h.api('/api/v1/me', { method: 'DELETE', headers: auth, env: { JOBS: undefined } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'done' });
    expect(h.port.rowsFor(pid)).toEqual({});
    expect(await objectsFor(pid, transcriptKey)).toEqual([]);
  });

  it('export without a queue builds the ZIP inline', async () => {
    const { auth } = await seeded();
    setQueueSinksForTests({ jobs: null });
    const res = await h.api('/api/v1/me/export', { headers: auth, env: { JOBS: undefined } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { state: string }).state).toBe('ready');
  });

  it('both halves are open to a player abroad; GET /me is not', async () => {
    const { auth } = await seeded();
    expect((await h.api('/api/v1/me', { headers: auth, country: 'DE' })).status).toBe(451);
    expect((await h.api('/api/v1/me/export', { headers: auth, country: 'DE' })).status).toBe(202);
    expect((await h.api('/api/v1/me', { method: 'DELETE', headers: auth, country: 'DE' })).status).toBe(202);
  });

  it('every route needs a valid play token', async () => {
    for (const [method, path] of [['GET', '/api/v1/me'], ['GET', '/api/v1/me/export'], ['DELETE', '/api/v1/me']] as const) {
      expect((await h.api(path, { method })).status, `${method} ${path}`).toBe(401);
    }
  });
});

describe('credential handlers of the forget and export jobs', () => {
  it('a registered handler runs before the profile row is purged (the hook M12a1 uses)', async () => {
    const { pid } = await seeded();
    const order: string[] = [];
    const handler: CredentialHandler = {
      name: 'password',
      forget: async (_env, id) => {
        order.push(`handler:${id === pid}:${(await h.port.profiles.get({ profileId: id, tier: 'local', requestId: 'r' })) === null ? 'hidden' : 'visible'}`);
        order.push(`rows:${h.port.rowsFor(id)['profiles'] ?? 0}`);
      },
    };
    const result = await runForget(env as unknown as Env, { data: () => h.port, log: () => undefined }, pid, [handler]);
    expect(order).toEqual(['handler:true:visible', 'rows:1']);
    expect(result).toMatchObject({ profileId: pid, purged: true });
    expect(h.port.rowsFor(pid)).toEqual({});
  });

  it('with no database the forget job does nothing and says so', async () => {
    expect(await runForget(env as unknown as Env, { data: () => null, log: () => undefined }, uuidv7())).toBeNull();
  });
});
