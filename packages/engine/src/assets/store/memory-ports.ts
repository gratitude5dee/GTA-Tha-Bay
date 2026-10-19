import type { FileStore, IndexStore, PackRow } from './ports.ts';

function quotaError(): Error {
  const e = new Error('QuotaExceededError');
  e.name = 'QuotaExceededError';
  return e;
}

/** In-memory `FileStore`: the unit-test port and the body of the 48 MB memory fallback. */
export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, Uint8Array>();
  /** Test hook: free bytes before `write` throws `QuotaExceededError`; null means unlimited. */
  limitBytes: number | null = null;

  open(): Promise<void> {
    return Promise.resolve();
  }
  write(hash: string, bytes: Uint8Array): Promise<void> {
    if (this.limitBytes !== null) {
      let used = 0;
      for (const [k, v] of this.files) if (k !== hash) used += v.byteLength;
      if (used + bytes.byteLength > this.limitBytes) return Promise.reject(quotaError());
    }
    this.files.set(hash, bytes.slice());
    return Promise.resolve();
  }
  read(hash: string): Promise<Uint8Array | null> {
    const f = this.files.get(hash);
    return Promise.resolve(f ? f.slice() : null);
  }
  size(hash: string): Promise<number | null> {
    return Promise.resolve(this.files.get(hash)?.byteLength ?? null);
  }
  remove(hash: string): Promise<void> {
    this.files.delete(hash);
    return Promise.resolve();
  }
  list(): Promise<string[]> {
    return Promise.resolve([...this.files.keys()]);
  }
  clear(): Promise<void> {
    this.files.clear();
    return Promise.resolve();
  }
}

/** In-memory `IndexStore`. */
export class MemoryIndexStore implements IndexStore {
  readonly rows = new Map<string, PackRow>();
  /** Test hook: the next `put` rejects, which models a crash between the file flush and the row write. */
  crashNextPut = false;

  open(): Promise<void> {
    return Promise.resolve();
  }
  get(hash: string): Promise<PackRow | null> {
    const r = this.rows.get(hash);
    return Promise.resolve(r ? { ...r, tags: [...r.tags] } : null);
  }
  put(row: PackRow): Promise<void> {
    if (this.crashNextPut) {
      this.crashNextPut = false;
      return Promise.reject(new Error('crash before the row write'));
    }
    this.rows.set(row.sha256, { ...row, tags: [...row.tags] });
    return Promise.resolve();
  }
  delete(hash: string): Promise<void> {
    this.rows.delete(hash);
    return Promise.resolve();
  }
  all(): Promise<PackRow[]> {
    return Promise.resolve([...this.rows.values()].map((r) => ({ ...r, tags: [...r.tags] })));
  }
  clear(): Promise<void> {
    this.rows.clear();
    return Promise.resolve();
  }
}
