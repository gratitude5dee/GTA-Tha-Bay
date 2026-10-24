import type { AgeBracket } from '@dv/shared';
import type { EcPublicJwk } from './thumbprint.ts';

export const DB_NAME = 'dv-identity';
export const STORE_NAME = 'identity';
export const RECORD_KEY = 'current';

/** The single record in `dv-identity` / `identity` / `current` (DL-075). The private key is a non-extractable CryptoKey. */
export interface StoredIdentity {
  v: 1;
  profileId: string;
  privateKey: CryptoKey;
  publicJwk: EcPublicJwk;
  thumbprint: string;
  ageBracket: AgeBracket | null;
  createdAt: number;
}

/** Storage behind `LocalIdentity`. Tests can swap in `memoryStore()`. */
export interface IdentityStore {
  load(): Promise<StoredIdentity | null>;
  save(record: StoredIdentity): Promise<void>;
  clear(): Promise<void>;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexeddb request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexeddb transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexeddb transaction aborted'));
  });
}

export function idbStore(factory: IDBFactory = indexedDB): IdentityStore {
  let opened: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexeddb open failed'));
      req.onblocked = () => reject(new Error('indexeddb open blocked'));
    }));
  return {
    async load() {
      const db = await open();
      const rec = (await request(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(RECORD_KEY))) as StoredIdentity | undefined;
      return rec ?? null;
    },
    async save(record) {
      const db = await open();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
      await done(tx);
    },
    async clear() {
      const db = await open();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(RECORD_KEY);
      await done(tx);
      db.close();
      opened = null;
      await new Promise<void>((resolve) => {
        const req = factory.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    },
  };
}

/** In-memory store for tests and for engines that cannot persist a CryptoKey. */
export function memoryStore(): IdentityStore {
  let rec: StoredIdentity | null = null;
  return {
    load: () => Promise.resolve(rec),
    save: (r) => {
      rec = r;
      return Promise.resolve();
    },
    clear: () => {
      rec = null;
      return Promise.resolve();
    },
  };
}
