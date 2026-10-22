// C12 1.1 DataPort (spec/domains/09-backend-contracts.md section 2.6), M05d.
// `DataPort` and `Ctx` are copied from the contract. The store interfaces (UgcStore ... RosterStore) are filled in by the
// "one method per route" rule of the same section; the members whose tables land later throw NotImplementedError('<milestone>')
// in both implementations (InMemoryDataPort here, services/edge/src/data/supabase/* on the Worker).
// Types only, plus NotImplementedError and the `later` helper. No IO.
import type { SpendEvent, Vendor } from './api/budget.ts';
import type { KillReq, RosterFlags } from './api/v1.ts';
import type { SlotId, SliceKind } from './contracts/c05-save.ts';
import type { MemoryHit, MemoryWrite, SummaryPatch } from './contracts/c10-npc.ts';
import type { Database } from './db.gen.ts';
import type { ProviderId, StaffScope, Tier } from './identity.ts';

/** Thrown by a DataPort member whose table lands in a later milestone. `milestone` names it. */
export class NotImplementedError extends Error {
  readonly milestone: string;
  constructor(milestone: string) {
    super(`not implemented: lands in ${milestone}`);
    this.name = 'NotImplementedError';
    this.milestone = milestone;
  }
}

// ---- Row types: generated from the database (db.gen.ts), with timestamptz columns as epoch ms at the port boundary ----

type PublicTables = Database['public']['Tables'];
/** A generated row with the named timestamptz columns converted from ISO strings to epoch ms (nullable columns stay nullable). */
export type MsRow<T, K extends keyof T> = { [P in keyof T]: P extends K ? (null extends T[P] ? number | null : number) : T[P] };

export type ProfileRow = MsRow<PublicTables['profiles']['Row'], 'created_at' | 'registered_at' | 'last_seen_at' | 'deleted_at'>;
/** One row of `cutscenes` (the record of a generated cutscene). `endpoint_updated_at` is the registry's own text stamp, not a timestamptz. */
export type CutsceneRow = MsRow<PublicTables['cutscenes']['Row'], 'created_at' | 'ready_at'>;
/** One row of `cutscene_catalog`. */
export type CatalogRow = MsRow<PublicTables['cutscene_catalog']['Row'], 'added_at'>;
/** The part of a catalog row the sync writes; `added_at` is set by the database. */
export type CatalogInput = Omit<CatalogRow, 'added_at'>;
export type { Database, Json } from './db.gen.ts';

export interface Ctx {
  profileId: string | null;
  tier: Tier;
  jwt?: string;
  requestId: string;
  staff?: StaffScope[];
}

// ---- Types owned by later milestones. They are declared here only so DataPort reads as the contract does; the owner widens them. ----

/** C12 section 2.5; the payload is opaque to S09. */
export interface CloudSaveRecord {
  saveProfileId: string;
  slot: SlotId;
  kind: SliceKind;
  schema: number;
  version: number;
  updatedAt: number;
  sha256: string;
  bytes: number;
  data?: unknown;
  blobUrl?: string;
  deletedAt?: number;
}
export interface SaveProfileUpsert {
  name: string;
  createdAt: number;
}
export interface SaveSyncRes {
  profiles: { id: string; name: string; createdAt: number; updatedAt: number; deletedAt?: number }[];
  records: CloudSaveRecord[];
  cursor: string;
}
export type SaveKey = { saveProfileId: string; slot: SlotId };
/** Owner M12c (S06 and S08 validators); opaque until then. */
export type ProgressDelta = Record<string, unknown>;
export type ScoreRow = Record<string, unknown>;
export type ScoreSubmit = Record<string, unknown>;
/** One row of `npc_relationship` (C10 relationship record), M06a1. */
export type RelationshipRow = MsRow<PublicTables['npc_relationship']['Row'], 'last_seen_at'>;
/** One row of `roster_flag` (the kill-switch state of one NPC), M06a1. */
export type RosterFlagRow = MsRow<PublicTables['roster_flag']['Row'], 'set_at'>;
/** One row of `encounter_transcripts` (the index of a transcript object in PRIVATE), M06a1. */
export type TranscriptRow = MsRow<PublicTables['encounter_transcripts']['Row'], 'closed_at' | 'expires_at'>;

// ---- Store interfaces: one method per route of section 2.4. Argument and result shapes are widened by the owner milestone. ----

