import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../packages/shared/src/hash.ts';
import { toolsRoot } from '../../ci/lib/common.ts';
import { buildCatalogFrom, sha256Bytes } from '../src/catalog.ts';
import { readLock, recordMap } from '../src/lock.ts';
import { loadSpecs } from '../src/spec.ts';
import { seedTextures } from '../src/seed.ts';
import { addAsset, relock, STAMP, tempRepo } from './helpers.ts';

const KEY_RE = /^assets\/[a-z_]+\/[a-z0-9][a-z0-9._-]{1,62}\/(default|desktop-ultra|desktop|mobile|mobile-low|xr-quest|xr-visionpro)\.[0-9a-f]{12}\.[a-z0-9]+$/;
const roots: string[] = [];
function repo(): string {
  const r = tempRepo();
  roots.push(r);
  return r;
}
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function build(root: string) {
  const { specs } = loadSpecs(root);
  return buildCatalogFrom(specs, readLock(root), recordMap(root), STAMP);
}

describe('catalog builder', () => {
  it('is byte-identical across runs and keys every variant', () => {
    const root = repo();
    addAsset(root, { kind: 'world_pack', id: 'p0-test', variants: { default: { ext: 'pack', bytes: 'PACK-BYTES' } } });
    const a = build(root);
    const b = build(root);
    expect(a.manifestBytes.equals(b.manifestBytes)).toBe(true);
    expect(a.catalog.buildId).toBe(b.catalog.buildId);
    expect(Object.keys(a.catalog.entries).sort()).toEqual(['data/asset-smoke', 'texture/asset-smoke', 'world_pack/p0-test']);
    for (const [ref, m] of Object.entries(a.catalog.entries)) {
      for (const [vid, v] of Object.entries(m.variants)) {
        expect(v.key, `${ref} ${vid}`).toMatch(KEY_RE);
        expect(v.encoding).toBe('identity');
      }
    }
    expect(Object.keys(a.catalog.entries['world_pack/p0-test']?.variants ?? {})).toEqual(['default']);
    expect(a.pointer.sha256).toBe(sha256Bytes(a.manifestBytes));
    expect(a.pointer.bytes).toBe(a.manifestBytes.length);
    expect(a.pointer.key).toBe(`manifests/assets-${a.pointer.sha256}.json`);
  });

  it('records the file hash, size and content type for every variant', () => {
    const root = repo();
    const { specs } = loadSpecs(root);
    const c = build(root);
    for (const s of specs) {
      for (const f of s.files) {
        const v = c.catalog.entries[s.ref]?.variants[f.variant];
        expect(v?.sha256).toBe(sha256Hex(readFileSync(f.abs)));
        expect(v?.bytes).toBe(readFileSync(f.abs).length);
      }
    }
    expect(c.catalog.entries['texture/asset-smoke']?.variants.desktop?.contentType).toBe('image/png');
    expect(c.catalog.entries['data/asset-smoke']?.variants.default?.contentType).toBe('application/json');
  });

  it('node:crypto hashing equals the shared sha256Hex', () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252]);
    expect(sha256Bytes(bytes)).toBe(sha256Hex(bytes));
  });

  it('rev: lock rev when unchanged, +1 when a variant hash changes, 1 for a new asset', () => {
    const root = repo();
    expect(build(root).catalog.entries['data/asset-smoke']?.rev).toBe(1);
    // new bytes for an existing asset and a brand-new asset, both left un-locked
    addAsset(root, { kind: 'data', id: 'asset-smoke', variants: { default: { ext: 'json', bytes: '{"changed":true}\n' } }, lock: false });
    addAsset(root, { kind: 'data', id: 'asset-new', variants: { default: { ext: 'json', bytes: '{"n":1}' } }, lock: false });
    const c = build(root);
    expect(c.catalog.entries['data/asset-smoke']?.rev).toBe(2);
    expect(c.catalog.entries['data/asset-new']?.rev).toBe(1);
    expect(c.catalog.entries['texture/asset-smoke']?.rev).toBe(1);
  });

  it('walks derived_from to the root record for the provenance summary', () => {
    const root = repo();
    const parent = addAsset(root, { kind: 'data', id: 'src-asset', variants: { default: { ext: 'json', bytes: '{"p":1}' } } }).default as string;
    addAsset(root, { kind: 'data', id: 'derived-asset', variants: { default: { ext: 'json', bytes: '{"d":1}' } }, derivedFrom: { default: parent } });
    const m = build(root).catalog.entries['data/derived-asset'];
    expect(m?.provenance.root).toBe(parent);
    expect(m?.provenance.origin).toBe('authored');
  });

  it('keeps only active, public entries', () => {
    const root = repo();
    addAsset(root, { kind: 'data', id: 'hidden-one', variants: { default: { ext: 'json', bytes: '{"h":1}' } }, visibility: 'private' });
    addAsset(root, { kind: 'data', id: 'killed-one', variants: { default: { ext: 'json', bytes: '{"k":1}' } }, status: 'killed' });
    relock(root);
    const refs = Object.keys(build(root).catalog.entries);
    expect(refs).toEqual(['data/asset-smoke', 'texture/asset-smoke']);
  });

  it('the committed smoke textures match a fresh render', () => {
    expect(seedTextures(toolsRoot, true)).toEqual([]);
    expect(path.basename(toolsRoot).length).toBeGreaterThan(0);
  });
});
