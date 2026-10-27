/**
 * M02g1 AC-2: the look-tune data and graphs. `look.json` validates and holds the numbers the milestone sets (sky weights, bloom, asphalt,
 * grade and haze per preset, the layers per profile); the fog nodes build with the haze and the fog-path grade; the trees of the units near
 * the focus cast on the `casters` layer; the analytic sky reflection builds for glass, water, paint and the player's vehicle.
 */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { Scene } from 'three/webgpu';
import { decodeL0, decodeP0 } from '@dv/shared';
import { TIERS } from '@dv/engine/platform/tier-config';
import { ChunkRenderer, type LookRuntime } from '../src/client/chunks/chunk-renderer.ts';
import { createWorldMaterials } from '../src/client/chunks/materials.ts';
import { meshChunk } from '../src/client/chunks/mesher.ts';
import { LOOK, LOOK_LAYERS, TIER_IDS, layersOf, lookErrors, srgbHexToLinear, type LookFile, type LookLayer } from '../src/client/look/config.ts';
import { gradeFor, hazeFor } from '../src/client/look/grade.ts';
import { createSkyNodes } from '../src/client/sky/nodes.ts';
import { createBackdropFog, createWorldFog } from '../src/client/sky/fog.ts';
import { createDomeMaterial } from '../src/client/sky/dome.ts';
import { reflectTerm, skyReflect, vehicleReflectHook } from '../src/client/look/sky-reflect.ts';
import { MeshStandardNodeMaterial } from 'three/webgpu';

const WEATHER = ['clear', 'karl-fog', 'overcast', 'rain', 'smoke', 'golden'] as const;

const read = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8'));
const shadowDistances = (): Record<string, number> => Object.fromEntries(TIER_IDS.map((t) => [t, TIERS[t].features.shadows.distanceM]));

describe('config/world/look.json (M02g1)', () => {
  it('validates against its schema and the structural rules', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(read('config/schemas/world-look.schema.json') as object);
    expect(validate(read('config/world/look.json'))).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
    expect(lookErrors(LOOK, shadowDistances())).toEqual([]);
  });

  it('keeps more of the physical sky under fog and overcast: karl-fog 0.35, overcast 0.6', () => {
    expect(LOOK.sky.keyframeWeight['karl-fog']).toBeCloseTo(0.35, 1);
    expect(Math.abs(LOOK.sky.keyframeWeight['karl-fog'] - 0.35)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(LOOK.sky.keyframeWeight.overcast - 0.6)).toBeLessThanOrEqual(0.05);
    expect(LOOK.sky.keyframeWeight.clear).toBe(0);
  });

  it('moved the bloom out of POST_TUNING and raised its threshold to at least 1.3', () => {
    expect(LOOK.bloom.threshold).toBeGreaterThanOrEqual(1.3);
    expect(LOOK.bloom.strength).toBeGreaterThan(0);
  });

  it('has a grade and a haze for every weather preset', () => {
    for (const w of WEATHER) {
      expect(LOOK.grade[w], w).toBeDefined();
      expect(LOOK.haze[w], w).toBeDefined();
      expect(gradeFor(w, w, 0).gamma).toBe(LOOK.grade[w].gamma);
      expect(hazeFor(w, w, 0)).toEqual(LOOK.haze[w]);
    }
  });

  it('lifts the asphalt and every road class to a linear albedo of 0.12 to 0.18 in all channels', () => {
    for (const k of ['Asphalt', 'freeway', 'ramp', 'arterial', 'collector', 'local', 'service']) {
      const g = LOOK.ground[k];
      expect(g, k).toBeDefined();
      for (const c of srgbHexToLinear((g as { albedo: string }).albedo)) {
        expect(c, `${k} ${(g as { albedo: string }).albedo}`).toBeGreaterThanOrEqual(0.12);
        expect(c, `${k} ${(g as { albedo: string }).albedo}`).toBeLessThanOrEqual(0.18);
      }
    }
  });

  it('gates every layer per profile: legacy none, the casters on full only, the rest on every flat profile', () => {
    expect(LOOK.layers.legacy).toEqual([]);
    expect(layersOf('legacy')).toEqual([]);
    expect([...LOOK.layers.full].sort()).toEqual([...LOOK_LAYERS].sort());
    for (const p of ['lite', 'min'] as const) {
      expect(LOOK.layers[p]).not.toContain('casters');
      expect([...LOOK.layers[p]].sort()).toEqual(LOOK_LAYERS.filter((l) => l !== 'casters').sort());
    }
    // every tier's profile resolves to a layer list; the XR tiers' is empty
    for (const t of TIER_IDS) {
      const profile = LOOK.tierProfile[t];
      if (t === 'xr-quest' || t === 'xr-visionpro') expect(layersOf(profile)).toEqual([]);
      else expect(layersOf(profile).length).toBeGreaterThan(0);
    }
  });

  it('rejects a legacy layer, an unknown layer and a casters layer below the full profile', () => {
    const broken = JSON.parse(JSON.stringify(LOOK)) as LookFile;
    (broken.layers.legacy as LookLayer[]).push('blob');
    (broken.layers.lite as unknown as string[]).push('casters', 'bogus');
    const text = lookErrors(broken, shadowDistances()).join('\n');
    expect(text).toMatch(/layers\.legacy must be empty/);
    expect(text).toMatch(/unknown layer bogus/);
    expect(text).toMatch(/casters layer is desktop only/);
  });

  it('keeps the dynamic caster radius within the smallest desktop shadow distance', () => {
    expect(LOOK.dynamicCasterRadiusM).toBe(70);
    for (const t of ['desktop', 'desktop-ultra'] as const) expect(LOOK.dynamicCasterRadiusM).toBeLessThanOrEqual(TIERS[t].features.shadows.distanceM);
  });
});

