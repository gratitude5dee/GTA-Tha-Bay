/**
 * assets/assets.lock.json (`asset-lock/1`, spec/domains/05-assets.md section 4.3): the reviewed release gate.
 * `root` is the sha256 of the asset's root provenance record (same value as ProvenanceSummary.root).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AssetRef, VariantId } from '../../../packages/shared/src/assets/c07.ts';
import type { ProvenanceRecord } from '../../../packages/shared/src/assets/provenance.ts';
import { loadRecords } from '../../ci/lib/common.ts';
import type { LoadedSpec } from './spec.ts';

export interface LockEntry {
  rev: number;
  variants: Partial<Record<VariantId, string>>;
  root: string;
  approved_by: string;
  approved_at: string; // ISO-8601 Z: repo-audited file (DL-059)
}
export interface AssetLock {
  schema: 'asset-lock/1';
  entries: Record<string, LockEntry>;
}

export const LOCK_PATH = 'assets/assets.lock.json';

export function emptyLock(): AssetLock {
  return { schema: 'asset-lock/1', entries: {} };
}

export function readLock(root: string): AssetLock | null {
  const p = path.join(root, LOCK_PATH);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as AssetLock;
}

export function lockText(lock: AssetLock): string {
  const sorted: AssetLock = { schema: 'asset-lock/1', entries: {} };
  for (const ref of Object.keys(lock.entries).sort()) {
    const e = lock.entries[ref] as LockEntry;
    const variants: Partial<Record<VariantId, string>> = {};
    for (const v of Object.keys(e.variants).sort()) variants[v as VariantId] = e.variants[v as VariantId] as string;
    sorted.entries[ref] = { rev: e.rev, variants, root: e.root, approved_by: e.approved_by, approved_at: e.approved_at };
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

export function recordMap(root: string): Map<string, ProvenanceRecord> {
  const m = new Map<string, ProvenanceRecord>();
  for (const { raw, parseError } of loadRecords(root)) {
    if (parseError || !raw || typeof raw !== 'object') continue;
    const r = raw as ProvenanceRecord;
    if (typeof r.sha256 === 'string') m.set(r.sha256, r);
  }
  return m;
}

/** Walks derived_from[0] to a record that has none. Returns undefined when the chain is broken or cyclic. */
export function rootRecord(sha: string, bySha: ReadonlyMap<string, ProvenanceRecord>): ProvenanceRecord | undefined {
  const seen = new Set<string>();
  let cur = bySha.get(sha);
  while (cur) {
    if (seen.has(cur.sha256)) return undefined;
    seen.add(cur.sha256);
    const parent = cur.derived_from[0];
    if (parent === undefined) return cur;
    cur = bySha.get(parent.replace(/^sha256:/, ''));
  }
  return undefined;
}

export function variantHashes(s: LoadedSpec): Partial<Record<VariantId, string>> {
  const out: Partial<Record<VariantId, string>> = {};
  for (const f of s.files) out[f.variant] = f.sha256;
  return out;
}

export function sameHashes(a: Partial<Record<string, string>>, b: Partial<Record<string, string>>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

/** Entries in the lock are the active, public assets (the ones that reach R2). */
export function isReleased(s: LoadedSpec): boolean {
  return s.spec.status === 'active' && s.spec.visibility === 'public';
}

/** rev of an asset in the next catalog: the lock's rev when every variant hash is unchanged, else rev + 1, or 1 when new. */
export function revFor(s: LoadedSpec, lock: AssetLock | null): number {
  const e = lock?.entries[s.ref];
  if (!e) return 1;
  return sameHashes(e.variants, variantHashes(s)) ? e.rev : e.rev + 1;
}

export function updateLock(
  specs: readonly LoadedSpec[],
  lock: AssetLock | null,
  bySha: ReadonlyMap<string, ProvenanceRecord>,
  approvedBy: string,
  approvedAt: string,
): { lock: AssetLock; changed: AssetRef[] } {
  const next = emptyLock();
  const changed: AssetRef[] = [];
  for (const s of specs) {
    if (!isReleased(s)) continue;
    const prev = lock?.entries[s.ref];
    const hashes = variantHashes(s);
    if (prev && sameHashes(prev.variants, hashes)) {
      next.entries[s.ref] = prev;
      continue;
    }
    const first = s.files[0];
    const root = first ? rootRecord(first.sha256, bySha)?.sha256 ?? first.sha256 : '';
    next.entries[s.ref] = { rev: prev ? prev.rev + 1 : 1, variants: hashes, root, approved_by: approvedBy, approved_at: approvedAt };
    changed.push(s.ref);
  }
  if (lock) for (const ref of Object.keys(lock.entries)) if (!(ref in next.entries)) changed.push(ref as AssetRef);
  return { lock: next, changed };
}

export function writeLock(root: string, lock: AssetLock): void {
  writeFileSync(path.join(root, LOCK_PATH), lockText(lock));
}
