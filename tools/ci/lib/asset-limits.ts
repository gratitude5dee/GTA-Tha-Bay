/**
 * Workers static-asset limits for a dist folder [F-018; research/stack-cloudflare-backend.md]: 25 MiB per file, and 20,000 files
 * (Free plan; the Paid plan allows 100,000, the stricter value is enforced for both). Used by check:bundle and by the Preview
 * workflow's `limits` step (BD-PW-01), which fails with a message naming the limit and the offenders.
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const MIB = 1024 * 1024;
export const ASSET_FILE_LIMIT_BYTES = 25 * MIB;
export const ASSET_COUNT_LIMIT = 20_000;

export interface AssetStats {
  files: string[];
  totalBytes: number;
  /** Files over the per-file limit, relative to the dist folder, with their sizes. */
  oversize: Array<{ file: string; bytes: number }>;
  /** The largest file, relative to the dist folder. */
  largest: { file: string; bytes: number } | null;
}

export function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

export function assetStats(dist: string, fileLimit = ASSET_FILE_LIMIT_BYTES): AssetStats {
  const files = listFiles(dist);
  const sized = files.map((f) => ({ file: path.relative(dist, f), bytes: statSync(f).size }));
  const largest = sized.reduce<{ file: string; bytes: number } | null>((m, s) => (m === null || s.bytes > m.bytes ? s : m), null);
  return { files, totalBytes: sized.reduce((n, s) => n + s.bytes, 0), oversize: sized.filter((s) => s.bytes > fileLimit), largest };
}

/** Failure messages for a dist folder; empty when it fits. */
export function assetLimitFailures(stats: AssetStats, countLimit = ASSET_COUNT_LIMIT, fileLimit = ASSET_FILE_LIMIT_BYTES): string[] {
  const out: string[] = [];
  if (stats.files.length > countLimit) {
    out.push(
      `${stats.files.length} static asset files exceed the Workers limit of ${countLimit} files per version (F-018); shrink the bake (fewer packs) or stop serving it from the Preview`,
    );
  }
  if (stats.oversize.length > 0) {
    const list = stats.oversize.map((o) => `${o.file} (${(o.bytes / MIB).toFixed(1)} MiB)`).join(', ');
    out.push(`static asset over the Workers limit of ${fileLimit / MIB} MiB per file (F-018): ${list}`);
  }
  return out;
}
