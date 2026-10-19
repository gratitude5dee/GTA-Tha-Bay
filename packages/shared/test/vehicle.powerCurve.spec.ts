/**
 * The handling presets (M03a1, AC-1 and AC-2): every file in `content/vehicles/handling/` validates against its schema and
 * its declared `powerKw` is within 3 % of the peak of T * omega over its torque curve.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { peakPowerKw, torqueAt, type HandlingProfile } from '../src/vehicle/index.ts';
import { loadPresets } from './vehicle-presets.ts';

const schema = JSON.parse(readFileSync(path.join(import.meta.dirname, '../schemas/racing/handling.schema.json'), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

const EXPECTED = [
  'hp.compact', 'hp.ondine-pico', 'hp.pickup', 'hp.police-cruiser', 'hp.police-suv', 'hp.rideshare', 'hp.robotaxi-ambient', 'hp.sedan', 'hp.truck', 'hp.van',
];

describe('handling presets', () => {
  const presets = loadPresets();

  it('there are exactly the ten presets, one file per id', () => {
    expect(presets.map((x) => x.p.id).sort()).toEqual(EXPECTED);
    for (const { file, p } of presets) expect(file).toBe(`${p.id}.json`);
  });

  it('every preset validates against handling.schema.json', () => {
    for (const { file, p } of presets) {
      const ok = validate(p);
      expect(ok, `${file}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it('the declared powerKw is within 3 % of the peak of T * omega', () => {
    for (const { p } of presets) {
      const peak = peakPowerKw(p);
      expect(Math.abs(peak - p.engine.powerKw) / p.engine.powerKw, `${p.id}: declared ${p.engine.powerKw} kW, curve peaks at ${peak.toFixed(1)} kW`).toBeLessThanOrEqual(0.03);
    }
  });

  it('torque tables rise in rpm and stay inside idle..redline', () => {
    for (const { p } of presets) {
      const t = p.engine.torque;
      for (let i = 1; i < t.length; i++) expect((t[i] as readonly number[])[0], p.id).toBeGreaterThan((t[i - 1] as readonly number[])[0] as number);
      expect((t[0] as readonly number[])[0], p.id).toBeLessThanOrEqual(p.engine.idleRpm === 0 ? 0 : p.engine.idleRpm * 2);
      expect((t[t.length - 1] as readonly number[])[0], p.id).toBe(p.engine.redlineRpm);
    }
  });

  it('torqueAt interpolates linearly and clamps at both ends', () => {
    const table: HandlingProfile['engine']['torque'] = [[1000, 100], [2000, 200], [4000, 100]];
    expect(torqueAt(table, 500)).toBe(100);
    expect(torqueAt(table, 1500)).toBe(150);
    expect(torqueAt(table, 3000)).toBe(150);
    expect(torqueAt(table, 9000)).toBe(100);
  });

  it('every make is fictional (not one of the real makes the brand gate bans)', () => {
    for (const { p } of presets) expect(p.fictionalMake.toLowerCase(), p.id).not.toMatch(/humvee|tesla|waymo|ford|toyota|honda|chevrolet|bmw|audi|mercedes/);
  });
});
