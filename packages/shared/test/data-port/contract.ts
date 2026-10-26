// The DataPort contract suite (M05d). One run against InMemoryDataPort (memory.spec.ts, AC-5) and one against the Supabase
// implementation on the local stack (services/edge/test/db/dataport-supabase.db.test.ts, AC-2). Every test uses fresh ids and a
// private time window, so a run does not depend on what earlier runs left in a persistent database.
import { describe, expect, it } from 'vitest';
import type { SpendEvent } from '../../src/api/budget.ts';
import { NotImplementedError, type CatalogInput, type Ctx, type CutsceneRow, type ServerDataPort } from '../../src/data-port.ts';
import type { SummaryPatch } from '../../src/contracts/c10-npc.ts';
import { readZip } from '../../src/zip.ts';

const uuid = (): string => crypto.randomUUID();
const hex64 = (): string => (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '').slice(0, 64);
const ctxOf = (profileId: string | null): Ctx => ({ profileId, tier: 'local', requestId: uuid() });

export interface ContractTarget {
  port: ServerDataPort;
  /** The env a port stamps on ledger rows that carry none, and the one the suite writes. */
  env: string;
}

const catalogInput = (key: string, over: Partial<CatalogInput> = {}): CatalogInput => ({
  cache_key: key,
  template_id: 'story.beat',
  template_ver: 1,
  characters: ['npc_a', 'npc_b'],
  source: 'mission:m.test',
  priority: 5,
  ...over,
});

const cutsceneRow = (key: string): CutsceneRow => ({
  cache_key: key,
  status: 'ready',
  r2_prefix: `cutscenes/${key}/`,
  endpoint_id: 'minimax/h3/image-to-video',
  endpoint_updated_at: '2026-10-01',
  provider_request_id: null,
  cost_usd_micros: 1_500_000,
  workflow_instance: `wf-${key.slice(0, 8)}`,
  char_ids: [],
  created_at: 1_790_000_000_000,
  ready_at: 1_790_000_100_000,
  error: null,
});

