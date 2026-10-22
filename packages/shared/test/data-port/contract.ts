// The DataPort contract suite (M05d). One run against InMemoryDataPort (memory.spec.ts, AC-5) and one against the Supabase
// implementation on the local stack (services/edge/test/db/dataport-supabase.db.test.ts, AC-2). Every test uses fresh ids and a
// private time window, so a run does not depend on what earlier runs left in a persistent database.
import { describe, expect, it } from 'vitest';
import type { SpendEvent } from '../../src/api/budget.ts';
import { NotImplementedError, type CatalogInput, type Ctx, type CutsceneRow, type ServerDataPort } from '../../src/data-port.ts';

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

    it('every member owned by a later milestone rejects with NotImplementedError naming it', async () => {
      const { port } = await make();
      const ctx = ctxOf(uuid());
      const cases: [string, () => Promise<unknown>][] = [
        ['M12a1', () => port.profiles.upgrade(ctx, 'x')],
        ['M06a1', () => port.profiles.forget(ctx)],
        ['M06a1', () => port.profiles.exportAll(ctx)],
        ['M12a1', () => port.identity.putRefresh(uuid(), uuid(), new Uint8Array(32), 1)],
        ['M12a1', () => port.identity.rotateRefresh(new Uint8Array(32))],
        ['M12a1', () => port.identity.link(ctx, 'openai', 's')],
        ['M13c1', () => port.identity.deviceCode.poll('x')],
        ['M12a1', () => port.saves.sync(ctx)],
        ['M12a1', () => port.saves.putProfile(ctx, 'p', { name: 'n', createdAt: 1 })],
        ['M12c', () => port.progress.commit(uuid(), 'k', {})],
        ['M12c', () => port.leaderboards.top('racing.x.time', 10)],
        ['M06a1', () => port.npcMemory.relationship(uuid(), 'npc_a')],
        ['M06a1', () => port.npcMemory.topK(uuid(), 'npc_a', new Float32Array(1024), 0)],
        ['M13a2', () => port.ugc.getMod('x')],
        ['M13b1', () => port.forum.listThreads({})],
        ['M06b1', () => port.moderation.listCases(ctx, {})],
        ['M06a1', () => port.roster.flags()],
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
