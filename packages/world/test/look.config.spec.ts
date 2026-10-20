/**
 * AC-2 (M02e): `config/world/look.json` validates against its schema, the profiles per tier are `full`, `full`, `lite`, `min`,
 * `legacy`, `legacy`, every `casterRadiusM` stays within the tier's shadow distance, and the structural rules reject a broken file.
 */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { QualityTierId } from '@dv/shared';
import { TIERS } from '@dv/engine/platform/tier-config';
import { FACADE_KEYS, LOOK, TIER_IDS, facadeClassOf, facadeKeyOf, lookErrors, lookProfileFor, srgbHexToLinear, type LookFile } from '../src/client/look/config.ts';
import { GROUND_NAMES, KIND_NAMES, ROAD_NAMES, SURFACE_COUNT, SURFACE_NAMES, Surf, groundSurf, isSurfaceId, roadSurf, roofSurf, wallSurf } from '../src/client/look/surfaces.ts';

const read = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8'));
const shadowDistances = (): Partial<Record<QualityTierId, number>> => Object.fromEntries(TIER_IDS.map((t) => [t, TIERS[t].features.shadows.distanceM]));

describe('config/world/look.json (AC-2)', () => {
  it('validates against config/schemas/world-look.schema.json', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(read('config/schemas/world-look.schema.json') as object);
    expect(validate(read('config/world/look.json'))).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
  });

  it('gives the profiles full, full, lite, min, legacy, legacy for ultra, desktop, mobile, mobile-low, xr-quest, xr-visionpro', () => {
    expect(TIER_IDS.map((t) => LOOK.tierProfile[t])).toEqual(['full', 'full', 'lite', 'min', 'legacy', 'legacy']);
    expect(TIER_IDS).toEqual(['desktop-ultra', 'desktop', 'mobile', 'mobile-low', 'xr-quest', 'xr-visionpro']);
  });

  it('keeps every caster radius within that tier\'s shadow distance and passes its own structural check', () => {
    expect(lookErrors(LOOK, shadowDistances())).toEqual([]);
    for (const [tier, r] of Object.entries(LOOK.casterRadiusM) as [QualityTierId, number][]) expect(r).toBeLessThanOrEqual(TIERS[tier].features.shadows.distanceM);
  });

  it('starts with the cap at 2, no shadows off and no WebGL2 substitution (each of those needs a spec/03 row first)', () => {
    expect(LOOK.postLevelCap).toBe(2);
    expect(LOOK.shadowsOff).toEqual([]);
    expect(LOOK.webgl2Unsupported).toEqual([]);
    expect(LOOK.webgl2AaFallback).toEqual({});
  });

  it('the world.look flag off makes every tier legacy', () => {
    for (const t of TIER_IDS) expect(lookProfileFor(t, false)).toBe('legacy');
    expect(lookProfileFor('desktop', true)).toBe('full');
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
