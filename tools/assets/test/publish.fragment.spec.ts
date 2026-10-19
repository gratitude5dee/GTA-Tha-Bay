import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { objectKey, type AssetCatalog, type AssetManifest, type CatalogPointer } from '../../../packages/shared/src/assets/c07.ts';
import { publishAssets, type PublishOptions } from '../src/publish.ts';
import { STAMP, tempRepo } from './helpers.ts';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'dv-frag-'));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

/** A world_pack (or data) manifest whose blob already sits under `dest` at its object key. */
function fragmentEntry(dest: string, kind: 'world_pack' | 'data', id: string, bytes: Uint8Array | string, ext: string): AssetManifest {
  const h = sha(bytes);
  const key = objectKey(kind, id, 'default', h, ext);
  mkdirSync(path.dirname(path.join(dest, key)), { recursive: true });
  writeFileSync(path.join(dest, key), bytes);
  const len = typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.length;
  return {
    schema: 'asset/1', id, kind, rev: 1,
    variants: { default: { key, sha256: h, bytes: len, contentType: ext === 'json' ? 'application/json' : 'application/octet-stream', encoding: 'identity' } },
    deps: [], provenance: { root: h, origin: 'derived', license: 'ODbL-1.0', aiGenerated: false }, status: 'active', visibility: 'public', tags: ['world'],
  };
}

function setup(): { root: string; dest: string; fragmentFile: string; entries: AssetManifest[]; run: (extra?: Partial<PublishOptions>) => Promise<{ code: number; lines: string[]; pointerDir: string }> } {
  const root = tempRepo();
  dirs.push(root);
  const dest = tmp();
  const entries = [
    fragmentEntry(dest, 'world_pack', 'p0-70-70', new Uint8Array([1, 2, 3, 4]), 'pack'),
    fragmentEntry(dest, 'world_pack', 'l0-70-70', new Uint8Array([5, 6, 7, 8, 9]), 'pack'),
  ];
  const fragmentFile = path.join(tmp(), 'catalog.fragment.json');
  writeFileSync(fragmentFile, JSON.stringify({ bakeId: 'f'.repeat(64), entries }));
  const run = async (extra: Partial<PublishOptions> = {}): Promise<{ code: number; lines: string[]; pointerDir: string }> => {
    const lines: string[] = [];
    const pointerDir = tmp();
    const res = await publishAssets({
      root, env: 'staging', target: `dir:${dest}`, pointerOut: pointerDir, fragment: fragmentFile, stamp: STAMP, baseline: null,
      distRoot: path.join(tmp(), 'dist'), log: (l) => lines.push(l), ...extra,
    });
    return { code: res.code, lines, pointerDir };
  };
  return { root, dest, fragmentFile, entries, run };
}

const manifestOf = (dest: string, pointerDir: string): { bytes: Buffer; catalog: AssetCatalog; pointer: CatalogPointer } => {
  const pointer = JSON.parse(readFileSync(path.join(pointerDir, 'asset-catalog.json'), 'utf8')) as CatalogPointer;
  const bytes = readFileSync(path.join(dest, pointer.key));
  return { bytes, catalog: JSON.parse(bytes.toString('utf8')) as AssetCatalog, pointer };
};

