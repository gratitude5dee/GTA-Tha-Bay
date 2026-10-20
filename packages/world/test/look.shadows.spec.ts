/**
 * M02e shadows: the shadow object a tier gets, the cascade count it reports (the perf meter counts it per caster), the fallback
 * order, and which render objects cast (only L0 `buildings` objects of chunks within `casterRadiusM`).
 */
import { readFileSync } from 'node:fs';
import { DirectionalLight, Scene, type WebGPURenderer } from 'three/webgpu';
import { decodeL0, decodeP0, type ChunkKey } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { TIERS } from '@dv/engine/platform/tier-config';
import { ChunkRenderer, type LookRuntime } from '../src/client/chunks/chunk-renderer.ts';
import { createWorldMaterials } from '../src/client/chunks/materials.ts';
import { meshChunk } from '../src/client/chunks/mesher.ts';
import { LOOK } from '../src/client/look/config.ts';
import { PASSES, ShadowRig, type ShadowPath } from '../src/client/look/shadows.ts';

const fakeRenderer = (): WebGPURenderer => ({ shadowMap: { enabled: false } }) as unknown as WebGPURenderer;

function rig(tier: keyof typeof TIERS, o: { order?: readonly ShadowPath[]; disabled?: boolean; renderer?: WebGPURenderer } = {}) {
  const scene = new Scene();
  const light = new DirectionalLight(0xffffff, 3);
  scene.add(light);
  const renderer = o.renderer ?? fakeRenderer();
  const r = new ShadowRig({
    scene, light, shadows: TIERS[tier].features.shadows, tier, look: LOOK, renderer,
    ...(o.order ? { order: o.order } : {}), ...(o.disabled ? { disabled: true } : {}),
  });
  return { r, scene, light, renderer };
}

