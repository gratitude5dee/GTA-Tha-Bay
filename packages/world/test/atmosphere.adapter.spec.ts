/**
 * M10d2 AC-6: the desktop-ultra atmosphere adapter. On a WebGL2 backend, with the library missing, or when `init` rejects, it disposes
 * what it built, the M02e physical sky (`world.sky.physical`) stays visible and no error escapes; at any tier other than
 * `desktop-ultra` it is never constructed.
 */
import { Mesh, MeshBasicMaterial, PlaneGeometry, Scene } from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QualityTierId } from '@dv/shared';
import { createAtmosphereAdapter } from '../src/client/sky/atmosphere.ts';
import { ATMOSPHERE_SKY_NAME, PHYSICAL_SKY_NAME, TakramAtmosphere, type TakramModule } from '../src/client/sky/atmosphere-takram.ts';
import { skyConfigFor } from '../src/client/sky/tiers.ts';
import type { SkyUniforms } from '../src/client/sky/types.ts';

const TIERS: QualityTierId[] = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low', 'xr-quest', 'xr-visionpro'];

function sceneWithPhysicalSky(): { scene: Scene; physical: Mesh } {
  const scene = new Scene();
  const physical = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
  physical.name = PHYSICAL_SKY_NAME;
  scene.add(physical);
  return { scene, physical };
}

/** A mock of the library's `/webgpu` entry, counting what it built and disposed. */
function mockModule(): { mod: TakramModule; built: number; disposed: number; sun: number[] } {
  const s = { built: 0, disposed: 0, sun: [] as number[] };
  const mod: TakramModule = {
    AtmosphereContext: class {
      sunDirectionECEF = { value: { set: (x: number, y: number, z: number) => void s.sun.push(x, y, z) } };
      constructor() {
        s.built++;
      }
      dispose(): void {
        s.disposed++;
      }
    } as unknown as TakramModule['AtmosphereContext'],
    skyBackground: () => ({ isNode: true }),
  };
  return Object.assign(s, { mod });
}

const env = { uSunDir: [0.3, 0.8, -0.5] } as unknown as SkyUniforms;
let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe('atmosphere adapter: never constructed off desktop-ultra', () => {
  it.each(TIERS)('%s', (tier) => {
    const { scene } = sceneWithPhysicalSky();
    const level = skyConfigFor(tier, 2).level;
    const a = createAtmosphereAdapter({ enabled: true, level, tier, scene, backend: () => 'webgpu' });
    if (tier === 'desktop-ultra') expect(a).toBeInstanceOf(TakramAtmosphere);
    else expect(a).toBeNull();
    // even at a forced level 2, a tier other than desktop-ultra gets none
    if (tier !== 'desktop-ultra') {
      expect(createAtmosphereAdapter({ enabled: true, level: 2, tier, scene, backend: () => 'webgpu' })).toBeNull();
      expect(() => new TakramAtmosphere({ tier, scene, backend: () => 'webgpu' })).toThrow(/desktop-ultra only/);
    }
  });

  it('is off by default (world.atmosphere false)', async () => {
    const flags = (await import('../../../config/platform-flags.json')).default as Record<string, unknown>;
    expect(flags['world.atmosphere']).toBe(false);
  });
});

describe('atmosphere adapter: falls back to the M02e sky', () => {
  it('on a WebGL2 backend: no library load, the physical sky stays, state fallback (webgl2)', async () => {
    const { scene, physical } = sceneWithPhysicalSky();
    const load = vi.fn(async () => mockModule().mod);
    const a = new TakramAtmosphere({ tier: 'desktop-ultra', scene, backend: () => 'webgl2', load });
    await expect(a.init({})).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    expect(a.status()).toEqual({ state: 'fallback', reason: 'webgl2' });
    expect(physical.visible).toBe(true);
    expect(scene.getObjectByName(ATMOSPHERE_SKY_NAME)).toBeUndefined();
    a.update(env);
    a.dispose();
  });

  it('when the library is not there (the default loader of this build): fallback, nothing escapes', async () => {
    const { scene, physical } = sceneWithPhysicalSky();
    const a = new TakramAtmosphere({ tier: 'desktop-ultra', scene, backend: () => 'webgpu', load: async () => { throw new Error('Cannot find module'); } });
    await a.init({});
    expect(a.status().state).toBe('fallback');
    expect(a.status().reason).toMatch(/^library unavailable/);
    expect(physical.visible).toBe(true);
  });

  it('when init rejects half way (the renderer has no node context): disposes the context it built and shows the physical sky', async () => {
    const { scene, physical } = sceneWithPhysicalSky();
    const m = mockModule();
    const a = new TakramAtmosphere({ tier: 'desktop-ultra', scene, backend: () => 'webgpu', load: async () => m.mod });
    await a.init(null);
    expect(m.built).toBe(1);
    expect(m.disposed).toBe(1);
    expect(a.status().state).toBe('fallback');
    expect(a.status().reason).toMatch(/^init:/);
    expect(physical.visible).toBe(true);
    expect(scene.getObjectByName(ATMOSPHERE_SKY_NAME)).toBeUndefined();
  });

  it('on WebGPU with the library: replaces the physical sky, follows the sun, and dispose puts the physical sky back', async () => {
    const { scene, physical } = sceneWithPhysicalSky();
    const m = mockModule();
    const renderer: { contextNode?: unknown } = {};
    const a = new TakramAtmosphere({ tier: 'desktop-ultra', scene, backend: () => 'webgpu', load: async () => m.mod });
    await a.init(renderer);
    expect(a.status()).toEqual({ state: 'on', reason: null });
    expect(renderer.contextNode).toBeDefined();
    expect(physical.visible).toBe(false);
    expect(scene.getObjectByName(ATMOSPHERE_SKY_NAME)).toBeDefined();
    a.update(env);
    expect(m.sun).toEqual([0.3, 0.8, -0.5]);
    a.dispose();
    expect(a.status().state).toBe('disposed');
    expect(physical.visible).toBe(true);
    expect(scene.getObjectByName(ATMOSPHERE_SKY_NAME)).toBeUndefined();
    expect(m.disposed).toBe(1);
  });

  it('a dispose during init leaves nothing behind', async () => {
    const { scene, physical } = sceneWithPhysicalSky();
    const m = mockModule();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = new TakramAtmosphere({ tier: 'desktop-ultra', scene, backend: () => 'webgpu', load: async () => { await gate; return m.mod; } });
    const p = a.init({});
    a.dispose();
    release();
    await p;
    expect(m.built).toBe(0);
    expect(physical.visible).toBe(true);
    expect(scene.getObjectByName(ATMOSPHERE_SKY_NAME)).toBeUndefined();
  });
});
