import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CatalogPointer } from '../../../packages/shared/src/assets/c07.ts';
import { sha256Bytes } from '../src/catalog.ts';
import { publishAssets, type PublishOptions } from '../src/publish.ts';
import type { RunResult, Runner } from '../src/uploader-rclone.ts';
import { verifyAssets } from '../src/verify.ts';
import { STAMP, tempRepo } from './helpers.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'dv-pub-'));
  dirs.push(d);
  return d;
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const SECRETS = { R2_ACCESS_KEY_ID: 'k-test', R2_SECRET_ACCESS_KEY: 's-test', CLOUDFLARE_ACCOUNT_ID: 'acct-test' };

function base(root: string): Pick<PublishOptions, 'root' | 'stamp' | 'baseline' | 'distRoot' | 'log'> & { lines: string[] } {
  const lines: string[] = [];
  return { root, stamp: STAMP, baseline: null, distRoot: path.join(tmp(), 'dist'), log: (l) => lines.push(l), lines };
}

interface Call { cmd: string; args: string[]; env: NodeJS.ProcessEnv }
function fakeRunner(root: string, opts: { corrupt?: boolean } = {}): { run: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const v = verifyAssets(root, { baseline: null, stamp: STAMP });
  const listing = (v.build?.blobs ?? []).map((b) => ({ Path: b.key, Size: opts.corrupt ? b.bytes + 1 : b.bytes }));
  const run: Runner = (cmd, args, env): RunResult => {
    calls.push({ cmd, args, env });
    if (args[0] === 'lsjson') return { status: 0, stdout: JSON.stringify(listing), stderr: '' };
    if (args[0] === 'copy') return { status: 0, stdout: '', stderr: 'INFO  : x: Copied (new)\n' };
    return { status: 0, stdout: 'rclone v1.75.2', stderr: '' };
  };
  return { run, calls };
}

describe('assets:publish with the rclone uploader', () => {
  it('uploads per content class, then checks sizes, then the manifest, with immutable headers', async () => {
    const root = tempRepo();
    dirs.push(root);
    const { run, calls } = fakeRunner(root);
    const b = base(root);
    const ptr = tmp();
    const res = await publishAssets({ ...b, env: 'staging', target: 'r2', pointerOut: ptr, processEnv: { ...SECRETS }, run });
    expect(res.code).toBe(0);
    const sub = calls.map((c) => c.args[0]);
    expect(sub).toEqual(['version', 'copy', 'copy', 'lsjson', 'copy']);
    const copies = calls.filter((c) => c.args[0] === 'copy');
    const types = copies.map((c) => c.args.filter((a) => a.startsWith('Content-Type: ')).join());
    expect(types).toEqual(['Content-Type: application/json', 'Content-Type: image/png', 'Content-Type: application/json']);
    for (const c of copies) {
      expect(c.args[2]).toBe('r2:tha-bay-media-staging');
      expect(c.args).toContain('--immutable');
      expect(c.args).toContain('--ignore-existing');
      expect(c.args).toContain('Cache-Control: public, max-age=31536000, immutable');
      expect(c.args.join(' ')).not.toMatch(/Content-Encoding/i);
    }
    // the blob json class never picks up the manifest or the pointer
    expect(copies[0]?.args).toEqual(expect.arrayContaining(['--exclude', 'manifests/**']));
    const pointer = JSON.parse(readFileSync(path.join(ptr, 'asset-catalog.json'), 'utf8')) as CatalogPointer;
    expect(copies[2]?.args).toContain(pointer.key);
    // remote is configured from the environment only
    const env = calls[1]?.env ?? {};
    expect(env.RCLONE_CONFIG_R2_TYPE).toBe('s3');
    expect(env.RCLONE_CONFIG_R2_PROVIDER).toBe('Cloudflare');
    expect(env.RCLONE_CONFIG_R2_ENDPOINT).toBe('https://acct-test.r2.cloudflarestorage.com');
    expect(env.RCLONE_CONFIG_R2_NO_CHECK_BUCKET).toBe('true');
    expect(b.lines.join('\n')).not.toContain('s-test');
    expect(existsSync(path.join(ptr, 'asset-catalog.json'))).toBe(true);
  });

  it('a size mismatch stops before the manifest upload and the pointer write', async () => {
    const root = tempRepo();
    dirs.push(root);
    const { run, calls } = fakeRunner(root, { corrupt: true });
    const ptr = tmp();
    const b = base(root);
    const res = await publishAssets({ ...b, env: 'staging', target: 'r2', pointerOut: ptr, processEnv: { ...SECRETS }, run });
    expect(res.code).toBe(1);
    expect(calls.map((c) => c.args[0])).toEqual(['version', 'copy', 'copy', 'lsjson']);
    expect(existsSync(path.join(ptr, 'asset-catalog.json'))).toBe(false);
    expect(b.lines.join('\n')).toMatch(/size .*expected/);
  });

  it('HEAD checks run when MEDIA_ORIGIN is set and reject Content-Encoding', async () => {
    const root = tempRepo();
    dirs.push(root);
    const { run } = fakeRunner(root);
    const ptr = tmp();
    const v = verifyAssets(root, { baseline: null, stamp: STAMP });
    const sizes = new Map((v.build?.blobs ?? []).map((x) => [`https://media.test/${x.key}`, x]));
    const b = base(root);
    const res = await publishAssets({
      ...b, env: 'staging', target: 'r2', pointerOut: ptr, processEnv: { ...SECRETS, MEDIA_ORIGIN: 'https://media.test' }, run,
      head: async (url) => {
        const blob = sizes.get(url);
        return { ok: true, status: 200, contentLength: String(blob?.bytes), contentType: blob?.contentType ?? null, contentEncoding: 'gzip' };
      },
    });
    expect(res.code).toBe(1);
    expect(b.lines.join('\n')).toContain('unexpected Content-Encoding');
  });

  it('prints SKIP after verify ok when the secrets are missing, and runs nothing', async () => {
    const root = tempRepo();
    dirs.push(root);
    const calls: string[] = [];
    const b = base(root);
    const res = await publishAssets({ ...b, env: 'staging', target: 'r2', processEnv: {}, run: (c) => { calls.push(c); return { status: 0, stdout: '', stderr: '' }; } });
    expect(res.code).toBe(0);
    expect(calls).toEqual([]);
    expect(b.lines[0]).toMatch(/^verify ok/);
    expect(b.lines[1]).toMatch(/^SKIP assets:publish: .*R2_ACCESS_KEY_ID.*R2_SECRET_ACCESS_KEY.*CLOUDFLARE_ACCOUNT_ID/);
  });

  it('prints SKIP when the rclone binary is missing', async () => {
    const root = tempRepo();
    dirs.push(root);
    const b = base(root);
    const res = await publishAssets({ ...b, env: 'prod', target: 'r2', processEnv: { ...SECRETS }, run: () => ({ status: 127, stdout: '', stderr: 'ENOENT' }) });
    expect(res.code).toBe(0);
    expect(b.lines.join('\n')).toContain('SKIP assets:publish: rclone binary not found');
  });

  it('aborts on a verify finding before anything is uploaded', async () => {
    const root = tempRepo();
    dirs.push(root);
    rmSync(path.join(root, 'assets/assets.lock.json'));
    const calls: string[] = [];
    const b = base(root);
    const res = await publishAssets({ ...b, env: 'staging', target: 'r2', processEnv: { ...SECRETS }, run: (c) => { calls.push(c); return { status: 0, stdout: '', stderr: '' }; } });
    expect(res.code).toBe(1);
    expect(calls).toEqual([]);
  });
});

