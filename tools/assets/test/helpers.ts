/** Test helpers: a temp copy of the repository's asset tree and a way to add synthetic assets to it. */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AssetKind, VariantId } from '../../../packages/shared/src/assets/c07.ts';
import { toolsRoot } from '../../ci/lib/common.ts';
import { buildRecord } from '../provenance-new.ts';
import { readLock, recordMap, updateLock, writeLock } from '../src/lock.ts';
import { loadSpecs } from '../src/spec.ts';

export const STAMP = { gitSha: 'a'.repeat(40), createdAt: 1_790_000_000_000 };

export function tempRepo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dv-assets-'));
  for (const d of ['assets', 'config', 'docs/legal', 'content/vehicles']) cpSync(path.join(toolsRoot, d), path.join(root, d), { recursive: true });
  dropFixtureAssets(root);
  return root;
}

/** The tests below assert on the M01d seed assets only: the M01f world_pack fixtures (which point outside assets/), the M06a2 NPC data assets and the M02d1 landmark models stay out of the copy. */
function dropFixtureAssets(root: string): void {
  const lockFile = path.join(root, 'assets', 'assets.lock.json');
  const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as { entries: Record<string, unknown> };
  for (const id of ['p0-64-64', 'l0-64-64']) {
    rmSync(path.join(root, 'assets', 'src', 'world_pack', id), { recursive: true, force: true });
    delete lock.entries[`world_pack/${id}`];
  }
  // M06a2: the NPC data assets (data/npc-roster, data/ink.<id>) are built by npc:build and tested in tools/soul.
  const dataDir = path.join(root, 'assets', 'src', 'data');
  for (const id of readdirSync(dataDir)) {
    if (id === 'asset-smoke') continue;
    rmSync(path.join(dataDir, id), { recursive: true, force: true });
    delete lock.entries[`data/${id}`];
  }
  // M02d1: the landmark models (building/lm.<slug>) are built by map:landmarks and tested in tools/map and tools/ci (assets-stats).
  const buildingDir = path.join(root, 'assets', 'src', 'building');
  rmSync(buildingDir, { recursive: true, force: true });
  for (const ref of Object.keys(lock.entries)) if (ref.startsWith('building/')) delete lock.entries[ref];
  // M08b1: the gray-box fighter models, portraits and move sets are built by the fighter generators and tested in packages/modes/fighter.
  for (const kind of ['anim', 'character', 'portrait']) {
    rmSync(path.join(root, 'assets', 'src', kind), { recursive: true, force: true });
    for (const ref of Object.keys(lock.entries)) if (ref.startsWith(`${kind}/`)) delete lock.entries[ref];
  }
  writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
}

export function put(root: string, rel: string, data: string | Uint8Array): void {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, data);
}

export const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

export interface AddAssetOptions {
  kind: AssetKind;
  id: string;
  variants: Partial<Record<VariantId, { ext: string; bytes: Uint8Array | string }>>;
  deps?: string[];
  tags?: string[];
  status?: 'active' | 'quarantined' | 'killed';
  visibility?: 'public' | 'private';
  record?: boolean;
  derivedFrom?: Partial<Record<VariantId, string>>;
  lock?: boolean;
}

/** Writes asset.json, variant files and (by default) provenance records, then re-locks. Returns the variant hashes. */
export function addAsset(root: string, o: AddAssetOptions): Partial<Record<VariantId, string>> {
  const out: Partial<Record<VariantId, string>> = {};
  const variants: Record<string, string> = {};
  for (const [v, f] of Object.entries(o.variants)) {
    const rel = `assets/src/${o.kind}/${o.id}/${v}.${f.ext}`;
    put(root, rel, f.bytes);
    variants[v] = rel;
    const h = sha(f.bytes);
    out[v as VariantId] = h;
    if (o.record !== false) {
      const parent = o.derivedFrom?.[v as VariantId];
      const rec = buildRecord({
        sha256: h,
        paths: [rel],
        kind: o.kind,
        origin: parent ? 'derived' : 'authored',
        license: 'LicenseRef-DeeVerse-Owned',
        authors: ['studio:dee-verse'],
        derivedFrom: parent ? [parent] : undefined,
        tool: parent ? { name: 'test-tool', version: '1', args_sha256: sha('x') } : undefined,
        createdAt: '2026-10-18T00:00:00Z',
      });
      put(root, `assets/provenance/${h.slice(0, 2)}/${h}.json`, `${JSON.stringify(rec, null, 2)}\n`);
    }
  }
  put(root, `assets/src/${o.kind}/${o.id}/asset.json`, JSON.stringify({
    kind: o.kind, id: o.id, variants, deps: o.deps ?? [], tags: o.tags ?? [], status: o.status ?? 'active', visibility: o.visibility ?? 'public',
  }));
  if (o.lock !== false) relock(root);
  return out;
}

export function relock(root: string): void {
  const { specs } = loadSpecs(root);
  writeLock(root, updateLock(specs, readLock(root), recordMap(root), 'tester', '2026-10-18T00:00:00Z').lock);
}
