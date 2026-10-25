// InMemoryDataPort (M05d): the DataPort for tests and for a Worker with no database configured. It implements the same
// semantics as services/edge/src/data/supabase/* for the members that exist now, and rejects with NotImplementedError(<milestone>)
// for the members whose tables land later. No IO, no clock of its own: time comes from the `now` option.
import type { SpendEvent, Vendor } from './api/budget.ts';
import {
  later,
  rejectLater,
  type AuditEntry,
  type AuditStore,
  type BuilderStore,
  type CatalogInput,
  type CatalogRow,
  type CatalogStore,
  type CutsceneRow,
  type DataPort,
  type DeviceCodeStore,
  type ExportRows,
  type ForumStore,
  type LedgerStore,
  type MaintenanceStore,
  type ModItemState,
  type ModSubjectKind,
  type ModerationCaseRow,
  type ModerationSignalRow,
  type ModerationStore,
  type NpcDraftRow,
  type NpcSoulRow,
  type ProfileRow,
  type RelationshipRow,
  type RosterFlagRow,
  type RosterStore,
  type ServerDataPort,
  type TranscriptRow,
  type UgcStore,
  MODERATION_SLA_HOURS,
  laterModeration,
} from './data-port.ts';
import type { MemoryHit } from './contracts/c10-npc.ts';
import { buildRosterFlags, cosine, MEMORY_TTL_MS, mergeSummary, NIL_UUID, scoreMemory } from './npc/memory.ts';
import { bytesStream, zipOfRows } from './zip.ts';

interface MemoryRow {
  id: number;
  profile_id: string;
  npc_id: string;
  scope: 'pair' | 'npc' | 'world';
  kind: string;
  text: string;
  importance: number;
  game_time: number;
  source: string;
  embedding: Float32Array;
  created_at: number;
  last_accessed_at: number | null;
  expires_at: number;
}

export interface InMemoryOptions {
  /** The `env` column of ledger rows written through `append` when the row carries none. Default 'test'. */
  env?: string;
  /** Epoch ms. Default: a counter that starts at 1,700,000,000,000 and moves by 1 ms per call, so rows are ordered without a clock. */
  now?: () => number;
  /** Cache keys that are in the catalog from the start. */
  catalogKeys?: Iterable<string>;
}

interface KeyBinding {
  kid: string;
  revoked: boolean;
}

/** Draft states whose draft the 180-day purge may delete: nothing that is, or is being, published. */
const UNPUBLISHED: ReadonlySet<string> = new Set(['draft', 'validating', 'rejected_auto', 'text_ok', 'soul_generating', 'soul_failed', 'soul_ready', 'probing', 'private']);

const sameCatalogFields = (a: CatalogInput, b: CatalogInput): boolean =>
  a.template_id === b.template_id &&
  a.template_ver === b.template_ver &&
  a.source === b.source &&
  a.priority === b.priority &&
  a.characters.length === b.characters.length &&
  a.characters.every((c, i) => c === b.characters[i]);

export class InMemoryDataPort implements ServerDataPort {
  private readonly clock: () => number;
  private tick = 1_700_000_000_000;
  private readonly profileRows = new Map<string, ProfileRow>();
  private readonly deviceKeys = new Map<string, string>(); // kid -> pid
  private readonly bindings = new Map<string, KeyBinding[]>(); // pid -> keys
  private readonly catalogRows = new Map<string, CatalogRow>();
  private readonly cutsceneRows = new Map<string, CutsceneRow>();
  private readonly ledgerEvents: SpendEvent[] = [];
  private readonly ledgerKeys = new Set<string>();
  private readonly memoryRows: MemoryRow[] = [];
  private nextMemoryId = 1;
  private readonly relationshipRows = new Map<string, RelationshipRow>(); // pid|npc
  private readonly rosterRows = new Map<string, RosterFlagRow>();
  private readonly transcriptRows = new Map<string, TranscriptRow>();
  private readonly auditEntries: (AuditEntry & { at: number })[] = [];
  private readonly draftRows = new Map<string, NpcDraftRow>();
  private readonly soulRows = new Map<string, NpcSoulRow>(); // npc|version
  private readonly modItems = new Map<string, { id: string; kind: ModSubjectKind; subjectId: string; owner: string; state: ModItemState }>();
  private readonly modSignals: (ModerationSignalRow & { itemId: string })[] = [];
  private readonly modCases: ModerationCaseRow[] = [];
  private nextSignalId = 1;