describe('gradeFor and hazeFor', () => {
  it('blend the preset in force with the next by the weather blend', () => {
    const half = gradeFor('karl-fog', 'clear', 0.5);
    expect(half.saturation).toBeCloseTo((LOOK.grade['karl-fog'].saturation + LOOK.grade.clear.saturation) / 2, 9);
    const haze = hazeFor('karl-fog', 'clear', 0.5);
    expect(haze.blue).toBeCloseTo((LOOK.haze['karl-fog'].blue + LOOK.haze.clear.blue) / 2, 9);
    expect(hazeFor('clear', 'clear', 9)).toEqual(LOOK.haze.clear);
  });

  it('the clear haze is bluer and scatters more than the Karl fog, which keeps the keyed fog alone', () => {
    expect(LOOK.haze.clear.blue).toBeGreaterThan(LOOK.haze['karl-fog'].blue);
    expect(LOOK.haze.clear.ext).toBeGreaterThan(LOOK.haze['karl-fog'].ext);
    expect(LOOK.haze['karl-fog'].ext).toBe(0);
  });
});

describe('the fog nodes with the look', () => {
  it('build for every fog kind with and without the haze and the fog-path grade', () => {
    const n = createSkyNodes();
    for (const kind of ['height', 'linear', 'linear-fade'] as const) {
      expect(createWorldFog(n, kind, false)).toBeDefined();
      expect(createWorldFog(n, kind, true)).toBeDefined();
    }
    expect(createBackdropFog(n, false)).toBeDefined();
    expect(createBackdropFog(n, true)).toBeDefined();
  });

  it('the weights are 0 until the look writes them, so a world without a look draws as before', () => {
    const n = createSkyNodes();
    expect(n.look.grade.weight.value).toBe(0);
    expect(n.look.haze.weight.value).toBe(0);
    expect(n.look.reflect.weight.value).toBe(0);
  });

  it('the dome builds with the fog-path grade', () => {
    const n = createSkyNodes();
    expect(createDomeMaterial(n, 'gradient', undefined, true)).toBeDefined();
    expect(createDomeMaterial(n, 'painted', undefined, false)).toBeDefined();
  });
});

