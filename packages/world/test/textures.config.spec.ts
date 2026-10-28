/**
 * AC-5 (M10d0): `config/world/surface-textures.json` validates against its schema, its binding keys are surface names that cover the
 * milestone's list, every `SURFACE_NAMES` entry is bound or listed procedural (a fixture with one unlisted name fails naming it), the
 * mode of each tier follows its look profile, and a view with textures off changes nothing.
 */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { QualityTierId } from '@dv/shared';
import { TIERS } from '@dv/engine/platform/tier-config';
import { LOOK, TIER_IDS, lookProfileFor } from '../src/client/look/config.ts';
import { SURFACE_NAMES } from '../src/client/look/surfaces.ts';
import {
  MAP_NAMES, SURFACE_TEXTURES, TEXTURES_FLAG, TIER_VARIANT, backendUnsupported, boundSets, idsOfSet, mapsOf, refOf, refsFor, textureConfigErrors, textureModeFor,
  type SurfaceTexturesFile,
} from '../src/client/textures/config.ts';
import { SurfaceTextures, installSurfaceTextures, withSurfaceTextures } from '../src/client/textures/surface-textures.ts';
import type { L } from '../src/client/sky/tsl.ts';

const read = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8'));
const maxTextureMB = (): Partial<Record<QualityTierId, number>> => Object.fromEntries(TIER_IDS.map((t) => [t, TIERS[t].budget.memory.maxTextureMB]));
const clone = (): SurfaceTexturesFile => JSON.parse(JSON.stringify(SURFACE_TEXTURES)) as SurfaceTexturesFile;

describe('config/world/surface-textures.json', () => {
  it('validates against config/schemas/world-surface-textures.schema.json', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(read('config/schemas/world-surface-textures.schema.json') as object);
    expect(validate(read('config/world/surface-textures.json'))).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
  });

  it('passes its own structural check against the real surface names and the tier budgets', () => {
    expect(textureConfigErrors(SURFACE_TEXTURES, SURFACE_NAMES, maxTextureMB())).toEqual([]);
  });

  it('binds the surfaces of the milestone: asphalt to the roads and ground.Asphalt, concrete to the sidewalk, pavers to ground.Paved, grass-dirt to grass, park and dirt', () => {
    const b = SURFACE_TEXTURES.bindings;
    for (const r of ['freeway', 'ramp', 'arterial', 'collector', 'local', 'service']) expect(b[`road.${r}`]).toBe('asphalt');
    expect(b['ground.Asphalt']).toBe('asphalt');
    expect(b['sidewalk']).toBe('concrete');
    expect(b['ground.Paved']).toBe('pavers');
    for (const g of ['Grass', 'Park', 'Dirt']) expect(b[`ground.${g}`]).toBe('grass-dirt');
    for (const name of Object.keys(b)) expect(SURFACE_NAMES).toContain(name);
    expect(boundSets()).toEqual(['asphalt', 'concrete', 'pavers', 'grass-dirt']);
  });

  it('lists the walls as procedural until M02h7 binds brick and stucco, and keeps those two sets unbound', () => {
    for (const name of SURFACE_NAMES.filter((n) => n.startsWith('wall.'))) expect(SURFACE_TEXTURES.procedural).toContain(name);
    expect(Object.values(SURFACE_TEXTURES.bindings)).not.toContain('brick');
    expect(Object.values(SURFACE_TEXTURES.bindings)).not.toContain('stucco');
    expect(Object.keys(SURFACE_TEXTURES.sets).sort()).toEqual(['asphalt', 'brick', 'concrete', 'grass-dirt', 'pavers', 'stucco']);
  });

  it('every surface name is bound or procedural, exactly once, and a fixture with one unlisted name fails naming it', () => {
    for (const name of SURFACE_NAMES) expect(name in SURFACE_TEXTURES.bindings || SURFACE_TEXTURES.procedural.includes(name)).toBe(true);
    const errors = textureConfigErrors(SURFACE_TEXTURES, [...SURFACE_NAMES, 'curb'], maxTextureMB());
    expect(errors).toEqual(['surface curb is in neither bindings nor procedural']);
    const both = clone();
    both.procedural = [...both.procedural, 'sidewalk'];
    expect(textureConfigErrors(both, SURFACE_NAMES, maxTextureMB())).toEqual(['surface sidewalk is both bound and listed as procedural']);
  });

  it('names the other problems of a broken file', () => {
    const broken = clone();
    broken.bindings['road.nope'] = 'asphalt';
    broken.bindings['sidewalk'] = 'marble';
    broken.budgets.mobile.gpuMB = 400;
    broken.budgets['xr-quest'].downloadMB = 1;
    broken.fade.endM = broken.fade.startM;
    const text = textureConfigErrors(broken, SURFACE_NAMES, maxTextureMB()).join('\n');
    expect(text).toContain('road.nope is not a surface name');
    expect(text).toContain('sidewalk names the unknown set marble');
    expect(text).toContain('budgets.mobile.gpuMB 400 exceeds 5 %');
    expect(text).toContain('budgets.xr-quest must be 0');
    expect(text).toContain('fade.endM must exceed fade.startM');
  });
});

