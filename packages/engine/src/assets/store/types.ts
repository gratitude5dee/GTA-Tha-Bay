import type { AssetRef } from '@dv/shared/assets';

/**
 * C13 1.1 world-pack store types, copied from 11-platform-pwa.md section 5 and the `AssetSource` hook from section 11.
 * Change only through the Architect.
 */
export interface PackRef {
  /** BootConfig.hosts.media plus the C07 AssetVariant.key. */
  url: string;
  /** C07 AssetVariant.sha256. */
  sha256: string;
  bytes: number;
  kind: 'chunk' | 'tex' | 'mesh' | 'audio' | 'data';
  /** C07 tags, for example `char:<npcId>`. */
  tags?: string[];
}

export type PackFailure = 'offline' | 'http' | 'hash-mismatch' | 'quota' | 'aborted';

export class PackUnavailable extends Error {
  readonly reason: PackFailure;
  readonly ref: PackRef;
  constructor(reason: PackFailure, ref: PackRef) {
    super(reason);
    this.name = 'PackUnavailable';
    this.reason = reason;
    this.ref = ref;
  }
}

export interface StorageUsage {
  usageMB: number;
  quotaMB: number;
  persisted: boolean | null;
  packsMB: number;
  packs: number;
  cutscenesMB: number;
}

export interface WorldPackStore {
  open(): Promise<'opfs' | 'memory-fallback'>;
  has(hash: string): Promise<boolean>;
  get(ref: PackRef, o?: { priority?: 'now' | 'soon' | 'idle'; signal?: AbortSignal }): Promise<ArrayBuffer>;
  prefetch(refs: readonly PackRef[], priority: 'soon' | 'idle'): void;
  /** Boot set of the current manifest. */
  pin(hashes: readonly string[]): void;
  gc(current: ReadonlySet<string>): Promise<{ removed: number; freedMB: number }>;
  usage(): Promise<StorageUsage>;
  downloadAll(refs: readonly PackRef[], onProgress: (done: number, total: number) => void): Promise<void>;
  /** Kill-switch path (S05 section 5.5): drop every pack tagged `char:<npcId>`. */
  evictByTag(tag: string): Promise<{ removed: number }>;
  clear(): Promise<void>;
}

/** Resolves `'<kind>/mod.<sha256[0:12]>'` refs from OPFS `dv/mods/blobs/<sha256>`; catalog refs are unchanged. */
export interface AssetSource {
  matches(ref: AssetRef): boolean;
  open(ref: AssetRef): Promise<{ bytes: ArrayBuffer; sha256: string; contentType: string } | null>;
}
