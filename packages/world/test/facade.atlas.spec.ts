/** M10d2: the facade atlas of the desktop tiers (`chunks/facade.ts`), its config and the committed `texture/facade-atlas` asset. */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { float, vec3, type L } from '../src/client/sky/tsl.ts';
import {
  ATLAS_TIERS, FACADE_ATLAS, FacadeAtlas, atlasTier, atlasUv, installFacadeAtlas, installedFacadeAtlas, tilePairs, withFacadeAtlas, facadeAtlasAlbedo,
} from '../src/client/chunks/facade.ts';
import type { WallOut } from '../src/client/look/facade.ts';
import { bootSet } from '../src/sim/streaming/boot.ts';

const ROOT = new URL('../../../', import.meta.url);
const read = (rel: string): Uint8Array => new Uint8Array(readFileSync(new URL(rel, ROOT)));

/** Width, height and level count of a KTX2 header. */
function ktx2(b: Uint8Array): { w: number; h: number; levels: number } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: dv.getUint32(20, true), h: dv.getUint32(24, true), levels: dv.getUint32(40, true) };
}

const wall = (): WallOut => ({ color: vec3(0.5, 0.4, 0.3), roughness: float(0.8), metalness: float(0), emissive: vec3(0, 0, 0), glass: float(0) });
const input = (): { kind: L; seed: L; u: L; v: L } => ({ kind: float(2), seed: float(0.25), u: float(3), v: float(5) });

afterEach(() => installFacadeAtlas(null));

describe('facade atlas config and asset', () => {
  it('is a 4 x 4 grid of 16 tiles; every class picks four tiles that exist', () => {
    expect(FACADE_ATLAS.asset).toBe('texture/facade-atlas');
    expect(FACADE_ATLAS.tiles).toHaveLength(FACADE_ATLAS.grid * FACADE_ATLAS.grid);
    expect(FACADE_ATLAS.classes).toHaveLength(6);
    for (const c of FACADE_ATLAS.classes) {
      expect(c).toHaveLength(4);
      for (const t of c) expect(t).toBeLessThan(FACADE_ATLAS.tiles.length);
    }
    const pairs = tilePairs();
    expect(pairs).toHaveLength(24);
    for (const p of pairs) expect(p.tileM).toBeGreaterThan(1);
  });

  it('commits the desktop (1024 px), mobile (512 px) and mobile-low (256 px) KTX2 variants with full mip chains, and a spec that names them', () => {
    const spec = JSON.parse(new TextDecoder().decode(read('assets/src/texture/facade-atlas/asset.json'))) as { variants: Record<string, string>; codec: { tex: string } };
    expect(Object.keys(spec.variants).sort()).toEqual(['desktop', 'mobile', 'mobile-low']);
    expect(spec.codec.tex).toBe('ktx2-etc1s');
    expect(ktx2(read('assets/src/texture/facade-atlas/desktop.ktx2'))).toEqual({ w: 1024, h: 1024, levels: 11 });
    expect(ktx2(read('assets/src/texture/facade-atlas/mobile.ktx2'))).toEqual({ w: 512, h: 512, levels: 10 });
    expect(ktx2(read('assets/src/texture/facade-atlas/mobile-low.ktx2'))).toEqual({ w: 256, h: 256, levels: 9 });
  });

  it('maps a wall point into its tile, inset, with wall-up as image-up', () => {
    const [u0, v0] = atlasUv(5, 0, 0);
    const [u1, v1] = atlasUv(5, 0.999, 0.999);
    // tile 5 is column 1, row 1 of the grid
    for (const u of [u0, u1]) expect(u).toBeGreaterThan(0.25);
    for (const u of [u0, u1]) expect(u).toBeLessThan(0.5);
    for (const v of [v0, v1]) expect(v).toBeGreaterThan(0.25);
    for (const v of [v0, v1]) expect(v).toBeLessThan(0.5);
    expect(v0).toBeGreaterThan(v1);
    // whole repeats land on the same spot
    expect(atlasUv(5, 2.25, 7.5)).toEqual(atlasUv(5, 0.25, 0.5));
  });
});

