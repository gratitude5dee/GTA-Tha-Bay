import type { ProfileId, ProfileMeta, SaveRecord, SlotId, SlotPointer, Tombstone } from '@dv/shared';
import { recordIsIntact } from './canonical.ts';

/**
 * The storage seam under SaveService. Two implementations: IndexedDB `dv-saves` (idb.ts) and the in-memory store used
 * when IndexedDB is unavailable (memory-store.ts). Every method is one transaction.
 */
export interface SaveStore {
  readonly persistent: boolean;
  listProfiles(): Promise<ProfileMeta[]>;
  getProfile(id: ProfileId): Promise<ProfileMeta | null>;
  putProfile(meta: ProfileMeta): Promise<void>;
  /** Removes the profile row, its records and pointers. Tombstones stay: they are the sync unit for the deletion. */
  deleteProfileData(id: ProfileId): Promise<void>;

  /** Adds a record; false when a record with the same (profileId, slot, gen) already exists (nothing is overwritten). */
  addRecord(rec: SaveRecord): Promise<boolean>;
  getRecord(profileId: ProfileId, slot: SlotId, gen: number): Promise<SaveRecord | null>;
  deleteRecord(profileId: ProfileId, slot: SlotId, gen: number): Promise<void>;
  listRecords(profileId: ProfileId): Promise<SaveRecord[]>;

  getPointer(profileId: ProfileId, slot: SlotId): Promise<SlotPointer | null>;
  listPointers(profileId: ProfileId): Promise<SlotPointer[]>;
  /** Compare-and-swap: stores `next` only if the stored pointer's gen equals `expectedGen` (0 = no pointer). */
  casPointer(next: SlotPointer, expectedGen: number): Promise<boolean>;
  /**
   * C05 rule 1 (e), one transaction: moves the slot's pointer to `rec.gen` only if the stored pointer's gen equals `expectedGen`
   * ('moved' otherwise). The record must be in the same transaction: when another service's boot sweep removed it after step (c),
   * it is put back from `rec` and read again; a stored copy that is not intact or is not `rec` returns 'corrupt' and moves nothing.
   */
  commitRecord(rec: SaveRecord, expectedGen: number): Promise<'ok' | 'moved' | 'corrupt'>;
  /**
   * C05 rule 1, the boot sweep, one transaction: deletes the profile's records that no pointer reaches (a generation above the
   * pointer, or a slot without one) and generations at or below `pointer.gen - keepGenerations`. Returns how many were deleted.
   */
  sweepOrphans(profileId: ProfileId, keepGenerations: number): Promise<number>;
  /** Unconditional (import undo and import replace). */
  setPointer(p: SlotPointer): Promise<void>;
  deletePointer(profileId: ProfileId, slot: SlotId): Promise<void>;

  addTombstone(t: Tombstone): Promise<void>;
  listTombstones(profileId: ProfileId): Promise<Tombstone[]>;
  deleteTombstone(t: Tombstone): Promise<void>;

  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  close(): void;
}

/** Thrown by stores for storage-level failures; `quota` maps to SaveErrorCode QUOTA. */
export class SaveStoreError extends Error {
  constructor(message: string, readonly quota = false) {
    super(message);
    this.name = 'SaveStoreError';
  }
}

/** The boot-sweep rule shared by the stores: true when no pointer reaches generation `gen` of `slot`. */
export function isOrphan(pointerGen: number | undefined, gen: number, keepGenerations: number): boolean {
  return pointerGen === undefined || gen > pointerGen || gen <= pointerGen - keepGenerations;
}

/** True when a stored record is intact and is the record `rec` that step (c) wrote (same checksum and size). */
export function isSameIntactRecord(stored: SaveRecord, rec: SaveRecord): boolean {
  return recordIsIntact(stored) && stored.checksum === rec.checksum && stored.bytes === rec.bytes;
}

export const tombstoneKey = (t: Tombstone): string => `${t.slot}\u0000${t.deletedAt}`;
