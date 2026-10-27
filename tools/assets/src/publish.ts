/**
 * assets:publish. verify -> upload blobs (one rclone invocation per content class) -> verify sizes (and HEAD when
 * MEDIA_ORIGIN is set) -> upload the immutable manifest -> write the pointer that ships with the Worker.
 * A missing secret or rclone binary on the r2 target prints a SKIP line and exits 0 (after the verify step).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONTENT_CLASSES, contentTypeOf } from '../../../packages/shared/src/assets/content-type.ts';
import { formatFinding } from '../../../packages/shared/src/assets/gates/types.ts';
import { lockGitStamp, pointerText, writeCatalogDir, type Blob, type CatalogBuild, type GitStamp } from './catalog.ts';
import { mergeFragment, readFragment, type FragmentBlob } from './fragment.ts';
import { recordMap, type AssetLock } from './lock.ts';
import { createDirUploader } from './uploader-dir.ts';
import { createRcloneUploader, rclonePreflight, spawnRunner, type ClassFiles, type Runner, type Uploader } from './uploader-rclone.ts';
import { POINTER_EDGE, POINTER_WEB, verifyAssets } from './verify.ts';
import { verifySlug } from './verify-slug.ts';
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
  /** catalog.fragment.json of a world bake (M02a1): needs a dir: target and --pointer-out. */
  fragment?: string | undefined;
  /**
   * The world release (M02c2, DL-670): `assets/world/sf.lock.json`. Merges the world entries (their manifests are the bake's
   * `catalog.fragment.json`, checked against the lock) into the catalog and writes the merged pointer to `--pointer-out <file>.json`
   * with `<file>.meta.json` beside it. The same run uploads the ODbL offer under `odbl/<bakeId>/` (DL-695).
   */
  world?: string | undefined;
  /** The bake directory of the world release (default: the one `dist/world/latest-sf.json` names). */
  worldBake?: string | undefined;
  /** Writes `bake-scripts.tar.gz` (the committed bake scripts as a tar.gz); returns the exit status. Injected by tests. */
  archive?: ((outFile: string) => number) | undefined;
  /** `HOST_MEDIA` for the printed offer URL (default `MEDIA_ORIGIN`, else the Worker config of `root`). */
  mediaOrigin?: string | undefined;
  /** M10a1: one character. Its own gates (A4, A6, A7, A8, likeness) must pass before anything is uploaded. */
  slug?: string | undefined;
}
export interface PublishResult { code: number; uploaded: number; total: number; skipped?: string; buildId?: string; offerUrl?: string }

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


// ---- the world release (M02c2) ---------------------------------------------------------------------------------------------------

const sha256Of = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

export const ODBL_SCRIPT_PATHS = ['tools/map', 'config/world', 'content/world'] as const;

interface WorldInput {
  lockRel: string;
  lockBytes: Buffer;
  bakeDir: string;
  objectsDir: string;
  fragment: ReturnType<typeof readFragment>;
}

/** Reads and checks the world lock against the bake's fragment and the provenance records. Returns lines for a failure. */
function loadWorld(o: PublishOptions): { world: WorldInput | null; problems: string[] } {
  const problems: string[] = [];
  const lockAbs = path.resolve(o.root, o.world as string);
  if (!existsSync(lockAbs)) return { world: null, problems: [`${o.world}: the world lock does not exist (run map:pack -- --target r2:<env> first)`] };
  const lockBytes = readFileSync(lockAbs);
  let lock: AssetLock;
  try {
    lock = JSON.parse(lockBytes.toString('utf8')) as AssetLock;
  } catch (e) {
    return { world: null, problems: [`${o.world}: not JSON (${(e as Error).message})`] };
  }
  if (lock.schema !== 'asset-lock/1' || typeof lock.entries !== 'object' || lock.entries === null) return { world: null, problems: [`${o.world}: not an asset-lock/1 file`] };
  let bakeDir = o.worldBake ? path.resolve(o.root, o.worldBake) : '';
  if (!bakeDir) {
    const latest = path.join(o.root, 'dist', 'world', 'latest-sf.json');
    if (!existsSync(latest)) return { world: null, problems: ['no sf bake: pass --bake <dir> or run pnpm map:build -- --area sf'] };
    bakeDir = path.join(path.dirname(latest), (JSON.parse(readFileSync(latest, 'utf8')) as { bakeId: string }).bakeId);
  }
  const fragFile = path.join(bakeDir, 'catalog.fragment.json');
  if (!existsSync(fragFile)) return { world: null, problems: [`${path.relative(o.root, fragFile)} does not exist (run map:pack on the bake)`] };
  const fragment = readFragment(fragFile);
  const records = recordMap(o.root);
  const seen = new Set<string>();
  for (const m of fragment.entries) {
    const ref = `${m.kind}/${m.id}`;
    seen.add(ref);
    const e = lock.entries[ref];
    const v = m.variants.default;
    if (!e) problems.push(`${ref}: in the bake but not in ${o.world}`);
    else if (!v || e.variants.default !== v.sha256) problems.push(`${ref}: lock sha256 ${(e.variants.default ?? '-').slice(0, 12)} differs from the bake's ${(v?.sha256 ?? '-').slice(0, 12)}`);
  }
  for (const [ref, e] of Object.entries(lock.entries)) {
    if (!seen.has(ref)) problems.push(`${ref}: in ${o.world} but not in the bake`);
    for (const [variant, sha] of Object.entries(e.variants)) if (sha && !records.has(sha)) problems.push(`${ref} ${variant}: no provenance record for sha256 ${sha.slice(0, 12)}`);
  }
  if (problems.length > 0) return { world: null, problems };
  return { world: { lockRel: path.relative(o.root, lockAbs).split(path.sep).join('/'), lockBytes, bakeDir, objectsDir: path.join(bakeDir, 'objects'), fragment }, problems };
}

