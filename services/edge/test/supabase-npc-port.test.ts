import { describe, expect, it } from 'vitest';
import { supabaseDataPort } from '../src/data/supabase/index.ts';

// The Supabase side of the M06a1 stores, against a recording stand-in for PostgREST: it shows which requests each member sends
// (paths, filters, headers, bodies). The semantics are proved on the database itself by pgTAP (check:db) and by the contract suite
// that check:db runs against the Supabase local stack; this file runs everywhere, so a change of query shape fails in every CI job.
interface Req {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: unknown;
}

function stub(reply: (r: Req) => { status?: number; body?: unknown; headers?: Record<string, string> }): { fetch: typeof fetch; requests: Req[] } {
  const requests: Req[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const text = typeof init?.body === 'string' ? init.body : '';
    const req: Req = { method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname, query: url.searchParams, headers: new Headers(init?.headers), body: text === '' ? null : JSON.parse(text) };
    requests.push(req);
    const r = reply(req);
    return new Response(r.status === 204 || r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...r.headers } });
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

const port = (s: ReturnType<typeof stub>) => supabaseDataPort({ url: 'https://pg.test', secretKey: 'sb_secret_x', env: 'test', fetch: s.fetch });
const PID = '0198aaaa-bbbb-7ccc-8ddd-eeeeffff0001';
const vec = (): Float32Array => new Float32Array(1024).fill(0.25);

describe('npcMemory over PostgREST', () => {
  it('topK calls match_npc_memories with a 1024-component literal, then moves the expiry of the rows it returned', async () => {
    const s = stub((r) =>
      r.path.endsWith('/rpc/match_npc_memories')
        ? { body: [{ id: 7, text: 'a', kind: 'event', score: 0.9 }, { id: 9, text: 'b', kind: 'promise', score: 0.4 }] }
        : { status: 204 },
    );
    const hits = await port(s).npcMemory.topK(PID, 'npc_a', vec(), 12345, 4);
    expect(hits).toEqual([{ id: 7, text: 'a', kind: 'event', score: 0.9 }, { id: 9, text: 'b', kind: 'promise', score: 0.4 }]);
    const [rpc, touch] = s.requests;
    expect(rpc).toMatchObject({ method: 'POST', path: '/rest/v1/rpc/match_npc_memories' });
    const args = rpc!.body as { p_profile: string; p_npc: string; q: string; now_gt: number; k: number };
    expect(args).toMatchObject({ p_profile: PID, p_npc: 'npc_a', now_gt: 12345, k: 4 });
    expect(args.q.startsWith('[0.25,')).toBe(true);
    expect(args.q.split(',')).toHaveLength(1024);
    expect(touch).toMatchObject({ method: 'PATCH', path: '/rest/v1/npc_memory' });
    expect(touch!.query.get('id')).toBe('in.(7,9)');
    expect(Object.keys(touch!.body as object).sort()).toEqual(['expires_at', 'last_accessed_at']);
  });

  it('topK with no hit sends no update, and a vector of the wrong length is refused before any request', async () => {
    const s = stub(() => ({ body: [] }));
    expect(await port(s).npcMemory.topK(PID, 'npc_a', vec(), 1)).toEqual([]);
    expect(s.requests).toHaveLength(1);
    await expect(port(s).npcMemory.topK(PID, 'npc_a', new Float32Array(3), 1)).rejects.toThrow(/1024/);
    expect(s.requests).toHaveLength(1);
  });

  it('write inserts one row per memory with scope pair, or world for "*", and the vector literal', async () => {
    const s = stub(() => ({ status: 201 }));
    const m = (text: string) => ({ kind: 'event' as const, text, importance: 3, gameTime: 99.9, source: 'dialogue' as const, embedding: vec() });
    await port(s).npcMemory.write(PID, 'npc_a', [m('one'), m('two')]);
    await port(s).npcMemory.write(PID, '*', [m('world')]);
    await port(s).npcMemory.write(PID, 'npc_a', []);
    expect(s.requests).toHaveLength(2);
    const rows = s.requests[0]!.body as { scope: string; text: string; game_time: number; embedding: string; profile_id: string; npc_id: string }[];
    expect(rows.map((r) => [r.scope, r.text, r.game_time, r.profile_id, r.npc_id])).toEqual([['pair', 'one', 99, PID, 'npc_a'], ['pair', 'two', 99, PID, 'npc_a']]);
    expect(rows[0]!.embedding.startsWith('[0.25,')).toBe(true);
    expect((s.requests[1]!.body as { scope: string }[])[0]!.scope).toBe('world');
    expect(s.requests[0]).toMatchObject({ method: 'POST', path: '/rest/v1/npc_memory' });
  });

  it('applySummary reads the relationship, merges and upserts on (profile_id, npc_id)', async () => {
    const s = stub((r) =>
      r.method === 'GET'
        ? { body: { profile_id: PID, npc_id: 'npc_a', affinity: 98, trust: 0, flags: { met: true }, encounters: 2, summary: 'old', soul_version: 1, last_seen_at: '2026-10-01T00:00:00Z' } }
        : { status: 201 },
    );
    await port(s).npcMemory.applySummary(PID, 'npc_a', { summaryUpdate: 'new', memories: [], affinityDelta: 9, trustDelta: -4, flagsPatch: { owes: 1 }, soulVersion: 2, reflection: false });
    const [read, write] = s.requests;
    expect(read).toMatchObject({ method: 'GET', path: '/rest/v1/npc_relationship' });
    expect(read!.query.get('profile_id')).toBe(`eq.${PID}`);
    expect(read!.query.get('npc_id')).toBe('eq.npc_a');
    expect(write).toMatchObject({ method: 'POST', path: '/rest/v1/npc_relationship' });
    expect(write!.query.get('on_conflict')).toBe('profile_id,npc_id');
    expect(write!.body).toMatchObject({ profile_id: PID, npc_id: 'npc_a', affinity: 100, trust: -4, encounters: 3, summary: 'old new', soul_version: 2, flags: { met: true, owes: 1 } });
  });
});

