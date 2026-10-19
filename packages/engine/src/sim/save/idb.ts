import type { ProfileId, ProfileMeta, SaveRecord, SlotId, SlotPointer, Tombstone } from '@dv/shared';
import { SaveStoreError, type SaveStore } from './store.ts';

/** IndexedDB database name and version (C05 "IndexedDB layout"). */
export const SAVE_DB_NAME = 'dv-saves';
export const SAVE_DB_VERSION = 1;

const STORES = ['profiles', 'records', 'pointers', 'tombstones', 'conflicts', 'meta'] as const;

function wrap<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function mapError(e: unknown): Error {
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
  if (name === 'QuotaExceededError') return new SaveStoreError('storage quota exceeded', true);
  return e instanceof Error ? e : new Error(String(e));
}

/** Opens (creating it empty at v1) the `dv-saves` database. Rejects when IndexedDB is unavailable. */
export function openSaveDb(factory: IDBFactory, name = SAVE_DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(name, SAVE_DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('profiles', { keyPath: 'id' });
      db.createObjectStore('records', { keyPath: ['profileId', 'slot', 'gen'] });
      db.createObjectStore('pointers', { keyPath: ['profileId', 'slot'] });
      db.createObjectStore('tombstones', { keyPath: ['profileId', 'slot', 'deletedAt'] });
      db.createObjectStore('conflicts', { keyPath: ['profileId', 'slot', 'serverVersion'] }); // filled by M12a1
      db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

/** Opens `dv-saves` only if it already exists (no database is created). Resolves null otherwise. */
export function openSaveDbIfExists(factory: IDBFactory, name = SAVE_DB_NAME): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let created = false;
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(name);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      created = true;
      req.transaction?.abort();
    };
    req.onsuccess = () => {
      if (created) {
        req.result.close();
        resolve(null);
      } else resolve(req.result);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

const prefix = (profileId: string): IDBKeyRange => IDBKeyRange.bound([profileId], [profileId, []]);

export class IdbStore implements SaveStore {
  readonly persistent = true;
  constructor(private readonly db: IDBDatabase) {}

  private tx(stores: readonly (typeof STORES)[number][], mode: IDBTransactionMode): IDBTransaction {
    return mode === 'readwrite' ? this.db.transaction([...stores], mode, { durability: 'strict' }) : this.db.transaction([...stores], mode);
  }

  private async run<T>(stores: readonly (typeof STORES)[number][], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    try {
      const tx = this.tx(stores, mode);
      const finished = done(tx);
      finished.catch(() => undefined);
      const out = await fn(tx);
      await finished;
      return out;
    } catch (e) {
      throw mapError(e);
    }
  }

  listProfiles(): Promise<ProfileMeta[]> {
    return this.run(['profiles'], 'readonly', (tx) => wrap(tx.objectStore('profiles').getAll() as IDBRequest<ProfileMeta[]>));
  }
  async getProfile(id: ProfileId): Promise<ProfileMeta | null> {
    const r = await this.run(['profiles'], 'readonly', (tx) => wrap(tx.objectStore('profiles').get(id) as IDBRequest<ProfileMeta | undefined>));
    return r ?? null;
  }
  putProfile(meta: ProfileMeta): Promise<void> {
    return this.run(['profiles'], 'readwrite', async (tx) => void (await wrap(tx.objectStore('profiles').put(meta))));
  }
  deleteProfileData(id: ProfileId): Promise<void> {
    // Tombstones stay: they are the sync unit for the deletion (C05 rule 6).
    return this.run(['profiles', 'records', 'pointers'], 'readwrite', async (tx) => {
      await wrap(tx.objectStore('profiles').delete(id));
      await wrap(tx.objectStore('records').delete(prefix(id)));
      await wrap(tx.objectStore('pointers').delete(prefix(id)));
    });
  }

  async addRecord(rec: SaveRecord): Promise<boolean> {
    try {
      const tx = this.tx(['records'], 'readwrite');
      const finished = done(tx);
      finished.catch(() => undefined);
      const req = tx.objectStore('records').add(rec);
      const ok = await new Promise<boolean>((resolve, reject) => {
        req.onsuccess = () => resolve(true);
        req.onerror = (ev) => {
          if (req.error?.name === 'ConstraintError') {
            ev.preventDefault(); // keep the transaction alive; nothing was written
            resolve(false);
          } else reject(req.error);
        };
      });
      await finished;
      return ok;
    } catch (e) {
      throw mapError(e);
    }
  }
  async getRecord(profileId: ProfileId, slot: SlotId, gen: number): Promise<SaveRecord | null> {
    const r = await this.run(['records'], 'readonly', (tx) => wrap(tx.objectStore('records').get([profileId, slot, gen]) as IDBRequest<SaveRecord | undefined>));
    return r ?? null;
  }
  deleteRecord(profileId: ProfileId, slot: SlotId, gen: number): Promise<void> {
    return this.run(['records'], 'readwrite', async (tx) => void (await wrap(tx.objectStore('records').delete([profileId, slot, gen]))));
  }
  listRecords(profileId: ProfileId): Promise<SaveRecord[]> {
    return this.run(['records'], 'readonly', (tx) => wrap(tx.objectStore('records').getAll(prefix(profileId)) as IDBRequest<SaveRecord[]>));
  }

  async getPointer(profileId: ProfileId, slot: SlotId): Promise<SlotPointer | null> {
    const r = await this.run(['pointers'], 'readonly', (tx) => wrap(tx.objectStore('pointers').get([profileId, slot]) as IDBRequest<SlotPointer | undefined>));
    return r ?? null;
  }
  listPointers(profileId: ProfileId): Promise<SlotPointer[]> {
    return this.run(['pointers'], 'readonly', (tx) => wrap(tx.objectStore('pointers').getAll(prefix(profileId)) as IDBRequest<SlotPointer[]>));
  }
  casPointer(next: SlotPointer, expectedGen: number): Promise<boolean> {
    return this.run(['pointers'], 'readwrite', async (tx) => {
      const store = tx.objectStore('pointers');
      const cur = (await wrap(store.get([next.profileId, next.slot]) as IDBRequest<SlotPointer | undefined>)) ?? null;
      if ((cur?.gen ?? 0) !== expectedGen) return false;
      await wrap(store.put(next));
      return true;
    });
  }
  setPointer(p: SlotPointer): Promise<void> {
    return this.run(['pointers'], 'readwrite', async (tx) => void (await wrap(tx.objectStore('pointers').put(p))));
  }
  deletePointer(profileId: ProfileId, slot: SlotId): Promise<void> {
    return this.run(['pointers'], 'readwrite', async (tx) => void (await wrap(tx.objectStore('pointers').delete([profileId, slot]))));
  }

  addTombstone(t: Tombstone): Promise<void> {
    return this.run(['tombstones'], 'readwrite', async (tx) => void (await wrap(tx.objectStore('tombstones').put(t))));
  }
  listTombstones(profileId: ProfileId): Promise<Tombstone[]> {
    return this.run(['tombstones'], 'readonly', (tx) => wrap(tx.objectStore('tombstones').getAll(prefix(profileId)) as IDBRequest<Tombstone[]>));
  }
  deleteTombstone(t: Tombstone): Promise<void> {
    return this.run(['tombstones'], 'readwrite', async (tx) => void (await wrap(tx.objectStore('tombstones').delete([t.profileId, t.slot, t.deletedAt]))));
  }

  getMeta<T>(key: string): Promise<T | undefined> {
    return this.run(['meta'], 'readonly', (tx) => wrap(tx.objectStore('meta').get(key) as IDBRequest<T | undefined>));
  }
  setMeta(key: string, value: unknown): Promise<void> {
    return this.run(['meta'], 'readwrite', async (tx) => void (await wrap(tx.objectStore('meta').put(value, key))));
  }
  close(): void {
    this.db.close();
  }
}