describe('the mode of a tier', () => {
  const modeOf = (tier: QualityTierId, enabled = true): string => textureModeFor(tier, lookProfileFor(tier, true, LOOK), enabled);

  it('is stochastic on the desktop tiers, single on mobile, albedo on mobile-low and off on the XR tiers', () => {
    expect(TIER_IDS.map((t) => modeOf(t))).toEqual(['stochastic', 'stochastic', 'single', 'albedo', 'off', 'off']);
  });

  it('is off everywhere when the world.textures flag is off, and the default flag is on', () => {
    for (const t of TIER_IDS) expect(modeOf(t, false)).toBe('off');
    expect(TEXTURES_FLAG).toBe(true);
  });

  it('reads the maps and refs of a mode: albedo alone on min, all three otherwise, none off', () => {
    expect(mapsOf('albedo')).toEqual(['albedo']);
    expect(mapsOf('single')).toEqual(MAP_NAMES);
    expect(mapsOf('off')).toEqual([]);
    expect(refsFor('albedo')).toEqual(boundSets().map((s) => refOf(s, 'albedo')));
    expect(refsFor('stochastic')).toHaveLength(boundSets().length * 3);
    expect(refsFor('off')).toEqual([]);
    expect(refOf('grass-dirt', 'orm')).toBe('texture/pbr.grass-dirt.orm');
  });

  it('loads the variant of the tier: desktop, mobile, mobile-low', () => {
    expect(TIER_IDS.map((t) => TIER_VARIANT[t])).toEqual(['desktop', 'desktop', 'mobile', 'mobile-low', 'mobile-low', 'mobile-low']);
  });

  it('knows the ids each set is bound to', () => {
    expect(idsOfSet('concrete').map((i) => SURFACE_NAMES[i])).toEqual(['ground.Sidewalk', 'sidewalk']);
    expect(idsOfSet('brick')).toEqual([]);
  });

  it('reads the unsupported list by backend and by browser and backend', () => {
    const cfg = clone();
    expect(backendUnsupported('webgl2', 'webkit', cfg)).toBe(false);
    cfg.unsupported = ['webkit-webgl2'];
    expect(backendUnsupported('webgl2', 'webkit', cfg)).toBe(true);
    expect(backendUnsupported('webgl2', 'chromium', cfg)).toBe(false);
    cfg.unsupported = ['webgpu'];
    expect(backendUnsupported('webgpu', 'chromium', cfg)).toBe(true);
  });
});

describe('SurfaceTextures and withSurfaceTextures', () => {
  const nodes = { color: {} as L, roughness: {} as L, normal: null };
  const surface = { id: {} as L, normal: {} as L };
  const make = (tier: QualityTierId, extra: { enabled?: boolean; backend?: 'webgpu' | 'webgl2' } = {}): SurfaceTextures =>
    new SurfaceTextures({ tier, profile: lookProfileFor(tier, true, LOOK), enabled: extra.enabled ?? true, backend: extra.backend ?? 'webgl2', browser: 'chromium' });

  it('returns the nodes it was given when textures are off, unsupported or no instance is installed', () => {
    installSurfaceTextures(null);
    expect(withSurfaceTextures(surface, nodes)).toBe(nodes);
    for (const t of [make('xr-quest'), make('desktop', { enabled: false })]) {
      installSurfaceTextures(t);
      expect(t.active).toBe(false);
      expect(withSurfaceTextures(surface, nodes)).toBe(nodes);
      expect(t.report()).toMatchObject({ mode: 'off', refs: [], sets: [], settled: true });
    }
    installSurfaceTextures(null);
  });

  it('reports the configured mode and the tier\'s refs before anything has loaded, and goes off with the QA switch', () => {
    const t = make('mobile');
    expect(t.report()).toMatchObject({ mode: 'single', configured: 'single', on: true, sets: [], settled: false, gpuBytes: 0, downloadBytes: 0 });
    expect(t.report().refs).toEqual(refsFor('single'));
    expect(t.setOn(false)).toBe(true);
    expect(t.report()).toMatchObject({ mode: 'off', configured: 'single', on: false });
    expect(t.setOn(true)).toBe(true);
    expect(t.report().mode).toBe('single');
    t.dispose();
    // A tier without textures has no such layer.
    const off = make('xr-quest');
    expect(off.setOn(false)).toBe(false);
    expect(off.setOn(true)).toBe(false);
  });

  it('makes no request when off', async () => {
    const calls: unknown[] = [];
    const assets = { job: (n: string, a: unknown): Promise<unknown> => (calls.push([n, a]), Promise.resolve({ missing: true })) };
    const t = make('desktop', { enabled: false });
    t.start(assets, () => null);
    await Promise.resolve();
    expect(calls).toEqual([]);
  });

  it('asks for the tier\'s refs only, one at a time, and marks a catalog without them as failed (the surfaces stay procedural)', async () => {
    const asked: string[] = [];
    const assets = { job: (_n: string, a: unknown): Promise<unknown> => (asked.push((a as { ref: string }).ref), Promise.resolve({ missing: true })) };
    const t = make('mobile-low');
    // A renderer whose loader cannot be built: every ref fails at once, and nothing is requested.
    t.start(assets, () => null);
    await new Promise((r) => setTimeout(r, 10));
    expect(asked).toEqual([]);
    expect(t.report().settled).toBe(true);
    expect(t.report().failed).toEqual([...refsFor('albedo')].sort());
  });
});