  constructor(private readonly options: InMemoryOptions = {}) {
    this.clock = options.now ?? (() => this.tick++);
    for (const key of options.catalogKeys ?? []) {
      this.catalogRows.set(key, { cache_key: key, template_id: 'seed', template_ver: 1, characters: [], source: 'seed', priority: 5, added_at: this.clock() });
    }
  }

  // ---- inspection helpers for tests ----
  /** Every ledger row in insertion order. */
  ledgerRows(): readonly SpendEvent[] {
    return this.ledgerEvents;
  }
  catalogEntries(): readonly CatalogRow[] {
    return [...this.catalogRows.values()];
  }
  recordedCutscenes(): readonly CutsceneRow[] {
    return [...this.cutsceneRows.values()];
  }

  readonly profiles: DataPort['profiles'] = {
    ensureLocal: (pid, dkt) => {
      const existing = this.profileRows.get(pid);
      const boundTo = this.deviceKeys.get(dkt);
      if (existing === undefined) {
        if (boundTo !== undefined) return Promise.resolve('key_mismatch');
        const now = this.clock();
        this.profileRows.set(pid, {
          id: pid,
          tier: 'local',
          display_name: null,
          display_name_state: 'none',
          created_at: now,
          registered_at: null,
          last_seen_at: now,
          flags: {},
          deleted_at: null,
        });
        this.deviceKeys.set(dkt, pid);
        this.bindings.set(pid, [{ kid: dkt, revoked: false }]);
        return Promise.resolve('created');
      }
      const keys = (this.bindings.get(pid) ?? []).filter((k) => !k.revoked);
      if (keys.some((k) => k.kid === dkt)) return Promise.resolve('exists');
      if (keys.length === 0 && boundTo === undefined) {
        // A profile that has no key yet binds the first key it is seen with.
        this.deviceKeys.set(dkt, pid);
        this.bindings.set(pid, [...(this.bindings.get(pid) ?? []), { kid: dkt, revoked: false }]);
        return Promise.resolve('exists');
      }
      return Promise.resolve('key_mismatch');
    },
    upgrade: rejectLater('M12a1'),
    get: (ctx) => {
      if (ctx.profileId === null) return Promise.resolve(null);
      const row = this.profileRows.get(ctx.profileId);
      return Promise.resolve(row === undefined || row.deleted_at !== null ? null : { ...row });
    },
    exportAll: async (ctx) => bytesStream(zipOfRows(await this.maintenance.exportRows(ctx.profileId ?? ''))),
    forget: (ctx) => {
      // The soft step of DELETE /me: the profile stops existing for the API at once; the forget job purges the rows (maintenance.purgeProfile).
      const row = ctx.profileId === null ? undefined : this.profileRows.get(ctx.profileId);
      if (row !== undefined && row.deleted_at === null) row.deleted_at = this.clock();
      return Promise.resolve();
    },
  };

  readonly identity: DataPort['identity'] = {
    putRefresh: rejectLater('M12a1'),
    rotateRefresh: rejectLater('M12a1'),
    link: rejectLater('M12a1'),
    deviceCode: later<DeviceCodeStore>('M13c1'),
  };

  readonly saves: DataPort['saves'] = {
    sync: rejectLater('M12a1'),
    putProfile: rejectLater('M12a1'),
    deleteProfile: rejectLater('M12a1'),
    put: rejectLater('M12a1'),
    tombstone: rejectLater('M12a1'),
  };

