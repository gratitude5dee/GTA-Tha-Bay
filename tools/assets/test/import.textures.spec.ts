/** M10d0 AC-4: the texture importer (resize, KTX2 headers, outputs, provenance chain) and `--check` over the committed sets. */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';
import { checkDerivedKtx2Roots, checkLicensedRecord } from '../../../packages/shared/src/assets/gates/provenance.ts';
import type { ProvenanceRecord } from '../../../packages/shared/src/assets/provenance.ts';
import { sha256Hex, toolsRoot } from '../../ci/lib/common.ts';
import { loadPackRegister, snapshotHashes } from '../src/import/packs.ts';
import {
  assetDirOf, assetIdOf, basisEncoder, checkTextures, CODEC_OF, COLOR_MODEL_ETC1S, COLOR_MODEL_UASTC, gpuBytesOf, halve, importTextures, levelsFor,
  MANIFEST_PATH, MAP_NAMES, readKtx2, readManifest, resizeTo, SET_NAMES, TIER_SIZES, TIER_VARIANTS, TRANSFER_LINEAR, TRANSFER_SRGB,
  type Ktx2Encoder, type Raster, type TextureManifest,
} from '../src/import/texture-set.ts';

const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});
const mk = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'dv-tex-'));
  tmp.push(d);
  return d;
};

