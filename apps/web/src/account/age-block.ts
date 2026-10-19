/**
 * The device-level under-18 flag (10-ui-pages.md section 2.4 rule 4): IndexedDB `dv-ui`, key `ageBlocked`, mirrored in
 * localStorage `dv-ui-ageBlocked`. Every access is in try/catch; clearing site data bypasses it, which is accepted.
 */

export const AGE_BLOCK_DB = 'dv-ui';
export const AGE_BLOCK_STORE = 'kv';
export const AGE_BLOCK_KEY = 'ageBlocked';
export const AGE_BLOCK_LOCAL_KEY = 'dv-ui-ageBlocked';

export interface AgeBlockStore {
  isBlocked(): Promise<boolean>;
  block(): Promise<void>;
}

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(AGE_BLOCK_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(AGE_BLOCK_STORE)) req.result.createObjectStore(AGE_BLOCK_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb open failed'));
  });
}

async function idbRead(idb: IDBFactory): Promise<boolean> {
  const db = await openDb(idb);
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const get = db.transaction(AGE_BLOCK_STORE, 'readonly').objectStore(AGE_BLOCK_STORE).get(AGE_BLOCK_KEY);
      get.onsuccess = () => resolve(get.result === true);
      get.onerror = () => reject(get.error ?? new Error('idb read failed'));
    });
  } finally {
    db.close();
  }
}

async function idbWrite(idb: IDBFactory): Promise<void> {
  const db = await openDb(idb);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(AGE_BLOCK_STORE, 'readwrite');
      tx.objectStore(AGE_BLOCK_STORE).put(true, AGE_BLOCK_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('idb write failed'));
    });
  } finally {
    db.close();
  }
}

export function createAgeBlockStore(storage: Pick<Storage, 'getItem' | 'setItem'> | null, idb: IDBFactory | null): AgeBlockStore {
  return {
    async isBlocked() {
      try {
        if (storage?.getItem(AGE_BLOCK_LOCAL_KEY) === '1') return true;
      } catch {
        /* blocked storage */
      }
      try {
        if (idb && (await idbRead(idb))) return true;
      } catch {
        /* blocked or unavailable */
      }
      return false;
    },
    async block() {
      try {
        storage?.setItem(AGE_BLOCK_LOCAL_KEY, '1');
      } catch {
        /* blocked storage */
      }
      try {
        if (idb) await idbWrite(idb);
      } catch {
        /* blocked or unavailable */
      }
    },
  };
}

/** The browser's stores; each global is read inside try/catch because the accessors can throw. */
export function browserAgeBlockStore(): AgeBlockStore {
  let storage: Storage | null = null;
  let idb: IDBFactory | null = null;
  try {
    storage = localStorage;
  } catch {
    storage = null;
  }
  try {
    idb = indexedDB;
  } catch {
    idb = null;
  }
  return createAgeBlockStore(storage, idb);
}