  readonly progress: DataPort['progress'] = { commit: rejectLater('M12c') };
  readonly leaderboards: DataPort['leaderboards'] = { top: rejectLater('M12c'), submit: rejectLater('M12c') };
  readonly npcMemory: DataPort['npcMemory'] = {
    relationship: (pid, npcId) => {
      const row = this.relationshipRows.get(`${pid}|${npcId}`);
      return Promise.resolve(row === undefined ? null : { ...row, flags: row.flags });
    },
    topK: (pid, npcId, q, gameTime, k = 6) => {
      const now = this.clock();
      const hits = this.memoryRows
        .filter((m) => m.profile_id === pid && (m.npc_id === npcId || m.npc_id === '*') && m.expires_at > now)
        .map((m) => ({ m, score: scoreMemory({ cosine: cosine(m.embedding, q), importance: m.importance, gameTime: m.game_time }, gameTime) }))
        .sort((a, b) => b.score - a.score || a.m.id - b.m.id)
        .slice(0, k);
      for (const h of hits) {
        // A memory that is read lives 180 days from now (migration 0003: "reset to +180 d on access").
        h.m.last_accessed_at = now;
        h.m.expires_at = now + MEMORY_TTL_MS;
      }
      return Promise.resolve(hits.map((h) => ({ id: h.m.id, text: h.m.text, kind: h.m.kind as MemoryHit['kind'], score: h.score })));
    },
    write: (pid, npcId, ms) => {
      if (!this.profileRows.has(pid)) return Promise.reject(new Error('npc_memory: no such profile'));
      const now = this.clock();
      for (const m of ms) {
        this.memoryRows.push({
          id: this.nextMemoryId++,
          profile_id: pid,
          npc_id: npcId,
          scope: npcId === '*' ? 'world' : 'pair',
          kind: m.kind,
          text: m.text,
          importance: m.importance,
          game_time: m.gameTime,
          source: m.source,
          embedding: Float32Array.from(m.embedding),
          created_at: now,
          last_accessed_at: null,
          expires_at: now + MEMORY_TTL_MS,
        });
      }
      return Promise.resolve();
    },
    applySummary: (pid, npcId, s) => {
      const key = `${pid}|${npcId}`;
      const old = this.relationshipRows.get(key) ?? null;
      const merged = mergeSummary(old === null ? null : { ...old, flags: old.flags as Record<string, unknown> }, s);
      this.relationshipRows.set(key, {
        profile_id: pid,
        npc_id: npcId,
        affinity: merged.affinity,
        trust: merged.trust,
        flags: merged.flags as RelationshipRow['flags'],
        encounters: merged.encounters,
        summary: merged.summary,
        soul_version: merged.soul_version,
        last_seen_at: this.clock(),
      });
      return Promise.resolve();
    },
  };

  readonly cutscenes: DataPort['cutscenes'] = {
    record: (row) => {
      this.cutsceneRows.set(row.cache_key, { ...row });
      return Promise.resolve();
    },
    inCatalog: (key) => Promise.resolve(this.catalogRows.has(key)),
  };

  readonly catalog: CatalogStore = {
    upsert: (rows) => {
      let written = 0;
      for (const input of rows) {
        const old = this.catalogRows.get(input.cache_key);
        if (old !== undefined && sameCatalogFields(old, input)) continue;
        this.catalogRows.set(input.cache_key, { ...input, characters: [...input.characters], added_at: old?.added_at ?? this.clock() });
        written++;
      }
      return Promise.resolve(written);
    },
    keys: () => Promise.resolve([...this.catalogRows.keys()]),
  };

