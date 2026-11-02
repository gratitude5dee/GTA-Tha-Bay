/**
 * BD-FIX-WEBGPU-TREES-01: the surface textures stay within the device's per-fragment texture limit. A look ground material binds the
 * sets' maps beside the DFG table of three's physical lighting, the environment map and the shadow cascades; at `desktop` that is
 * 12 + 1 + 1 + 3 = 17, one over WebGPU's 16 (the SwiftShader adapter of CI and Chrome), so `mapsWithin` leaves the last map out there and
 * nowhere else.
 */
import { describe, expect, it } from 'vitest';
import type { QualityTierId } from '@dv/shared';
import { TIERS } from '@dv/engine/platform/tier-config';
import { LOOK, lookProfileFor } from '../src/client/look/config.ts';
import {
  MAP_NAMES, boundSets, bakesEnvMap, groundReservedTextures, mapsWithin, refOf, refsFor, textureModeFor,
} from '../src/client/textures/config.ts';
import { SurfaceTextures, fragmentTextureLimit } from '../src/client/textures/surface-textures.ts';
import { float, vec3, type L } from '../src/client/sky/tsl.ts';
import type { WebGPURenderer } from 'three/webgpu';

const FLAT: readonly QualityTierId[] = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'];
const FULL = boundSets().length * MAP_NAMES.length;

/** The slots the world view gives the textures on a device whose fragment stage binds `limit` textures (world-view.ts `attach`). */
const slotsOf = (tier: QualityTierId, browser: string, limit: number): number =>
  limit - groundReservedTextures({ envMap: bakesEnvMap(lookProfileFor(tier, true, LOOK), browser), shadows: TIERS[tier].features.shadows.mode });

describe('groundReservedTextures and bakesEnvMap', () => {
  it('counts the DFG table, the environment map and one texture per shadow cascade', () => {
    expect(groundReservedTextures({ envMap: true, shadows: 'csm3' })).toBe(5);
    expect(groundReservedTextures({ envMap: false, shadows: 'csm3' })).toBe(4);
    expect(groundReservedTextures({ envMap: false, shadows: 'csm1' })).toBe(2);
    expect(groundReservedTextures({ envMap: false, shadows: 'blob' })).toBe(1);
    expect(groundReservedTextures({ envMap: true, shadows: 'none' })).toBe(2);
  });

  it('bakes an environment map on the full profile off WebKit only', () => {
    expect(bakesEnvMap('full', 'chromium')).toBe(true);
    expect(bakesEnvMap('full', 'safari')).toBe(false);
    for (const p of ['lite', 'min', 'legacy'] as const) expect(bakesEnvMap(p, 'chromium')).toBe(false);
  });
});

describe('mapsWithin', () => {
  it('keeps every map when the slots hold the full set', () => {
    for (const mode of ['stochastic', 'single', 'albedo', 'off'] as const) {
      for (const slots of [FULL, FULL + 7, Number.POSITIVE_INFINITY]) {
        const p = mapsWithin(mode, slots);
        expect(p.refs).toEqual(refsFor(mode));
        expect(p.capped).toEqual([]);
      }
    }
  });

  it('leaves out the orm maps from the last set first, then the normal maps, and the albedo last', () => {
    const sets = boundSets();
    const last = sets[sets.length - 1] as string;
    const one = mapsWithin('stochastic', FULL - 1);
    expect(one.capped).toEqual([refOf(last, 'orm')]);
    expect(one.maps[last]).toEqual(['albedo', 'normal']);
    for (const s of sets.slice(0, -1)) expect(one.maps[s]).toEqual([...MAP_NAMES]);
    expect(one.refs).toEqual(refsFor('stochastic').filter((r) => r !== refOf(last, 'orm')));

    const noOrm = mapsWithin('single', sets.length * 2);
    for (const s of sets) expect(noOrm.maps[s]).toEqual(['albedo', 'normal']);
    expect(noOrm.capped).toEqual(sets.map((s) => refOf(s, 'orm')).sort());

    const two = mapsWithin('stochastic', 2);
    expect(two.refs).toEqual([refOf(sets[0] as string, 'albedo'), refOf(sets[1] as string, 'albedo')]);
    for (const s of sets.slice(2)) expect(two.maps[s]).toEqual([]);

    expect(mapsWithin('stochastic', 0).refs).toEqual([]);
    expect(mapsWithin('stochastic', -3).capped).toEqual([...refsFor('stochastic')].sort());
    expect(mapsWithin('albedo', 3).refs).toEqual(refsFor('albedo').slice(0, 3));
  });

  it('caps one map at desktop on a 16-texture WebGPU device, nothing on the other tiers, on WebKit or on a 32-unit WebGL2 device', () => {
    for (const tier of FLAT) {
      const mode = textureModeFor(tier, lookProfileFor(tier, true, LOOK), true);
      const desktop = tier === 'desktop' || tier === 'desktop-ultra';
      expect(mapsWithin(mode, slotsOf(tier, 'chromium', 16)).capped, `${tier} chromium 16`).toEqual(desktop ? ['texture/pbr.grass-dirt.orm'] : []);
      expect(mapsWithin(mode, slotsOf(tier, 'safari', 16)).capped, `${tier} safari 16`).toEqual([]);
      expect(mapsWithin(mode, slotsOf(tier, 'chromium', 32)).capped, `${tier} chromium 32`).toEqual([]);
    }
    // the full desktop material: twelve surface maps, the DFG table, the environment map and three cascades
    expect(FULL + groundReservedTextures({ envMap: true, shadows: 'csm3' })).toBe(17);
  });
});

