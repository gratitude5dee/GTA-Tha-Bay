import {
  SAVE_LIMITS,
  type CoreSlice,
  type JsonObject,
  type LastSaveStatus,
  type ProfileId,
  type ProfileMeta,
  type ProfileSettings,
  type SandboxSlice,
  type SaveGame,
  type SaveReason,
  type SaveRecord,
  type SaveResult,
  type SaveService,
  type SlotId,
  type StorySlice,
  type Tombstone,
} from '@dv/shared';
import { changesSince as feed } from './changes.ts';
import { canWrite, isSlotId, type SaveCapability } from './capability.ts';
import { fail, SaveKilled, type SaveCtx, type WriteStep } from './context.ts';
import { defaultCore, defaultSettings } from './defaults.ts';
import { buildExport, exportBlob, importAsNew, importReplace, parseImport, undoImport, type ImportOutcome } from './export-import.ts';
import { IdbStore, openSaveDb } from './idb.ts';
import { intactRecord, loadAll, sweepOrphans, type LoadedSlot } from './load.ts';
import { MemoryStore } from './memory-store.ts';
import { DEFAULT_MIGRATIONS, type MigrationRegistry } from './migrate.ts';
import { Session, type ReadOnlyReason } from './multitab.ts';
import { newProfile, nameTaken, normalizeName, randomHex32 } from './profiles.ts';
import { SaveStoreError, type SaveStore } from './store.ts';
import { markSynced, purge, writeTombstone } from './tombstones.ts';
import { writeSlot } from './write.ts';

export interface SaveServiceOptions {
  /** Use this store (tests share one MemoryStore between services to model two tabs). */
  store?: SaveStore;
  /** IndexedDB factory; default `globalThis.indexedDB`. `null` forces the in-memory store. */
  indexedDB?: IDBFactory | null;
  capability?: SaveCapability;
  buildId?: string;
  worldBake?: string;
  now?: () => number;
  random?: (n: number) => Uint8Array;
  migrations?: MigrationRegistry;
  /** Fault injection (tests): called after each step of C05 rule 1; throw SaveKilled to model a killed tab. */
  onStep?: (s: WriteStep) => void | Promise<void>;
  /** Seconds of play to stamp on records and the profile. Default: the profile's stored value. */
  playtimeSec?: () => number;
}

export interface SlotInfo {
  gen: number;
  savedAt: number;
  bytes: number;
  checksum: string;
  /** False when the pointer's record is unreadable and an older generation was used. */
  fellBack: boolean;
}

const STORY_KEYS = ['auto', '1', '2', '3'] as const;

/** C05 SaveService (1.1). Runs in sim.worker on IndexedDB `dv-saves`; falls back to memory when IndexedDB is unavailable. */
export class SaveServiceImpl implements SaveService {
  /** Result of the latest `importProfile`: the profile written and the slots taken or left out by tombstones. */
  lastImport: { profileId: ProfileId; imported: SlotId[]; skipped: SlotId[] } | null = null;

  private session: Session | null = null;
  private cap: SaveCapability;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(p: ProfileId, s: LastSaveStatus) => void>();
  private readonly random: (n: number) => Uint8Array;
  private lastStamp = 0;

  private constructor(
    private readonly store: SaveStore,
    private readonly ctx: SaveCtx,
    private readonly opts: SaveServiceOptions,
    random: (n: number) => Uint8Array,
  ) {
    this.cap = opts.capability ?? 'story';
    this.random = random;
  }

