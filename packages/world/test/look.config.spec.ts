/**
 * AC-2 (M02e): `config/world/look.json` validates against its schema, the profiles per tier are `full`, `full`, `lite`, `min` and, since
 * M02h8, `xr` on both XR tiers (`legacy` before), every `casterRadiusM` stays within the tier's shadow distance, and the structural rules
 * reject a broken file. M02h8 AC-2: `xr` is in the schema enum, `lookErrors` rejects `xr` on a flat tier and accepts `legacy` on every tier,
 * the cap is 3 and `xr-visionpro` has its shadow map off.
 */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { QualityTierId } from '@dv/shared';
import { TIERS } from '@dv/engine/platform/tier-config';
import { FACADE_KEYS, LOOK, TIER_IDS, XR_TIER_IDS, facadeClassOf, facadeKeyOf, lookErrors, lookProfileFor, parseLookParam, srgbHexToLinear, type LookFile } from '../src/client/look/config.ts';
import { GROUND_NAMES, KIND_NAMES, ROAD_NAMES, SURFACE_COUNT, SURFACE_NAMES, Surf, groundSurf, isSurfaceId, roadSurf, roofSurf, wallSurf } from '../src/client/look/surfaces.ts';

const read = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8'));
const shadowDistances = (): Partial<Record<QualityTierId, number>> => Object.fromEntries(TIER_IDS.map((t) => [t, TIERS[t].features.shadows.distanceM]));