/** Routes 10 (device code), M13c1. */
export interface DeviceCodeStore {
  create(ctx: Ctx | null, req: unknown): Promise<unknown>;
  poll(deviceCode: string): Promise<unknown>;
  approve(ctx: Ctx, userCode: string): Promise<unknown>;
}
/** C12 section 2.5 (route 34); declared here until a milestone that serves the route moves them to api/v1.ts. */
export interface UploadReq {
  purpose: 'npc_image' | 'npc_backstory' | 'mod_archive' | 'experience_thumb' | 'forum_attachment' | 'save_blob';
  contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'text/markdown' | 'text/plain' | 'application/zip' | 'application/octet-stream';
  bytes: number;
}
export interface UploadRes {
  uploadId: string;
  putUrl: string;
  expiresAt: number;
  headers: { 'Content-Type': string };
}
/** Routes 34, 35, 36, 37 (uploads, mods, experiences), M13a2. */
export interface UgcStore {
  createUpload(ctx: Ctx, req: UploadReq): Promise<UploadRes>;
  commitUpload(ctx: Ctx, uploadId: string): Promise<unknown>;
  listMods(query: unknown): Promise<unknown>;
  getMod(id: string): Promise<unknown>;
  getModVersion(id: string, version: string): Promise<unknown>;
  publishModVersion(ctx: Ctx, id: string, version: unknown): Promise<unknown>;
  listExperiences(query: unknown): Promise<unknown>;
  getExperience(id: string): Promise<unknown>;
  createExperience(ctx: Ctx, experience: unknown): Promise<unknown>;
}
/** Routes 38, 39, 40, M13b1. */
export interface ForumStore {
  listThreads(query: unknown): Promise<unknown>;
  createThread(ctx: Ctx, thread: unknown): Promise<unknown>;
  listPosts(threadId: string, query: unknown): Promise<unknown>;
  createPost(ctx: Ctx, threadId: string, post: unknown): Promise<unknown>;
  vote(ctx: Ctx, vote: unknown): Promise<unknown>;
}
/** Routes 41, 43, 44, 45, M06b1. */
export interface ModerationStore {
  report(ctx: Ctx, report: unknown): Promise<unknown>;
  listCases(ctx: Ctx, query: unknown): Promise<unknown>;
  decide(ctx: Ctx, caseId: string, decision: unknown): Promise<unknown>;
  evidence(ctx: Ctx, id: string): Promise<unknown>;
  hashBank(ctx: Ctx, bank: string, entries: unknown): Promise<unknown>;
  takedowns(ctx: Ctx): Promise<unknown>;
}
/** Route 46 request as the store takes it: `standIn` is resolved by the caller. */
export type KillRequest = Required<Pick<KillReq, 'standIn'>> & Omit<KillReq, 'standIn'>;
/** Routes 30 and 46 (M06a1). `flags` reads Postgres (strongly consistent); the Worker adds the 10 s isolate cache and the KV fallback. */
export interface RosterStore {
  flags(): Promise<RosterFlags>;
  /** Marks the NPC killed for the scopes (replacing an earlier row) and returns the stored row. `ctx.profileId` is null for the ops token. */
  kill(ctx: Ctx, npcId: string, req: KillRequest): Promise<RosterFlagRow>;
}
/** One append-only audit entry (`audit_log`, hash-chained). Never holds a secret, a token or a network address. */
export interface AuditEntry {
  actor: string;
  role: string;
  action: string;
  targetKind?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}
/** Every admin write is audited (R-IP-02). Added beyond C12 section 2.6 (BD-M06a1-03). */
export interface AuditStore {
  append(entry: AuditEntry): Promise<void>;
}
/** The tables an export covers and the rows it holds: table name to rows (JSON-safe). */
export type ExportRows = Record<string, Record<string, unknown>[]>;
/**
 * Retention, forget and export operations of M06a1 (BD-M06a1-03): the Worker's crons and queue jobs run through these, not through a
 * route. Added beyond C12 section 2.6; `DataPort` itself stays as the contract has it.
 */
export interface MaintenanceStore {
  /** Inserts the `encounter_transcripts` row of a closed encounter. 'no_profile' when the profile was deleted meanwhile. */
  recordTranscript(row: TranscriptRow): Promise<'recorded' | 'no_profile'>;
  /** Rows past `expires_at` (at most `limit`). */
  expiredTranscripts(nowMs: number, limit: number): Promise<{ encounter_id: string; r2_key: string }[]>;
  deleteTranscripts(encounterIds: string[]): Promise<number>;
  /** R2 keys of every transcript of a profile. */
  transcriptKeys(profileId: string): Promise<string[]>;
  /** Deletes memories past `expires_at` and relationships with `last_seen_at` more than 180 days before `nowMs`. */
  purgeMemory(nowMs: number): Promise<{ memories: number; relationships: number }>;
  /** Profiles of tier 'local' not seen since `beforeMs` (at most `limit`). */
  stubProfiles(beforeMs: number, limit: number): Promise<string[]>;
  /** Profiles soft-deleted (`deleted_at`) before `beforeMs` that the forget job has not purged yet (at most `limit`). */
  deletedProfiles(beforeMs: number, limit: number): Promise<string[]>;
  /** Deletes the profile row; every table keyed by it cascades. True when a row existed. */
  purgeProfile(profileId: string): Promise<boolean>;
  /** Every row keyed by the profile, per table (the export job adds R2 objects). Secrets and embeddings are left out. */
  exportRows(profileId: string): Promise<ExportRows>;
}
/**
 * The GenAI ledger. It has no route (the nightly export of BudgetGovernorDO writes it), so its two methods are a Builder decision (BD-M05d-02).
 * `append` returns how many rows were new: a row whose (env, jobId) is already stored is skipped, so an export can be repeated.
 */
