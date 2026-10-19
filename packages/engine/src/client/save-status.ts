import type { LastSaveStatus, ProfileId, ProfileMeta, SaveReason, SlotId } from '@dv/shared';
import { recordIsIntact } from '../sim/save/canonical.ts';
import { IdbStore, openSaveDbIfExists } from '../sim/save/idb.ts';

/** The main thread's read-only view of the last save of a profile (C05 "the main thread opens the same DB read-only"). */
export interface LastSaveInfo {
  status: LastSaveStatus;
  /** Generation and checksum of the slot's record at the pointer; what the status line points at. */
  gen: number;
  checksum: string;
}

/**
 * Reads the status line for the home screen without writing anything and without creating the database: the newest
 * pointer of the profile, its record verified against its checksum. Derived from pointers rather than from the stored
 * `ProfileMeta.lastSave`, so a tab killed between the pointer move and the profile update still shows the true state.
 * Resolves null when IndexedDB is unavailable, the database does not exist, or the profile has no save.
 */
export async function readLastSave(profileId: ProfileId, factory: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB): Promise<LastSaveInfo | null> {
  if (!factory) return null;
  const db = await openSaveDbIfExists(factory);
  if (!db) return null;
  const store = new IdbStore(db);
  try {
    const profile = await store.getProfile(profileId);
    if (!profile) return null;
    const pointers = await store.listPointers(profileId);
    pointers.sort((a, b) => b.savedAt - a.savedAt);
    for (const ptr of pointers) {
      const rec = await store.getRecord(profileId, ptr.slot, ptr.gen);
      if (rec && recordIsIntact(rec)) {
        return { status: statusFor(profile, ptr.slot, rec.savedAt), gen: rec.gen, checksum: rec.checksum };
      }
      // The newest pointer is unreadable: report it as a checksum problem, as the loader will (it falls back).
      const prev = await store.getRecord(profileId, ptr.slot, ptr.gen - 1);
      if (prev && recordIsIntact(prev)) {
        return { status: { ...statusFor(profile, ptr.slot, prev.savedAt), ok: false, error: 'CHECKSUM' }, gen: prev.gen, checksum: prev.checksum };
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    store.close();
  }
}

/** Profiles for the home screen, read-only. Empty when the database does not exist. */
export async function readProfiles(factory: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB): Promise<ProfileMeta[]> {
  if (!factory) return [];
  const db = await openSaveDbIfExists(factory);
  if (!db) return [];
  const store = new IdbStore(db);
  try {
    return (await store.listProfiles()).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  } finally {
    store.close();
  }
}

function statusFor(profile: ProfileMeta, slot: SlotId, at: number): LastSaveStatus {
  const reason: SaveReason = profile.lastSave?.reason ?? 'manual';
  return { slot, at, ok: true, reason };
}
