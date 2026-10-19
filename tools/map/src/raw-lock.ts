/**
 * raw.lock.json: one tool-internal RawSourceLock per fetched source (DL-666). It is never called SourceStamp: that name
 * belongs to C08, whose WorldIndex.sources records are built from these entries with the attribution filled from sources.json.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SourceStamp } from '../../../packages/shared/src/index.ts';
import type { AreaId, SourcesConfig } from './config.ts';
import { CONTENT_ATTRIBUTION, CONTENT_STAMP_ID } from './content.ts';

export interface RawSourceLock {
  id: string;
  url: string;
  /** ISO-8601 Z: this file is repo-audited. */
  retrievedAt: string;
  sha256: string;
  rows: number;
  licence: string;
}
export interface RawLockFile {
  schema: 'raw-lock/1';
  area: AreaId;
  /** True when the raw files were produced by the synth generator (QA only, stamps are authored). */
  synthetic: boolean;
  /** Real-data locks that carry some generated sources (the civic-excerpt OSM part). */
  syntheticSources?: string[];
  sources: RawSourceLock[];
}

export const RAW_LOCK_NAME = 'raw.lock.json';

export function rawLockText(l: RawLockFile): string {
  const sorted: RawLockFile = { ...l, sources: [...l.sources].sort((a, b) => (a.id < b.id ? -1 : 1)) };
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

export function writeRawLock(file: string, l: RawLockFile): void {
  writeFileSync(file, rawLockText(l));
}

export function readRawLock(dir: string): RawLockFile | null {
  const p = path.join(dir, RAW_LOCK_NAME);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as RawLockFile;
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

export function sha256Text(s: string | Uint8Array): string {
  return createHash('sha256').update(s).digest('hex');
}

/** C08 SourceStamp records, one per lock entry, attribution from sources.json. */
export function stampsOf(lock: RawLockFile, cfg: SourcesConfig): SourceStamp[] {
  return [...lock.sources]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((s) => {
      if (s.id === CONTENT_STAMP_ID) return { id: s.id, url: s.url, retrievedAt: s.retrievedAt, sha256: s.sha256, licence: s.licence, attribution: CONTENT_ATTRIBUTION };
      const def = cfg.sources.find((d) => d.id === s.id);
      if (!def) throw new Error(`raw.lock.json names unknown source ${s.id}`);
      const generated = lock.synthetic || (lock.syntheticSources ?? []).includes(s.id);
      return {
        id: s.id, url: s.url, retrievedAt: s.retrievedAt, sha256: s.sha256, licence: s.licence,
        attribution: generated ? `Synthetic test data (${s.id}), Dee-Verse` : def.attribution,
      };
    });
}
