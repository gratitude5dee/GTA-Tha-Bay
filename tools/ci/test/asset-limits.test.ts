/** The Workers static-asset limits (F-018) as the Preview workflow's `limits` step applies them (BD-PW-01). */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ASSET_COUNT_LIMIT, MIB, assetLimitFailures, assetStats } from '../lib/asset-limits.ts';
import { repoRoot } from '../run.ts';

const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});
function dist(files: Record<string, number>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dv-limits-'));
  tmp.push(dir);
  for (const [rel, bytes] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), Buffer.alloc(bytes));
  }
  return dir;
}

describe('asset limits', () => {
  it('passes a small tree and reports its largest file', () => {
    const s = assetStats(dist({ 'a.js': 10, 'media-local/assets/p.pack': 2 * MIB }));
    expect(assetLimitFailures(s)).toEqual([]);
    expect(s.files).toHaveLength(2);
    expect(s.largest?.file).toBe(path.join('media-local', 'assets', 'p.pack'));
  });

  it('names a file over 25 MiB', () => {
    const msgs = assetLimitFailures(assetStats(dist({ 'media-local/big.pack': 25 * MIB + 1 })));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('25 MiB per file (F-018)');
    expect(msgs[0]).toContain('big.pack');
  });

  it('names a file count over the limit', () => {
    const s = assetStats(dist({ 'a.txt': 1 }));
    const msgs = assetLimitFailures({ ...s, files: new Array<string>(ASSET_COUNT_LIMIT + 1).fill('x') });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain(`${ASSET_COUNT_LIMIT + 1} static asset files exceed`);
  });

  it('check-dist.ts limits exits 1 with the message on an oversize file and 0 otherwise', () => {
    const bin = path.join(repoRoot, 'node_modules/.bin/tsx');
    const bad = spawnSync(bin, ['tools/ci/check-dist.ts', 'limits', '--dist', dist({ 'x.pack': 25 * MIB + 1 })], { cwd: repoRoot, encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stdout + bad.stderr).toContain('25 MiB per file (F-018)');
    const good = spawnSync(bin, ['tools/ci/check-dist.ts', 'limits', '--dist', dist({ 'x.pack': 5 })], { cwd: repoRoot, encoding: 'utf8' });
    expect(good.status).toBe(0);
  });
});