describe('assets:publish --fragment (AC-12)', () => {
  it('merges both fragment refs into the seed catalog, byte-identically across runs, with a matching pointer', async () => {
    const s = setup();
    const a = await s.run();
    expect(a.code).toBe(0);
    const first = manifestOf(s.dest, a.pointerDir);
    const seedRefs = ['data/asset-smoke', 'texture/asset-smoke'];
    expect(Object.keys(first.catalog.entries).sort()).toEqual([...seedRefs, 'world_pack/l0-70-70', 'world_pack/p0-70-70'].sort());
    expect(first.pointer.sha256).toBe(sha(first.bytes));
    expect(first.pointer.bytes).toBe(first.bytes.length);
    expect(first.pointer.key).toBe(`manifests/assets-${first.pointer.sha256}.json`);
    expect(a.lines.join('\n')).toContain('fragment merged: 2 added, 0 replaced');

    const b = await s.run();
    expect(b.code).toBe(0);
    const second = manifestOf(s.dest, b.pointerDir);
    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(readFileSync(path.join(b.pointerDir, 'asset-catalog.json')).equals(readFileSync(path.join(a.pointerDir, 'asset-catalog.json')))).toBe(true);
    // fragment blobs stay where map:pack put them
    for (const e of s.entries) expect(existsSync(path.join(s.dest, e.variants.default!.key))).toBe(true);
  });

  it('never writes the committed pointers or the lock', async () => {
    const s = setup();
    const before = [readFileSync(path.join(s.root, 'assets/assets.lock.json'), 'utf8'), existsSync(path.join(s.root, 'apps/web/public/asset-catalog.json'))];
    await s.run();
    expect([readFileSync(path.join(s.root, 'assets/assets.lock.json'), 'utf8'), existsSync(path.join(s.root, 'apps/web/public/asset-catalog.json'))]).toEqual(before);
  });

  it('rejects a fragment entry whose sha256 differs from its blob, naming the rule, and uploads nothing', async () => {
    const s = setup();
    const bad = JSON.parse(readFileSync(s.fragmentFile, 'utf8')) as { entries: AssetManifest[] };
    const e = bad.entries[0]!;
    const wrong = sha('other bytes');
    e.variants.default!.sha256 = wrong;
    e.variants.default!.key = objectKey('world_pack', e.id, 'default', wrong, 'pack');
    writeFileSync(path.join(s.dest, e.variants.default!.key), new Uint8Array([1, 2, 3, 4]));
    const f = path.join(tmp(), 'bad.json');
    writeFileSync(f, JSON.stringify(bad));
    const r = await s.run({ fragment: f });
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toMatch(/fragment-sha-mismatch/);
    expect(existsSync(path.join(r.pointerDir, 'asset-catalog.json'))).toBe(false);
    expect(readdirSync(s.dest).includes('manifests')).toBe(false);
  });

  it.each([
    ['fragment-blob-missing', (e: AssetManifest, dest: string) => rmSync(path.join(dest, e.variants.default!.key))],
    ['fragment-key', (e: AssetManifest) => { e.variants.default!.key = 'assets/world_pack/p0-70-70/default.000000000000.pack'; }],
    ['fragment-variant', (e: AssetManifest) => { e.variants.desktop = e.variants.default!; }],
    ['fragment-bytes', (e: AssetManifest) => { e.variants.default!.bytes += 1; }],
  ] as const)('rejects a malformed entry by rule name %s', async (rule, mutate) => {
    const s = setup();
    const frag = JSON.parse(readFileSync(s.fragmentFile, 'utf8')) as { entries: AssetManifest[] };
    mutate(frag.entries[0]!, s.dest);
    const f = path.join(tmp(), 'bad.json');
    writeFileSync(f, JSON.stringify(frag));
    const r = await s.run({ fragment: f });
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toContain(rule);
  });

  it('rejects a world_pack over 4 MiB', async () => {
    const s = setup();
    const big = fragmentEntry(s.dest, 'world_pack', 'p0-71-71', new Uint8Array(4 * 1024 * 1024 + 1), 'pack');
    const f = path.join(tmp(), 'big.json');
    writeFileSync(f, JSON.stringify({ bakeId: 'f'.repeat(64), entries: [big] }));
    const r = await s.run({ fragment: f });
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toContain('fragment-too-large');
  });

  it('replaces a lock ref in this catalog only and prints the replacement', async () => {
    const s = setup();
    const swap = fragmentEntry(s.dest, 'data', 'asset-smoke', '{"replaced":true}\n', 'json');
    const f = path.join(tmp(), 'swap.json');
    writeFileSync(f, JSON.stringify({ bakeId: 'f'.repeat(64), entries: [swap] }));
    const lockBefore = readFileSync(path.join(s.root, 'assets/assets.lock.json'), 'utf8');
    const r = await s.run({ fragment: f });
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toContain('fragment replaces data/asset-smoke in this catalog');
    const m = manifestOf(s.dest, r.pointerDir);
    expect(m.catalog.entries['data/asset-smoke']!.variants.default!.key).toBe(swap.variants.default!.key);
    expect(readFileSync(path.join(s.root, 'assets/assets.lock.json'), 'utf8')).toBe(lockBefore);
  });

  it('exits non-zero before any upload with an r2 target or without --pointer-out', async () => {
    const s = setup();
    const calls: string[] = [];
    const run = (cmd: string): { status: number; stdout: string; stderr: string } => { calls.push(cmd); return { status: 0, stdout: '', stderr: '' }; };
    const r2 = await s.run({ target: 'r2', run, processEnv: { R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 'b', CLOUDFLARE_ACCOUNT_ID: 'c' } });
    expect(r2.code).not.toBe(0);
    expect(r2.lines.join('\n')).toContain('--fragment needs a dir: target');
    expect(calls).toEqual([]);
    const noPointer = await s.run({ pointerOut: undefined });
    expect(noPointer.code).not.toBe(0);
    expect(noPointer.lines.join('\n')).toContain('--pointer-out');
  });
});
