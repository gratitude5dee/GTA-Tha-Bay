/**
 * M02h7 AC-3: the façade shading of the kit. Every look material builds on `full`, `lite` and `min`; the window reveal bump exists only on
 * `full`; `facade.ts` takes `skyReflect` from `look/sky-reflect.ts` and defines none of its own; the `albedo` seam is called once on `full`
 * and `lite` and never on `min`; a null atlas hook with textures off creates no texture node; with the wall bindings the seam samples
 * brick and stucco on `full` and `lite` (and nothing on `mobile-low`); shop signs glow by the hour (0 at 13:00, lit at 22:00).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { QualityTierId } from '@dv/shared';
import { DepthRules } from '../src/client/chunks/depth.ts';
import { FacadeAtlas, facadeAtlasAlbedo, installFacadeAtlas } from '../src/client/chunks/facade.ts';
import { createLookNodes, facadeNodes, surfNodes } from '../src/client/look/common.ts';
import { LOOK, lookProfileFor } from '../src/client/look/config.ts';
import { awningNodes, flagBit, wallNodes, type WallProfile } from '../src/client/look/facade.ts';
import { createLookMaterials } from '../src/client/look/look-materials.ts';
import { shopGlow } from '../src/client/look/windows.ts';
import { createSkyNodes } from '../src/client/sky/nodes.ts';
import { float, vec3, type L } from '../src/client/sky/tsl.ts';
import { wallRefsFor } from '../src/client/textures/config.ts';
import { SurfaceTextures, installSurfaceTextures, wallTexturesAlbedo } from '../src/client/textures/surface-textures.ts';

const PROFILES: WallProfile[] = ['full', 'lite', 'min'];

function wallOf(profile: WallProfile, albedo?: (b: L) => L): ReturnType<typeof wallNodes> {
  const s = surfNodes();
  return wallNodes({ profile, look: LOOK, n: createLookNodes(createSkyNodes(), 0), kind: s.kind, pal: s.pal, flags: s.flags, fac: facadeNodes(), foundationM: 1.5, parapetM: 0.5, albedo });
}

/**
 * The two places a wall texture node is made: the wall sets' `wallAlbedo` (brick, stucco) and the atlas's `albedo`; spied so a test can say
 * whether the building material's graph asked for one (an `Fn` body is built lazily, so a graph walk does not see into it).
 */
function textureCalls(): { walls: () => number; atlas: () => number; restore: () => void } {
  const w = vi.spyOn(SurfaceTextures.prototype, 'wallAlbedo');
  const a = vi.spyOn(FacadeAtlas.prototype, 'albedo');
  return { walls: () => w.mock.calls.length, atlas: () => a.mock.calls.length, restore: () => (w.mockRestore(), a.mockRestore()) };
}

const textures = (tier: QualityTierId): SurfaceTextures =>
  new SurfaceTextures({ tier, profile: lookProfileFor(tier, true, LOOK), enabled: true, backend: 'webgl2', browser: 'chromium' });

