import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  BANK_FULL_M, MOON_STRENGTH, SKY_KEYS, SKY_PRESET_IDS, bankWeight, evaluateSky, mixRows, rowAt, skyKeysErrors, sunDirection,
} from '../src/client/sky/sky-keys.ts';
import { SKY_KEY_HOURS, type SkyInput, type SkyKeysFile } from '../src/client/sky/types.ts';

const read = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8'));

const input = (o: Partial<SkyInput> = {}): SkyInput => ({
  hour: 13, night: 0, dark: 0, weather: 'clear', next: 'clear', blend: 0, fogBankM: 0, rain: 0, wet: 0, blackout: false, ...o,
});

describe('config/world/sky-keys.json (AC-4)', () => {
  it('validates against tools/map/schemas/sky-keys.schema.json', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(read('tools/map/schemas/sky-keys.schema.json') as object);
    expect(validate(read('config/world/sky-keys.json'))).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
  });

  it('passes the structural check the loader runs and has six presets of eight rows', () => {
    expect(skyKeysErrors(SKY_KEYS)).toEqual([]);
    expect(SKY_PRESET_IDS).toHaveLength(6);
    for (const id of SKY_PRESET_IDS) expect(SKY_KEYS.presets[id]).toHaveLength(8);
    expect([...SKY_KEYS.hours]).toEqual([...SKY_KEY_HOURS]);
  });

  it('the structural check names what is wrong', () => {
    const broken = JSON.parse(JSON.stringify(SKY_KEYS)) as SkyKeysFile;
    (broken.presets.rain as unknown[]).pop();
    (broken.presets.clear[2] as { fogFarM: number }).fogFarM = 1;
    (broken.presets.golden[0] as unknown as { skyTop: unknown }).skyTop = [1, 2];
    const errors = skyKeysErrors(broken);
    expect(errors.join('\n')).toMatch(/preset rain needs 8 rows/);
    expect(errors.join('\n')).toMatch(/clear\[2\] fogFarM must exceed fogNearM/);
    expect(errors.join('\n')).toMatch(/golden\[0\]\.skyTop is not a vec3/);
    expect(skyKeysErrors({ schema: 'sky-keys/2' })).not.toEqual([]);
  });
});

describe('the sun (AC-4)', () => {
  it('is below the horizon outside 06:30 to 19:30 and above it inside', () => {
    for (let h = 0; h < 24; h += 0.05) {
      const y = sunDirection(h)[1];
      if (h < 6.5 - 1e-9 || h > 19.5 + 1e-9) expect(y, `hour ${h}`).toBeLessThan(1e-9);
      else expect(y, `hour ${h}`).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('rises in the east, stands south at noon and sets in the west; every direction is a unit vector', () => {
    const rise = sunDirection(6.5);
    const noon = sunDirection(13);
    const set = sunDirection(19.5);
    expect(rise[0]).toBeCloseTo(1, 6);
    expect(set[0]).toBeCloseTo(-1, 6);
    expect(noon[0]).toBeCloseTo(0, 6);
    expect(noon[2]).toBeGreaterThan(0.5); // +z is south
    expect(noon[1]).toBeCloseTo(Math.sin((52 * Math.PI) / 180), 6);
    for (let h = 0; h < 24; h += 0.25) expect(Math.hypot(...sunDirection(h))).toBeCloseTo(1, 9);
    expect(MOON_STRENGTH).toBe(0.4);
  });
});

describe('the Karl fog bank (AC-4)', () => {
  it('has weight 1 at x = -2,000 m and 0.35 at x = 3,000 m, linear between -1,500 and 2,500', () => {
    expect(bankWeight(-2000)).toBe(1);
    expect(bankWeight(3000)).toBe(0.35);
    expect(bankWeight(-1500)).toBe(1);
    expect(bankWeight(2500)).toBe(0.35);
    expect(bankWeight(500)).toBeCloseTo(0.675, 9);
    let prev = 2;
    for (let x = -2000; x <= 3000; x += 50) {
      const w = bankWeight(x);
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      prev = w;
    }
  });

  it('the Karl share of the fog follows the sim marine-layer height', () => {
    expect(evaluateSky(SKY_KEYS, input({ fogBankM: 0 })).uBank).toBe(0);
    expect(evaluateSky(SKY_KEYS, input({ fogBankM: BANK_FULL_M / 2 })).uBank).toBeCloseTo(0.5, 9);
    expect(evaluateSky(SKY_KEYS, input({ fogBankM: 10_000 })).uBank).toBe(1);
  });
});

describe('row interpolation', () => {
  it('returns the key rows exactly at the key hours and wraps at midnight', () => {
    SKY_KEY_HOURS.forEach((h, i) => {
      for (const id of SKY_PRESET_IDS) expect(rowAt(SKY_KEYS, id, h)).toEqual(SKY_KEYS.presets[id][i]);
    });
    expect(rowAt(SKY_KEYS, 'clear', 24)).toEqual(rowAt(SKY_KEYS, 'clear', 0));
    expect(rowAt(SKY_KEYS, 'clear', -1)).toEqual(rowAt(SKY_KEYS, 'clear', 23));
    const mid = rowAt(SKY_KEYS, 'clear', 23.0);
    const a = SKY_KEYS.presets.clear[7]!;
    const b = SKY_KEYS.presets.clear[0]!;
    expect(mid.skyTop[2]).toBeCloseTo(a.skyTop[2] + (b.skyTop[2] - a.skyTop[2]) * (1.5 / 2.5), 9);
  });

  it('mixRows blends every member and keeps the ends', () => {
    const a = SKY_KEYS.presets.clear[3]!;
    const b = SKY_KEYS.presets['karl-fog'][3]!;
    expect(mixRows(a, b, 0)).toEqual(a);
    expect(mixRows(a, b, 1)).toEqual(b);
    expect(mixRows(a, b, 0.5).fogFarM).toBeCloseTo((a.fogFarM + b.fogFarM) / 2, 9);
  });

  it('a blend of 0 is the current preset and 65,535 the next', () => {
    const u0 = evaluateSky(SKY_KEYS, input({ weather: 'clear', next: 'rain', blend: 0 }));
    const uN = evaluateSky(SKY_KEYS, input({ weather: 'clear', next: 'rain', blend: 65_535 }));
    expect(u0.uFogFar).toBe(rowAt(SKY_KEYS, 'clear', 13).fogFarM);
    expect(uN.uFogFar).toBe(rowAt(SKY_KEYS, 'rain', 13).fogFarM);
  });

  it('stars are max(0, night - 0.3) of the night, scaled by the preset', () => {
    expect(evaluateSky(SKY_KEYS, input({ hour: 13, night: 0.2 })).uStars).toBe(0);
    expect(evaluateSky(SKY_KEYS, input({ hour: 0, night: 1 })).uStars).toBeGreaterThan(0.9);
    expect(evaluateSky(SKY_KEYS, input({ hour: 0, night: 1, weather: 'overcast', next: 'overcast' })).uStars).toBe(0);
  });

  it('wetness, rain and blackout reach the uniforms', () => {
    const u = evaluateSky(SKY_KEYS, input({ rain: 255, wet: 0.5, blackout: true }));
    expect(u).toMatchObject({ uRain: 1, uWet: 0.5, uBlackout: 1 });
  });
});
