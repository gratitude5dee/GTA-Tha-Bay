/**
 * assets:publish. verify -> upload blobs (one rclone invocation per content class) -> verify sizes (and HEAD when
 * MEDIA_ORIGIN is set) -> upload the immutable manifest -> write the pointer that ships with the Worker.
 * A missing secret or rclone binary on the r2 target prints a SKIP line and exits 0 (after the verify step).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONTENT_CLASSES, contentTypeOf } from '../../../packages/shared/src/assets/content-type.ts';
import { formatFinding } from '../../../packages/shared/src/assets/gates/types.ts';
import { pointerText, writeCatalogDir, type Blob, type GitStamp } from './catalog.ts';
import type { AssetLock } from './lock.ts';
import { createDirUploader } from './uploader-dir.ts';
import { createRcloneUploader, rclonePreflight, spawnRunner, type ClassFiles, type Runner, type Uploader } from './uploader-rclone.ts';
import { POINTER_EDGE, POINTER_WEB, verifyAssets } from './verify.ts';
// The pointer copies are checked by check:assets, not by verify: verify must pass before the first pointer exists.

export interface HeadResult { ok: boolean; status: number; contentLength: string | null; contentType: string | null; contentEncoding: string | null }
export type HeadFn = (url: string) => Promise<HeadResult>;

export interface PublishOptions {
  root: string;
  env: 'staging' | 'prod';
  target: string; // 'r2' | 'dir:<path>'
  dryRun?: boolean;
  pointerOut?: string | undefined;
  processEnv?: NodeJS.ProcessEnv;
  run?: Runner;
  head?: HeadFn;
  log?: (line: string) => void;
  distRoot?: string | undefined;
  stamp?: GitStamp | undefined;
  baseline?: AssetLock | null | undefined;
}
export interface PublishResult { code: number; uploaded: number; total: number; skipped?: string; buildId?: string }

const defaultHead: HeadFn = async (url) => {
  const r = await fetch(url, { method: 'HEAD' });
  return { ok: r.ok, status: r.status, contentLength: r.headers.get('content-length'), contentType: r.headers.get('content-type'), contentEncoding: r.headers.get('content-encoding') };
};

export function bucketOf(env: 'staging' | 'prod'): string {
  return `tha-bay-media-${env}`;
}

export function classUnits(blobs: readonly Blob[], srcDir: string): ClassFiles[] {
  const exts = [...CONTENT_CLASSES, ...[...new Set(blobs.map((b) => b.ext))].filter((e) => !CONTENT_CLASSES.includes(e)).sort()];
  const units: ClassFiles[] = [];
  for (const ext of exts) {
    const files = blobs.filter((b) => b.ext === ext);
    if (files.length === 0) continue;
    units.push({
      label: ext,
      contentType: contentTypeOf(ext),
      srcDir,
      include: `**/*.${ext}`,
      exclude: ext === 'json' ? ['manifests/**', 'pointer.json'] : [],
      keys: files.map((f) => f.key).sort(),
    });
  }
  return units;
}

export async function publishAssets(o: PublishOptions): Promise<PublishResult> {
  const log = o.log ?? ((l: string) => console.log(l));
  const penv = o.processEnv ?? process.env;
  const v = verifyAssets(o.root, { baseline: o.baseline, stamp: o.stamp });
  if (v.findings.length > 0 || !v.build) {
    for (const f of v.findings) log(formatFinding(f));
    log(`assets:publish: verify FAILED (${v.findings.length} findings); nothing uploaded`);
    return { code: 1, uploaded: 0, total: 0 };
  }
  const build = v.build;
  const buildId = build.catalog.buildId;
  log(`verify ok (${Object.keys(build.catalog.entries).length} assets, ${build.blobs.length} blobs, build ${buildId})`);

  const srcDir = writeCatalogDir(o.root, build, o.distRoot);
  const bucket = bucketOf(o.env);
  const units = classUnits(build.blobs, srcDir);
  const manifestUnit: ClassFiles = {
    label: 'manifest', contentType: 'application/json', srcDir, include: build.manifestKey, exclude: [], keys: [build.manifestKey],
  };
  const total = build.blobs.length + 1;

  let uploader: Uploader;
  const run: Runner = o.run ?? spawnRunner;
  if (o.target === 'r2') {
    if (o.dryRun) {
      log(`dry run: would upload ${build.blobs.length} blobs in ${units.length} classes (${units.map((u) => u.label).join(', ')}) and ${build.manifestKey} to r2:${bucket}`);
      return { code: 0, uploaded: 0, total, buildId };
    }
    const missing = rclonePreflight(penv);
    if (missing.length > 0) {
      const reason = `${missing.join(', ')} not set`;
      log(`SKIP assets:publish: ${reason} (needs R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID)`);
      return { code: 0, uploaded: 0, total, skipped: reason, buildId };
    }
    const probe = run('rclone', ['version'], penv);
    if (probe.status !== 0) {
      log('SKIP assets:publish: rclone binary not found on PATH');
      return { code: 0, uploaded: 0, total, skipped: 'rclone not found', buildId };
    }
    uploader = createRcloneUploader({ bucket, env: penv, run });
  } else if (o.target.startsWith('dir:')) {
    const dest = path.resolve(o.target.slice(4));
    if (o.dryRun) {
      log(`dry run: would copy ${total} files to ${dest}`);
      return { code: 0, uploaded: 0, total, buildId };
    }
    uploader = createDirUploader(dest);
  } else {
    log(`assets:publish: unknown --target ${o.target} (use r2 or dir:<path>)`);
    return { code: 2, uploaded: 0, total, buildId };
  }

  let uploaded = 0;
  try {
    for (const u of units) uploaded += uploader.put(u);
  } catch (e) {
    log(`assets:publish: ${(e as Error).message}`);
    return { code: 1, uploaded, total, buildId };
  }

  const expected = build.blobs.map((b) => ({ key: b.key, bytes: b.bytes }));
  const problems = uploader.verify(expected);
  if (o.target === 'r2' && penv.MEDIA_ORIGIN) {
    const head = o.head ?? defaultHead;
    for (const b of build.blobs) {
      const r = await head(`${penv.MEDIA_ORIGIN.replace(/\/$/, '')}/${b.key}`);
      if (!r.ok) problems.push(`${b.key}: HEAD ${r.status}`);
      else {
        if (r.contentLength !== String(b.bytes)) problems.push(`${b.key}: Content-Length ${r.contentLength}, expected ${b.bytes}`);
        if (r.contentType !== b.contentType) problems.push(`${b.key}: Content-Type ${r.contentType}, expected ${b.contentType}`);
        if (r.contentEncoding) problems.push(`${b.key}: unexpected Content-Encoding ${r.contentEncoding}`);
      }
    }
  }
  if (problems.length > 0) {
    for (const p of problems) log(`verify: ${p}`);
    log('assets:publish: blob verification FAILED; manifest and pointer not written');
    return { code: 1, uploaded, total, buildId };
  }

  try {
    uploaded += uploader.put(manifestUnit);
  } catch (e) {
    log(`assets:publish: ${(e as Error).message}`);
    return { code: 1, uploaded, total, buildId };
  }

  const text = pointerText(build.pointer);
  const targets = o.pointerOut ? [path.join(path.resolve(o.pointerOut), 'asset-catalog.json')] : [path.join(o.root, POINTER_WEB), path.join(o.root, POINTER_EDGE)];
  for (const t of targets) {
    mkdirSync(path.dirname(t), { recursive: true });
    writeFileSync(t, text);
  }
  log(`assets:publish ok: env=${o.env} target=${o.target === 'r2' ? `r2:${bucket}` : o.target} build=${buildId} uploaded ${uploaded} of ${total} objects, manifest ${build.manifestKey}`);
  return { code: 0, uploaded, total, buildId };
}
