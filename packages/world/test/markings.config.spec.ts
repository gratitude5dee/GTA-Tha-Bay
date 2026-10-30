/**
 * AC-2 (M02h1): `config/world/look.json` with its `markings` block validates against the schema, `layers` lists `markings` for every
 * profile (legacy only that), the structural rules reject a broken block, and the surface table has the three new ids with the textures
 * config binding them.
 */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { LOOK, LOOK_LAYERS, layersOf, lookErrors, markingsErrors, type LookFile, type MarkingsFile } from '../src/client/look/config.ts';
import { ROAD_CLASS_NAMES } from '../src/client/look/road-layout.ts';
import { SURFACE_COUNT, SURFACE_NAMES, Surf, isSurfaceId } from '../src/client/look/surfaces.ts';
import { SURFACE_TEXTURES } from '../src/client/textures/config.ts';
import { TIERS } from '@dv/engine/platform/tier-config';
import type { QualityTierId } from '@dv/shared';
import { TIER_IDS } from '../src/client/look/config.ts';

const read = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8'));
const shadowDistances = (): Partial<Record<QualityTierId, number>> => Object.fromEntries(TIER_IDS.map((t) => [t, TIERS[t].features.shadows.distanceM]));
const clone = (): LookFile => JSON.parse(JSON.stringify(LOOK)) as LookFile;

describe('look.json markings (AC-2)', () => {
  it('validates against the schema, with the block required', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(read('config/schemas/world-look.schema.json') as object);
    expect(validate(read('config/world/look.json'))).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
    const without = JSON.parse(JSON.stringify(LOOK)) as Record<string, unknown>;
    delete without['markings'];
    expect(validate(without)).toBe(false);
    const wrong = clone();
    (wrong.markings.rules['arterial'] as { centre: string }).centre = 'sometimes';
    expect(validate(wrong)).toBe(false);
  });

  it('lists the markings layer for full, lite, min and legacy, and nothing else for legacy', () => {
    for (const p of ['full', 'lite', 'min', 'legacy'] as const) expect(LOOK.layers[p]).toContain('markings');
    expect(LOOK.layers.legacy).toEqual(['markings']);
    expect(layersOf('legacy')).toEqual(['markings']);
    expect(LOOK_LAYERS).toContain('markings');
    expect(lookErrors(LOOK, shadowDistances())).toEqual([]);
    const broken = clone();
    (broken.layers.legacy as string[]).push('blob');
    expect(lookErrors(broken, shadowDistances()).join('\n')).toMatch(/layers\.legacy may hold only markings/);
  });

  it('maps every road class to a class that has a rule, and class 0 paints nothing', () => {
    const m = LOOK.markings;
    expect(markingsErrors(m)).toEqual([]);
    for (const name of ROAD_CLASS_NAMES) expect(m.classes).toContain(m.byClass[name]);
    expect(m.rules['none']).toEqual({ edges: false, dashes: false, centre: 'never', ts: false });
    // freeway and ramp: edges and dashes; arterial and collector: a double yellow; local: only when wide; service: nothing
    expect(m.byClass['freeway']).toBe(m.byClass['ramp']);
    expect(m.rules['freeway']).toMatchObject({ edges: true, dashes: true });
    expect(m.rules['arterial']?.centre).toBe('twoWay');
    expect(m.rules['collector']?.centre).toBe('twoWay');
    expect(m.rules['local']?.centre).toBe('twoWayWide');
    expect(m.centreWideMinM).toBe(9);
    expect(m.byClass['service']).toBe('none');
  });

  it('holds the design values of the spec: 10 cm lines, 3 m dashes every 12 m, a 6 m T, 2 cm decals, 0.4 m stop bars 1.2 m behind the crosswalk', () => {
    const m = LOOK.markings;
    expect(m).toMatchObject({ lineM: 0.1, dashOnM: 3, dashOffM: 9, doubleGapM: 0.1, tEveryM: 6, parkingM: 2.4, decalLiftM: 0.02, decalFarM: 250, junctionExtraM: 1, worn: { roughness: 0.6 } });
    expect(m.stopBar).toEqual({ depthM: 0.4, behindCrosswalkM: 1.2 });
    for (const hex of Object.values(m.paint)) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('names the problems of a broken block', () => {
    const bad = JSON.parse(JSON.stringify(LOOK.markings)) as MarkingsFile;
    (bad.byClass as Record<string, string>)['arterial'] = 'bogus';
    delete (bad.rules as Record<string, unknown>)['collector'];
    bad.tStemM = bad.parkingM + 1;
    (bad.rules['none'] as { dashes: boolean }).dashes = true;
    const text = markingsErrors(bad).join('\n');
    expect(text).toMatch(/byClass\.arterial names bogus/);
    expect(text).toMatch(/no entry for the class collector/);
    expect(text).toMatch(/tStemM/);
    expect(text).toMatch(/rules\.none must paint nothing/);
  });
});

describe('the surface ids of the paint (AC-3)', () => {
  it('adds Junction 35, Crosswalk 36 and StopBar 37, so the table ends at 38 and M02h2 takes 38 and 39', () => {
    expect([Surf.Junction, Surf.Crosswalk, Surf.StopBar]).toEqual([35, 36, 37]);
    expect(SURFACE_COUNT).toBe(38);
    expect(SURFACE_NAMES.slice(35)).toEqual(['junction', 'crosswalk', 'stopbar']);
    expect(isSurfaceId(37)).toBe(true);
    expect(isSurfaceId(38)).toBe(false);
  });

  it('are bound to the asphalt set in the surface textures, so the painted quads match the road around them', () => {
    for (const n of ['junction', 'crosswalk', 'stopbar']) expect(SURFACE_TEXTURES.bindings[n]).toBe('asphalt');
  });
});