  readonly ugc: UgcStore = later<UgcStore>('M13a2');
  readonly forum: ForumStore = later<ForumStore>('M13b1');
  readonly moderation: ModerationStore = {
    ensureItem: (subject) => {
      for (const it of this.modItems.values()) if (it.kind === subject.kind && it.subjectId === subject.id) return Promise.resolve(it.id);
      this.modItems.set(subject.newId, { id: subject.newId, kind: subject.kind, subjectId: subject.id, owner: subject.ownerProfileId, state: 'received' });
      return Promise.resolve(subject.newId);
    },
    setItemState: (itemId, state) => {
      const it = this.modItems.get(itemId);
      if (it !== undefined) it.state = state;
      return Promise.resolve();
    },
    recordSignals: (itemId, signals) => {
      if (!this.modItems.has(itemId)) return Promise.reject(new Error('moderation_signal: no such item'));
      for (const g of signals) {
        this.modSignals.push({
          id: this.nextSignalId++,
          itemId,
          item_id: itemId,
          source: g.source,
          source_version: g.sourceVersion,
          verdict: g.verdict,
          scores: g.scores as ModerationSignalRow['scores'],
          latency_ms: g.latencyMs ?? null,
          created_at: this.clock(),
        });
      }
      return Promise.resolve();
    },
    openCase: (c) => {
      const now = this.clock();
      const row: ModerationCaseRow = {
        id: c.id,
        item_id: c.itemId,
        queue: c.queue,
        reason: c.reason,
        opened_by: c.openedBy,
        sla_due_at: now + MODERATION_SLA_HOURS[c.queue] * 3_600_000,
        statutory_due_at: null,
        status: 'open',
        assignee: null,
        created_at: now,
        closed_at: null,
        subject_snapshot: c.snapshot as ModerationCaseRow['subject_snapshot'],
      };
      this.modCases.push(row);
      return Promise.resolve({ ...row });
    },
    draftVerdicts: (draftId) => {
      const ids = [...this.modItems.values()].filter((i) => i.kind === 'npc_draft' && i.subjectId === draftId).map((i) => i.id);
      return Promise.resolve(this.modSignals.filter((g) => ids.includes(g.itemId)).map(({ itemId: _i, ...g }) => ({ ...g })));
    },
    casesFor: (kind, subjectId) => {
      const ids = [...this.modItems.values()].filter((i) => i.kind === kind && i.subjectId === subjectId).map((i) => i.id);
      return Promise.resolve(this.modCases.filter((c) => c.item_id !== null && ids.includes(c.item_id)).map((c) => ({ ...c })));
    },
    ...laterModeration(),
  };