function gradient(size: number): Raster {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      data[o] = x % 256;
      data[o + 1] = y % 256;
      data[o + 2] = 128;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/** A minimal KTX2 container with the header fields the importer reads (no image data). */
function fakeKtx2(size: number, map: 'albedo' | 'normal' | 'orm'): Uint8Array {
  const b = new Uint8Array(160);
  const dv = new DataView(b.buffer);
  b.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  dv.setUint32(20, size, true);
  dv.setUint32(24, size, true);
  dv.setUint32(40, levelsFor(size), true);
  dv.setUint32(44, map === 'albedo' ? 1 : 2, true);
  dv.setUint32(48, 100, true); // dfdByteOffset
  b[100 + 12] = map === 'albedo' ? COLOR_MODEL_ETC1S : COLOR_MODEL_UASTC;
  b[100 + 14] = map === 'albedo' ? TRANSFER_SRGB : TRANSFER_LINEAR;
  b[150] = size & 0xff; // keeps the bytes of different sizes apart
  b[151] = size >> 8;
  b[152] = map === 'albedo' ? 1 : map === 'normal' ? 2 : 3;
  return b;
}

const fakeEncoder: Ktx2Encoder = {
  version: 'fake@0',
  async encode(img, map) {
    return fakeKtx2(img.width, map);
  },
};

describe('image helpers', () => {
  it('halves with a box filter and reaches each tier size', () => {
    const src = gradient(1024);
    const h = halve(src, false);
    expect(h.width).toBe(512);
    expect(resizeTo(src, 1024, false)).toBe(src);
    expect(resizeTo(src, 256, false).width).toBe(256);
    expect(() => resizeTo(gradient(512), 1024, false)).toThrow(/below/);
    expect(() => resizeTo({ width: 1024, height: 256, data: new Uint8Array(1024 * 256 * 4) }, 256, false)).toThrow(/square/);
  });

  it('renormalises averaged normals', () => {
    const data = new Uint8Array(2 * 2 * 4);
    // Two opposite tilts average to a short vector: halve(normal) renormalises it to unit length.
    const set = (i: number, x: number, y: number, z: number): void => {
      data.set([Math.round((x * 0.5 + 0.5) * 255), Math.round((y * 0.5 + 0.5) * 255), Math.round((z * 0.5 + 0.5) * 255), 255], i * 4);
    };
    set(0, 0.6, 0, 0.8);
    set(1, -0.6, 0, 0.8);
    set(2, 0.6, 0, 0.8);
    set(3, -0.6, 0, 0.8);
    const out = halve({ width: 2, height: 2, data }, true);
    const v = [0, 1, 2].map((c) => ((out.data[c] as number) / 255) * 2 - 1);
    expect(Math.hypot(...(v as [number, number, number]))).toBeCloseTo(1, 1);
    expect(v[2]).toBeCloseTo(1, 1);
  });

  it('counts the GPU bytes of a full mip chain in an 8 bit per texel format', () => {
    expect(gpuBytesOf(1024, 1024, levelsFor(1024))).toBe(1_398_128);
    expect(gpuBytesOf(256, 256, levelsFor(256))).toBe(87_408);
    expect(levelsFor(512)).toBe(10);
  });
});

describe('the encoder', () => {
  it('writes KTX2: ETC1S with an sRGB transfer for albedo, UASTC with a linear one for normal and orm', async () => {
    const enc = await basisEncoder();
    const albedo = readKtx2(await enc.encode(gradient(64), 'albedo'));
    expect(albedo).toMatchObject({ width: 64, height: 64, levels: 7, colorModel: COLOR_MODEL_ETC1S, transfer: TRANSFER_SRGB });
    const normal = readKtx2(await enc.encode(gradient(64), 'normal'));
    expect(normal).toMatchObject({ width: 64, height: 64, levels: 7, colorModel: COLOR_MODEL_UASTC, transfer: TRANSFER_LINEAR });
    const orm = readKtx2(await enc.encode(gradient(64), 'orm'));
    expect(orm).toMatchObject({ colorModel: COLOR_MODEL_UASTC, transfer: TRANSFER_LINEAR });
  }, 120_000);

  it('readKtx2 refuses other bytes', () => {
    expect(readKtx2(new Uint8Array(200))).toBeNull();
  });
});

describe('the manifest', () => {
  const manifest = readManifest(toolsRoot);
  it('lists the six sets, each with three pinned Poly Haven source maps', () => {
    expect(manifest.sets.map((s) => s.set).sort()).toEqual([...SET_NAMES].sort());
    for (const s of manifest.sets) {
      expect(s.pack).toBe('polyhaven');
      expect(s.pageUrl).toBe(`https://polyhaven.com/a/${s.assetId}`);
      expect(s.tileM).toBeGreaterThan(0.5);
      for (const m of MAP_NAMES) {
        expect(s.maps[m].sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(new URL(s.maps[m].url).hostname).toBe('dl.polyhaven.org');
      }
    }
  });

  it('every source host belongs to a pack of the register', () => {
    const reg = loadPackRegister(toolsRoot);
    for (const s of manifest.sets) {
      for (const m of MAP_NAMES) {
        const host = new URL(s.maps[m].url).hostname;
        expect(reg.packs.some((p) => p.id === s.pack && p.hosts.includes(host))).toBe(true);
      }
    }
  });
});

describe('committed outputs (--check)', () => {
  it('18 assets of three KTX2 variants each pass', () => {
    const res = checkTextures(toolsRoot);
    expect(res.findings).toEqual([]);
    expect(res.assets).toBe(18);
  });

  it('every asset has the sizes and codec of the milestone, texGpuBytes, and derived records rooted in an approved licensed record', { timeout: 120_000 }, () => {
    const reg = loadPackRegister(toolsRoot);
    const snap = snapshotHashes(toolsRoot, reg.packs);
    const manifest = readManifest(toolsRoot);
    const recs: ProvenanceRecord[] = [];
    const dir = path.join(toolsRoot, 'assets/provenance');
    for (const sub of readdirSync(dir)) for (const f of readdirSync(path.join(dir, sub))) recs.push(JSON.parse(readFileSync(path.join(dir, sub, f), 'utf8')) as ProvenanceRecord);
    const bySha = new Map(recs.map((r) => [r.sha256, r]));
    const nodeSha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
    for (const s of manifest.sets) {
      for (const m of MAP_NAMES) {
        const spec = JSON.parse(readFileSync(path.join(toolsRoot, assetDirOf(s.set, m), 'asset.json'), 'utf8')) as { id: string; codec: { tex: string }; stats: Record<string, { texMaxPx: number; texGpuBytes: number }> };
        expect(spec.id).toBe(assetIdOf(s.set, m));
        expect(spec.codec.tex).toBe(CODEC_OF[m]);
        for (const v of TIER_VARIANTS) {
          const bytes = readFileSync(path.join(toolsRoot, assetDirOf(s.set, m), `${v}.ktx2`));
          const info = readKtx2(bytes);
          expect(info?.width).toBe(TIER_SIZES[v]);
          expect(spec.stats[v]?.texGpuBytes).toBe(gpuBytesOf(TIER_SIZES[v], TIER_SIZES[v], levelsFor(TIER_SIZES[v])));
          const rec = bySha.get(nodeSha(bytes));
          expect(rec?.origin).toBe('derived');
          expect(rec?.derived_from).toEqual([s.maps[m].sha256]);
        }
        const root = bySha.get(s.maps[m].sha256 ?? "");
        expect(root?.origin).toBe('licensed');
        expect(checkLicensedRecord(root as ProvenanceRecord, { packs: reg.packs, snapshotSha: snap })).toEqual([]);
      }
    }
    expect(checkDerivedKtx2Roots(recs)).toEqual([]);
  });

  it('refuses a wrong size, a wrong codec and a missing record', () => {
    const root = mk();
    cpSync(path.join(toolsRoot, 'assets/import'), path.join(root, 'assets/import'), { recursive: true });
    const one: TextureManifest = JSON.parse(readFileSync(path.join(root, MANIFEST_PATH), 'utf8')) as TextureManifest;
    one.sets = one.sets.filter((s) => s.set === 'asphalt');
    writeFileSync(path.join(root, MANIFEST_PATH), JSON.stringify(one));
    for (const m of MAP_NAMES) {
      cpSync(path.join(toolsRoot, assetDirOf('asphalt', m)), path.join(root, assetDirOf('asphalt', m)), { recursive: true });
    }
    // Without the provenance records and with the wrong set list.
    const missing = checkTextures(root).findings.map((f) => f.rule);
    expect(missing).toContain('sets');
    expect(missing).toContain('record-missing');
    // A 256 px file under the desktop name.
    const dst = path.join(root, assetDirOf('asphalt', 'albedo'), 'desktop.ktx2');
    writeFileSync(dst, readFileSync(path.join(toolsRoot, assetDirOf('asphalt', 'albedo'), 'mobile-low.ktx2')));
    expect(checkTextures(root).findings.map((f) => f.rule)).toContain('size');
    // The wrong codec in the spec.
    const specFile = path.join(root, assetDirOf('asphalt', 'normal'), 'asset.json');
    const spec = JSON.parse(readFileSync(specFile, 'utf8')) as { codec: { tex: string } };
    spec.codec.tex = 'ktx2-etc1s';
    writeFileSync(specFile, JSON.stringify(spec));
    expect(checkTextures(root).findings.map((f) => f.rule)).toContain('codec');
  });
});

describe('importTextures (fake encoder)', () => {
  it('writes the variants, the spec and the provenance chain of a set from a pinned source', async () => {
    const root = mk();
    // One set, sources served from the cache with their hashes pinned.
    const png = new PNG({ width: 1024, height: 1024 });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = (i >> 4) & 255;
      png.data[i + 1] = 90;
      png.data[i + 2] = 60;
      png.data[i + 3] = 255;
    }
    const bytes = PNG.sync.write(png);
    const manifest = readManifest(toolsRoot);
    const set = { ...(manifest.sets.find((s) => s.set === 'asphalt') as TextureManifest['sets'][number]) };
    set.maps = {
      albedo: { ...set.maps.albedo, sha256: sha256Hex(bytes) },
      normal: { ...set.maps.normal, sha256: sha256Hex(bytes) },
      orm: { ...set.maps.orm, sha256: sha256Hex(bytes) },
    };
    mkdirSync(path.join(root, 'assets/import'), { recursive: true });
    writeFileSync(path.join(root, MANIFEST_PATH), JSON.stringify({ schema: 'texture-import/1', sets: [set] }));
    mkdirSync(path.join(root, '.cache/import/polyhaven'), { recursive: true });
    for (const m of MAP_NAMES) writeFileSync(path.join(root, '.cache/import/polyhaven', set.maps[m].file), bytes);
    await importTextures({ root, encoder: fakeEncoder, only: ['asphalt'] });
    for (const m of MAP_NAMES) {
      for (const v of TIER_VARIANTS) {
        const f = path.join(root, assetDirOf('asphalt', m), `${v}.ktx2`);
        expect(readKtx2(readFileSync(f))?.width).toBe(TIER_SIZES[v]);
      }
    }
    // Same bytes in three source maps give one root record; the derived records differ by map and size.
    const recs = (): ProvenanceRecord[] => {
      const out: ProvenanceRecord[] = [];
      const dir = path.join(root, 'assets/provenance');
      for (const sub of readdirSync(dir)) for (const f of readdirSync(path.join(dir, sub))) out.push(JSON.parse(readFileSync(path.join(dir, sub, f), 'utf8')) as ProvenanceRecord);
      return out;
    };
    const all = recs();
    expect(all.filter((r) => r.origin === 'licensed')).toHaveLength(1);
    expect(all.filter((r) => r.origin === 'derived').length).toBeGreaterThanOrEqual(7);
    expect(checkDerivedKtx2Roots(all)).toEqual([]);
  });

  it('refuses a source whose hash is not the pinned one', async () => {
    const root = mk();
    const manifest = readManifest(toolsRoot);
    const set = manifest.sets.find((s) => s.set === 'asphalt') as TextureManifest['sets'][number];
    mkdirSync(path.join(root, 'assets/import'), { recursive: true });
    writeFileSync(path.join(root, MANIFEST_PATH), JSON.stringify({ schema: 'texture-import/1', sets: [set] }));
    mkdirSync(path.join(root, '.cache/import/polyhaven'), { recursive: true });
    writeFileSync(path.join(root, '.cache/import/polyhaven', set.maps.albedo.file), new Uint8Array([1, 2, 3]));
    await expect(importTextures({ root, encoder: fakeEncoder, only: ['asphalt'] })).rejects.toThrow(/differs from the manifest/);
  });
});