describe('the analytic sky reflection', () => {
  it('builds as a term, as a sky colour and as the vehicle hook, and the hook keeps the lamp emissive of the material', () => {
    const n = createSkyNodes();
    expect(reflectTerm(n, 0.05)).toBeDefined();
    expect(reflectTerm(n, 0.02, { strength: 0.5, shininess: 400 })).toBeDefined();
    expect(skyReflect(n, reflectTerm(n, 0.05))).toBeDefined();
    const m = new MeshStandardNodeMaterial({ color: 0xffffff });
    m.emissive.setHex(0xff0000);
    m.emissiveIntensity = 1.4;
    expect(m.emissiveNode).toBeNull();
    vehicleReflectHook(n)(m);
    expect(m.emissiveNode).not.toBeNull();
  });
});

describe('trees on the casters layer', () => {
  const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/world/civic-graybox/${name}`, import.meta.url)));
  const sim = decodeP0(fixture('p0-64-64.pack'));
  const render = decodeL0(fixture('l0-64-64.pack'), sim);

  function committed(runtime: LookRuntime): ChunkRenderer {
    const scene = new Scene();
    const cr = new ChunkRenderer({ parent: scene, materials: createWorldMaterials({ fadeSeconds: 0 }), uploadBytes: null, fadeSeconds: 0 });
    cr.look = runtime;
    for (const c of sim) {
      const mesh = meshChunk(c, render.find((r) => r.key === c.key) ?? null, { tier: 'desktop', distM: 0 });
      // two trees in every chunk: the fixture's own may be none
      mesh.trees = new Float32Array([mesh.originX + 20, 0, mesh.originZ + 20, 1, 0, mesh.originX + 40, 0, mesh.originZ + 40, 1.2, 1]);
      cr.enqueue(mesh, 0);
      for (let i = 0; i < 4; i++) cr.update(i, { pos: [0, 5, 0], dir: [0, 0, -1] });
    }
    return cr;
  }

  const runtime = (over: Partial<Omit<LookRuntime, 'focus'>> & { focus?: { x: number; z: number } } = {}): LookRuntime => {
    const { focus: at, ...rest } = over;
    const focus = at ?? { x: 0, z: 0 };
    return { receive: true, casting: true, casterRadiusM: 10_000, dynamicCasting: true, dynamicCasterRadiusM: 10_000, ...rest, focus: () => focus };
  };

  it('cast when the layer is on and the unit is within the radius; the report names buildings only', () => {
    const cr = committed(runtime());
    expect(cr.treeCasterCount()).toBeGreaterThan(0);
    expect(cr.casterReport().kinds).toEqual(['l0:buildings']);
  });

  it('do not cast with the layer off, or when the unit is far from the focus', () => {
    expect(committed(runtime({ dynamicCasting: false })).treeCasterCount()).toBe(0);
    expect(committed(runtime({ dynamicCasterRadiusM: 10, focus: { x: 1e6, z: 1e6 } })).treeCasterCount()).toBe(0);
    expect(committed({ receive: true, casting: true, casterRadiusM: 10_000, focus: () => ({ x: 0, z: 0 }) }).treeCasterCount()).toBe(0);
  });

  it('follow the focus: refreshTreeCasters flips the flags of the units and re-records only those', () => {
    const focus = { x: 0, z: 0 };
    const rt = runtime({ dynamicCasterRadiusM: 5, focus });
    const cr = committed(rt);
    const near = cr.treeCasterCount();
    focus.x = 1e6;
    focus.z = 1e6;
    const before = cr.bundleRerecords();
    const changed = cr.refreshTreeCasters();
    expect(cr.treeCasterCount()).toBe(0);
    expect(changed).toBe(near);
    const after = cr.bundleRerecords();
    let bumped = 0;
    for (const [id, n] of Object.entries(after)) if (n !== (before[id] ?? 0)) bumped++;
    expect(bumped).toBe(changed);
    expect(cr.refreshTreeCasters()).toBe(0);
  });
});