export function runDataPortContract(name: string, make: () => Promise<ContractTarget>): void {
  describe(`DataPort contract: ${name}`, () => {
    it('profiles.ensureLocal returns created, then exists, then key_mismatch for a second key', async () => {
      const { port } = await make();
      const pid = uuid();
      const dkt = hex64();
      expect(await port.profiles.ensureLocal(pid, dkt)).toBe('created');
      expect(await port.profiles.ensureLocal(pid, dkt)).toBe('exists');
      expect(await port.profiles.ensureLocal(pid, hex64())).toBe('key_mismatch');
      expect(await port.profiles.ensureLocal(pid, dkt)).toBe('exists');
    });

    it('a device key thumbprint that belongs to another profile is a key_mismatch and creates no profile', async () => {
      const { port } = await make();
      const dkt = hex64();
      const first = uuid();
      expect(await port.profiles.ensureLocal(first, dkt)).toBe('created');
      const second = uuid();
      expect(await port.profiles.ensureLocal(second, dkt)).toBe('key_mismatch');
      expect(await port.profiles.get(ctxOf(second))).toBeNull();
    });

    it('profiles.get returns the stored row with epoch-ms times, and null for an unknown or absent profile', async () => {
      const { port } = await make();
      const pid = uuid();
      await port.profiles.ensureLocal(pid, hex64());
      const row = await port.profiles.get(ctxOf(pid));
      expect(row).not.toBeNull();
      expect(row!.id).toBe(pid);
      expect(row!.tier).toBe('local');
      expect(row!.display_name).toBeNull();
      expect(typeof row!.created_at).toBe('number');
      expect(typeof row!.last_seen_at).toBe('number');
      expect(row!.registered_at).toBeNull();
      expect(row!.deleted_at).toBeNull();
      expect(await port.profiles.get(ctxOf(uuid()))).toBeNull();
      expect(await port.profiles.get(ctxOf(null))).toBeNull();
    });

    it('cutscenes.record followed by inCatalog agrees with the rows', async () => {
      const { port } = await make();
      const inIndex = hex64();
      const recordedOnly = hex64();
      const neither = hex64();
      expect(await port.catalog.upsert([catalogInput(inIndex)])).toBe(1);
      await port.cutscenes.record(cutsceneRow(inIndex));
      await port.cutscenes.record(cutsceneRow(recordedOnly));
      expect(await port.cutscenes.inCatalog(inIndex)).toBe(true);
      expect(await port.cutscenes.inCatalog(recordedOnly)).toBe(false);
      expect(await port.cutscenes.inCatalog(neither)).toBe(false);
    });

    it('cutscenes.record is an upsert by cache key', async () => {
      const { port } = await make();
      const key = hex64();
      await port.cutscenes.record(cutsceneRow(key));
      await expect(port.cutscenes.record({ ...cutsceneRow(key), status: 'failed', error: 'boom' })).resolves.toBeUndefined();
    });

    it('catalog.upsert writes new and changed rows only, and keys lists them', async () => {
      const { port } = await make();
      const [a, b, c] = [hex64(), hex64(), hex64()];
      expect(await port.catalog.upsert([catalogInput(a), catalogInput(b), catalogInput(c)])).toBe(3);
      expect(await port.catalog.upsert([catalogInput(a), catalogInput(b), catalogInput(c)])).toBe(0);
      expect(await port.catalog.upsert([catalogInput(b, { priority: 2 })])).toBe(1);
      expect(await port.catalog.upsert([catalogInput(b, { priority: 2 })])).toBe(0);
      const keys = await port.catalog.keys();
      for (const k of [a, b, c]) expect(keys).toContain(k);
    });

    it('ledger.sumUsdMicros equals the sum of the appended rows, and an append can be repeated', async () => {
      const { port, env } = await make();
      // A private window far in the future: no row from another run falls inside it.
      const base = 4_102_444_800_000 + Math.floor(Math.random() * 1_000_000_000) * 1000;
      const rows: SpendEvent[] = [100, 250, 4_000_000].map((usdMicros, i) => ({
        ts: base + i,
        vendor: 'elevenlabs',
        model: 'eleven_flash_v2_5',
        kind: 'tts',
        usdMicros,
        settled: true,
        jobId: `job-${uuid()}`,
        requestId: `req-${i}`,
        env,
      }));
      expect(await port.ledger.append(rows)).toBe(3);
      expect(await port.ledger.sumUsdMicros('elevenlabs', base)).toBe(4_000_350);
      expect(await port.ledger.append(rows)).toBe(0);
      expect(await port.ledger.sumUsdMicros('elevenlabs', base)).toBe(4_000_350);
      expect(await port.ledger.sumUsdMicros('elevenlabs', base + 2)).toBe(4_000_000);
      expect(await port.ledger.sumUsdMicros('anthropic', base)).toBe(0);
    });

    // ---- M06a1: NPC memory, relationship, roster, audit, retention, forget and export ----
    const unit = (i: number): Float32Array => {
      const v = new Float32Array(1024);
      v[i] = 1;
      return v;
    };
    const mem = (text: string, importance: number, gameTime: number, embedding: Float32Array) =>
      ({ kind: 'event' as const, text, importance, gameTime, source: 'dialogue' as const, embedding });
    const patch = (over: Partial<SummaryPatch> = {}): SummaryPatch => ({
      summaryUpdate: 'Met at the shop.', memories: [], affinityDelta: 5, trustDelta: -3, flagsPatch: { met: true }, soulVersion: 2, reflection: false, ...over,
    });

    it('npcMemory.write then topK orders by 0.5 relevance + 0.3 importance + 0.2 recency on the 518,400 scale, and reaches world scope', async () => {
      const { port } = await make();
      const pid = uuid();
      await port.profiles.ensureLocal(pid, hex64());
      const npc = `npc_${uuid().slice(0, 8)}`;
      // now_gt = 1,000,000. m1 .73, m2 .5, m3 .72358, m4 .77131 (see supabase/tests/memory_match.sql); the world row scores 1.0.
      await port.npcMemory.write(pid, npc, [
        mem('m1', 1, 1_000_000, unit(0)),
        mem('m2', 10, 1_000_000, unit(1)),
        mem('m3', 5, 481_600, unit(0)),
        mem('m4', 5, 740_800, unit(0)),
      ]);
      await port.npcMemory.write(pid, '*', [mem('m5', 10, 1_000_000, unit(0))]);
      const hits = await port.npcMemory.topK(pid, npc, unit(0), 1_000_000, 10);
      expect(hits.map((h) => h.text)).toEqual(['m5', 'm4', 'm1', 'm3', 'm2']);
      expect(hits[0]!.score).toBeCloseTo(1, 3);
      expect(hits[1]!.score).toBeCloseTo(0.5 + 0.15 + 0.2 * Math.exp(-0.5), 3);
      expect((await port.npcMemory.topK(pid, npc, unit(0), 1_000_000, 2)).map((h) => h.text)).toEqual(['m5', 'm4']);
      expect(await port.npcMemory.topK(pid, `npc_${uuid().slice(0, 8)}`, unit(0), 1_000_000, 10)).toHaveLength(1); // only the world row
      expect(await port.npcMemory.topK(uuid(), npc, unit(0), 1_000_000, 10)).toEqual([]);
    });

    it('npcMemory.applySummary creates and then updates the relationship (clamped deltas, merged flags, bounded summary)', async () => {
      const { port } = await make();
      const pid = uuid();
      await port.profiles.ensureLocal(pid, hex64());
      const npc = `npc_${uuid().slice(0, 8)}`;
      expect(await port.npcMemory.relationship(pid, npc)).toBeNull();
      await port.npcMemory.applySummary(pid, npc, patch());
      const first = await port.npcMemory.relationship(pid, npc);
      expect(first).toMatchObject({ profile_id: pid, npc_id: npc, affinity: 5, trust: -3, encounters: 1, summary: 'Met at the shop.', soul_version: 2, flags: { met: true } });
      expect(typeof first!.last_seen_at).toBe('number');
      await port.npcMemory.applySummary(pid, npc, patch({ affinityDelta: 200, trustDelta: -200, summaryUpdate: 'x'.repeat(600), flagsPatch: { owes_favor: true }, soulVersion: 3 }));
      await port.npcMemory.applySummary(pid, npc, patch({ summaryUpdate: 'y'.repeat(600), flagsPatch: {} }));
      const third = await port.npcMemory.relationship(pid, npc);
      expect(third).toMatchObject({ affinity: 100, trust: -100, encounters: 3, soul_version: 2, flags: { met: true, owes_favor: true } });
      expect(third!.summary.length).toBe(1200);
      expect(third!.summary.endsWith('y'.repeat(600))).toBe(true);
    });

    it('roster.kill marks the NPC, flags lists it with scope and stand-in, and the etag moves', async () => {
      const { port } = await make();
      const before = await port.roster.flags();
      const npc = `npc_${uuid().slice(0, 8)}`;
      const row = await port.roster.kill(ctxOf(null), npc, { scope: ['spawn', 'all'], reason: 'quality', ticketId: 'T-1', standIn: 'character/stand_in' as never });
      expect(row).toMatchObject({ npc_id: npc, killed: true, reason: 'quality', ticket_id: 'T-1', stand_in: 'character/stand_in' });
      const after = await port.roster.flags();
      expect(after.killed[npc]).toEqual({ scope: ['all', 'spawn'], standIn: 'character/stand_in' });
      expect(after.etag).not.toBe(before.etag);
      expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
      expect(await port.roster.flags()).toEqual(after);
    });

    it('audit.append accepts an entry', async () => {
      const { port } = await make();
      await expect(port.audit.append({ actor: 'ops-token', role: 'ops', action: 'contract.test', targetKind: 'npc', targetId: 'npc_x', details: { scope: ['all'] } })).resolves.toBeUndefined();
      await expect(port.audit.append({ actor: 'ops-token', role: 'ops', action: 'contract.test' })).resolves.toBeUndefined();
    });

    it('maintenance: transcripts are recorded, found when expired, and deleted; a missing profile is reported', async () => {
      const { port } = await make();
      const pid = uuid();
      await port.profiles.ensureLocal(pid, hex64());
      const mk = (id: string, expiresAt: number) => ({ encounter_id: id, profile_id: pid, npc_id: 'npc_a', r2_key: `transcripts/${id}.jsonl`, turns: 2, usd_micros: 40, closed_at: 1_700_000_000_000, expires_at: expiresAt });
      const old = `enc-${uuid()}`;
      const fresh = `enc-${uuid()}`;
      expect(await port.maintenance.recordTranscript(mk(old, 1_700_000_100_000))).toBe('recorded');
      expect(await port.maintenance.recordTranscript(mk(old, 1_700_000_100_000))).toBe('recorded'); // repeat is harmless
      expect(await port.maintenance.recordTranscript(mk(fresh, 4_102_444_800_000))).toBe('recorded');
      expect((await port.maintenance.expiredTranscripts(1_700_000_200_000, 1000)).map((r) => r.encounter_id)).toContain(old);
      expect((await port.maintenance.expiredTranscripts(1_700_000_200_000, 1000)).map((r) => r.encounter_id)).not.toContain(fresh);
      expect((await port.maintenance.transcriptKeys(pid)).sort()).toEqual([`transcripts/${fresh}.jsonl`, `transcripts/${old}.jsonl`].sort());
      expect(await port.maintenance.deleteTranscripts([old])).toBe(1);
      expect(await port.maintenance.deleteTranscripts([old])).toBe(0);
      expect(await port.maintenance.recordTranscript({ ...mk(`enc-${uuid()}`, 1), profile_id: uuid() })).toBe('no_profile');
    });

    it('maintenance: forget hides the profile, exportRows and exportAll hold its rows, purgeProfile removes everything keyed by it', async () => {
      const { port } = await make();
      const pid = uuid();
      await port.profiles.ensureLocal(pid, hex64());
      const npc = `npc_${uuid().slice(0, 8)}`;
      await port.npcMemory.write(pid, npc, [mem('remember me', 5, 10, unit(3))]);
      await port.npcMemory.applySummary(pid, npc, patch());
      await port.maintenance.recordTranscript({ encounter_id: `enc-${uuid()}`, profile_id: pid, npc_id: npc, r2_key: 'transcripts/e.jsonl', turns: 1, usd_micros: 1, closed_at: 1, expires_at: 4_102_444_800_000 });

      const rows = await port.maintenance.exportRows(pid);
      expect(rows['profiles']).toHaveLength(1);
      expect(rows['npc_memory']).toHaveLength(1);
      expect(rows['npc_relationship']).toHaveLength(1);
      expect(rows['encounter_transcripts']).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain('"embedding"');
      const entries = readZip(new Uint8Array(await new Response(await port.profiles.exportAll(ctxOf(pid))).arrayBuffer()));
      expect(entries.map((e) => e.name)).toContain('tables/npc_memory.json');
      expect(JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === 'tables/profiles.json')!.data))).toHaveLength(1);

      await port.profiles.forget(ctxOf(pid));
      expect(await port.profiles.get(ctxOf(pid))).toBeNull();
      expect(await port.maintenance.deletedProfiles(Date.now() + 1000, 10_000)).toContain(pid);
      expect(await port.maintenance.purgeProfile(pid)).toBe(true);
      expect(await port.maintenance.purgeProfile(pid)).toBe(false);
      expect(await port.npcMemory.relationship(pid, npc)).toBeNull();
      expect(await port.npcMemory.topK(pid, npc, unit(3), 10, 10)).toEqual([]);
      expect(await port.maintenance.transcriptKeys(pid)).toEqual([]);
      const after = await port.maintenance.exportRows(pid);
      for (const table of Object.keys(after)) expect(after[table], table).toEqual([]);
    });

    it('maintenance: purgeMemory removes expired memories and long-unseen relationships only', async () => {
      const { port } = await make();
      const pid = uuid();
      await port.profiles.ensureLocal(pid, hex64());
      const npc = `npc_${uuid().slice(0, 8)}`;
      await port.npcMemory.write(pid, npc, [mem('keeps', 5, 10, unit(1))]);
      const far = Date.now() + 400 * 86_400_000;
      const purged = await port.maintenance.purgeMemory(far);
      expect(purged.memories).toBeGreaterThanOrEqual(1);
      expect(await port.npcMemory.topK(pid, npc, unit(1), 10, 10)).toEqual([]);
      await port.npcMemory.write(pid, npc, [mem('fresh', 5, 10, unit(1))]);
      await port.maintenance.purgeMemory(Date.now());
      expect((await port.npcMemory.topK(pid, npc, unit(1), 10, 10)).map((h) => h.text)).toEqual(['fresh']);
    });

    it('builder: createDraft stops at the live limit, updateDraft guards revision and state, souls keep versions, deleteDraft names the files', async () => {
      const { port } = await make();
      const pid = uuid();
      await port.profiles.ensureLocal(pid, hex64());
      const mk = (): { id: string; npcId: string } => ({ id: uuid(), npcId: `u_${uuid().replaceAll('-', '').slice(0, 16)}` });
      const a = mk();
      const fields = { name: 'Contract Test' } as never;
      const first = await port.builder.createDraft({ id: a.id, npcId: a.npcId, ownerProfileId: pid, fields, attestation: 'original' }, 2);
      if (first === 'limit') throw new Error('first draft refused');
      expect(first).toMatchObject({ id: a.id, state: 'draft', rev: 1, backstory: '', publishable: true, soul_md: null });
      const b = mk();
      expect(await port.builder.createDraft({ id: b.id, npcId: b.npcId, ownerProfileId: pid, fields, attestation: 'original' }, 2)).not.toBe('limit');
      const c = mk();
      expect(await port.builder.createDraft({ id: c.id, npcId: c.npcId, ownerProfileId: pid, fields, attestation: 'original' }, 2)).toBe('limit');
      expect((await port.builder.listDrafts(pid)).map((d) => d.id).sort()).toEqual([a.id, b.id].sort());

      const edited = await port.builder.updateDraft(a.id, { backstory: 'a story' }, { ifRev: 1, fromStates: ['draft'], bumpRev: true });
      expect(edited).toMatchObject({ rev: 2, backstory: 'a story' });
      expect(await port.builder.updateDraft(a.id, { backstory: 'x' }, { ifRev: 1 })).toBe('conflict');
      expect(await port.builder.updateDraft(a.id, { state: 'validating' }, { fromStates: ['text_ok'] })).toBe('state');
      expect(await port.builder.updateDraft(uuid(), { backstory: 'x' })).toBeNull();
      const moved = await port.builder.updateDraft(a.id, { state: 'validating' }, { fromStates: ['draft'] });
      expect(moved).toMatchObject({ state: 'validating', rev: 2 });
      expect((await port.builder.getDraft(a.id))?.state).toBe('validating');

      const soul = (version: number, status: 'private' | 'published' = 'private'): Parameters<typeof port.builder.putSoul>[0] => ({
        npcId: a.npcId,
        soulVersion: version,
        ownerProfileId: pid,
        soulMd: 'md',
        compiledJson: { id: a.npcId } as never,
        promptR2Key: `souls/${a.npcId}/${version}/soul.prompt.txt`,
        promptSha256: hex64(),
        status,
      });
      await port.builder.putSoul(soul(1));
      await port.builder.putSoul(soul(2));
      await port.builder.putSoul(soul(2, 'published'));
      expect((await port.builder.getSoul(a.npcId))?.soul_version).toBe(2);
      expect((await port.builder.getSoul(a.npcId, 1))?.status).toBe('private');
      expect((await port.builder.getSoul(a.npcId, 2))?.status).toBe('published');
      expect(await port.builder.getSoul('u_0000000000000000')).toBeNull();
      expect((await port.builder.soulKeys(pid)).sort()).toEqual([soul(1).promptR2Key, soul(2).promptR2Key]);

      expect(await port.builder.deleteDraft(a.id, uuid())).toBeNull(); // not the owner's
      const gone = await port.builder.deleteDraft(a.id, pid);
      expect(gone?.promptKeys.sort()).toEqual([soul(1).promptR2Key, soul(2).promptR2Key]);
      expect(await port.builder.getDraft(a.id)).toBeNull();
      expect(await port.builder.getSoul(a.npcId)).toBeNull();
    });

    it('builder: purgeStaleDrafts removes only unpublished drafts older than the cutoff, with their private souls', async () => {
      const { port } = await make();
      const pid = uuid();
      await port.profiles.ensureLocal(pid, hex64());
      const fields = { name: 'Old One' } as never;
      const old = { id: uuid(), npcId: `u_${uuid().replaceAll('-', '').slice(0, 16)}` };
      const live = { id: uuid(), npcId: `u_${uuid().replaceAll('-', '').slice(0, 16)}` };
      await port.builder.createDraft({ id: old.id, npcId: old.npcId, ownerProfileId: pid, fields, attestation: 'original' }, 5);
      await port.builder.putSoul({ npcId: old.npcId, soulVersion: 1, ownerProfileId: pid, soulMd: 'md', compiledJson: {} as never, promptR2Key: `souls/${old.npcId}/1/soul.prompt.txt`, promptSha256: hex64(), status: 'private' });
      await port.builder.createDraft({ id: live.id, npcId: live.npcId, ownerProfileId: pid, fields, attestation: 'original' }, 5);
      await port.builder.updateDraft(live.id, { state: 'published' });
      const future = Date.now() + 3650 * 86_400_000;
      const removed = await port.builder.purgeStaleDrafts(future, 500);
      expect(removed.map((r) => r.npcId)).toContain(old.npcId);
      expect(removed.find((r) => r.npcId === old.npcId)?.promptKeys).toEqual([`souls/${old.npcId}/1/soul.prompt.txt`]);
      expect(removed.map((r) => r.npcId)).not.toContain(live.npcId);
      expect(await port.builder.getDraft(old.id)).toBeNull();
      expect(await port.builder.getDraft(live.id)).not.toBeNull();
      expect(await port.builder.getSoul(old.npcId)).toBeNull();
    });

    it('moderation: one item per subject, appended signals, a case with a computed SLA and a snapshot', async () => {
      const { port } = await make();
      const pid = uuid();
      await port.profiles.ensureLocal(pid, hex64());
      const draftId = uuid();
      const item = await port.moderation.ensureItem({ kind: 'npc_draft', id: draftId, ownerProfileId: pid, newId: uuid() });
      expect(await port.moderation.ensureItem({ kind: 'npc_draft', id: draftId, ownerProfileId: pid, newId: uuid() })).toBe(item);
      expect(await port.moderation.draftVerdicts(draftId)).toEqual([]);
      await port.moderation.recordSignals(item, [
        { source: 'names_lint', sourceVersion: 'registry', verdict: 'allow', scores: { hits: 0 } },
        { source: 'openai_omni', sourceVersion: 'omni-moderation-latest', verdict: 'quarantine', scores: { 'sexual/minors': 0.25 }, latencyMs: 12 },
      ]);
      const signals = await port.moderation.draftVerdicts(draftId);
      expect(signals.map((s) => s.source)).toEqual(['names_lint', 'openai_omni']);
      expect(signals[1]).toMatchObject({ verdict: 'quarantine', scores: { 'sexual/minors': 0.25 }, latency_ms: 12, source_version: 'omni-moderation-latest' });
      await port.moderation.setItemState(item, 'quarantined');
      const caseId = uuid();
      const opened = await port.moderation.openCase({ id: caseId, itemId: item, queue: 'P0_CSAM', reason: 'text_csam', openedBy: 'auto:openai_omni', snapshot: { draftId, source: 'openai_omni' } });
      expect(opened).toMatchObject({ id: caseId, queue: 'P0_CSAM', status: 'open', reason: 'text_csam', opened_by: 'auto:openai_omni' });
      expect(opened.sla_due_at - opened.created_at).toBe(4 * 3_600_000);
      expect(opened.subject_snapshot).toEqual({ draftId, source: 'openai_omni' });
      expect((await port.moderation.casesFor('npc_draft', draftId)).map((x) => x.id)).toEqual([caseId]);
      expect(await port.moderation.casesFor('npc_draft', uuid())).toEqual([]);
    });

    it('every member owned by a later milestone rejects with NotImplementedError naming it', async () => {
      const { port } = await make();
      const ctx = ctxOf(uuid());
      const cases: [string, () => Promise<unknown>][] = [
        ['M12a1', () => port.profiles.upgrade(ctx, 'x')],
        ['M12a1', () => port.identity.putRefresh(uuid(), uuid(), new Uint8Array(32), 1)],
        ['M12a1', () => port.identity.rotateRefresh(new Uint8Array(32))],
        ['M12a1', () => port.identity.link(ctx, 'openai', 's')],
        ['M13c1', () => port.identity.deviceCode.poll('x')],
        ['M12a1', () => port.saves.sync(ctx)],
        ['M12a1', () => port.saves.putProfile(ctx, 'p', { name: 'n', createdAt: 1 })],
        ['M12c', () => port.progress.commit(uuid(), 'k', {})],
        ['M12c', () => port.leaderboards.top('racing.x.time', 10)],
        ['M13a2', () => port.ugc.getMod('x')],
        ['M13b1', () => port.forum.listThreads({})],
        ['M06b2', () => port.moderation.listCases(ctx, {})],
        ['M13d1', () => port.moderation.hashBank(ctx, 'x', [])],
      ];
      for (const [milestone, call] of cases) {
        const err: unknown = await call().then(
          () => null,
          (e: unknown) => e,
        );
        expect(err, milestone).toBeInstanceOf(NotImplementedError);
        expect((err as NotImplementedError).milestone).toBe(milestone);
      }
    });
  });
}