  readonly builder: BuilderStore = {
    createDraft: (d, maxLive) => {
      if (!this.profileRows.has(d.ownerProfileId)) return Promise.reject(new Error('npc_draft: no such profile'));
      const live = [...this.draftRows.values()].filter((r) => r.owner_profile_id === d.ownerProfileId).length;
      if (live >= maxLive) return Promise.resolve('limit');
      if ([...this.draftRows.values()].some((r) => r.npc_id === d.npcId)) return Promise.reject(new Error('npc_draft: duplicate npc id'));
      const now = this.clock();
      const row: NpcDraftRow = {
        id: d.id,
        npc_id: d.npcId,
        owner_profile_id: d.ownerProfileId,
        state: 'draft',
        rev: 1,
        fields: d.fields,
        backstory: '',
        image_upload_ids: [],
        image_descriptions: [],
        attestation: d.attestation,
        moderation: {},
        publishable: true,
        soul_md: null,
        lint: [],
        probes: null,
        jobs: [],
        soul_version: null,
        created_at: now,
        updated_at: now,
      };
      this.draftRows.set(row.id, row);
      return Promise.resolve(structuredClone(row));
    },
    getDraft: (id) => {
      const r = this.draftRows.get(id);
      return Promise.resolve(r === undefined ? null : structuredClone(r));
    },
    listDrafts: (owner) =>
      Promise.resolve(
        [...this.draftRows.values()]
          .filter((r) => r.owner_profile_id === owner)
          .sort((a, b) => b.updated_at - a.updated_at)
          .map((r) => structuredClone(r)),
      ),
    updateDraft: (id, patch, guard = {}) => {
      const r = this.draftRows.get(id);
      if (r === undefined) return Promise.resolve(null);
      if (guard.fromStates != null && !guard.fromStates.includes(r.state)) return Promise.resolve('state');
      if (guard.ifRev != null && guard.ifRev !== r.rev) return Promise.resolve('conflict');
      Object.assign(r, structuredClone(patch));
      if (guard.bumpRev === true) r.rev += 1;
      r.updated_at = this.clock();
      return Promise.resolve(structuredClone(r));
    },
    deleteDraft: (id, owner) => {
      const r = this.draftRows.get(id);
      if (r === undefined || r.owner_profile_id !== owner) return Promise.resolve(null);
      this.draftRows.delete(id);
      const promptKeys: string[] = [];
      for (const [k, so] of [...this.soulRows]) {
        if (so.npc_id === r.npc_id && so.owner_profile_id === owner) {
          promptKeys.push(so.prompt_r2_key);
          this.soulRows.delete(k);
        }
      }
      return Promise.resolve({ promptKeys });
    },
    putSoul: (sRow) => {
      if (!this.profileRows.has(sRow.ownerProfileId)) return Promise.reject(new Error('npc_soul: no such profile'));
      this.soulRows.set(`${sRow.npcId}|${sRow.soulVersion}`, {
        npc_id: sRow.npcId,
        soul_version: sRow.soulVersion,
        origin: 'user',
        owner_profile_id: sRow.ownerProfileId,
        soul_md: sRow.soulMd,
        compiled_json: sRow.compiledJson,
        prompt_r2_key: sRow.promptR2Key,
        prompt_sha256: sRow.promptSha256,
        status: sRow.status,
        published_at: null,
        created_at: this.clock(),
      });
      return Promise.resolve();
    },
    getSoul: (npcId, version) => {
      let best: NpcSoulRow | null = null;
      for (const r of this.soulRows.values()) {
        if (r.npc_id !== npcId) continue;
        if (version !== undefined) {
          if (r.soul_version === version) best = r;
        } else if (best === null || r.soul_version > best.soul_version) best = r;
      }
      return Promise.resolve(best === null ? null : structuredClone(best));
    },
    soulKeys: (owner) => Promise.resolve([...this.soulRows.values()].filter((r) => r.owner_profile_id === owner).map((r) => r.prompt_r2_key)),
    purgeStaleDrafts: (beforeMs, limit) => {
      const stale = [...this.draftRows.values()]
        .filter((r) => r.updated_at < beforeMs && UNPUBLISHED.has(r.state))
        .sort((a, b) => a.updated_at - b.updated_at)
        .slice(0, limit);
      const out: { npcId: string; promptKeys: string[] }[] = [];
      for (const r of stale) {
        this.draftRows.delete(r.id);
        const keys: string[] = [];
        for (const [k, so] of [...this.soulRows]) {
          if (so.npc_id === r.npc_id && so.status === 'private') {
            keys.push(so.prompt_r2_key);
            this.soulRows.delete(k);
          }
        }
        out.push({ npcId: r.npc_id, promptKeys: keys });
      }
      return Promise.resolve(out);
    },
  };
  readonly roster: RosterStore = {
    flags: () => Promise.resolve(buildRosterFlags([...this.rosterRows.values()])),
    kill: (ctx, npcId, req) => {
      const row: RosterFlagRow = {
        npc_id: npcId,
        killed: true,
        scope: [...req.scope],
        reason: req.reason,
        stand_in: req.standIn,
        ticket_id: req.ticketId,
        set_by: ctx.profileId ?? NIL_UUID,
        set_at: this.clock(),
      };
      this.rosterRows.set(npcId, row);
      return Promise.resolve({ ...row });
    },
  };

  readonly audit: AuditStore = {
    append: (entry) => {
      this.auditEntries.push({ ...entry, at: this.clock() });
      return Promise.resolve();
    },
  };

