import type { AssetClient } from './client.ts';
import type { Priority } from './store/lanes.ts';
import { sha256Hex } from './store/store.ts';
import type { PackRef } from './store/types.ts';

/**
 * `window.__dvBridge.assets` (QA builds only; M01e). Reachable only through a dynamic import behind
 * `import.meta.env.VITE_DV_QA === '1'`, so a production dist contains neither it nor the string "__dvBridge"
 * (apps/web/scripts/verify-dist.mjs). Results are JSON-friendly: `get` returns the length and the SHA-256, not the bytes.
 */
export interface AssetsBridge {
  get(target: string | PackRef, o?: { priority?: Priority }): Promise<{ byteLength: number; sha256: string }>;
  has(target: string | PackRef): Promise<boolean>;
  resolve(ref: string): Promise<PackRef>;
  usage(): ReturnType<AssetClient['usage']>;
  stats(): Promise<{ network: number; hits: number; retries: number; evictions: number; bytes: number; inflightPeak: number; waves: number }>;
  configure(o: { softCapBytes: number | null }): Promise<void>;
  injectFaults(o: { status: number | 'network' | 'corrupt'; times: number; match?: string }): Promise<void>;
  clearFaults(): Promise<void>;
  reopen(o?: { force?: 'memory' }): Promise<'opfs' | 'memory-fallback'>;
  writeOrphan(sha: string): Promise<void>;
  /** Removes the file of a pack but keeps its row, which models the OS taking OPFS data. */
  removeFileOnly(sha: string): Promise<void>;
  files(): Promise<string[]>;
  rows(): Promise<unknown[]>;
  lanes(): Promise<{ peak: Record<string, number>; limits: Record<string, number> }>;
  /** Which OPFS write path the last write took: `sync` or `writable`. */
  writePath(): Promise<string | null>;
  mode(): 'rw' | 'read-only';
  storeKind(): 'opfs' | 'memory-fallback';
  catalogState(): Promise<string>;
  pin(targets: Array<string | PackRef>): Promise<void>;
  unpinAll(): Promise<void>;
  evictByTag(tag: string): Promise<{ removed: number }>;
  gc(): Promise<{ removed: number; freedMB: number }>;
  downloadAll(): Promise<{ done: number; total: number }>;
  clear(): Promise<void>;
  /** Waits until queued store writes (pins, commits) are finished. */
  settled(): Promise<void>;
  /** Queued `err.asset` events, as the client received them. */
  errAssetEvents(): Array<{ reason: string; kind: string }>;
}

export function installAssetsBridge(client: AssetClient): AssetsBridge {
  const bridge: AssetsBridge = {
    async get(target, o) {
      const buf = await client.get(target, { priority: o?.priority ?? 'now' });
      return { byteLength: buf.byteLength, sha256: await sha256Hex(new Uint8Array(buf)) };
    },
    has: (t) => client.has(t),
    resolve: (r) => client.resolve(r),
    usage: () => client.usage(),
    stats: () => client.stats(),
    configure: async (o) => void (await client.qa('configure', o)),
    injectFaults: async (o) => void (await client.qa('injectFaults', o)),
    clearFaults: async () => void (await client.qa('clearFaults')),
    reopen: async (o) => (await client.qa('reopen', o ?? {})) as 'opfs' | 'memory-fallback',
    writeOrphan: async (sha) => void (await client.qa('writeOrphan', { sha })),
    removeFileOnly: async (sha) => void (await client.qa('removeFileOnly', { sha })),
    files: async () => (await client.qa('files')) as string[],
    rows: async () => (await client.qa('rows')) as unknown[],
    lanes: async () => (await client.qa('lanes')) as { peak: Record<string, number>; limits: Record<string, number> },
    writePath: async () => (await client.qa('writePath')) as string | null,
    mode: () => client.mode,
    storeKind: () => client.storeKind,
    catalogState: () => client.loadCatalog(),
    pin: (t) => client.pin(t),
    unpinAll: () => client.unpinAll(),
    evictByTag: (tag) => client.evictByTag(tag),
    gc: () => client.gc(),
    async downloadAll() {
      let last = { done: 0, total: 0 };
      await client.downloadAll((done, total) => {
        last = { done, total };
      });
      return last;
    },
    clear: () => client.clear(),
    settled: async () => void (await client.qa('settled')),
    errAssetEvents: () => [...client.errLog],
  };
  const w = window as unknown as { __dvBridge?: Record<string, unknown> };
  w.__dvBridge = { ...w.__dvBridge, assets: bridge };
  return bridge;
}
