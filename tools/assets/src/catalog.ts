/**
 * Catalog builder: specs + lock + provenance records in, a deterministic content-addressed catalog out.
 * `dist/assets/<buildId>/` holds every blob at its key, `manifests/assets-<sha256>.json` and `pointer.json`.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  C07_VERSION,
  objectKey,
  type AssetCatalog,
  type AssetManifest,
  type AssetRef,
  type AssetVariant,
  type CatalogPointer,
  type ProvenanceSummary,
  type VariantId,
} from '../../../packages/shared/src/assets/c07.ts';
import { contentTypeOf } from '../../../packages/shared/src/assets/content-type.ts';
import type { ProvenanceRecord } from '../../../packages/shared/src/assets/provenance.ts';
import { canonicalize } from '../../../packages/shared/src/json.ts';
import { isReleased, readLock, recordMap, revFor, rootRecord, type AssetLock } from './lock.ts';
import { loadSpecs, type LoadedSpec } from './spec.ts';

export interface Blob {
  key: string;
  abs: string;
  ext: string;
  contentType: string;
  sha256: string;
  bytes: number;
}

export interface CatalogBuild {
  catalog: AssetCatalog;
  manifestBytes: Buffer;
  manifestKey: string;
  pointer: CatalogPointer;
  blobs: Blob[];
}

export interface GitStamp { gitSha: string; createdAt: number }

/** Last commit that touched the lock file: its sha and committer time (epoch ms). Zeros outside a git work tree. */
export function lockGitStamp(root: string): GitStamp {
  const res = spawnSync('git', ['log', '-1', '--format=%H%x09%ct', '--', 'assets/assets.lock.json'], { cwd: root, encoding: 'utf8' });
  const [sha, ct] = (res.status === 0 ? res.stdout.trim() : '').split('\t');
  if (!sha || !ct) return { gitSha: '0'.repeat(40), createdAt: 0 };
  return { gitSha: sha, createdAt: Number(ct) * 1000 };
}

export function sha256Bytes(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex');
}

function summaryOf(s: LoadedSpec, bySha: ReadonlyMap<string, ProvenanceRecord>): ProvenanceSummary {
  const first = s.files[0];
  const rec = first ? rootRecord(first.sha256, bySha) : undefined;
  if (!rec) throw new Error(`${s.ref}: no root provenance record`);
  const out: ProvenanceSummary = { root: rec.sha256, origin: rec.origin, license: rec.license, aiGenerated: rec.ai_generated };
  if (rec.attribution) out.attribution = rec.attribution;
  if (rec.generator) {
    out.vendor = rec.generator.vendor;
    out.endpoint = rec.generator.endpoint;
    out.requestId = rec.generator.request_id;
    out.promptSha256 = rec.generator.prompt_sha256;
  }
  return out;
}

function manifestOf(s: LoadedSpec, lock: AssetLock | null, bySha: ReadonlyMap<string, ProvenanceRecord>, blobs: Blob[]): AssetManifest {
  const variants: Partial<Record<VariantId, AssetVariant>> = {};
  for (const f of s.files) {
    const key = objectKey(s.spec.kind, s.spec.id, f.variant, f.sha256, f.ext);
    const contentType = contentTypeOf(f.ext);
    const v: AssetVariant = { key, sha256: f.sha256, bytes: f.bytes, contentType, encoding: 'identity' };
    if (f.ext === 'png') v.codec = { tex: 'png' };
    if (f.ext === 'glb' && s.spec.codec) v.codec = { ...s.spec.codec };
    const stats = s.spec.stats?.[f.variant];
    if (stats) v.stats = { ...stats };
    variants[f.variant] = v;
    blobs.push({ key, abs: f.abs, ext: f.ext, contentType, sha256: f.sha256, bytes: f.bytes });
  }
  const m: AssetManifest = {
    schema: 'asset/1',
    id: s.spec.id,
    kind: s.spec.kind,
    rev: revFor(s, lock),
    variants,
    deps: [...s.spec.deps].sort(),
    provenance: summaryOf(s, bySha),
    status: s.spec.status,
    visibility: s.spec.visibility,
    tags: [...s.spec.tags].sort(),
  };
  if (s.spec.likeness) m.likeness = s.spec.likeness;
  if (s.spec.extras) m.extras = s.spec.extras;
  return m;
}

/** buildId, catalog, manifest bytes and pointer for a set of entries (shared by the lock build and the fragment merge). */
export function finalizeCatalog(entries: Record<AssetRef, AssetManifest>, blobs: Blob[], stamp: GitStamp): CatalogBuild {
  const buildId = sha256Bytes(Buffer.from(canonicalize(entries))).slice(0, 16);
  const catalog: AssetCatalog = { schema: 'asset-catalog/1', c07: C07_VERSION, buildId, gitSha: stamp.gitSha, createdAt: stamp.createdAt, entries };
  const manifestBytes = Buffer.from(`${canonicalize(catalog)}\n`);
  const sha256 = sha256Bytes(manifestBytes);
  const manifestKey = `manifests/assets-${sha256}.json`;
  const pointer: CatalogPointer = { schema: 'asset-catalog-pointer/1', sha256, key: manifestKey, bytes: manifestBytes.length };
  return { catalog, manifestBytes, manifestKey, pointer, blobs };
}

export function buildCatalogFrom(
  specs: readonly LoadedSpec[],
  lock: AssetLock | null,
  bySha: ReadonlyMap<string, ProvenanceRecord>,
  stamp: GitStamp,
): CatalogBuild {
  const entries: Record<AssetRef, AssetManifest> = {};
  const blobs: Blob[] = [];
  for (const s of [...specs].sort((a, b) => (a.ref < b.ref ? -1 : 1))) {
    if (!isReleased(s)) continue;
    entries[s.ref] = manifestOf(s, lock, bySha, blobs);
  }
  return finalizeCatalog(entries, blobs, stamp);
}

export function buildCatalog(root: string, stamp: GitStamp = lockGitStamp(root)): { build: CatalogBuild; problems: string[] } {
  const { specs, findings } = loadSpecs(root);
  const problems = findings.map((f) => `${f.file}: ${f.rule}: ${f.detail}`);
  const build = buildCatalogFrom(specs, readLock(root), recordMap(root), stamp);
  return { build, problems };
}

/** Writes dist/assets/<buildId>/ (blobs, manifest, pointer.json) and returns its path. */
export function writeCatalogDir(root: string, build: CatalogBuild, outRoot = path.join(root, 'dist', 'assets')): string {
  const dir = path.join(outRoot, build.catalog.buildId);
  rmSync(dir, { recursive: true, force: true });
  for (const b of build.blobs) {
    const dest = path.join(dir, b.key);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(b.abs, dest);
  }
  mkdirSync(path.join(dir, 'manifests'), { recursive: true });
  writeFileSync(path.join(dir, build.manifestKey), build.manifestBytes);
  writeFileSync(path.join(dir, 'pointer.json'), `${JSON.stringify(build.pointer, null, 2)}\n`);
  return dir;
}

export function pointerText(p: CatalogPointer): string {
  return `${JSON.stringify(p, null, 2)}\n`;
}
