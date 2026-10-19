import type { PackRef } from './types.ts';

/** One row of IDB `dv-packs` / `packs`. The row is the commit record of a pack (11-platform-pwa.md section 5, rule 1). */
export interface PackRow {
  sha256: string;
  bytes: number;
  kind: PackRef['kind'];
  tags: string[];
  createdAt: number;
  lastUsedAt: number;
  pinned: boolean;
}

/** Whole-file storage keyed by SHA-256 (`dv/packs/<sha256>.bin` in OPFS). */
export interface FileStore {
  open(): Promise<void>;
  /** Writes the whole file and flushes it. Throws an error named `QuotaExceededError` when the origin is out of space. */
  write(hash: string, bytes: Uint8Array): Promise<void>;
  /** Null when absent. */
  read(hash: string): Promise<Uint8Array | null>;
  /** Null when absent. */
  size(hash: string): Promise<number | null>;
  remove(hash: string): Promise<void>;
  list(): Promise<string[]>;
  clear(): Promise<void>;
}

export interface IndexStore {
  open(): Promise<void>;
  get(hash: string): Promise<PackRow | null>;
  put(row: PackRow): Promise<void>;
  delete(hash: string): Promise<void>;
  all(): Promise<PackRow[]>;
  clear(): Promise<void>;
}

export interface QuotaEstimate {
  usage: number;
  quota: number;
}
