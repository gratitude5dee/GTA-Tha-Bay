/**
 * R2 uploader through rclone (research/gap-ci-cd-release-assets.md section 2.1). The remote `r2` is configured only
 * from the environment (RCLONE_CONFIG_R2_*); no config file is written and no secret is printed.
 * One `rclone copy` per content class; never a Content-Encoding header (Cloudflare decompresses gzip and breaks Range).
 */
import { spawnSync } from 'node:child_process';

export interface RunResult { status: number; stdout: string; stderr: string }
export type Runner = (cmd: string, args: string[], env: NodeJS.ProcessEnv) => RunResult;

export const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export const spawnRunner: Runner = (cmd, args, env) => {
  const r = spawnSync(cmd, args, { env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return { status: 127, stdout: '', stderr: r.error.message };
  return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
};

/** One upload unit: the files of one content class (or the manifest) under `srcDir`. */
export interface ClassFiles {
  label: string;
  contentType: string;
  srcDir: string;
  include: string;
  exclude: string[];
  keys: string[];
}
export interface KeyExpectation { key: string; bytes: number }

export interface Uploader {
  /** Uploads one unit; returns how many objects were new. Throws on failure. */
  put(unit: ClassFiles): number;
  /** Returns one problem string per missing or wrong-size key. */
  verify(keys: readonly KeyExpectation[]): string[];
}

/**
 * Single-object operations on the same S3-API remote (M05c4): what `assets:gen prewarm --finish` needs against the PRIVATE bucket.
 * `copyto` moves one file to or from a key; `cat` reads a small JSON object; `lsf` lists a prefix. None of them is used by `assets:publish`.
 */
export interface RemoteFiles {
  /** Copies `remoteKey` to `localPath`. Throws on any failure, a missing object included. */
  download(remoteKey: string, localPath: string): void;
  /** Copies `localPath` to `remoteKey`, replacing an existing object. */
  putFile(localPath: string, remoteKey: string, opts?: { contentType?: string; cacheControl?: string }): void;
  /** The parsed JSON of `remoteKey`, or null when the object does not exist. Throws on any other failure. */
  readJson(remoteKey: string): unknown;
  /** Object names below `prefix` (recursive, relative to it); empty when the prefix does not exist. */
  list(prefix: string): string[];
}

export type RcloneUploader = Uploader & RemoteFiles;

const NOT_FOUND = /not found|no such (file|object|key)|NoSuchKey/i;

export function rclonePreflight(env: NodeJS.ProcessEnv): string[] {
  const missing = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_ACCOUNT_ID'].filter((k) => !env[k]);
  return missing;
}

export function rcloneEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    RCLONE_CONFIG_R2_TYPE: 's3',
    RCLONE_CONFIG_R2_PROVIDER: 'Cloudflare',
    RCLONE_CONFIG_R2_ENDPOINT: `https://${env.CLOUDFLARE_ACCOUNT_ID ?? ''}.r2.cloudflarestorage.com`,
    RCLONE_CONFIG_R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID ?? '',
    RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY ?? '',
    RCLONE_CONFIG_R2_NO_CHECK_BUCKET: 'true',
  };
}

export function createRcloneUploader(opts: { bucket: string; env: NodeJS.ProcessEnv; run: Runner }): RcloneUploader {
  const env = rcloneEnv(opts.env);
  const remote = `r2:${opts.bucket}`;
  return {
    put(unit) {
      const args = [
        'copy', unit.srcDir, remote,
        ...unit.exclude.flatMap((x) => ['--exclude', x]),
        '--include', unit.include,
        '--immutable', '--ignore-existing',
        '--header-upload', `Cache-Control: ${CACHE_CONTROL}`,
        '--header-upload', `Content-Type: ${unit.contentType}`,
        '-v',
      ];
      const r = opts.run('rclone', args, env);
      if (r.status !== 0) throw new Error(`rclone copy (${unit.label}) failed with exit ${r.status}: ${r.stderr.split('\n').slice(-3).join(' ').trim()}`);
      return (`${r.stdout}\n${r.stderr}`.match(/Copied \(new\)/g) ?? []).length;
    },
    download(remoteKey, localPath) {
      const r = opts.run('rclone', ['copyto', `${remote}/${remoteKey}`, localPath, '--no-traverse'], env);
      if (r.status !== 0) throw new Error(`rclone copyto ${remoteKey} failed with exit ${r.status}: ${r.stderr.split('\n').slice(-3).join(' ').trim()}`);
    },
    putFile(localPath, remoteKey, o = {}) {
      const args = ['copyto', localPath, `${remote}/${remoteKey}`, '--no-traverse'];
      if (o.cacheControl !== undefined) args.push('--header-upload', `Cache-Control: ${o.cacheControl}`);
      if (o.contentType !== undefined) args.push('--header-upload', `Content-Type: ${o.contentType}`);
      const r = opts.run('rclone', args, env);
      if (r.status !== 0) throw new Error(`rclone copyto ${remoteKey} failed with exit ${r.status}: ${r.stderr.split('\n').slice(-3).join(' ').trim()}`);
    },
    readJson(remoteKey) {
      const r = opts.run('rclone', ['cat', `${remote}/${remoteKey}`], env);
      if (r.status !== 0) {
        if (r.status === 3 || r.status === 4 || NOT_FOUND.test(r.stderr)) return null;
        throw new Error(`rclone cat ${remoteKey} failed with exit ${r.status}: ${r.stderr.split('\n').slice(-3).join(' ').trim()}`);
      }
      try {
        return JSON.parse(r.stdout) as unknown;
      } catch {
        throw new Error(`${remoteKey} is not JSON`);
      }
    },
    list(prefix) {
      const r = opts.run('rclone', ['lsf', '-R', '--files-only', `${remote}/${prefix}`], env);
      if (r.status !== 0) {
        if (r.status === 3 || r.status === 4 || NOT_FOUND.test(r.stderr)) return [];
        throw new Error(`rclone lsf ${prefix} failed with exit ${r.status}: ${r.stderr.split('\n').slice(-3).join(' ').trim()}`);
      }
      return r.stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    },
    verify(keys) {
      const r = opts.run('rclone', ['lsjson', '-R', '--files-only', '--no-modtime', '--no-mimetype', remote], env);
      if (r.status !== 0) return [`rclone lsjson failed with exit ${r.status}`];
      let listed: { Path: string; Size: number }[];
      try {
        listed = JSON.parse(r.stdout) as { Path: string; Size: number }[];
      } catch {
        return ['rclone lsjson did not return JSON'];
      }
      const size = new Map(listed.map((o) => [o.Path, o.Size]));
      const out: string[] = [];
      for (const k of keys) {
        const s = size.get(k.key);
        if (s === undefined) out.push(`${k.key}: missing in ${remote}`);
        else if (s !== k.bytes) out.push(`${k.key}: size ${s}, expected ${k.bytes}`);
      }
      return out;
    },
  };
}