export interface LedgerStore {
  append(rows: SpendEvent[]): Promise<number>;
  sumUsdMicros(vendor: Vendor, sinceMs: number): Promise<number>;
}

export interface DataPort {
  profiles: {
    ensureLocal(pid: string, dkt: string): Promise<'created' | 'exists' | 'key_mismatch'>;
    upgrade(ctx: Ctx, displayName?: string): Promise<void>;
    get(ctx: Ctx): Promise<ProfileRow | null>;
    exportAll(ctx: Ctx): Promise<ReadableStream<Uint8Array>>;
    forget(ctx: Ctx): Promise<void>;
  };
  identity: {
    putRefresh(pid: string, family: string, hash: Uint8Array, exp: number): Promise<void>;
    rotateRefresh(hash: Uint8Array): Promise<{ pid: string; family: string } | 'reused' | null>;
    link(ctx: Ctx, provider: ProviderId, subject: string): Promise<'linked' | { mergeRequestId: string }>;
    deviceCode: DeviceCodeStore;
  };
  saves: {
    sync(ctx: Ctx, since?: string): Promise<SaveSyncRes>;
    putProfile(ctx: Ctx, saveProfileId: string, p: SaveProfileUpsert): Promise<void>;
    deleteProfile(ctx: Ctx, saveProfileId: string): Promise<void>;
    put(ctx: Ctx, rec: CloudSaveRecord, ifMatch: number | null): Promise<CloudSaveRecord | { conflict: CloudSaveRecord }>;
    tombstone(ctx: Ctx, id: SaveKey, ifMatch: number): Promise<void>;
  };
  progress: { commit(pid: string, key: string, delta: ProgressDelta): Promise<'applied' | 'duplicate'> };
  leaderboards: { top(board: string, n: number): Promise<ScoreRow[]>; submit(ctx: Ctx, s: ScoreSubmit): Promise<'accepted' | 'rejected'> };
  npcMemory: {
    relationship(pid: string, npcId: string): Promise<RelationshipRow | null>;
    topK(pid: string, npcId: string, q: Float32Array, gameTime: number /* C06 clock half-seconds */, k?: number): Promise<MemoryHit[]>;
    write(pid: string, npcId: string, m: MemoryWrite[]): Promise<void>;
    applySummary(pid: string, npcId: string, s: SummaryPatch): Promise<void>;
  };
  cutscenes: { record(row: CutsceneRow): Promise<void>; inCatalog(key: string): Promise<boolean> };
  ugc: UgcStore;
  forum: ForumStore;
  moderation: ModerationStore;
  ledger: LedgerStore;
  roster: RosterStore;
}

/**
 * What M05d adds beyond C12 section 2.6 (proposed to the Architect in the PR, BD-M05d-03): the write side of the cutscene catalog,
 * which the daily catalog-sync job needs. `DataPort` itself stays as the contract has it.
 */
export interface CatalogStore {
  /** Inserts rows that are new and updates rows whose fields changed; returns how many rows were written (0 on a repeat). */
  upsert(rows: CatalogInput[]): Promise<number>;
  /** Every cache key in the catalog. */
  keys(): Promise<string[]>;
}
export interface ServerDataPort extends DataPort {
  catalog: CatalogStore;
  audit: AuditStore;
  maintenance: MaintenanceStore;
}

/**
 * A store whose every method rejects with NotImplementedError(milestone). Both implementations use it for the members that land
 * later, so the two stay identical until the owner milestone replaces the member in each.
 */
export function rejectLater(milestone: string): <A extends unknown[]>(...args: A) => Promise<never> {
  return () => Promise.reject(new NotImplementedError(milestone));
}

/** `rejectLater` for a whole store object. */
export function later<T extends object>(milestone: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return (): Promise<never> => Promise.reject(new NotImplementedError(milestone));
    },
  });
}
