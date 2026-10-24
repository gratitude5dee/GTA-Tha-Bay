import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { objectKey, type AssetManifest } from '../../../packages/shared/src/assets/c07.ts';
import { toolsRoot } from '../../ci/lib/common.ts';
import { metaPathOf, publishAssets, type PublishOptions } from '../src/publish.ts';
import { STAMP, tempRepo } from './helpers.ts';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'dv-world-'));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const BAKE_ID = 'b'.repeat(64);

/** The world_pack/p0-64-64 fixture of M01f, back in the temp repo so the world can replace it. */
function restoreGrayboxEntry(root: string): void {
  cpSync(path.join(toolsRoot, 'assets/src/world_pack/p0-64-64'), path.join(root, 'assets/src/world_pack/p0-64-64'), { recursive: true });
  cpSync(path.join(toolsRoot, 'tests/fixtures/world/civic-graybox'), path.join(root, 'tests/fixtures/world/civic-graybox'), { recursive: true });
  const lockFile = path.join(root, 'assets/assets.lock.json');
  const real = JSON.parse(readFileSync(path.join(toolsRoot, 'assets/assets.lock.json'), 'utf8')) as { entries: Record<string, unknown> };
  const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as { entries: Record<string, unknown> };
  lock.entries['world_pack/p0-64-64'] = real.entries['world_pack/p0-64-64'];
  writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
}

function entry(objects: string, kind: 'world_pack' | 'data' | 'map_data', id: string, bytes: Uint8Array | string, ext: string): AssetManifest {
  const h = sha(bytes);
  const key = objectKey(kind, id, 'default', h, ext);
  mkdirSync(path.dirname(path.join(objects, key)), { recursive: true });
  writeFileSync(path.join(objects, key), bytes);
  const len = typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.length;
  return {
    schema: 'asset/1', id, kind, rev: 1,
    variants: { default: { key, sha256: h, bytes: len, contentType: ext === 'json' ? 'application/json' : 'application/octet-stream', encoding: 'identity' } },
    deps: [], provenance: { root: h, origin: 'derived', license: 'ODbL-1.0', aiGenerated: false }, status: 'active', visibility: 'public', tags: ['world', 'sf'],
  };
}

function setup() {
  const root = tempRepo();
  dirs.push(root);
  restoreGrayboxEntry(root);
  const bake = path.join(tmp(), 'bake');
  const objects = path.join(bake, 'objects');
  const entries = [
    entry(objects, 'world_pack', 'p0-64-64', new Uint8Array([9, 9, 9, 9]), 'pack'),
    entry(objects, 'world_pack', 'p0-65-64', new Uint8Array([1, 2, 3]), 'pack'),
    entry(objects, 'data', 'world-index', '{"schema":"world-index/1"}\n', 'json'),
    entry(objects, 'map_data', 'sf-map.v1', new Uint8Array([4, 5, 6, 7, 8]), 'pack'),
  ];
  writeFileSync(path.join(bake, 'catalog.fragment.json'), JSON.stringify({ bakeId: BAKE_ID, entries }));
  const lock = { schema: 'asset-lock/1', entries: {} as Record<string, unknown> };
  for (const e of entries) {
    const h = e.variants.default!.sha256;
    lock.entries[`${e.kind}/${e.id}`] = { rev: 1, variants: { default: h }, root: h, approved_by: 'map-pack', approved_at: '2026-10-22T00:00:00Z' };
    const rec = path.join(root, 'assets/provenance', h.slice(0, 2), `${h}.json`);
    mkdirSync(path.dirname(rec), { recursive: true });
    writeFileSync(rec, JSON.stringify({ sha256: h, derived_from: [] }));
  }
  const worldLock = path.join(root, 'assets/world/sf.lock.json');
  mkdirSync(path.dirname(worldLock), { recursive: true });
  writeFileSync(worldLock, `${JSON.stringify(lock, null, 2)}\n`);
  const target = tmp();
  const archive = (out: string): number => {
    writeFileSync(out, Buffer.from('fake-tar-gz-of-the-bake-scripts'));
    return 0;
  };
  const run = async (extra: Partial<PublishOptions> = {}) => {
    const lines: string[] = [];
    const pointer = path.join(root, 'assets/world/pointer.staging.json');
    const res = await publishAssets({
      root, env: 'staging', target: `dir:${target}`, world: 'assets/world/sf.lock.json', worldBake: bake, pointerOut: 'assets/world/pointer.staging.json', stamp: STAMP,
      baseline: null, distRoot: path.join(tmp(), 'dist'), archive, mediaOrigin: 'https://media.example/media', log: (l) => lines.push(l), ...extra,
    });
    return { res, lines, pointer, meta: metaPathOf(pointer) };
  };
  return { root, bake, target, entries, run };
}