/** The `HOST_MEDIA` of the Worker config for a media env, or null. */
export function hostMediaOf(root: string, env: 'staging' | 'prod'): string | null {
  const file = path.join(root, 'services', 'edge', 'wrangler.jsonc');
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  // the first HOST_MEDIA of the file is the top-level (production) one, the one under "staging" follows it
  const all = [...text.matchAll(/"HOST_MEDIA"\s*:\s*"([^"]+)"/g)].map((m) => m[1] as string);
  return (env === 'prod' ? all[0] : all[1]) ?? null;
}

const defaultArchive = (root: string) => (out: string): number =>
  spawnSync('git', ['archive', '--format=tar.gz', '-o', out, 'HEAD', ...ODBL_SCRIPT_PATHS], { cwd: root }).status ?? 1;

/** Meta file next to a pointer: `pointer.staging.json` gives `pointer.staging.meta.json`. */
export const metaPathOf = (pointerFile: string): string => pointerFile.replace(/\.json$/, '.meta.json');

export async function publishAssets(o: PublishOptions): Promise<PublishResult> {
  const log = o.log ?? ((l: string) => console.log(l));
  const penv = o.processEnv ?? process.env;
  if (o.fragment !== undefined) {
    if (!o.target.startsWith('dir:')) {
      log('assets:publish: --fragment needs a dir: target');
      return { code: 2, uploaded: 0, total: 0 };
    }
    if (!o.pointerOut) {
      log('assets:publish: --fragment needs --pointer-out (the committed pointers are never written on this path)');
      return { code: 2, uploaded: 0, total: 0 };
    }
  }
  if (o.world !== undefined) {
    if (o.fragment !== undefined) {
      log('assets:publish: --world and --fragment are alternatives');
      return { code: 2, uploaded: 0, total: 0 };
    }
    if (!o.pointerOut || !o.pointerOut.endsWith('.json')) {
      log('assets:publish: --world needs --pointer-out <file>.json (the committed pointers are never written on this path)');
      return { code: 2, uploaded: 0, total: 0 };
    }
    if (o.target !== 'r2' && !o.target.startsWith('dir:')) {
      log(`assets:publish: unknown --target ${o.target} (use r2 or dir:<path>)`);
      return { code: 2, uploaded: 0, total: 0 };
    }
  }
  const v = verifyAssets(o.root, { baseline: o.baseline, stamp: o.stamp });
  if (v.findings.length > 0 || !v.build) {
    for (const f of v.findings) log(formatFinding(f));
    log(`assets:publish: verify FAILED (${v.findings.length} findings); nothing uploaded`);
    return { code: 1, uploaded: 0, total: 0 };
  }
  if (o.slug !== undefined) {
    const sv = await verifySlug(o.root, o.slug);
    for (const n of sv.notes) log(`verify ${o.slug}: ${n}`);
    if (sv.findings.length > 0) {
      for (const f of sv.findings) log(formatFinding(f));
      log(`assets:publish: ${o.slug} FAILED its character gates (${sv.findings.length} findings); nothing uploaded`);
      return { code: 1, uploaded: 0, total: 0 };
    }
  }
  let build: CatalogBuild = v.build;
  log(`verify ok (${Object.keys(build.catalog.entries).length} assets, ${build.blobs.length} blobs, build ${build.catalog.buildId})`);
  let fragmentBlobs: FragmentBlob[] = [];
  if (o.fragment !== undefined) {
    const dest = path.resolve(o.target.slice(4));
    let merged;
    try {
      merged = mergeFragment(build, readFragment(path.resolve(o.fragment)), dest, o.stamp ?? lockGitStamp(o.root));
    } catch (e) {
      log(`assets:publish: --fragment ${o.fragment}: ${(e as Error).message}`);
      return { code: 1, uploaded: 0, total: 0 };
    }
    if (!merged.build) {
      for (const f of merged.findings) log(formatFinding(f));
      log(`assets:publish: fragment rejected (${merged.findings.length} findings); nothing uploaded`);
      return { code: 1, uploaded: 0, total: 0 };
    }
    for (const r of merged.replaced) log(`fragment replaces ${r} in this catalog (the lock entry is untouched)`);
    log(`fragment merged: ${merged.added.length} added, ${merged.replaced.length} replaced`);
    build = merged.build;
    fragmentBlobs = merged.fragmentBlobs;
  }
  let worldInput: WorldInput | null = null;
  if (o.world !== undefined) {
    const loaded = loadWorld(o);
    if (!loaded.world) {
      for (const p of loaded.problems) log(`assets:publish: --world: ${p}`);
      log('assets:publish: world lock rejected; nothing uploaded');
      return { code: 1, uploaded: 0, total: 0 };
    }
    worldInput = loaded.world;
    const merged = mergeFragment(build, worldInput.fragment, worldInput.objectsDir, o.stamp ?? lockGitStamp(o.root));
    if (!merged.build) {
      for (const f of merged.findings) log(formatFinding(f));
      log(`assets:publish: world entries rejected (${merged.findings.length} findings); nothing uploaded`);
      return { code: 1, uploaded: 0, total: 0 };
    }
    for (const r of merged.replaced) log(`world replaces ${r} in this catalog (the lock entry is untouched)`);
    log(`world merged: ${merged.added.length} added, ${merged.replaced.length} replaced`);
    build = merged.build;
    fragmentBlobs = merged.fragmentBlobs;
  }
  const buildId = build.catalog.buildId;

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
    // a dir: target of the world release gets the pack blobs too (an r2 target has them from map:pack)
    if (worldInput && o.target.startsWith('dir:')) {
      const keys = fragmentBlobs.map((b) => b.key).sort();
      if (keys.length > 0) uploaded += uploader.put({ label: 'world', contentType: 'application/octet-stream', srcDir: worldInput.objectsDir, include: '**/*', exclude: [], keys });
    }
  } catch (e) {
    log(`assets:publish: ${(e as Error).message}`);
    return { code: 1, uploaded, total, buildId };
  }

  const expected = [...build.blobs.map((b) => ({ key: b.key, bytes: b.bytes })), ...fragmentBlobs.map((b) => ({ key: b.key, bytes: b.bytes }))];
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

  // the ODbL offer of a world release (DL-695): the bake scripts, the world lock and an index naming both and the world packs
  let offerUrl: string | undefined;
  if (worldInput) {
    const offer = await uploadOffer(o, worldInput, uploader, fragmentBlobs, bucket, log);
    if (typeof offer === 'string') {
      log(`assets:publish: ODbL offer: ${offer}`);
      return { code: 1, uploaded, total, buildId };
    }
    uploaded += offer.uploaded;
    offerUrl = offer.url;
  }

  const text = pointerText(build.pointer);
  const targets = worldInput && o.pointerOut
    ? [path.resolve(o.root, o.pointerOut)]
    : o.pointerOut ? [path.join(path.resolve(o.pointerOut), 'asset-catalog.json')] : [path.join(o.root, POINTER_WEB), path.join(o.root, POINTER_EDGE)];
  for (const t of targets) {
    mkdirSync(path.dirname(t), { recursive: true });
    writeFileSync(t, text);
  }
  if (worldInput && o.pointerOut) {
    const assetsLock = path.join(o.root, 'assets', 'assets.lock.json');
    const worldIndexSha = worldInput.fragment.entries.find((m) => m.kind === 'data' && m.id === 'world-index')?.variants.default?.sha256;
    const meta = {
      schema: 'world-pointer-meta/1',
      assetsLockSha256: existsSync(assetsLock) ? sha256Of(readFileSync(assetsLock)) : '',
      worldLockSha256: sha256Of(worldInput.lockBytes),
      ...(worldIndexSha ? { worldIndexSha256: worldIndexSha } : {}),
    };
    writeFileSync(metaPathOf(path.resolve(o.root, o.pointerOut)), `${JSON.stringify(meta, null, 2)}
`);
  }
  log(`assets:publish ok: env=${o.env} target=${o.target === 'r2' ? `r2:${bucket}` : o.target} build=${buildId} uploaded ${uploaded} of ${total} objects, manifest ${build.manifestKey}`);
  return { code: 0, uploaded, total, buildId, ...(offerUrl ? { offerUrl } : {}) };
}