  /** Audit entries in append order (test helper). */
  auditRows(): readonly (AuditEntry & { at: number })[] {
    return this.auditEntries;
  }
  /** Transcript index rows (test helper). */
  transcripts(): readonly TranscriptRow[] {
    return [...this.transcriptRows.values()];
  }
  /** Memory rows without embeddings (test helper). */
  memories(): readonly Omit<MemoryRow, 'embedding'>[] {
    return this.memoryRows.map(({ embedding: _e, ...rest }) => rest);
  }
  /** Draft rows (test helper). */
  drafts(): readonly NpcDraftRow[] {
    return [...this.draftRows.values()];
  }
  /** Soul rows (test helper). */
  souls(): readonly NpcSoulRow[] {
    return [...this.soulRows.values()];
  }
  /** Moderation cases in the order they were opened (test helper). */
  moderationCases(): readonly ModerationCaseRow[] {
    return this.modCases;
  }
  /** Moderation signals in the order they were recorded (test helper). */
  moderationSignals(): readonly ModerationSignalRow[] {
    return this.modSignals;
  }
  /** Moves a draft's `updated_at` (test helper for the 180-day purge). */
  ageDraft(id: string, updatedAt: number): void {
    const r = this.draftRows.get(id);
    if (r !== undefined) r.updated_at = updatedAt;
  }
  /** Seeds a relationship row (test helper). */
  seedRelationship(row: RelationshipRow): void {
    this.relationshipRows.set(`${row.profile_id}|${row.npc_id}`, row);
  }
  /** Seeds an encounter transcript row (test helper). */
  seedTranscript(row: TranscriptRow): void {
    this.transcriptRows.set(row.encounter_id, row);
  }
  /** Sets a profile's `last_seen_at` and tier (test helper for the stub-profile sweep). */
  ageProfile(pid: string, lastSeenAt: number): void {
    const row = this.profileRows.get(pid);
    if (row !== undefined) row.last_seen_at = lastSeenAt;
  }
  /** Rewrites a memory's expiry (test helper for the retention job). */
  expireMemory(id: number, expiresAt: number): void {
    const m = this.memoryRows.find((r) => r.id === id);
    if (m !== undefined) m.expires_at = expiresAt;
  }
  /** Every table keyed by the profile that still holds a row for it (test helper for the forget proof). */
  rowsFor(pid: string): Record<string, number> {
    const out: Record<string, number> = {};
    const add = (name: string, n: number): void => {
      if (n > 0) out[name] = n;
    };
    add('profiles', this.profileRows.has(pid) ? 1 : 0);
    add('npc_memory', this.memoryRows.filter((m) => m.profile_id === pid).length);
    add('npc_relationship', [...this.relationshipRows.values()].filter((r) => r.profile_id === pid).length);
    add('encounter_transcripts', [...this.transcriptRows.values()].filter((r) => r.profile_id === pid).length);
    add('npc_draft', [...this.draftRows.values()].filter((r) => r.owner_profile_id === pid).length);
    add('npc_soul', [...this.soulRows.values()].filter((r) => r.owner_profile_id === pid).length);
    add('device_keys', (this.bindings.get(pid) ?? []).length);
    return out;
  }

