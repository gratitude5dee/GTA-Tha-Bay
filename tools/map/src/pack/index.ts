/**
 * map:pack, part 1: from a finished bake to C07 material. One AssetManifest per pack (`world_pack/p0-<x>-<y>`,
 * `world_pack/l0-<x>-<y>`) and one for `data/world-index`, all with the single variant `default`; one ProvenanceRecord per
 * pack and one `open_data` record per source stamp (synth stamps are `authored`); and a tool-internal
 * `catalog.fragment.json` that `assets:publish --fragment` merges (DL-542).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalize, sha256Hex } from '../../../../packages/shared/src/index.ts';
import { objectKey, type AssetKind, type AssetManifest, type AssetRef } from '../../../../packages/shared/src/assets/c07.ts';
import { contentTypeOf } from '../../../../packages/shared/src/assets/content-type.ts';
import type { ProvenanceRecord } from '../../../../packages/shared/src/assets/provenance.ts';
import { rootRecord } from '../../../assets/src/lock.ts';
import { TOOL_NAME, TOOL_VERSION, type SourcesConfig } from '../config.ts';
import { readRawLock, type RawLockFile } from '../raw-lock.ts';
import { cmp, stableJson, writeEnsured } from '../util.ts';

export interface PackBlob { ref: AssetRef; kind: AssetKind; id: string; key: string; abs: string; sha256: string; bytes: number; ext: string }
export interface CatalogFragment { bakeId: string; entries: AssetManifest[] }
export interface PackedBake {
  bakeId: string;
  area: string;
  synthetic: boolean;
  blobs: PackBlob[];
  manifests: AssetManifest[];
  /** Provenance records: source stamps first, then one per blob. */
  records: ProvenanceRecord[];
  fragment: CatalogFragment;
}

const sha = (b: Uint8Array): string => sha256Hex(b);
const AUTHOR = 'studio:dee-verse';

function stampRecord(s: RawLockFile['sources'][number], cfg: SourcesConfig, area: string, synthetic: boolean): ProvenanceRecord {
  const def = cfg.sources.find((d) => d.id === s.id);
  if (!def) throw new Error(`unknown source ${s.id}`);
  const rec: ProvenanceRecord = {
    schema: 'provenance/1.0',
    sha256: s.sha256,
    paths: [`raw/${area}/${def.file}`],
    kind: 'data',
    origin: synthetic ? 'authored' : 'open_data',
    license: s.licence,
    authors: [synthetic ? AUTHOR : `studio:${def.id}`],
    derived_from: [],
    review: [],
    ip_checks: { signatures: 'n/a', strings: 'n/a', similarity: 'n/a' },
    ai_generated: false,
    status: 'active',
    created_at: s.retrievedAt,
  };
  if (!synthetic) {
    rec.attribution = def.attribution;
    rec.source = { url: s.url, dataset_id: def.dataset ?? null, retrieved: s.retrievedAt };
  }
  return rec;
}