  /** Opens the database, sweeps orphans and expired synced tombstones. Never rejects: IndexedDB errors select the memory store. */
  static async open(opts: SaveServiceOptions = {}): Promise<SaveServiceImpl> {
    const random = opts.random ?? ((n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n)));
    const now = opts.now ?? ((): number => Date.now());
    const build = async (store: SaveStore): Promise<SaveServiceImpl> => {
      let deviceId = await store.getMeta<string>('deviceId');
      if (!deviceId) {
        deviceId = randomHex32(random);
        await store.setMeta('deviceId', deviceId);
      }
      const holder: { svc: SaveServiceImpl | null } = { svc: null };
      const ctx: SaveCtx = {
        store,
        deviceId,
        buildId: opts.buildId ?? 'dev',
        worldBake: opts.worldBake ?? 'none',
        migrations: opts.migrations ?? DEFAULT_MIGRATIONS,
        stamp: () => holder.svc?.stamp() ?? now(),
        step: opts.onStep ?? null,
      };
      const svc = new SaveServiceImpl(store, ctx, opts, random);
      holder.svc = svc;
      svc.nowFn = now;
      for (const p of await store.listProfiles()) {
        await sweepOrphans(ctx, p.id);
        await purge(ctx, p.id, now());
      }
      return svc;
    };
    if (opts.store) return build(opts.store);
    const factory = opts.indexedDB === undefined ? (globalThis as { indexedDB?: IDBFactory }).indexedDB : opts.indexedDB;
    if (factory) {
      try {
        return await build(new IdbStore(await openSaveDb(factory)));
      } catch {
        // IDB_UNAVAILABLE: continue on memory below.
      }
    }
    return build(new MemoryStore());
  }

  private nowFn: () => number = () => Date.now();
  private stamp(): number {
    this.lastStamp = Math.max(this.nowFn(), this.lastStamp + 1);
    return this.lastStamp;
  }

  /** False on the in-memory fallback (the S10 banner "progress is not saved"). */
  get persistent(): boolean {
    return this.store.persistent;
  }
  get readOnly(): ReadOnlyReason | null {
    return this.session?.readOnly ?? null;
  }
  get activeProfile(): ProfileId | null {
    return this.session?.profileId ?? null;
  }
  get capability(): SaveCapability {
    return this.cap;
  }
  setCapability(cap: SaveCapability): void {
    this.cap = cap;
  }
  get deviceId(): string {
    return this.ctx.deviceId;
  }
  close(): void {
    this.store.close();
  }

  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  private mapError(e: unknown): SaveResult {
    if (e instanceof SaveKilled) throw e;
    if (e instanceof SaveStoreError && e.quota) return fail('QUOTA', e.message);
    return fail('IDB_UNAVAILABLE', e instanceof Error ? e.message : String(e));
  }

  private emit(profileId: ProfileId, s: LastSaveStatus): void {
    for (const cb of [...this.listeners]) cb(profileId, s);
  }

  onStatus(cb: (p: ProfileId, s: LastSaveStatus) => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  // Profiles (rule 7).

  listProfiles(): Promise<ProfileMeta[]> {
    return this.store.listProfiles().then((l) => l.sort((a, b) => a.createdAt - b.createdAt));
  }

  createProfile(name: string): Promise<ProfileMeta | SaveResult> {
    return this.mutate(async () => {
      try {
        const n = normalizeName(name);
        if (n === null) return fail('INVALID', 'a name has 1 to 80 characters');
        const profiles = await this.store.listProfiles();
        if (profiles.length >= SAVE_LIMITS.maxProfiles) return fail('PROFILE_LIMIT');
        if (nameTaken(profiles, n)) return fail('NAME_TAKEN');
        const meta = newProfile(randomHex32(this.random) as ProfileId, n, this.ctx.deviceId, this.stamp());
        await this.store.putProfile(meta);
        return meta;
      } catch (e) {
        return this.mapError(e);
      }
    });
  }

  renameProfile(id: ProfileId, name: string): Promise<SaveResult> {
    return this.mutate(async () => {
      try {
        const n = normalizeName(name);
        if (n === null) return fail('INVALID', 'a name has 1 to 80 characters');
        const profiles = await this.store.listProfiles();
        const cur = profiles.find((p) => p.id === id);
        if (!cur) return fail('INVALID', 'no such profile');
        if (nameTaken(profiles, n, id)) return fail('NAME_TAKEN');
        await this.store.putProfile({ ...cur, name: n, updatedAt: this.stamp() });
        return { ok: true, gen: 0, bytes: 0 };
      } catch (e) {
        return this.mapError(e);
      }
    });
  }

  deleteProfile(id: ProfileId): Promise<SaveResult> {
    return this.mutate(async () => {
      try {
        const cur = await this.store.getProfile(id);
        if (!cur) return fail('INVALID', 'no such profile');
        let gen = 0;
        for (const p of await this.store.listPointers(id)) gen = Math.max(gen, p.gen);
        await writeTombstone(this.ctx, id, '*', gen); // first: a crash after this still ends with the profile deleted
        await this.store.deleteProfileData(id);
        if (this.session?.profileId === id) this.session = null;
        return { ok: true, gen, bytes: 0 };
      } catch (e) {
        return this.mapError(e);
      }
    });
  }

  // Load (rules 2 and 5).

  async load(id: ProfileId): Promise<SaveGame> {
    const profile = await this.store.getProfile(id);
    if (!profile) throw new Error(`save: no profile ${id}`);
    const pointers = await this.store.listPointers(id);
    const loaded = await loadAll(this.ctx, id);
    const sess = new Session(id);
    for (const p of pointers) sess.seen.set(p.slot, p.gen);
    if (loaded.some((l) => l.newer)) sess.trip('newer-schema');
    this.session = sess;
    const bad = loaded.find((l) => l.error !== undefined);
    let meta = profile;
    if (bad?.error) {
      const status: LastSaveStatus = { slot: bad.slot, at: this.stamp(), ok: false, error: bad.error, reason: profile.lastSave?.reason ?? 'manual' };
      meta = { ...profile, lastSave: status };
      try {
        await this.store.putProfile(meta); // the profile row only; records are never touched while reading
      } catch {
        // A read-only environment still returns the loaded game.
      }
      this.emit(id, status);
    }
    return this.assemble(meta, loaded);
  }

  private assemble(profile: ProfileMeta, loaded: LoadedSlot[]): SaveGame {
    const by = new Map<SlotId, LoadedSlot>(loaded.map((l) => [l.slot, l]));
    const data = (slot: SlotId): JsonObject | null => by.get(slot)?.data ?? null;
    const story: SaveGame['story'] = {};
    for (const k of STORY_KEYS) {
      const d = data(`story:${k}`);
      if (d) story[k] = d as unknown as StorySlice;
    }
    const mods: Record<string, JsonObject> = {};
    for (const l of loaded) if (l.slot.startsWith('mod:') && l.data) mods[l.slot.slice(4)] = l.data;
    return {
      version: 1,
      profile,
      core: (data('core') as unknown as CoreSlice | null) ?? defaultCore(),
      settings: (data('settings') as unknown as ProfileSettings | null) ?? defaultSettings(),
      story,
      sandbox: data('sandbox') as unknown as SandboxSlice | null,
      modes: { racing: data('mode:racing'), fighter: data('mode:fighter'), tycoon: data('mode:tycoon') },
      mods,
    };
  }

  /** Generation, checksum and size of the slot's current readable record (for the status line and QA). */
  async describeSlot(id: ProfileId, slot: SlotId): Promise<SlotInfo | null> {
    const ptr = await this.store.getPointer(id, slot);
    if (!ptr) return null;
    const found = await intactRecord(this.ctx, ptr);
    if (!found) return null;
    const { rec } = found;
    return { gen: rec.gen, savedAt: rec.savedAt, bytes: rec.bytes, checksum: rec.checksum, fellBack: found.fellBack };
  }

  // Write (rules 1 and 3).

  write(slot: SlotId, data: unknown, reason: SaveReason): Promise<SaveResult> {
    return this.mutate(async () => {
      if (typeof slot !== 'string' || !isSlotId(slot)) return fail('INVALID', 'unknown slot');
      const sess = this.session;
      if (!sess) return fail('NOT_ALLOWED', 'no profile is loaded');
      if (!canWrite(this.cap, slot)) return fail('NOT_ALLOWED', `${this.cap} may not write ${slot}`);
      if (sess.readOnly) return fail(sess.readOnly === 'newer-schema' ? 'NEWER_SCHEMA' : 'CONFLICT', 'this session is read-only');
      let result: SaveResult;
      try {
        const profile = await this.store.getProfile(sess.profileId);
        if (!profile) return fail('INVALID', 'the profile was deleted');
        result = await writeSlot(this.ctx, sess, slot, data, this.opts.playtimeSec?.() ?? profile.playtimeSec);
        if (result.ok) {
          const status: LastSaveStatus = { slot, at: this.lastStamp, ok: true, reason };
          await this.store.putProfile({
            ...profile,
            updatedAt: this.lastStamp,
            playtimeSec: this.opts.playtimeSec?.() ?? profile.playtimeSec,
            lastSave: status,
          });
          this.emit(sess.profileId, status);
          return result;
        }
      } catch (e) {
        result = this.mapError(e);
      }
      if (!result.ok) {
        if (result.error === 'CONFLICT') sess.trip('conflict');
        this.emit(sess.profileId, { slot, at: this.stamp(), ok: false, error: result.error, reason });
      }
      return result;
    });
  }

  // Tombstones (rule 6).

  deleteSlot(id: ProfileId, slot: SlotId): Promise<SaveResult> {
    return this.mutate(async () => {
      if (!isSlotId(slot)) return fail('INVALID', 'unknown slot');
      if (!canWrite(this.cap, slot)) return fail('NOT_ALLOWED', `${this.cap} may not delete ${slot}`);
      const sess = this.session;
      if (sess?.profileId === id && sess.readOnly) return fail(sess.readOnly === 'newer-schema' ? 'NEWER_SCHEMA' : 'CONFLICT', 'this session is read-only');
      try {
        const ptr = await this.store.getPointer(id, slot);
        const gen = ptr?.gen ?? 0;
        await writeTombstone(this.ctx, id, slot, gen);
        await this.store.deletePointer(id, slot);
        for (const r of await this.store.listRecords(id)) if (r.slot === slot) await this.store.deleteRecord(id, slot, r.gen);
        if (sess?.profileId === id) sess.seen.set(slot, 0);
        return { ok: true, gen, bytes: 0 };
      } catch (e) {
        return this.mapError(e);
      }
    });
  }

  /** S09 reports every tombstone with `deletedAt <= upTo` as synced; only those may be purged after 180 days. */
  markTombstonesSynced(id: ProfileId, upTo: number): Promise<void> {
    return markSynced(this.ctx, id, upTo);
  }
  purgeTombstones(id: ProfileId, nowMs: number = this.nowFn()): Promise<number> {
    return purge(this.ctx, id, nowMs);
  }
  listTombstones(id: ProfileId): Promise<Tombstone[]> {
    return this.store.listTombstones(id);
  }

  // Export and import (rule 8).

  async exportProfile(id: ProfileId): Promise<Blob> {
    const profile = await this.store.getProfile(id);
    if (!profile) throw new Error(`save: no profile ${id}`);
    return exportBlob(await buildExport(this.ctx, profile));
  }

  importProfile(b: Blob, mode: 'asNew' | 'replace', into?: ProfileId): Promise<SaveResult> {
    return this.mutate(async () => {
      try {
        const sess = this.session;
        if (mode === 'replace' && sess && sess.profileId === into && sess.readOnly) {
          return fail(sess.readOnly === 'newer-schema' ? 'NEWER_SCHEMA' : 'CONFLICT', 'this session is read-only');
        }
        const parsed = await parseImport(this.ctx, b);
        if (!parsed.ok) return parsed.result;
        let out: ImportOutcome;
        if (mode === 'asNew') out = await importAsNew(this.ctx, parsed.file, this.random);
        else if (!into) return fail('INVALID', 'replace needs a target profile');
        else out = await importReplace(this.ctx, parsed.file, into);
        if (out.result.ok && out.profileId) {
          this.lastImport = { profileId: out.profileId, imported: out.imported, skipped: out.skipped };
          if (mode === 'replace' && sess?.profileId === out.profileId) {
            for (const p of await this.store.listPointers(out.profileId)) sess.seen.set(p.slot, p.gen);
          }
        }
        return out.result;
      } catch (e) {
        return this.mapError(e);
      }
    });
  }

  undoImport(id: ProfileId): Promise<SaveResult> {
    return this.mutate(async () => {
      try {
        const { result } = await undoImport(this.ctx, id);
        const sess = this.session;
        if (result.ok && sess?.profileId === id) {
          sess.seen.clear();
          for (const p of await this.store.listPointers(id)) sess.seen.set(p.slot, p.gen);
        }
        return result;
      } catch (e) {
        return this.mapError(e);
      }
    });
  }

  // Cloud sync feed.

  changesSince(id: ProfileId, cursor: number): Promise<{ records: SaveRecord[]; tombstones: Tombstone[]; cursor: number }> {
    return feed(this.ctx, id, cursor);
  }
}