describe('ShadowRig: the shadow object and its cascade count', () => {
  it('desktop and desktop-ultra: CSMShadowNode with three cascades, maxFar the tier\'s shadow distance, the tier\'s map size', () => {
    for (const tier of ['desktop', 'desktop-ultra'] as const) {
      const { r, light, renderer } = rig(tier);
      expect(r.mode).toBe('csm3');
      expect(r.path).toBe('csm');
      expect(r.passes).toBe(3);
      expect(r.receiving).toBe(true);
      expect(light.castShadow).toBe(true);
      expect(light.shadow.mapSize.width).toBe(TIERS[tier].features.shadows.mapSize);
      const node = light.shadow.shadowNode as unknown as { cascades: number; maxFar: number };
      expect(node.cascades).toBe(3);
      expect(node.maxFar).toBe(TIERS[tier].features.shadows.distanceM);
      expect((renderer as unknown as { shadowMap: { enabled: boolean } }).shadowMap.enabled).toBe(true);
    }
  });

  it('mobile: one fitted DirectionalLight cascade of the tier\'s map size, reporting 1', () => {
    const { r, light } = rig('mobile');
    expect(r.mode).toBe('csm1');
    expect(r.path).toBe('fitted');
    expect(r.passes).toBe(1);
    expect(light.castShadow).toBe(true);
    expect(light.shadow.mapSize.width).toBe(1024);
    expect(light.shadow.shadowNode).toBeFalsy();
    // The box follows the focus, snapped to the shadow texel.
    r.place([0.3, 0.8, 0.5], { x: 100.123, z: -50.456 });
    r.update({ near: 0.1, far: 1000, aspect: 1, fov: 60 } as never, { x: 100.123, z: -50.456 });
    expect(Math.abs(light.target.position.x - 100.123)).toBeLessThan(1);
  });

  it('mobile-low is blob (no shadow map), and a tier in shadowsOff reports 0 whatever its mode', () => {
    const blob = rig('mobile-low');
    expect(blob.r.mode).toBe('blob');
    expect(blob.r.passes).toBe(0);
    expect(blob.r.receiving).toBe(false);
    expect(blob.light.castShadow).toBe(false);
    const off = rig('mobile', { disabled: true });
    expect(off.r.passes).toBe(0);
    expect(off.r.receiving).toBe(false);
  });

  it('SunLight is the first fallback and reports 2; a renderer that cannot register it falls on to the fitted cascade, reporting 1', () => {
    const registered: unknown[] = [];
    const renderer = { shadowMap: { enabled: false }, library: { addLight: (...a: unknown[]) => void registered.push(a) } } as unknown as WebGPURenderer;
    const sun = rig('desktop', { order: ['sunlight', 'fitted'], renderer });
    expect(sun.r.path).toBe('sunlight');
    expect(sun.r.passes).toBe(2);
    expect(registered).toHaveLength(1);
    expect(sun.scene.children).toContain(sun.r.light);
    const broken = rig('desktop', { order: ['sunlight', 'fitted'] });
    expect(broken.r.path).toBe('fitted');
    expect(broken.r.passes).toBe(1);
    expect(broken.r.fallbackReason).toMatch(/fell back to fitted/);
  });

  it('a renderer replacement sets the shadow object up again (and the SunLight registration with it)', () => {
    const registered: unknown[] = [];
    const renderer = { shadowMap: { enabled: false }, library: { addLight: (...a: unknown[]) => void registered.push(a) } } as unknown as WebGPURenderer;
    const { r } = rig('desktop', { order: ['sunlight', 'fitted'], renderer });
    const next = { shadowMap: { enabled: false }, library: { addLight: (...a: unknown[]) => void registered.push(a) } } as unknown as WebGPURenderer;
    r.onRendererReplaced(next);
    expect(r.path).toBe('sunlight');
    expect(registered).toHaveLength(2);
  });

  it('the cascade counts are the table the perf meter reads', () => {
    expect(PASSES).toEqual({ csm: 3, sunlight: 2, fitted: 1, blob: 0, off: 0 });
  });
});

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/world/civic-graybox/${name}`, import.meta.url)));

describe('ChunkRenderer: which objects cast', () => {
  const sim = decodeP0(fixture('p0-64-64.pack'));
  const render = decodeL0(fixture('l0-64-64.pack'), sim);

  function committed(runtime: LookRuntime | null, tier: 'desktop' | 'mobile-low' = 'desktop') {
    const scene = new Scene();
    const materials = createWorldMaterials({ fadeSeconds: 0 });
    const cr = new ChunkRenderer({ parent: scene, materials, uploadBytes: null, fadeSeconds: 0 });
    cr.look = runtime;
    for (const c of sim) {
      const mesh = meshChunk(c, render.find((r) => r.key === c.key) ?? null, { tier, distM: 0 });
      cr.enqueue(mesh, 0);
      for (let i = 0; i < 4; i++) cr.update(i, { pos: [0, 5, 0], dir: [0, 0, -1] });
    }
    return cr;
  }

  const near = (radius: number, f = { x: 0, z: 0 }): LookRuntime => ({ receive: true, casting: true, casterRadiusM: radius, focus: () => f });

  it('only L0 buildings objects within the caster radius cast; terrain, roads and vegetation only receive', () => {
    const cr = committed(near(10_000));
    const report = cr.casterReport();
    expect(report.count).toBeGreaterThan(0);
    expect(report.kinds).toEqual(['l0:buildings']);
    for (const u of cr.units.values()) {
      for (const child of u.group.children) {
        const m = child as { castShadow: boolean; receiveShadow: boolean; userData: Record<string, unknown> };
        expect(m.receiveShadow).toBe(true);
        expect(m.castShadow).toBe(m.userData['kind'] === 'buildings');
      }
    }
  });

  it('a chunk farther than the radius from the focus does not cast', () => {
    const cr = committed(near(10, { x: 1e6, z: 1e6 }));
    expect(cr.casterReport().count).toBe(0);
  });

  it('without a look runtime, or with casting off, nothing casts or receives (the legacy flags)', () => {
    expect(committed(null).casterReport().count).toBe(0);
    expect(committed({ receive: false, casting: false, casterRadiusM: 500, focus: () => ({ x: 0, z: 0 }) }).casterReport().count).toBe(0);
  });

  it('applyLook re-records every resident unit once and re-reads the flags', () => {
    const runtime = { receive: true, casting: true, casterRadiusM: 10_000, focus: () => ({ x: 0, z: 0 }) };
    const cr = committed(runtime);
    const before = cr.bundleRerecords();
    runtime.casting = false;
    runtime.receive = false;
    cr.applyLook();
    expect(cr.casterReport().count).toBe(0);
    for (const [id, n] of Object.entries(cr.bundleRerecords())) expect(n).toBe((before[id] ?? 0) + 1);
    const key = [...cr.units.keys()][0] as string;
    expect(key).toMatch(/^l0:/);
    void (null as unknown as ChunkKey);
  });
});
