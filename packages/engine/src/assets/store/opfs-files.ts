import type { FileStore } from './ports.ts';

/**
 * OPFS `dv/packs/<sha256>.bin`. Used only inside `asset.worker`: `createSyncAccessHandle` exists only in dedicated workers
 * (11-platform-pwa.md section 5). A write is `truncate(0)`, `write`, `flush()`, `close()` on a short-lived handle; the caller
 * commits the IDB row afterwards. A handle that another context holds raises `NoModificationAllowedError`, which is retried
 * up to 20 times with jitter. Typed views are rebuilt after every `await`.
 */
export const SYNC_OPEN_TRIES = 20;
const SUFFIX = '.bin';

interface SyncHandle {
  truncate(size: number): void;
  write(buffer: Uint8Array, opts?: { at?: number }): number;
  flush(): void;
  close(): void;
}
type SyncCapableFile = FileSystemFileHandle & { createSyncAccessHandle?: () => Promise<SyncHandle> };
type IterableDir = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> };

export interface OpfsOptions {
  root?: () => Promise<FileSystemDirectoryHandle>;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Force the async `createWritable` path (tests and the WebKit fallback). */
  forceWritable?: boolean;
}

function errName(e: unknown): string {
  return (e as { name?: string } | null)?.name ?? '';
}

export class OpfsFileStore implements FileStore {
  private dir: FileSystemDirectoryHandle | null = null;
  private useWritable: boolean;
  private readonly o: OpfsOptions;
  /** Which write path the last write used (the bridge and the device notes report it). */
  lastWritePath: 'sync' | 'writable' | null = null;

  constructor(o: OpfsOptions = {}) {
    this.o = o;
    this.useWritable = o.forceWritable === true;
  }

  async open(): Promise<void> {
    const root = await (this.o.root ? this.o.root() : navigator.storage.getDirectory());
    const dv = await root.getDirectoryHandle('dv', { create: true });
    this.dir = await dv.getDirectoryHandle('packs', { create: true });
  }

  private d(): FileSystemDirectoryHandle {
    if (!this.dir) throw new Error('OPFS store is not open');
    return this.dir;
  }

  private async openSync(fh: SyncCapableFile): Promise<SyncHandle> {
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const random = this.o.random ?? Math.random;
    let last: unknown;
    for (let i = 0; i < SYNC_OPEN_TRIES; i++) {
      try {
        const create = fh.createSyncAccessHandle;
        if (!create) throw new TypeError('createSyncAccessHandle is not available');
        return await create.call(fh);
      } catch (e) {
        last = e;
        const n = errName(e);
        if (n !== 'NoModificationAllowedError' && n !== 'InvalidStateError') throw e;
        await sleep(5 + Math.floor(random() * 45));
      }
    }
    throw last;
  }

  async write(hash: string, bytes: Uint8Array): Promise<void> {
    const dir = this.d();
    const fh = (await dir.getFileHandle(hash + SUFFIX, { create: true })) as SyncCapableFile;
    try {
      if (!this.useWritable && typeof fh.createSyncAccessHandle === 'function') {
        try {
          const h = await this.openSync(fh);
          try {
            h.truncate(0);
            const n = h.write(bytes, { at: 0 });
            if (n !== bytes.byteLength) throw new Error(`short write ${n} of ${bytes.byteLength}`);
            h.flush();
          } finally {
            h.close();
          }
          this.lastWritePath = 'sync';
          return;
        } catch (e) {
          const n = errName(e);
          // Quota and lock conflicts are real answers; anything else means this engine's sync handles are unusable here.
          if (n === 'QuotaExceededError' || n === 'NoModificationAllowedError' || n === 'InvalidStateError') throw e;
          this.useWritable = true;
        }
      }
      const w = await (fh as FileSystemFileHandle).createWritable();
      try {
        await w.write(bytes as unknown as FileSystemWriteChunkType);
        await w.close();
      } catch (e) {
        await w.abort().catch(() => undefined);
        throw e;
      }
      this.lastWritePath = 'writable';
    } catch (e) {
      // Do not leave a partial file behind; an orphan would be swept at the next open() anyway.
      await dir.removeEntry(hash + SUFFIX).catch(() => undefined);
      throw e;
    }
  }

  async read(hash: string): Promise<Uint8Array | null> {
    try {
      const fh = await this.d().getFileHandle(hash + SUFFIX);
      const file = await fh.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      if (errName(e) === 'NotFoundError') return null;
      throw e;
    }
  }

  async size(hash: string): Promise<number | null> {
    try {
      const fh = await this.d().getFileHandle(hash + SUFFIX);
      return (await fh.getFile()).size;
    } catch (e) {
      if (errName(e) === 'NotFoundError') return null;
      throw e;
    }
  }

  async remove(hash: string): Promise<void> {
    try {
      await this.d().removeEntry(hash + SUFFIX);
    } catch (e) {
      if (errName(e) !== 'NotFoundError') throw e;
    }
  }

  async list(): Promise<string[]> {
    const out: string[] = [];
    for await (const [name] of (this.d() as IterableDir).entries()) {
      if (name.endsWith(SUFFIX)) out.push(name.slice(0, -SUFFIX.length));
    }
    return out;
  }

  async clear(): Promise<void> {
    for (const name of await this.list()) await this.remove(name);
  }
}
