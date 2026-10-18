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

export function createRcloneUploader(opts: { bucket: string; env: NodeJS.ProcessEnv; run: Runner }): Uploader {
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