describe('FacadeAtlas on the tiers', () => {
  it('draws on desktop-ultra, desktop and (M02h7) mobile; mobile-low and XR request nothing', async () => {
    expect(ATLAS_TIERS).toEqual(['desktop-ultra', 'desktop', 'mobile']);
    for (const tier of ['mobile-low', 'xr-quest', 'xr-visionpro'] as const) {
      expect(atlasTier(tier)).toBe(false);
      const a = new FacadeAtlas(tier, true);
      const calls: unknown[] = [];
      await a.load({ job: async (n, args) => void calls.push([n, args]) }, () => null);
      expect(calls).toEqual([]);
      expect(a.info()).toMatchObject({ on: false, variant: null, requested: false, loaded: false });
      a.dispose();
    }
    // the boot art of mobile-low holds no atlas either
    expect(bootSet({ tiles: { p0: [], l0: [], l1: [], l2: [] } } as never, { x: 0, z: 0 }, 'mobile-low').art).toEqual([]);
  });

  it('on desktop requests texture/facade-atlas once through world.texture; a catalog without it leaves the walls as they were', async () => {
    const a = new FacadeAtlas('desktop', true);
    const calls: [string, unknown][] = [];
    await a.load({ job: async (n, args) => { calls.push([n, args]); return { missing: true }; } }, () => null);
    await a.load({ job: async () => ({ missing: true }) }, () => null);
    expect(calls).toEqual([['world.texture', { ref: 'texture/facade-atlas', tier: 'desktop' }]]);
    expect(a.info()).toMatchObject({ on: true, variant: 'desktop', requested: true, loaded: false, failed: 'not in the catalog' });
    expect(a.weight.value).toBe(0);
    expect(a.hook.get()).toBeNull();
    a.dispose();
  });

  it('M02h7: on mobile requests the atlas once with the tier (the catalog serves the mobile variant) and reports that variant', async () => {
    const a = new FacadeAtlas('mobile', true);
    const calls: [string, unknown][] = [];
    await a.load({ job: async (n, args) => { calls.push([n, args]); return { missing: true }; } }, () => null);
    expect(calls).toEqual([['world.texture', { ref: 'texture/facade-atlas', tier: 'mobile' }]]);
    expect(a.info()).toMatchObject({ on: true, variant: 'mobile', requested: true });
    a.dispose();
  });

  it('with the atlas off (?textures=0, ?art=0) a desktop tier requests nothing', async () => {
    const a = new FacadeAtlas('desktop', false);
    let called = false;
    await a.load({ job: async () => { called = true; return { missing: true }; } }, () => null);
    expect(called).toBe(false);
    expect(a.info().on).toBe(false);
    a.dispose();
  });
});

describe('withFacadeAtlas (the art hook of the wall albedo)', () => {
  it('returns the wall itself without an installed atlas, on min, and off the atlas tiers; the seam is null there too (M02h7)', () => {
    const w = wall();
    installFacadeAtlas(null);
    expect(withFacadeAtlas('full', w, input())).toBe(w);
    expect(facadeAtlasAlbedo('full', input())).toBeNull();
    installFacadeAtlas(new FacadeAtlas('desktop', true));
    expect(installedFacadeAtlas()?.tier).toBe('desktop');
    expect(withFacadeAtlas('min', w, input())).toBe(w);
    expect(facadeAtlasAlbedo('min', input())).toBeNull();
    expect(facadeAtlasAlbedo('full', input())).not.toBeNull();
    // M02h7: the mobile variant draws on `lite` through the seam
    installFacadeAtlas(new FacadeAtlas('mobile', true));
    expect(facadeAtlasAlbedo('lite', input())).not.toBeNull();
    installFacadeAtlas(new FacadeAtlas('mobile-low', true));
    expect(facadeAtlasAlbedo('lite', input())).toBeNull();
    expect(withFacadeAtlas('full', w, input())).toBe(w);
    installFacadeAtlas(null);
  });

  it('on full builds a new colour node and keeps roughness, metalness, emissive and glass', () => {
    const w = wall();
    installFacadeAtlas(new FacadeAtlas('desktop-ultra', true));
    const out = withFacadeAtlas('full', w, input());
    expect(out).not.toBe(w);
    expect(out.color).not.toBe(w.color);
    expect(out.roughness).toBe(w.roughness);
    expect(out.metalness).toBe(w.metalness);
    expect(out.emissive).toBe(w.emissive);
    expect(out.glass).toBe(w.glass);
  });
});