/** Reads dist/world/<bakeId> and builds manifests, records and the catalog fragment. */
export function packBake(bakeDir: string, cfg: SourcesConfig): PackedBake {
  const lock = readRawLock(bakeDir);
  if (!lock) throw new Error(`${bakeDir} has no raw.lock.json; is it a finished bake?`);
  const report = JSON.parse(readFileSync(path.join(bakeDir, 'bake-report.json'), 'utf8')) as { bakeId: string; area: string };
  const bakeId = report.bakeId;
  const area = report.area;

  const stampSynthetic = (id: string): boolean => lock.synthetic || (lock.syntheticSources ?? []).includes(id);
  const stampRecs = lock.sources.map((s) => stampRecord(s, cfg, area, stampSynthetic(s.id))).sort((a, b) => cmp(a.sha256, b.sha256));
  // derived_from[0] is the root of the summary: the OSM stamp when present (ODbL is the licence the pack is offered under).
  const ordered = [...lock.sources].sort((a, b) => (a.id === 'osm' ? -1 : b.id === 'osm' ? 1 : cmp(a.id, b.id)));
  const derivedFrom = [...new Set(ordered.map((s) => s.sha256))];
  const allSynthetic = lock.sources.every((s) => stampSynthetic(s.id));
  const createdAt = [...lock.sources.map((s) => s.retrievedAt)].sort().pop() as string;
  const attribution = [...new Set(lock.sources.filter((s) => !stampSynthetic(s.id)).map((s) => cfg.sources.find((d) => d.id === s.id)!.attribution))].sort().join('; ');
  const argsSha = sha256Hex(canonicalize({ bakeId, area, tool: `${TOOL_NAME}@${TOOL_VERSION}` }));

  const files: { kind: AssetKind; id: string; abs: string; ext: string }[] = [];
  const packsDir = path.join(bakeDir, 'packs');
  for (const name of readdirSync(packsDir).sort()) {
    const m = /^((?:p0|l0)-\d+-\d+)\.pack$/.exec(name);
    if (m) files.push({ kind: 'world_pack', id: m[1] as string, abs: path.join(packsDir, name), ext: 'pack' });
  }
  files.push({ kind: 'data', id: 'world-index', abs: path.join(bakeDir, 'world-index.json'), ext: 'json' });

  const blobs: PackBlob[] = [];
  const records: ProvenanceRecord[] = [...stampRecs];
  const bySha = new Map(records.map((r) => [r.sha256, r]));
  const manifests: AssetManifest[] = [];
  for (const f of files) {
    const bytes = readFileSync(f.abs);
    const hash = sha(bytes);
    const key = objectKey(f.kind, f.id, 'default', hash, f.ext);
    const ref = `${f.kind}/${f.id}` as AssetRef;
    blobs.push({ ref, kind: f.kind, id: f.id, key, abs: f.abs, sha256: hash, bytes: bytes.length, ext: f.ext });
    const rec: ProvenanceRecord = {
      schema: 'provenance/1.0',
      sha256: hash,
      paths: [key],
      kind: f.kind,
      origin: 'derived',
      license: allSynthetic ? 'LicenseRef-DeeVerse-Owned' : 'ODbL-1.0',
      ...(allSynthetic ? {} : { attribution }),
      authors: [AUTHOR],
      derived_from: derivedFrom,
      tool: { name: TOOL_NAME, version: TOOL_VERSION, args_sha256: argsSha },
      review: [],
      ip_checks: { signatures: 'n/a', strings: 'n/a', similarity: 'n/a' },
      ai_generated: false,
      status: 'active',
      created_at: createdAt,
    };
    records.push(rec);
    bySha.set(hash, rec);
    const root = rootRecord(hash, bySha);
    if (!root) throw new Error(`${ref}: provenance chain has no root`);
    manifests.push({
      schema: 'asset/1',
      id: f.id,
      kind: f.kind,
      rev: 1,
      variants: { default: { key, sha256: hash, bytes: bytes.length, contentType: contentTypeOf(f.ext), encoding: 'identity' } },
      deps: [],
      provenance: {
        root: root.sha256, origin: root.origin, license: root.license, aiGenerated: root.ai_generated,
        ...(root.attribution ? { attribution: root.attribution } : {}),
      },
      status: 'active',
      visibility: 'public',
      tags: ['world', area],
    });
  }
  manifests.sort((a, b) => cmp(`${a.kind}/${a.id}`, `${b.kind}/${b.id}`));
  return { bakeId, area, synthetic: allSynthetic, blobs, manifests, records, fragment: { bakeId, entries: manifests } };
}

/** Writes manifests/, provenance/, objects/ (blobs at their keys) and catalog.fragment.json under the bake directory. */
export function writePackage(bakeDir: string, p: PackedBake): { objectsDir: string; fragmentPath: string } {
  const objectsDir = path.join(bakeDir, 'objects');
  for (const b of p.blobs) {
    const dest = path.join(objectsDir, b.key);
    if (!existsSync(dest)) {
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(b.abs, dest);
    }
  }
  for (const m of p.manifests) writeEnsured(path.join(bakeDir, 'manifests', `${m.kind}.${m.id}.json`), stableJson(m));
  for (const r of p.records) writeEnsured(path.join(bakeDir, 'provenance', r.sha256.slice(0, 2), `${r.sha256}.json`), stableJson(r));
  const fragmentPath = path.join(bakeDir, 'catalog.fragment.json');
  writeFileSync(fragmentPath, stableJson(p.fragment));
  return { objectsDir, fragmentPath };
}