describe('fragmentTextureLimit', () => {
  const r = (backend: unknown): WebGPURenderer => ({ backend }) as unknown as WebGPURenderer;
  it('reads the WebGPU device limits (the lower of textures and samplers), WebGL2 texture units, or nothing', () => {
    expect(fragmentTextureLimit(r({ device: { limits: { maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16 } } }))).toBe(16);
    expect(fragmentTextureLimit(r({ device: { limits: { maxSampledTexturesPerShaderStage: 48, maxSamplersPerShaderStage: 16 } } }))).toBe(16);
    const gl = { MAX_TEXTURE_IMAGE_UNITS: 0x8872, getParameter: (p: number): unknown => (p === 0x8872 ? 32 : null) };
    expect(fragmentTextureLimit(r({ gl }))).toBe(32);
    expect(fragmentTextureLimit(r({}))).toBeNull();
    expect(fragmentTextureLimit(null)).toBeNull();
  });
});

describe('SurfaceTextures within textureSlots', () => {
  const make = (textureSlots?: number): SurfaceTextures =>
    new SurfaceTextures({
      tier: 'desktop', profile: lookProfileFor('desktop', true, LOOK), enabled: true, backend: 'webgpu', browser: 'chromium',
      ...(textureSlots === undefined ? {} : { textureSlots }),
    });
  const slotsOfSets = (t: SurfaceTextures): Record<string, string[]> =>
    Object.fromEntries((t as unknown as { sets: { name: string; slots: Record<string, unknown> }[] }).sets.map((s) => [s.name, Object.keys(s.slots)]));

  it('requests and binds the kept maps only, and reports what was capped', () => {
    const t = make(11);
    expect(t.report()).toMatchObject({ mode: 'stochastic', capped: ['texture/pbr.grass-dirt.orm'], slots: 11 });
    expect(t.report().refs).toEqual(refsFor('stochastic').filter((r) => r !== 'texture/pbr.grass-dirt.orm'));
    expect(slotsOfSets(t)['grass-dirt']).toEqual(['albedo', 'normal']);
    expect(Object.values(slotsOfSets(t)).flat()).toHaveLength(11);
    t.dispose();
  });

  it('binds the full set unchanged with no cap or room for it', () => {
    for (const t of [make(), make(FULL), make(27)]) {
      expect(t.report().capped).toEqual([]);
      expect(t.report().refs).toEqual(refsFor('stochastic'));
      expect(Object.values(slotsOfSets(t)).flat()).toHaveLength(FULL);
      t.dispose();
    }
    expect(make().report().slots).toBeNull();
  });

  it('builds the shading nodes with and without the cap', () => {
    const surface = { id: float(0) as unknown as L, normal: vec3(0, 1, 0) as unknown as L };
    const base = { color: vec3(0.5, 0.5, 0.5) as unknown as L, roughness: float(0.8) as unknown as L, normal: vec3(0, 0, 1) as unknown as L };
    for (const slots of [undefined, 11, 8, 4]) {
      const t = make(slots);
      const out = t.shade(surface, base);
      expect(out.color).toBeTruthy();
      // the orm term exists while any set reads its orm map; otherwise the roughness is the procedural one
      if (slots === 4 || slots === 8) expect(out.roughness).toBe(base.roughness);
      else expect(out.roughness).not.toBe(base.roughness);
      t.dispose();
    }
  });
});