describe('assets:publish --world (AC-13, DL-670)', () => {
  it('merges the world entries, replaces world_pack/p0-64-64 and prints it', async () => {
    const s = setup();
    const r = await s.run();
    expect(r.res.code).toBe(0);
    expect(r.lines.join('\n')).toContain('world replaces world_pack/p0-64-64 in this catalog');
    expect(r.lines.join('\n')).toContain('world merged: 3 added, 1 replaced');
    const pointer = JSON.parse(readFileSync(r.pointer, 'utf8')) as { key: string; sha256: string };
    const manifest = JSON.parse(readFileSync(path.join(s.target, pointer.key), 'utf8')) as { entries: Record<string, AssetManifest> };
    expect(Object.keys(manifest.entries)).toEqual(expect.arrayContaining(['data/world-index', 'map_data/sf-map.v1', 'world_pack/p0-64-64', 'world_pack/p0-65-64', 'data/asset-smoke']));
    expect(manifest.entries['world_pack/p0-64-64']!.variants.default!.sha256).toBe(s.entries[0]!.variants.default!.sha256);
    // every world blob is in the target
    for (const e of s.entries) expect(existsSync(path.join(s.target, e.variants.default!.key))).toBe(true);
  });

  it('is byte-identical across two runs', async () => {
    const s = setup();
    const a = await s.run();
    const first = [readFileSync(a.pointer), readFileSync(a.meta)];
    const manifest1 = readFileSync(path.join(s.target, (JSON.parse(first[0]!.toString()) as { key: string }).key));
    const b = await s.run();
    expect(b.res.code).toBe(0);
    expect(readFileSync(b.pointer).equals(first[0]!)).toBe(true);
    expect(readFileSync(b.meta).equals(first[1]!)).toBe(true);
    expect(readFileSync(path.join(s.target, (JSON.parse(readFileSync(b.pointer, 'utf8')) as { key: string }).key)).equals(manifest1)).toBe(true);
  });

  it('never writes assets/assets.lock.json or the committed pointers', async () => {
    const s = setup();
    const lockBefore = readFileSync(path.join(s.root, 'assets/assets.lock.json'), 'utf8');
    const webPointer = path.join(s.root, 'apps/web/public/asset-catalog.json');
    const edgePointer = path.join(s.root, 'services/edge/src/generated/asset-catalog.json');
    const before = [existsSync(webPointer) ? readFileSync(webPointer, 'utf8') : null, existsSync(edgePointer) ? readFileSync(edgePointer, 'utf8') : null];
    await s.run();
    expect(readFileSync(path.join(s.root, 'assets/assets.lock.json'), 'utf8')).toBe(lockBefore);
    expect([existsSync(webPointer) ? readFileSync(webPointer, 'utf8') : null, existsSync(edgePointer) ? readFileSync(edgePointer, 'utf8') : null]).toEqual(before);
  });

  it('writes the meta file with the SHA-256 of both locks and of the world index', async () => {
    const s = setup();
    const r = await s.run();
    const meta = JSON.parse(readFileSync(r.meta, 'utf8')) as Record<string, string>;
    expect(meta['schema']).toBe('world-pointer-meta/1');
    expect(meta['assetsLockSha256']).toBe(sha(readFileSync(path.join(s.root, 'assets/assets.lock.json'))));
    expect(meta['worldLockSha256']).toBe(sha(readFileSync(path.join(s.root, 'assets/world/sf.lock.json'))));
    expect(meta['worldIndexSha256']).toBe(s.entries[2]!.variants.default!.sha256);
    expect(r.meta.endsWith('pointer.staging.meta.json')).toBe(true);
  });

  it('uploads the ODbL offer under odbl/<bakeId>/ and prints its URL', async () => {
    const s = setup();
    const r = await s.run();
    const dir = path.join(s.target, 'odbl', BAKE_ID);
    expect(existsSync(path.join(dir, 'bake-scripts.tar.gz'))).toBe(true);
    expect(readFileSync(path.join(dir, 'sf.lock.json')).equals(readFileSync(path.join(s.root, 'assets/world/sf.lock.json')))).toBe(true);
    const index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8')) as { bakeId: string; files: { name: string; key: string; sha256: string }[]; worldPacks: string[]; licence: string };
    expect(index.bakeId).toBe(BAKE_ID);
    expect(index.licence).toBe('ODbL-1.0');
    expect(index.files.map((f) => f.name)).toEqual(['bake-scripts.tar.gz', 'sf.lock.json']);
    expect(index.files[1]!.sha256).toBe(sha(readFileSync(path.join(s.root, 'assets/world/sf.lock.json'))));
    expect(index.worldPacks).toEqual(s.entries.map((e) => e.variants.default!.key).sort());
    expect(r.res.offerUrl).toBe(`https://media.example/media/odbl/${BAKE_ID}/index.json`);
    expect(r.lines.join('\n')).toContain(`ODbL offer URL: https://media.example/media/odbl/${BAKE_ID}/index.json`);
  });

  it('refuses a pointer-out that is not a .json file, a --fragment beside --world, a lock that disagrees with the bake and a failed archive', async () => {
    const s = setup();
    expect((await s.run({ pointerOut: 'assets/world' })).res.code).toBe(2);
    expect((await s.run({ fragment: 'x.json' })).res.code).toBe(2);
    expect((await s.run({ archive: () => 1 })).res.code).toBe(1);
    const lockFile = path.join(s.root, 'assets/world/sf.lock.json');
    const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as { entries: Record<string, { variants: { default: string } }> };
    lock.entries['world_pack/p0-65-64']!.variants.default = 'e'.repeat(64);
    writeFileSync(lockFile, JSON.stringify(lock));
    const bad = await s.run();
    expect(bad.res.code).toBe(1);
    expect(bad.lines.join('\n')).toMatch(/world_pack\/p0-65-64: lock sha256/);
  });
});
