import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  GRID_EDGE_M, GRID_MIN_M, M_PER_DEG_LAT, M_PER_DEG_LNG, ORIGIN, chunkBounds, type WorldBounds,
} from '../../../packages/shared/src/index.ts';
import { GRAYBOX_KEYS } from '../src/fixtures/graybox.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bounds = JSON.parse(readFileSync(`${root}config/world.bounds.json`, 'utf8')) as WorldBounds;
const schema = JSON.parse(readFileSync(`${root}tools/map/schemas/world-bounds.schema.json`, 'utf8')) as object;

// The C08 section 5 values, typed out independently of the file under test.
const C08_SECTION_5 = {
  schema: 'world-bounds/1',
  origin: { lat: 37.7793, lng: -122.4193 },
  mPerDegLat: 110992.06,
  mPerDegLng: 88083.39,
  play: { minX: -9400, maxX: 6200, minZ: -6300, maxZ: 8900, minY: -80, maxY: 600 },
  stream: { minX: -10500, maxX: 9500, minZ: -11000, maxZ: 9000 },
  far: { minX: -12500, maxX: 52000, minZ: -23500, maxZ: 53300 },
  gridMinM: -65664,
  gridEdgeM: 131072,
};

describe('config/world.bounds.json', () => {
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

  it('validates against the schema', () => {
    expect(validate(bounds), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects extra properties and missing ones', () => {
    expect(validate({ ...bounds, extra: 1 })).toBe(false);
    const { far: _far, ...rest } = bounds;
    expect(validate(rest)).toBe(false);
    expect(validate({ ...bounds, schema: 'world-bounds/2' })).toBe(false);
  });

  it('equals the C08 section 5 values and the C08 constants', () => {
    expect(bounds).toEqual(C08_SECTION_5);
    expect(bounds.origin).toEqual(ORIGIN);
    expect(bounds.mPerDegLat).toBe(M_PER_DEG_LAT);
    expect(bounds.mPerDegLng).toBe(M_PER_DEG_LNG);
    expect(bounds.gridMinM).toBe(GRID_MIN_M);
    expect(bounds.gridEdgeM).toBe(GRID_EDGE_M);
  });

  it('keeps the four fixture chunks inside play and stream inside far', () => {
    for (const k of GRAYBOX_KEYS) {
      const c = chunkBounds(k);
      expect(c.minX).toBeGreaterThanOrEqual(bounds.play.minX);
      expect(c.maxX).toBeLessThanOrEqual(bounds.play.maxX);
      expect(c.minZ).toBeGreaterThanOrEqual(bounds.play.minZ);
      expect(c.maxZ).toBeLessThanOrEqual(bounds.play.maxZ);
    }
    expect(bounds.stream.minX).toBeGreaterThanOrEqual(bounds.far.minX);
    expect(bounds.stream.maxX).toBeLessThanOrEqual(bounds.far.maxX);
    expect(bounds.stream.minZ).toBeGreaterThanOrEqual(bounds.far.minZ);
    expect(bounds.stream.maxZ).toBeLessThanOrEqual(bounds.far.maxZ);
  });
});