  readonly maintenance: MaintenanceStore = {
    recordTranscript: (row) => {
      if (!this.profileRows.has(row.profile_id)) return Promise.resolve('no_profile');
      this.transcriptRows.set(row.encounter_id, { ...row });
      return Promise.resolve('recorded');
    },
    expiredTranscripts: (nowMs, limit) =>
      Promise.resolve(
        [...this.transcriptRows.values()]
          .filter((t) => t.expires_at <= nowMs)
          .slice(0, limit)
          .map((t) => ({ encounter_id: t.encounter_id, r2_key: t.r2_key })),
      ),
    deleteTranscripts: (ids) => {
      let n = 0;
      for (const id of ids) if (this.transcriptRows.delete(id)) n++;
      return Promise.resolve(n);
    },
    transcriptKeys: (pid) => Promise.resolve([...this.transcriptRows.values()].filter((t) => t.profile_id === pid).map((t) => t.r2_key)),
    purgeMemory: (nowMs) => {
      const before = this.memoryRows.length;
      for (let i = this.memoryRows.length - 1; i >= 0; i--) if ((this.memoryRows[i] as MemoryRow).expires_at <= nowMs) this.memoryRows.splice(i, 1);
      let relationships = 0;
      for (const [k, r] of [...this.relationshipRows]) {
        if (r.last_seen_at < nowMs - MEMORY_TTL_MS) {
          this.relationshipRows.delete(k);
          relationships++;
        }
      }
      return Promise.resolve({ memories: before - this.memoryRows.length, relationships });
    },
    stubProfiles: (beforeMs, limit) =>
      Promise.resolve(
        [...this.profileRows.values()]
          .filter((p) => p.tier === 'local' && p.last_seen_at < beforeMs)
          .slice(0, limit)
          .map((p) => p.id),
      ),
    deletedProfiles: (beforeMs, limit) =>
      Promise.resolve(
        [...this.profileRows.values()]
          .filter((p) => p.deleted_at !== null && p.deleted_at < beforeMs)
          .slice(0, limit)
          .map((p) => p.id),
      ),
    purgeProfile: (pid) => {
      const existed = this.profileRows.delete(pid);
      for (const k of this.bindings.get(pid) ?? []) this.deviceKeys.delete(k.kid);
      this.bindings.delete(pid);
      for (let i = this.memoryRows.length - 1; i >= 0; i--) if ((this.memoryRows[i] as MemoryRow).profile_id === pid) this.memoryRows.splice(i, 1);
      for (const [k, r] of [...this.relationshipRows]) if (r.profile_id === pid) this.relationshipRows.delete(k);
      for (const [k, t] of [...this.transcriptRows]) if (t.profile_id === pid) this.transcriptRows.delete(k);
      for (const [k, d] of [...this.draftRows]) if (d.owner_profile_id === pid) this.draftRows.delete(k);
      for (const [k, so] of [...this.soulRows]) if (so.owner_profile_id === pid) this.soulRows.delete(k);
      return Promise.resolve(existed);
    },
    exportRows: (pid) => {
      const rows: ExportRows = {};
      const profile = this.profileRows.get(pid);
      rows['profiles'] = profile === undefined ? [] : [{ ...profile }];
      rows['device_keys'] = (this.bindings.get(pid) ?? []).map((k) => ({ kid: k.kid, revoked: k.revoked }));
      rows['npc_relationship'] = [...this.relationshipRows.values()].filter((r) => r.profile_id === pid).map((r) => ({ ...r }));
      rows['npc_memory'] = this.memories().filter((m) => m.profile_id === pid).map((m) => ({ ...m }));
      rows['encounter_transcripts'] = [...this.transcriptRows.values()].filter((t) => t.profile_id === pid).map((t) => ({ ...t }));
      rows['npc_draft'] = [...this.draftRows.values()].filter((d) => d.owner_profile_id === pid).map((d) => structuredClone(d));
      rows['npc_soul'] = [...this.soulRows.values()].filter((so) => so.owner_profile_id === pid).map((so) => structuredClone(so));
      return Promise.resolve(rows);
    },
    nearestMemory: (pid, npcId, q, window = 64) => {
      const now = this.clock();
      let best: { id: number; cosine: number } | null = null;
      const pair = this.memoryRows
        .filter((m) => m.profile_id === pid && m.npc_id === npcId && m.expires_at > now)
        .sort((a, b) => b.id - a.id)
        .slice(0, window);
      for (const m of pair) {
        const c = cosine(m.embedding, q);
        if (best === null || c > best.cosine) best = { id: m.id, cosine: c };
      }
      return Promise.resolve(best);
    },
    touchMemories: (ids) => {
      const now = this.clock();
      for (const m of this.memoryRows) {
        if (!ids.includes(m.id)) continue;
        m.last_accessed_at = now;
        m.expires_at = now + MEMORY_TTL_MS;
      }
      return Promise.resolve();
    },
    forgetNpcMemory: (pid, npcId) => {
      const before = this.memoryRows.length;
      for (let i = this.memoryRows.length - 1; i >= 0; i--) {
        const m = this.memoryRows[i] as MemoryRow;
        if (m.profile_id === pid && (npcId === null || m.npc_id === npcId)) this.memoryRows.splice(i, 1);
      }
      let relationships = 0;
      for (const [k, r] of [...this.relationshipRows]) {
        if (r.profile_id === pid && (npcId === null || r.npc_id === npcId)) {
          this.relationshipRows.delete(k);
          relationships++;
        }
      }
      return Promise.resolve({ memories: before - this.memoryRows.length, relationships });
    },
  };

  readonly ledger: LedgerStore = {
    append: (rows) => {
      let added = 0;
      for (const row of rows) {
        const env = row.env === '' ? (this.options.env ?? 'test') : row.env;
        if (row.jobId !== undefined) {
          const id = `${env}\u0000${row.jobId}`;
          if (this.ledgerKeys.has(id)) continue;
          this.ledgerKeys.add(id);
        }
        this.ledgerEvents.push({ ...row, env });
        added++;
      }
      return Promise.resolve(added);
    },
    sumUsdMicros: (vendor: Vendor, sinceMs: number) =>
      Promise.resolve(this.ledgerEvents.reduce((sum, r) => (r.vendor === vendor && r.ts >= sinceMs ? sum + r.usdMicros : sum), 0)),
  };
}
