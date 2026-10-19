import type { IndexStore, PackRow } from './ports.ts';

/** IDB `dv-packs`, object store `packs`, keyed by `sha256` (11-platform-pwa.md section 5). */
export const PACKS_DB = 'dv-packs';
export const PACKS_STORE = 'packs';

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class IdbIndexStore implements IndexStore {
  private db: IDBDatabase | null = null;
  private readonly factory: IDBFactory | undefined;

  constructor(factory?: IDBFactory) {
    this.factory = factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  }

  async open(): Promise<void> {
    const f = this.factory;
    if (!f) throw new Error('IndexedDB is not available');
    const req = f.open(PACKS_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(PACKS_STORE)) req.result.createObjectStore(PACKS_STORE, { keyPath: 'sha256' });
    };
    this.db = await wrap(req);
    // Another context asking for a newer schema must not be blocked by this one.
    this.db.onversionchange = () => this.db?.close();
  }

  private store(mode: IDBTransactionMode): { tx: IDBTransaction; os: IDBObjectStore } {
    if (!this.db) throw new Error('IndexedDB store is not open');
    const tx = this.db.transaction(PACKS_STORE, mode);
    return { tx, os: tx.objectStore(PACKS_STORE) };
  }

  async get(hash: string): Promise<PackRow | null> {
    const { os } = this.store('readonly');
    const row = (await wrap(os.get(hash))) as PackRow | undefined;
    return row ?? null;
  }

  async put(row: PackRow): Promise<void> {
    const { tx, os } = this.store('readwrite');
    os.put(row);
    await done(tx);
  }

  async delete(hash: string): Promise<void> {
    const { tx, os } = this.store('readwrite');
    os.delete(hash);
    await done(tx);
  }

  async all(): Promise<PackRow[]> {
    const { os } = this.store('readonly');
    return (await wrap(os.getAll())) as PackRow[];
  }

  async clear(): Promise<void> {
    const { tx, os } = this.store('readwrite');
    os.clear();
    await done(tx);
  }
}
