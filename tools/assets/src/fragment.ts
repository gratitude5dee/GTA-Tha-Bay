/**
 * `assets:publish --fragment <catalog.fragment.json>` (M02a1, DL-542): merges the entries of a world bake into the catalog
 * of a `dir:` publish. The blobs of the fragment are already under the target directory (map:pack put them there); each
 * entry is checked before the catalog id and the manifest hash are computed. A fragment ref equal to a lock ref replaces it
 * in this catalog only. Equal inputs give byte-identical output.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { objectKey, type AssetManifest, type AssetRef, type VariantId } from '../../../packages/shared/src/assets/c07.ts';
import { finding, type GateFinding } from '../../../packages/shared/src/assets/gates/types.ts';
import { finalizeCatalog, type Blob, type CatalogBuild, type GitStamp } from './catalog.ts';

const GATE = 'assets:publish';
const MIB = 1024 * 1024;
export const WORLD_PACK_LIMIT = 4 * MIB;

export interface FragmentFile { bakeId: string; entries: AssetManifest[] }
export interface FragmentBlob { ref: AssetRef; key: string; bytes: number }
export interface MergeResult {
  build: CatalogBuild | null;
  findings: GateFinding[];
  replaced: AssetRef[];
  added: AssetRef[];
  /** Fragment blobs already under the target; checked for size by the uploader's verify step. */
  fragmentBlobs: FragmentBlob[];
}

export function readFragment(file: string): FragmentFile {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as FragmentFile;
  if (!raw || !Array.isArray(raw.entries)) throw new Error(`${file} is not a catalog.fragment.json`);
  return raw;
}

export function mergeFragment(base: CatalogBuild, fragment: FragmentFile, destDir: string, stamp: GitStamp): MergeResult {
  const findings: GateFinding[] = [];
  const add = (ref: string, rule: string, detail: string): void => {
    findings.push(finding(GATE, `fragment ${ref}`, rule, detail));
  };
  const entries: Record<AssetRef, AssetManifest> = { ...base.catalog.entries };
  const replaced: AssetRef[] = [];
  const added: AssetRef[] = [];
  const fragmentBlobs: FragmentBlob[] = [];
  const seen = new Set<string>();
  for (const m of [...fragment.entries].sort((a, b) => (`${a.kind}/${a.id}` < `${b.kind}/${b.id}` ? -1 : 1))) {
    const ref = `${m.kind}/${m.id}` as AssetRef;
    if (seen.has(ref)) { add(ref, 'fragment-duplicate', 'ref appears twice in the fragment'); continue; }
    seen.add(ref);
    const variants = Object.entries(m.variants) as [VariantId, NonNullable<AssetManifest['variants'][VariantId]>][];
    const only = variants[0];
    if (variants.length !== 1 || !only || only[0] !== 'default') { add(ref, 'fragment-variant', 'a fragment entry has the single variant default'); continue; }
    const v = only[1];
    const ext = path.extname(v.key).replace(/^\./, '');
    let want: string;
    try {
      want = objectKey(m.kind, m.id, 'default', v.sha256, ext);
    } catch (e) {
      add(ref, 'fragment-key', (e as Error).message);
      continue;
    }
    if (v.key !== want) { add(ref, 'fragment-key', `key ${v.key} does not match the object key pattern ${want}`); continue; }
    const abs = path.join(destDir, v.key);
    if (!existsSync(abs) || !statSync(abs).isFile()) { add(ref, 'fragment-blob-missing', `${v.key} is not under ${destDir}`); continue; }
    const bytes = readFileSync(abs);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== v.sha256) { add(ref, 'fragment-sha-mismatch', `blob ${v.key} has sha256 ${sha.slice(0, 12)}, the entry says ${v.sha256.slice(0, 12)}`); continue; }
    if (bytes.length !== v.bytes) { add(ref, 'fragment-bytes', `blob ${v.key} is ${bytes.length} bytes, the entry says ${v.bytes}`); continue; }
    if (m.kind === 'world_pack' && bytes.length > WORLD_PACK_LIMIT) { add(ref, 'fragment-too-large', `${bytes.length} bytes exceeds 4 MiB (world_pack)`); continue; }
    if (ref in entries) replaced.push(ref); else added.push(ref);
    entries[ref] = m;
    fragmentBlobs.push({ ref, key: v.key, bytes: v.bytes });
  }
  if (findings.length > 0) return { build: null, findings, replaced, added, fragmentBlobs };

  // A replaced lock entry's blobs are not part of this catalog any more: they are not uploaded.
  const dropKeys = new Set<string>();
  for (const ref of replaced) for (const v of Object.values(base.catalog.entries[ref]?.variants ?? {})) if (v) dropKeys.add(v.key);
  const blobs: Blob[] = base.blobs.filter((b) => !dropKeys.has(b.key));
  const sorted: Record<AssetRef, AssetManifest> = {};
  for (const ref of Object.keys(entries).sort()) sorted[ref as AssetRef] = entries[ref as AssetRef] as AssetManifest;
  return { build: finalizeCatalog(sorted, blobs, stamp), findings, replaced, added, fragmentBlobs };
}