/** Uploads `odbl/<bakeId>/{bake-scripts.tar.gz, <lock>, index.json}` through the uploader of the run; a string is the reason it failed. */
async function uploadOffer(o: PublishOptions, w: WorldInput, uploader: Uploader, fragmentBlobs: readonly FragmentBlob[], bucket: string, log: (l: string) => void): Promise<string | { uploaded: number; url: string }> {
  const bakeId = w.fragment.bakeId;
  if (!/^[0-9a-f]{64}$/.test(bakeId)) return `the bake id ${bakeId} is not 64 lowercase hex characters`;
  const dir = path.join(o.distRoot ? path.resolve(o.distRoot) : path.join(o.root, 'dist', 'assets'), `odbl-${bakeId.slice(0, 12)}`);
  const prefix = `odbl/${bakeId}`;
  const tarKey = `${prefix}/bake-scripts.tar.gz`;
  const lockKey = `${prefix}/${path.basename(w.lockRel)}`;
  const indexKey = `${prefix}/index.json`;
  mkdirSync(path.join(dir, prefix), { recursive: true });
  const archive = o.archive ?? defaultArchive(o.root);
  if (archive(path.join(dir, tarKey)) !== 0 || !existsSync(path.join(dir, tarKey))) return 'the archive of the bake scripts failed (run from a git checkout with the scripts committed)';
  writeFileSync(path.join(dir, lockKey), w.lockBytes);
  const file = (key: string, name: string): { name: string; key: string; sha256: string; bytes: number } => {
    const b = readFileSync(path.join(dir, key));
    return { name, key, sha256: sha256Of(b), bytes: b.length };
  };
  const index = {
    schema: 'odbl-offer/1',
    bakeId,
    licence: 'ODbL-1.0',
    files: [file(tarKey, 'bake-scripts.tar.gz'), file(lockKey, path.basename(w.lockRel))],
    scriptPaths: [...ODBL_SCRIPT_PATHS],
    worldPacks: fragmentBlobs.map((b) => b.key).sort(),
  };
  writeFileSync(path.join(dir, indexKey), `${JSON.stringify(index, null, 2)}
`);
  const units: ClassFiles[] = [
    { label: 'odbl-tgz', contentType: 'application/gzip', srcDir: dir, include: tarKey, exclude: [], keys: [tarKey] },
    { label: 'odbl-json', contentType: 'application/json', srcDir: dir, include: `${prefix}/*.json`, exclude: [], keys: [lockKey, indexKey].sort() },
  ];
  let n = 0;
  try {
    for (const u of units) n += uploader.put(u);
  } catch (e) {
    return (e as Error).message;
  }
  const problems = uploader.verify([tarKey, lockKey, indexKey].map((k) => ({ key: k, bytes: statSync(path.join(dir, k)).size })));
  if (problems.length > 0) return problems.join('; ');
  const origin = (o.mediaOrigin ?? o.processEnv?.MEDIA_ORIGIN ?? process.env['MEDIA_ORIGIN'] ?? hostMediaOf(o.root, o.env) ?? '<HOST_MEDIA>').replace(/\/$/, '');
  const url = `${origin}/${indexKey}`;
  log(`ODbL offer uploaded to ${o.target === 'r2' ? `r2:${bucket}` : o.target}: ${index.files.map((f) => f.key).join(', ')}, ${index.worldPacks.length} world packs listed`);
  log(`ODbL offer URL: ${url}`);
  return { uploaded: n, url };
}
