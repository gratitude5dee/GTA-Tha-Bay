import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { objectKey, type AssetManifest } from '../../../packages/shared/src/assets/c07.ts';
import { toolsRoot } from '../../ci/lib/common.ts';
import { metaPathOf, publishAssets, type PublishOptions } from '../src/publish.ts';
import type { RunResult, Runner } from '../src/uploader-rclone.ts';
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

// ---- an offer already published for the bake id (DL-754, BD-FIX-ODBL-01) ----------------------------------------------------------

interface OfferIndexFile { bakeId: string; files: { name: string; key: string; sha256: string; bytes: number }[]; worldPacks: string[] }
interface MetaWithOffer { odblOffer?: { bakeId: string; url: string; index: string; tarball: { key: string; bytes: number; sha256: string } } }

/** An archive of the scripts at a later HEAD: other bytes, other size (tools/map/src/race/*, config/world/look*.json changed). */
const laterHead = (calls: { n: number }) => (out: string): number => {
  calls.n++;
  writeFileSync(out, Buffer.from('fake-tar-gz-of-the-bake-scripts-at-a-later-head-with-more-files'));
  return 0;
};

describe('assets:publish --world with an existing ODbL offer (BD-FIX-ODBL-01)', () => {
  const offerDir = (s: ReturnType<typeof setup>): string => path.join(s.target, 'odbl', BAKE_ID);
  const readIndex = (s: ReturnType<typeof setup>): OfferIndexFile => JSON.parse(readFileSync(path.join(offerDir(s), 'index.json'), 'utf8')) as OfferIndexFile;
  const writeIndex = (s: ReturnType<typeof setup>, index: OfferIndexFile): void => writeFileSync(path.join(offerDir(s), 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

  it('fresh upload: a bake id with nothing under odbl/<bakeId>/ gets a new offer from HEAD, reported with its tarball', async () => {
    const s = setup();
    const r = await s.run();
    expect(r.res.code).toBe(0);
    const tar = readFileSync(path.join(offerDir(s), 'bake-scripts.tar.gz'));
    expect(r.res.offer).toMatchObject({ bakeId: BAKE_ID, existing: false, uploaded: 3, indexKey: `odbl/${BAKE_ID}/index.json` });
    expect(r.res.offer?.tarball).toEqual({ name: 'bake-scripts.tar.gz', key: `odbl/${BAKE_ID}/bake-scripts.tar.gz`, bytes: tar.length, sha256: sha(tar) });
    const out = r.lines.join('\n');
    expect(out).toContain(`ODbL offer uploaded to dir:${s.target}`);
    expect(out).toContain(`ODbL offer tarball: odbl/${BAKE_ID}/bake-scripts.tar.gz, ${tar.length} bytes, sha256 ${sha(tar)}`);
    expect(out).not.toContain('ODbL offer accepted');
    const meta = JSON.parse(readFileSync(r.meta, 'utf8')) as MetaWithOffer;
    expect(meta.odblOffer).toEqual({ bakeId: BAKE_ID, url: `https://media.example/media/odbl/${BAKE_ID}/index.json`, index: `odbl/${BAKE_ID}/index.json`, tarball: { key: `odbl/${BAKE_ID}/bake-scripts.tar.gz`, bytes: tar.length, sha256: sha(tar) } });
  });

  it('accept: the offer of the first publish stays when HEAD archives other bytes; nothing is uploaded or replaced, and the report is the same', async () => {
    const s = setup();
    const first = await s.run();
    expect(first.res.code).toBe(0);
    const before = ['bake-scripts.tar.gz', 'sf.lock.json', 'index.json'].map((f) => readFileSync(path.join(offerDir(s), f)));
    const firstMeta = readFileSync(first.meta);
    const calls = { n: 0 };
    const again = await s.run({ archive: laterHead(calls) });
    expect(again.res.code).toBe(0);
    expect(calls.n).toBe(0); // HEAD is not archived for a bake id that already has an offer
    expect(['bake-scripts.tar.gz', 'sf.lock.json', 'index.json'].map((f) => readFileSync(path.join(offerDir(s), f)))).toEqual(before);
    expect(again.res.offer).toMatchObject({ existing: true, uploaded: 0 });
    expect(again.res.offer?.tarball).toEqual(first.res.offer?.tarball);
    expect(again.res.offerUrl).toBe(first.res.offerUrl);
    const out = again.lines.join('\n');
    expect(out).toContain(`ODbL offer accepted: odbl/${BAKE_ID}/index.json in dir:${s.target} names this bake and the same world packs`);
    expect(out).toContain(`ODbL offer tarball: odbl/${BAKE_ID}/bake-scripts.tar.gz, ${before[0]!.length} bytes, sha256 ${sha(before[0]!)}`);
    expect(out).toContain(`ODbL offer URL: https://media.example/media/odbl/${BAKE_ID}/index.json`);
    // the pointer meta of the accepted offer is byte-identical to the fresh one
    expect(readFileSync(again.meta).equals(firstMeta)).toBe(true);
  });

  it('accept: an index whose pack list differs only in form is accepted on the world lock hash it records', async () => {
    const s = setup();
    expect((await s.run()).res.code).toBe(0);
    const index = readIndex(s);
    writeIndex(s, { ...index, worldPacks: index.worldPacks.filter((k) => k.startsWith('world_pack/')) });
    const r = await s.run({ archive: laterHead({ n: 0 }) });
    expect(r.res.code).toBe(0);
    expect(r.lines.join('\n')).toContain('names this bake and the same world lock');
  });

  it('mismatched packs: an index of the same bake id with other packs and another lock fails and replaces nothing; another bake id fails too', async () => {
    const s = setup();
    expect((await s.run()).res.code).toBe(0);
    const index = readIndex(s);
    const other = { ...index, worldPacks: [...index.worldPacks.slice(1), 'world_pack/p9-99-99/default.000000000000.pack'].sort(), files: index.files.map((f) => (f.name === 'sf.lock.json' ? { ...f, sha256: 'c'.repeat(64) } : f)) };
    writeIndex(s, other);
    const pointerBefore = readFileSync(path.join(s.root, 'assets/world/pointer.staging.json'));
    const r = await s.run({ archive: laterHead({ n: 0 }) });
    expect(r.res.code).toBe(1);
    expect(r.lines.join('\n')).toMatch(new RegExp(`ODbL offer: odbl/${BAKE_ID}/index.json already exists for bake bbbbbbbbbbbb but with different world packs \\(4 listed, 1 of this release's 4 not among them, 1 not in this release\\) and world lock sha256 cccccccccccc`));
    expect(r.lines.join('\n')).toContain('a published offer is never replaced');
    expect(readIndex(s)).toEqual(other);
    expect(readFileSync(path.join(s.root, 'assets/world/pointer.staging.json')).equals(pointerBefore)).toBe(true);

    writeIndex(s, { ...index, bakeId: 'd'.repeat(64) });
    const b = await s.run();
    expect(b.res.code).toBe(1);
    expect(b.lines.join('\n')).toContain(`odbl/${BAKE_ID}/index.json already exists and names bake dddddddddddd, this release is bake bbbbbbbbbbbb`);
  });

  it('missing index: objects under odbl/<bakeId>/ without index.json are a partial offer and fail', async () => {
    const s = setup();
    expect((await s.run()).res.code).toBe(0);
    rmSync(path.join(offerDir(s), 'index.json'));
    const calls = { n: 0 };
    const r = await s.run({ archive: laterHead(calls) });
    expect(r.res.code).toBe(1);
    expect(calls.n).toBe(0);
    expect(r.lines.join('\n')).toContain(`ODbL offer: odbl/${BAKE_ID}/ holds bake-scripts.tar.gz, sf.lock.json but no index.json (a partial offer); nothing uploaded`);
    expect(existsSync(path.join(offerDir(s), 'index.json'))).toBe(false);
  });

  it('partial offer: an index whose listed object is missing or has another size fails', async () => {
    const s = setup();
    expect((await s.run()).res.code).toBe(0);
    rmSync(path.join(offerDir(s), 'bake-scripts.tar.gz'));
    const r = await s.run({ archive: laterHead({ n: 0 }) });
    expect(r.res.code).toBe(1);
    expect(r.lines.join('\n')).toMatch(new RegExp(`odbl/${BAKE_ID}/index.json already exists but the offer is partial \\(odbl/${BAKE_ID}/bake-scripts.tar.gz: missing in `));
    expect(existsSync(path.join(offerDir(s), 'bake-scripts.tar.gz'))).toBe(false);
    writeFileSync(path.join(offerDir(s), 'bake-scripts.tar.gz'), 'shorter');
    const sized = await s.run();
    expect(sized.res.code).toBe(1);
    expect(sized.lines.join('\n')).toMatch(/bake-scripts\.tar\.gz: size 7, expected \d+/);
  });

  it('accept on the r2 target (the 2026-10-28 staging failure): no odbl copy, cat and lsjson only', async () => {
    const s = setup();
    expect((await s.run()).res.code).toBe(0); // the offer published from the first HEAD, mirrored in s.target
    const listing = (): { Path: string; Size: number }[] => {
      const out: { Path: string; Size: number }[] = [];
      const walk = (rel: string): void => {
        for (const d of readdirSync(path.join(s.target, rel), { withFileTypes: true })) {
          const r = rel ? `${rel}/${d.name}` : d.name;
          if (d.isDirectory()) walk(r);
          else out.push({ Path: r, Size: statSync(path.join(s.target, r)).size });
        }
      };
      walk('');
      return out;
    };
    const calls: string[][] = [];
    const run: Runner = (_cmd, args): RunResult => {
      calls.push(args);
      if (args[0] === 'lsjson') return { status: 0, stdout: JSON.stringify(listing()), stderr: '' };
      if (args[0] === 'cat') {
        const key = (args[1] ?? '').replace(/^r2:tha-bay-media-staging\//, '');
        return existsSync(path.join(s.target, key)) ? { status: 0, stdout: readFileSync(path.join(s.target, key), 'utf8'), stderr: '' } : { status: 3, stdout: '', stderr: 'object not found' };
      }
      if (args[0] === 'copy') return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: 'rclone v1.75.2', stderr: '' };
    };
    const archiveCalls = { n: 0 };
    const r = await s.run({ target: 'r2', processEnv: { R2_ACCESS_KEY_ID: 'k-test', R2_SECRET_ACCESS_KEY: 's-test', CLOUDFLARE_ACCOUNT_ID: 'acct-test' }, run, archive: laterHead(archiveCalls) });
    expect(r.res.code).toBe(0);
    expect(archiveCalls.n).toBe(0);
    expect(calls.filter((a) => a[0] === 'copy').some((a) => a.join(' ').includes('odbl/'))).toBe(false);
    expect(calls.some((a) => a[0] === 'cat' && a[1] === `r2:tha-bay-media-staging/odbl/${BAKE_ID}/index.json`)).toBe(true);
    expect(r.res.offer).toMatchObject({ existing: true, uploaded: 0 });
    expect(r.lines.join('\n')).toContain(`ODbL offer accepted: odbl/${BAKE_ID}/index.json in r2:tha-bay-media-staging`);
  });
});
