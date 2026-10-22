// InMemoryDataPort (M05d): the DataPort for tests and for a Worker with no database configured. It implements the same
// semantics as services/edge/src/data/supabase/* for the members that exist now, and rejects with NotImplementedError(<milestone>)
// for the members whose tables land later. No IO, no clock of its own: time comes from the `now` option.
import type { SpendEvent, Vendor } from './api/budget.ts';
import {
  later,
  rejectLater,
  type CatalogInput,
  type CatalogRow,
  type CatalogStore,
  type CutsceneRow,
  type DataPort,
  type DeviceCodeStore,
  type ForumStore,
  type LedgerStore,
  type ModerationStore,
  type ProfileRow,
  type RosterStore,
  type ServerDataPort,
  type UgcStore,
} from './data-port.ts';

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
    exportAll: rejectLater('M06a1'),
    forget: rejectLater('M06a1'),
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
    relationship: rejectLater('M06a1'),
    topK: rejectLater('M06a1'),
    write: rejectLater('M06a1'),
    applySummary: rejectLater('M06a1'),
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
  readonly moderation: ModerationStore = later<ModerationStore>('M06b1');
  readonly roster: RosterStore = later<RosterStore>('M06a1');

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
