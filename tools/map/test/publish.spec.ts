import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveVariant, type AssetManifest } from '../../../packages/shared/src/assets/c07.ts';
import { TIERS } from '../../assets/src/verify.ts';
import { rootRecord } from '../../assets/src/lock.ts';
import { repoRoot } from '../../ci/run.ts';
import { schemaValidator, sha256Hex } from '../../ci/lib/common.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';
import { resolveBake } from '../src/cli.ts';
import { packBake } from '../src/pack/index.ts';
import { parseTarget, publishPack, worldLock } from '../src/pack/publish.ts';
import { loadSources } from '../src/config.ts';
import { bakeExcerpt } from './helpers.ts';

const lockFile = path.join(repoRoot, 'assets', 'assets.lock.json');
const cfg = loadSources();

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

describe('map:pack to a directory target (civic-excerpt)', () => {
  it('writes one manifest and one valid provenance record per pack, a fragment, and the blobs at their keys', async () => {
    const b = await bakeExcerpt();
    const target = mkdtempSync(path.join(tmpdir(), 'dv-pack-'));
    const lockBefore = sha256Hex(readFileSync(lockFile));
    const logs: string[] = [];
    const r = await publishPack({ bakeDir: b.outDir, target: { kind: 'dir', path: target }, cfg, log: (l) => logs.push(l) });
    expect(r.code).toBe(0);
    // every file under packs/ (p0, l0, l1, l2, far-bay-*, sf-graph.v1) plus data/world-index and data/transit-routes.v1
    const nBlobs = readdirSync(path.join(b.outDir, 'packs')).length + 2;
    expect(r.packed.blobs).toHaveLength(nBlobs);
    expect(r.packed.manifests).toHaveLength(nBlobs);

    const manifests = readdirSync(path.join(b.outDir, 'manifests'));
    expect(manifests).toHaveLength(nBlobs);
    expect(manifests).toContain('map_data.sf-graph.v1.json');
    expect(manifests).toContain('data.transit-routes.v1.json');
    expect(manifests).toContain('texture.far-bay-cards.json');
    expect(manifests).toContain('world_pack.p0-64-64.json');
    expect(manifests).toContain('data.world-index.json');

    const validate = schemaValidator('provenance-1.0');
    const records = walkFiles(path.join(b.outDir, 'provenance')).map((f) => JSON.parse(readFileSync(f, 'utf8')) as { sha256: string; origin: string; derived_from: string[] });
    expect(records).toHaveLength(nBlobs + 10); // one per blob and one per source stamp (nine raw sources and content-world)
    for (const rec of records) expect(validate(rec), rec.sha256).toEqual([]);
    expect(records.filter((x) => x.origin === 'derived')).toHaveLength(nBlobs);
    expect(records.filter((x) => x.origin === 'open_data')).toHaveLength(5);
    expect(records.filter((x) => x.origin === 'authored')).toHaveLength(5); // the synthetic OSM, street, stop and pattern parts and content-world

    for (const m of r.packed.manifests) {
      const blob = r.packed.blobs.find((x) => x.ref === `${m.kind}/${m.id}`)!;
      expect(existsSync(path.join(target, blob.key))).toBe(true);
      expect(sha256Hex(readFileSync(path.join(target, blob.key)))).toBe(blob.sha256);
      expect(Object.keys(m.variants)).toEqual(['default']);
    }
    const bySha = new Map(r.packed.records.map((x) => [x.sha256, x]));
    for (const blob of r.packed.blobs) {
      const rec = bySha.get(blob.sha256)!;
      expect(rec.derived_from).toHaveLength(10);
      expect(rootRecord(blob.sha256, bySha)).toBeDefined();
    }
    expect(sha256Hex(readFileSync(lockFile))).toBe(lockBefore);
    expect(logs.join('\n')).toContain('map:pack ok');
  });

  it('resolves every world_pack ref in catalog.fragment.json through default for all six tiers', async () => {
    const b = await bakeExcerpt();
    const target = mkdtempSync(path.join(tmpdir(), 'dv-pack-'));
    await publishPack({ bakeDir: b.outDir, target: { kind: 'dir', path: target }, cfg, log: () => {} });
    const fragment = JSON.parse(readFileSync(path.join(b.outDir, 'catalog.fragment.json'), 'utf8')) as { bakeId: string; entries: AssetManifest[] };
    expect(fragment.bakeId).toBe(b.result.bakeId);
    const packs = fragment.entries.filter((e) => e.kind === 'world_pack');
    expect(packs).toHaveLength(readdirSync(path.join(b.outDir, 'packs')).filter((n) => n.endsWith('.pack') && !n.startsWith('sf-graph')).length);
    expect(fragment.entries.map((e) => `${e.kind}/${e.id}`)).toEqual([...fragment.entries.map((e) => `${e.kind}/${e.id}`)].sort());
    for (const e of fragment.entries) for (const tier of TIERS) expect(resolveVariant(e, tier)).toBe(e.variants.default);
  });

  it('is a no-op the second time and byte-identical across packings', async () => {
    const b = await bakeExcerpt();
    const target = mkdtempSync(path.join(tmpdir(), 'dv-pack-'));
    const a = packBake(b.outDir, cfg);
    await publishPack({ bakeDir: b.outDir, target: { kind: 'dir', path: target }, cfg, log: () => {} });
    const first = readFileSync(path.join(b.outDir, 'catalog.fragment.json'), 'utf8');
    const again = await publishPack({ bakeDir: b.outDir, target: { kind: 'dir', path: target }, cfg, log: () => {} });
    expect(again.uploaded).toBe(0);
    expect(readFileSync(path.join(b.outDir, 'catalog.fragment.json'), 'utf8')).toBe(first);
    expect(JSON.stringify(packBake(b.outDir, cfg))).toBe(JSON.stringify(a));
  });

  it('prints SKIP and exits 0 for an r2 target without secrets, and refuses an r2 target for a non-sf bake', async () => {
    const b = await bakeExcerpt();
    const logs: string[] = [];
    const none = await publishPack({ bakeDir: b.outDir, target: { kind: 'r2', env: 'staging' }, cfg, env: {}, log: (l) => logs.push(l) });
    expect(none.code).toBe(2); // the excerpt is not the sf bake
    expect(logs.join('\n')).toContain('sf bake only');
  });

  it('as the sf bake: SKIPs without secrets, and with a stub rclone writes assets/world/sf.lock.json and records only', async () => {
    const b = await bakeExcerpt();
    const copy = mkdtempSync(path.join(tmpdir(), 'dv-sf-'));
    cpSync(b.outDir, copy, { recursive: true });
    const rep = JSON.parse(readFileSync(path.join(copy, 'bake-report.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(path.join(copy, 'bake-report.json'), JSON.stringify({ ...rep, area: 'sf' }));
    const logs: string[] = [];
    const skipped = await publishPack({ bakeDir: copy, target: { kind: 'r2', env: 'staging' }, cfg, env: {}, log: (l) => logs.push(l) });
    expect(skipped.code).toBe(0);
    expect(skipped.skipped).toMatch(/R2_ACCESS_KEY_ID/);
    expect(logs.join('\n')).toMatch(/^SKIP map:pack r2:staging: .*R2_ACCESS_KEY_ID.* not set/m);

    const root = mkdtempSync(path.join(tmpdir(), 'dv-sf-root-'));
    const calls: string[][] = [];
    const run = (_cmd: string, args: string[]): { status: number; stdout: string; stderr: string } => {
      calls.push(args);
      if (args[0] === 'lsjson') {
        const listed = packBake(copy, cfg).blobs.map((x) => ({ Path: x.key, Size: x.bytes }));
        return { status: 0, stdout: JSON.stringify(listed), stderr: '' };
      }
      return { status: 0, stdout: '', stderr: args[0] === 'copy' ? 'Copied (new)' : '' };
    };
    const env = { R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 'b', CLOUDFLARE_ACCOUNT_ID: 'c' };
    const ok = await publishPack({ bakeDir: copy, target: { kind: 'r2', env: 'staging' }, cfg, env, run, root, log: () => {}, approvedBy: 'tester' });
    expect(ok.code).toBe(0);
    expect(calls.some((a) => a[0] === 'copy' && a.includes('r2:tha-bay-media-staging'))).toBe(true);
    const worldLockFile = JSON.parse(readFileSync(path.join(root, 'assets', 'world', 'sf.lock.json'), 'utf8')) as { schema: string; entries: Record<string, { variants: { default: string }; approved_by: string }> };
    expect(worldLockFile.schema).toBe('asset-lock/1');
    expect(Object.keys(worldLockFile.entries)).toHaveLength(ok.packed.blobs.length);
    expect(worldLockFile.entries['world_pack/p0-64-64']!.approved_by).toBe('tester');
    expect(existsSync(path.join(root, 'assets', 'assets.lock.json'))).toBe(false);
    expect(existsSync(path.join(root, 'apps'))).toBe(false);
    const recs = walkFiles(path.join(root, 'assets', 'provenance'));
    expect(recs).toHaveLength(ok.packed.blobs.length + 10);
  });

  it('never invents the committed pointers or the main lock', () => {
    const packed = worldLock({ blobs: [], records: [], manifests: [], fragment: { bakeId: 'x', entries: [] }, bakeId: 'x', area: 'sf', synthetic: false }, 'h', '2026-10-19T00:00:00Z');
    expect(packed).toEqual({ schema: 'asset-lock/1', entries: {} });
  });

  it('parses the targets', () => {
    expect(parseTarget('dir:/tmp/x')).toEqual({ kind: 'dir', path: '/tmp/x' });
    expect(parseTarget('r2:staging')).toEqual({ kind: 'r2', env: 'staging' });
    expect(parseTarget('r2:prod')).toEqual({ kind: 'r2', env: 'prod' });
    expect(parseTarget('r2:other')).toBeNull();
    expect(parseTarget('dir:')).toBeNull();
    expect(parseTarget('s3:bucket')).toBeNull();
  });

  it('finds a bake by id, by area pointer and refuses junk', () => {
    expect(resolveBake({ bake: 'nothex' })).toMatch(/64 lowercase hex/);
    expect(resolveBake({ bake: 'a'.repeat(64) }, mkdtempSync(path.join(tmpdir(), 'dv-none-')))).toMatch(/no finished bake/);
    expect(resolveBake({}, mkdtempSync(path.join(tmpdir(), 'dv-none-')))).toMatch(/no latest.json/);
  });
});

describe('map:pack on the synth bake (AC-5; needs pnpm map:build -- --area synth)', () => {
  const bake = requireBake('synth', 'publish.spec');
  const run = bake ? it : it.skip;

  run('writes one manifest and one valid record per pack and leaves assets.lock.json unchanged', async () => {
    const target = mkdtempSync(path.join(tmpdir(), 'dv-pack-synth-'));
    const lockBefore = sha256Hex(readFileSync(lockFile));
    const r = await publishPack({ bakeDir: bake!.dir, target: { kind: 'dir', path: target }, cfg, log: () => {} });
    expect(r.code).toBe(0);
    const packs = r.packed.manifests.filter((m) => m.kind === 'world_pack');
    expect(packs.length).toBeGreaterThan(200);
    expect(readdirSync(path.join(bake!.dir, 'manifests'))).toHaveLength(r.packed.manifests.length);
    const validate = schemaValidator('provenance-1.0');
    for (const rec of r.packed.records) expect(validate(rec)).toEqual([]);
    for (const m of r.packed.manifests) for (const tier of TIERS) expect(resolveVariant(m, tier).key).toBe(m.variants.default!.key);
    // synth stamps are authored and carry the owned licence
    expect(r.packed.synthetic).toBe(true);
    // ... except the content-world seeds, which are contributed to the ODbL database (DL-677)
    expect(r.packed.records.filter((x) => x.license !== 'LicenseRef-DeeVerse-Owned').map((x) => x.license)).toEqual(['ODbL-1.0']);
    expect(sha256Hex(readFileSync(lockFile))).toBe(lockBefore);
  }, 120_000);
});
