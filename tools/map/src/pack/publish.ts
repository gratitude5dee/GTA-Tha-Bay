/**
 * map:pack, part 2: hands a packed bake to the M01d uploaders. Target `dir:<path>` copies the blobs into a key tree (the QA
 * media mirror); `r2:<env>` (operator, `sf` only) uploads through rclone and additionally writes the lock entries to
 * assets/world/sf.lock.json and the provenance records under assets/provenance/ for a PR. It never writes
 * assets/assets.lock.json or the committed pointers (DL-670).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { toolsRoot } from '../../../ci/lib/common.ts';
import { bucketOf, classUnits } from '../../../assets/src/publish.ts';
import type { Blob } from '../../../assets/src/catalog.ts';
import { lockText, rootRecord, type AssetLock } from '../../../assets/src/lock.ts';
import { createDirUploader } from '../../../assets/src/uploader-dir.ts';
import { createRcloneUploader, rclonePreflight, spawnRunner, type Runner, type Uploader } from '../../../assets/src/uploader-rclone.ts';
import { contentTypeOf } from '../../../../packages/shared/src/assets/content-type.ts';
import { loadSources, type SourcesConfig } from '../config.ts';
import { stableJson } from '../util.ts';
import { packBake, writePackage, type PackedBake } from './index.ts';

export type PackTarget = { kind: 'dir'; path: string } | { kind: 'r2'; env: 'staging' | 'prod' };

export function parseTarget(t: string): PackTarget | null {
  if (t.startsWith('dir:') && t.length > 4) return { kind: 'dir', path: path.resolve(t.slice(4)) };
  const m = /^r2:(staging|prod)$/.exec(t);
  return m ? { kind: 'r2', env: m[1] as 'staging' | 'prod' } : null;
}

export interface PublishPackOptions {
  bakeDir: string;
  target: PackTarget;
  cfg?: SourcesConfig;
  env?: NodeJS.ProcessEnv;
  run?: Runner;
  log?: (l: string) => void;
  /** Repository root for the r2 lock and provenance outputs. */
  root?: string;
  approvedBy?: string;
}

export interface PublishPackResult { code: number; uploaded: number; packed: PackedBake; skipped?: string }

export function worldLock(p: PackedBake, approvedBy: string, approvedAt: string): AssetLock {
  const bySha = new Map(p.records.map((r) => [r.sha256, r]));
  const lock: AssetLock = { schema: 'asset-lock/1', entries: {} };
  for (const b of p.blobs) {
    const root = rootRecord(b.sha256, bySha);
    lock.entries[b.ref] = { rev: 1, variants: { default: b.sha256 }, root: root?.sha256 ?? b.sha256, approved_by: approvedBy, approved_at: approvedAt };
  }
  return lock;
}

export async function publishPack(o: PublishPackOptions): Promise<PublishPackResult> {
  const log = o.log ?? ((l: string) => console.log(l));
  const cfg = o.cfg ?? loadSources();
  const env = o.env ?? process.env;
  const packed = packBake(o.bakeDir, cfg);
  const { objectsDir } = writePackage(o.bakeDir, packed);
  const blobs: Blob[] = packed.blobs.map((b) => ({ key: b.key, abs: b.abs, ext: b.ext, contentType: contentTypeOf(b.ext), sha256: b.sha256, bytes: b.bytes }));
  const units = classUnits(blobs, objectsDir);
  log(`map:pack: bake ${packed.bakeId.slice(0, 12)} (${packed.area}): ${packed.manifests.length} manifests, ${packed.records.length} provenance records, ${blobs.length} blobs`);

  let uploader: Uploader;
  if (o.target.kind === 'dir') {
    mkdirSync(o.target.path, { recursive: true });
    uploader = createDirUploader(o.target.path);
  } else {
    if (packed.area !== 'sf') {
      log(`map:pack: an r2 target takes the sf bake only (this bake is ${packed.area})`);
      return { code: 2, uploaded: 0, packed };
    }
    const missing = rclonePreflight(env);
    if (missing.length > 0) {
      const reason = `${missing.join(', ')} not set`;
      log(`SKIP map:pack r2:${o.target.env}: ${reason} (needs R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID)`);
      return { code: 0, uploaded: 0, packed, skipped: reason };
    }
    const run = o.run ?? spawnRunner;
    if (run('rclone', ['version'], env).status !== 0) {
      log('SKIP map:pack: rclone binary not found on PATH');
      return { code: 0, uploaded: 0, packed, skipped: 'rclone not found' };
    }
    uploader = createRcloneUploader({ bucket: bucketOf(o.target.env), env, run });
  }
  let uploaded = 0;
  try {
    for (const u of units) uploaded += uploader.put(u);
  } catch (e) {
    log(`map:pack: ${(e as Error).message}`);
    return { code: 1, uploaded, packed };
  }
  const problems = uploader.verify(packed.blobs.map((b) => ({ key: b.key, bytes: b.bytes })));
  if (problems.length > 0) {
    for (const p of problems) log(`map:pack verify: ${p}`);
    return { code: 1, uploaded, packed };
  }
  log(`map:pack ok: ${uploaded} new objects of ${blobs.length} at ${o.target.kind === 'dir' ? o.target.path : `r2:${bucketOf(o.target.env)}`}`);

  if (o.target.kind === 'r2') {
    const root = o.root ?? toolsRoot;
    const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const lockFile = path.join(root, 'assets', 'world', 'sf.lock.json');
    mkdirSync(path.dirname(lockFile), { recursive: true });
    writeFileSync(lockFile, lockText(worldLock(packed, o.approvedBy ?? env['DV_APPROVED_BY'] ?? 'map-pack', at)));
    for (const r of packed.records) {
      const f = path.join(root, 'assets', 'provenance', r.sha256.slice(0, 2), `${r.sha256}.json`);
      if (existsSync(f) && readFileSync(f, 'utf8') === stableJson(r)) continue;
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, stableJson(r));
    }
    log(`map:pack: wrote assets/world/sf.lock.json and ${packed.records.length} provenance records for the PR; assets/assets.lock.json and both committed pointers are untouched`);
  }
  return { code: 0, uploaded, packed };
}