describe('assets:publish with the dir: target', () => {
  it('copies the full key tree, matches the pointer, and the second run copies nothing', async () => {
    const root = tempRepo();
    dirs.push(root);
    const out = tmp();
    const ptr = tmp();
    const b = base(root);
    const first = await publishAssets({ ...b, env: 'staging', target: `dir:${out}`, pointerOut: ptr });
    expect(first.code).toBe(0);
    expect(first.uploaded).toBe(5);
    const pointer = JSON.parse(readFileSync(path.join(ptr, 'asset-catalog.json'), 'utf8')) as CatalogPointer;
    const manifest = readFileSync(path.join(out, pointer.key));
    expect(sha256Bytes(manifest)).toBe(pointer.sha256);
    expect(manifest.length).toBe(pointer.bytes);
    const catalog = JSON.parse(manifest.toString('utf8')) as { entries: Record<string, { variants: Record<string, { key: string; sha256: string; bytes: number }> }> };
    let n = 0;
    for (const m of Object.values(catalog.entries)) {
      for (const v of Object.values(m.variants)) {
        n++;
        const f = readFileSync(path.join(out, v.key));
        expect(sha256Bytes(f)).toBe(v.sha256);
        expect(statSync(path.join(out, v.key)).size).toBe(v.bytes);
      }
    }
    expect(n).toBe(4);
    expect(readdirSync(path.join(out, 'assets/texture/asset-smoke')).length).toBe(3);
    const second = await publishAssets({ ...b, env: 'staging', target: `dir:${out}`, pointerOut: ptr });
    expect(second.code).toBe(0);
    expect(second.uploaded).toBe(0);
    expect(b.lines.some((l) => l.includes('uploaded 0 of 5'))).toBe(true);
  });

  it('--dry-run copies nothing and writes no pointer', async () => {
    const root = tempRepo();
    dirs.push(root);
    const out = tmp();
    const ptr = tmp();
    const res = await publishAssets({ ...base(root), env: 'staging', target: `dir:${out}`, pointerOut: ptr, dryRun: true });
    expect(res.code).toBe(0);
    expect(readdirSync(out)).toEqual([]);
    expect(existsSync(path.join(ptr, 'asset-catalog.json'))).toBe(false);
  });
});