describe('roster, audit and maintenance over PostgREST', () => {
  it('roster.kill upserts on npc_id; roster.flags lists the table and builds the document', async () => {
    const row = { npc_id: 'npc_a', killed: true, scope: ['all'], reason: 'legal', stand_in: 'character/pal', ticket_id: 'T-1', set_by: '00000000-0000-0000-0000-000000000000', set_at: '2026-10-22T10:00:00Z' };
    const s = stub((r) => (r.method === 'POST' ? { status: 201, body: row } : { body: [row] }));
    const p = port(s);
    const stored = await p.roster.kill({ profileId: null, tier: 'local', requestId: 'r' }, 'npc_a', { scope: ['all'], reason: 'legal', ticketId: 'T-1', standIn: 'character/pal' as never });
    expect(stored).toMatchObject({ npc_id: 'npc_a', killed: true, set_at: Date.parse('2026-10-22T10:00:00Z') });
    const post = s.requests[0]!;
    expect(post).toMatchObject({ method: 'POST', path: '/rest/v1/roster_flag' });
    expect(post.query.get('on_conflict')).toBe('npc_id');
    expect(post.headers.get('prefer')).toContain('resolution=merge-duplicates');
    expect(post.body).toMatchObject({ npc_id: 'npc_a', killed: true, scope: ['all'], reason: 'legal', stand_in: 'character/pal', ticket_id: 'T-1', set_by: '00000000-0000-0000-0000-000000000000' });
    const flags = await p.roster.flags();
    expect(flags.killed['npc_a']).toEqual({ scope: ['all'], standIn: 'character/pal' });
    expect(flags.updatedAt).toBe(Date.parse('2026-10-22T10:00:00Z'));
  });

  it('audit.append calls audit_append with the entry and nulls for the optional fields', async () => {
    const s = stub(() => ({ body: 41 }));
    await port(s).audit.append({ actor: 'ops-token', role: 'ops', action: 'flag.set' });
    await port(s).audit.append({ actor: 'ops-token', role: 'ops', action: 'roster.kill', targetKind: 'npc', targetId: 'npc_a', details: { scope: ['all'] } });
    expect(s.requests[0]).toMatchObject({ method: 'POST', path: '/rest/v1/rpc/audit_append', body: { p_actor: 'ops-token', p_role: 'ops', p_action: 'flag.set', p_target_kind: null, p_target_id: null, p_details: {} } });
    expect(s.requests[1]!.body).toMatchObject({ p_target_kind: 'npc', p_target_id: 'npc_a', p_details: { scope: ['all'] } });
  });

  it('recordTranscript answers no_profile on a foreign-key violation and recorded otherwise', async () => {
    const row = { encounter_id: 'e1', profile_id: PID, npc_id: 'npc_a', r2_key: 'transcripts/e1.jsonl', turns: 2, usd_micros: 5, closed_at: 1_790_000_000_000, expires_at: 1_792_592_000_000 };
    expect(await port(stub(() => ({ status: 201 }))).maintenance.recordTranscript(row)).toBe('recorded');
    const fk = stub(() => ({ status: 409, body: { code: '23503', message: 'violates foreign key constraint' } }));
    expect(await port(fk).maintenance.recordTranscript(row)).toBe('no_profile');
    expect(fk.requests[0]!.query.get('on_conflict')).toBe('encounter_id');
    expect(fk.requests[0]!.body).toMatchObject({ encounter_id: 'e1', closed_at: new Date(1_790_000_000_000).toISOString() });
    const other = stub(() => ({ status: 500, body: { code: 'XX000', message: 'boom' } }));
    await expect(port(other).maintenance.recordTranscript(row)).rejects.toMatchObject({ name: 'DataPortError', table: 'encounter_transcripts' });
  });

  it('purgeMemory deletes by expiry and by unseen time and reports the exact counts', async () => {
    const s = stub((r) => ({ status: 200, body: [], headers: { 'content-range': r.path.endsWith('npc_memory') ? '*/3' : '*/1' } }));
    const counts = await port(s).maintenance.purgeMemory(1_800_000_000_000);
    expect(counts).toEqual({ memories: 3, relationships: 1 });
    const [mem, rel] = s.requests;
    expect(mem).toMatchObject({ method: 'DELETE', path: '/rest/v1/npc_memory' });
    expect(mem!.query.get('expires_at')).toBe(`lte.${new Date(1_800_000_000_000).toISOString()}`);
    expect(mem!.headers.get('prefer')).toContain('count=exact');
    expect(rel).toMatchObject({ method: 'DELETE', path: '/rest/v1/npc_relationship' });
    expect(rel!.query.get('last_seen_at')).toBe(`lt.${new Date(1_800_000_000_000 - 180 * 86_400_000).toISOString()}`);
  });

  it('expired transcripts, stub and deleted profiles and the purge use the filters the retention jobs rely on', async () => {
    const s = stub((r) => {
      if (r.method === 'DELETE') return { body: [{ id: PID }] };
      if (r.path.endsWith('encounter_transcripts')) return { body: [{ encounter_id: 'e1', r2_key: 'transcripts/e1.jsonl' }] };
      return { body: [{ id: PID }] };
    });
    const p = port(s);
    expect(await p.maintenance.expiredTranscripts(1_800_000_000_000, 50)).toEqual([{ encounter_id: 'e1', r2_key: 'transcripts/e1.jsonl' }]);
    expect(await p.maintenance.stubProfiles(1_800_000_000_000, 10)).toEqual([PID]);
    expect(await p.maintenance.deletedProfiles(1_800_000_000_000, 10)).toEqual([PID]);
    expect(await p.maintenance.purgeProfile(PID)).toBe(true);
    const [t, stubReq, delReq, purge] = s.requests;
    expect(t!.query.get('expires_at')).toBe(`lte.${new Date(1_800_000_000_000).toISOString()}`);
    expect(t!.query.get('limit')).toBe('50');
    expect(stubReq!.query.get('tier')).toBe('eq.local');
    expect(stubReq!.query.get('last_seen_at')).toBe(`lt.${new Date(1_800_000_000_000).toISOString()}`);
    expect(delReq!.query.getAll('deleted_at')).toEqual(['not.is.null', `lt.${new Date(1_800_000_000_000).toISOString()}`]);
    expect(purge).toMatchObject({ method: 'DELETE', path: '/rest/v1/profiles' });
    expect(purge!.query.get('id')).toBe(`eq.${PID}`);
  });

  it('profiles.forget marks deleted_at on a live profile only, and exportRows reads only the allowed columns of each table', async () => {
    const s = stub((r) => (r.method === 'PATCH' ? { body: [] } : { body: [] }));
    const p = port(s);
    await p.profiles.forget({ profileId: PID, tier: 'local', requestId: 'r' });
    expect(s.requests[0]).toMatchObject({ method: 'PATCH', path: '/rest/v1/profiles' });
    expect(s.requests[0]!.query.get('id')).toBe(`eq.${PID}`);
    expect(s.requests[0]!.query.get('deleted_at')).toBe('is.null');
    expect(Object.keys(s.requests[0]!.body as object)).toEqual(['deleted_at']);
    await p.profiles.forget({ profileId: null, tier: 'local', requestId: 'r' });
    expect(s.requests).toHaveLength(1);

    const rows = await p.maintenance.exportRows(PID);
    expect(Object.keys(rows).sort()).toEqual(['age_assurance', 'device_keys', 'encounter_transcripts', 'identities', 'npc_memory', 'npc_relationship', 'profiles']);
    const selects = s.requests.slice(1).map((r) => `${r.path}:${r.query.get('select')}`).join('\n');
    expect(selects).not.toContain('embedding');
    expect(selects).not.toContain('token_hash');
    expect(selects).not.toContain('subject');
    expect(selects).not.toContain('public_jwk');
  });
});