describe('config/world/look.json (AC-2)', () => {
  it('validates against config/schemas/world-look.schema.json', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(read('config/schemas/world-look.schema.json') as object);
    expect(validate(read('config/world/look.json'))).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
  });

  it('gives the profiles full, full, lite, min, xr, xr for ultra, desktop, mobile, mobile-low, xr-quest, xr-visionpro (M02h8)', () => {
    expect(TIER_IDS.map((t) => LOOK.tierProfile[t])).toEqual(['full', 'full', 'lite', 'min', 'xr', 'xr']);
    expect(TIER_IDS).toEqual(['desktop-ultra', 'desktop', 'mobile', 'mobile-low', 'xr-quest', 'xr-visionpro']);
    expect(XR_TIER_IDS).toEqual(['xr-quest', 'xr-visionpro']);
  });

  it('the schema has xr in the profile enum and a layer list and a bump of 0 for it (M02h8)', () => {
    const schema = read('config/schemas/world-look.schema.json') as { $defs: { profile: { enum: string[] } }; properties: { layers: { required: string[] }; bump: { properties: { xr: unknown } } } };
    expect(schema.$defs.profile.enum).toEqual(['full', 'lite', 'min', 'xr', 'legacy']);
    expect(schema.properties.layers.required).toContain('xr');
    expect(schema.properties.bump.properties.xr).toEqual({ const: 0 });
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema as object);
    const bumped = JSON.parse(JSON.stringify(read('config/world/look.json'))) as { bump: Record<string, number>; tierProfile: Record<string, string> };
    bumped.bump['xr'] = 1;
    expect(validate(bumped), 'a bump on xr is not valid').toBe(false);
    const bogus = JSON.parse(JSON.stringify(read('config/world/look.json'))) as { tierProfile: Record<string, string> };
    bogus.tierProfile['xr-quest'] = 'vr';
    expect(validate(bogus), 'an unknown profile is not valid').toBe(false);
  });

  it('lookErrors rejects xr on a flat tier and accepts legacy on every tier (M02h8)', () => {
    for (const tier of ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'] as const) {
      const broken = JSON.parse(JSON.stringify(LOOK)) as LookFile;
      broken.tierProfile[tier] = 'xr';
      expect(lookErrors(broken, shadowDistances()).join('\n'), tier).toMatch(new RegExp(`tierProfile\\.${tier}: the xr profile is for the XR tiers only`));
    }
    // the fallback of the milestone (data): any tier, and both XR tiers, may be `legacy`
    for (const tier of TIER_IDS) {
      const fallback = JSON.parse(JSON.stringify(LOOK)) as LookFile;
      fallback.tierProfile[tier] = 'legacy';
      expect(lookErrors(fallback, shadowDistances()), `${tier} on legacy`).toEqual([]);
    }
    const casters = JSON.parse(JSON.stringify(LOOK)) as LookFile;
    (casters.layers.xr as string[]).push('casters');
    expect(lookErrors(casters, shadowDistances()).join('\n')).toMatch(/casters layer is desktop only/);
  });

  it('keeps every caster radius within that tier\'s shadow distance and passes its own structural check', () => {
    expect(lookErrors(LOOK, shadowDistances())).toEqual([]);
    for (const [tier, r] of Object.entries(LOOK.casterRadiusM) as [QualityTierId, number][]) expect(r).toBeLessThanOrEqual(TIERS[tier].features.shadows.distanceM);
  });

  it('has the cap at 3 (TRAA on desktop, M02h8), the Vision Pro shadow map off and no WebGL2 substitution (each of those needs a spec/03 row first)', () => {
    expect(LOOK.postLevelCap).toBe(3);
    // M02h8: `xr-visionpro` draws two view passes, so its `csm1` map would draw twice; off until M11b1's device run (the blobs stay)
    expect(LOOK.shadowsOff).toEqual(['xr-visionpro']);
    expect(TIERS['xr-visionpro'].budget.render.viewPasses).toBe(2);
    expect(LOOK.layers.xr).toContain('blob');
    expect(LOOK.webgl2Unsupported).toEqual([]);
    expect(LOOK.webgl2AaFallback).toEqual({});
  });

  it('the world.look flag off makes every tier legacy', () => {
    for (const t of TIER_IDS) expect(lookProfileFor(t, false)).toBe('legacy');
    expect(lookProfileFor('desktop', true)).toBe('full');
    // the flag wins over the QA override
    for (const t of XR_TIER_IDS) expect(lookProfileFor(t, false, LOOK, 'xr')).toBe('legacy');
  });

  it('the QA ?look= value: 0 is the look off on a flat tier and legacy on an XR tier; legacy and xr override an XR tier only (M02h8)', () => {
    expect(parseLookParam(null, 'desktop')).toEqual({ enabled: true, override: null });
    expect(parseLookParam('0', 'desktop')).toEqual({ enabled: false, override: null });
    expect(parseLookParam('legacy', 'desktop')).toEqual({ enabled: true, override: null });
    expect(parseLookParam('xr', 'mobile-low')).toEqual({ enabled: true, override: null });
    for (const t of XR_TIER_IDS) {
      expect(parseLookParam(null, t)).toEqual({ enabled: true, override: null });
      expect(parseLookParam('0', t)).toEqual({ enabled: true, override: 'legacy' });
      expect(parseLookParam('legacy', t)).toEqual({ enabled: true, override: 'legacy' });
      expect(parseLookParam('xr', t)).toEqual({ enabled: true, override: 'xr' });
      expect(parseLookParam('full', t)).toEqual({ enabled: true, override: null });
      expect(lookProfileFor(t, true, LOOK, 'legacy')).toBe('legacy');
      expect(lookProfileFor(t, true, LOOK, 'xr')).toBe('xr');
      expect(lookProfileFor(t, true, LOOK, null)).toBe('xr');
    }
    // an override never reaches a flat tier
    expect(lookProfileFor('desktop', true, LOOK, 'xr')).toBe('full');
    expect(lookProfileFor('mobile-low', true, LOOK, 'legacy')).toBe('min');
  });

  it('names the problems of a broken file', () => {
    const broken = JSON.parse(JSON.stringify(LOOK)) as LookFile;
    broken.casterRadiusM['mobile'] = 9000;
    (broken.webgl2Unsupported as string[]).push('tonemap');
    broken.facade.ResLow.winW = broken.facade.ResLow.bayM + 1;
    const text = lookErrors(broken, shadowDistances()).join('\n');
    expect(text).toMatch(/casterRadiusM\.mobile 9000 exceeds/);
    expect(text).toMatch(/webgl2Unsupported must not hold tonemap/);
    expect(text).toMatch(/facade\.ResLow: winW/);
  });

  it('the facade classes cover the six building kinds and every palette colour parses', () => {
    expect(FACADE_KEYS).toHaveLength(6);
    expect(FACADE_KEYS.map((_, i) => facadeKeyOf(i))).toEqual([...FACADE_KEYS]);
    for (let kind = 0; kind < 6; kind++) {
      const c = facadeClassOf(kind);
      expect(c.palette.length).toBeGreaterThan(0);
      for (const hex of c.palette) for (const v of srgbHexToLinear(hex)) expect(v).toBeGreaterThanOrEqual(0);
    }
    for (const k of [...GROUND_NAMES, ...ROAD_NAMES]) expect(LOOK.ground[k]).toBeDefined();
  });
});

describe('the surface table', () => {
  it('has one name per id and a helper for each family', () => {
    expect(SURFACE_NAMES).toHaveLength(SURFACE_COUNT);
    expect(new Set(SURFACE_NAMES).size).toBe(SURFACE_COUNT);
    expect(groundSurf(10)).toBe(Surf.GroundBase + 10);
    expect(roadSurf(4)).toBe(Surf.RoadBase + 4);
    expect(wallSurf(KIND_NAMES.indexOf('Civic'))).toBe(Surf.WallBase + 5);
    expect(roofSurf(0)).toBe(Surf.RoofFlat);
    expect(roofSurf(1)).toBe(Surf.RoofGable);
    expect(roofSurf(2)).toBe(Surf.RoofHip);
    expect(isSurfaceId(SURFACE_COUNT)).toBe(false);
    expect(isSurfaceId(Surf.Sea)).toBe(true);
  });
});