describe('facade.materials (AC-3)', () => {
  it.each(PROFILES)('%s: the look materials build, and the reveal bump is on full only', (profile) => {
    installFacadeAtlas(null);
    installSurfaceTextures(null);
    const set = createLookMaterials({ profile, look: LOOK, nodes: createLookNodes(createSkyNodes(), 0), foundationM: 1.5, parapetM: 0.5, depth: new DepthRules() });
    const b = set.l0.buildings as unknown as { normalNode: unknown; colorNode: unknown };
    expect(b.colorNode).toBeTruthy();
    expect(!!b.normalNode).toBe(profile === 'full');
    expect(!!wallOf(profile).normal).toBe(profile === 'full');
    // the min profile's flat bands
    expect(!!wallOf(profile).band).toBe(profile === 'min');
    set.dispose();
  });

  it('facade.ts imports skyReflect from look/sky-reflect.ts and defines none of its own', () => {
    const src = readFileSync(new URL('../src/client/look/facade.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/import \{[^}]*\bskyReflect\b[^}]*\} from '\.\/sky-reflect\.ts';/);
    expect(src).not.toMatch(/function skyReflect|const skyReflect|skyReflect\s*=/);
    expect(src).not.toMatch(/ShaderMaterial|gl_FragColor|#version/);
  });

  it('the albedo seam is called once on full and lite and never on min', () => {
    for (const profile of PROFILES) {
      let calls = 0;
      wallOf(profile, (base) => {
        calls++;
        return base.mul(1.01);
      });
      expect(calls, profile).toBe(profile === 'min' ? 0 : 1);
    }
  });

  it('a null atlas hook with textures off creates no texture node', () => {
    installFacadeAtlas(null);
    installSurfaceTextures(null);
    const i = { kind: float(2), seed: float(0.3), u: float(1), v: float(2) };
    expect(facadeAtlasAlbedo('full', i)).toBeNull();
    expect(wallTexturesAlbedo({ id: float(21), u: float(1), v: float(2) })).toBeNull();
    // the atlas switched off (`?textures=0`, `?art=0`) is the same as none
    installFacadeAtlas(new FacadeAtlas('desktop', false));
    expect(facadeAtlasAlbedo('full', i)).toBeNull();
    installSurfaceTextures(new SurfaceTextures({ tier: 'desktop', profile: 'full', enabled: false, backend: 'webgl2', browser: 'chromium' }));
    expect(wallTexturesAlbedo({ id: float(21), u: float(1), v: float(2) })).toBeNull();
    const spy = textureCalls();
    const set = createLookMaterials({ profile: 'full', look: LOOK, nodes: createLookNodes(createSkyNodes(), 0), foundationM: 1.5, parapetM: 0.5, depth: new DepthRules() });
    expect([spy.walls(), spy.atlas()]).toEqual([0, 0]);
    spy.restore();
    set.dispose();
    installFacadeAtlas(null);
    installSurfaceTextures(null);
  });

  it('with the wall bindings the seam samples brick and stucco on full and lite, and nothing on mobile-low', () => {
    for (const tier of ['desktop', 'mobile'] as const) {
      const t = textures(tier);
      expect(t.report().refs).toEqual(expect.arrayContaining(['texture/pbr.brick.albedo', 'texture/pbr.stucco.albedo']));
      installSurfaceTextures(t);
      const seam = wallTexturesAlbedo({ id: float(21), u: float(1), v: float(2) });
      expect(seam, tier).not.toBeNull();
      const base = vec3(0.5, 0.4, 0.3);
      expect((seam as (b: L) => L)(base)).not.toBe(base);
      // the building material samples the wall sets once (the seam is called once per wall graph)
      const spy = textureCalls();
      const set = createLookMaterials({ profile: lookProfileFor(tier, true, LOOK) as 'full' | 'lite', look: LOOK, nodes: createLookNodes(createSkyNodes(), 0), foundationM: 1.5, parapetM: 0.5, depth: new DepthRules() });
      expect(spy.walls(), tier).toBe(1);
      spy.restore();
      set.dispose();
      t.dispose();
    }
    const low = textures('mobile-low');
    installSurfaceTextures(low);
    expect(low.report().refs.filter((r) => r.includes('brick') || r.includes('stucco'))).toEqual([]);
    expect(wallTexturesAlbedo({ id: float(21), u: float(1), v: float(2) })).toBeNull();
    expect(wallRefsFor('albedo')).toEqual([]);
    low.dispose();
    installSurfaceTextures(null);
  });

  it('the awning branch and the flag bits build', () => {
    const n = createLookNodes(createSkyNodes(), 0);
    const a = awningNodes(LOOK, n, vec3(0.3, 0.1, 0.1), { u: float(1), seed: float(0.4) });
    expect(a.color).toBeTruthy();
    expect(a.roughness).toBeTruthy();
    expect(flagBit(float(15), 3)).toBeTruthy();
  });

  it('shop signs and shop glass glow by the hour: 0 at 13:00, lit at 22:00 (windows.shop)', () => {
    expect(shopGlow(13)).toBe(0);
    expect(shopGlow(22)).toBeGreaterThan(0.5);
    expect(shopGlow(46)).toBe(shopGlow(22));
    for (let h = 0; h < 24; h += 0.5) {
      expect(shopGlow(h)).toBeGreaterThanOrEqual(0);
      expect(shopGlow(h)).toBeLessThanOrEqual(1);
    }
  });
});
