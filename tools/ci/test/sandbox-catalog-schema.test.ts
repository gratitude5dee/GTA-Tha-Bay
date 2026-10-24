import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, schemaValidator } from '../lib/common.ts';
import { repoRoot } from '../run.ts';

const validate = schemaValidator('sandbox-catalog-1');
const row = (slug: string): { prefab: string; nameKey: string } => ({ prefab: `vehicle.${slug}`, nameKey: `sandbox.car.${slug}` });
const doc = (rows: unknown[]): unknown => ({ schema: 1, rows });

describe('sandbox-catalog-1 schema (M04e3 AC-2)', () => {
  it('accepts the committed catalog', () => {
    expect(validate(readJson(path.join(repoRoot, 'content/vehicles/sandbox-catalog.json')))).toEqual([]);
  });

  it('rejects a police car, the robotaxi, an extra field, a bad key, no rows and 33 rows', () => {
    expect(validate(doc([{ prefab: 'police.cruiser', nameKey: 'sandbox.car.cruiser' }])).length).toBeGreaterThan(0);
    expect(validate(doc([{ prefab: 'robotaxi.default', nameKey: 'sandbox.car.robotaxi' }])).length).toBeGreaterThan(0);
    expect(validate(doc([{ ...row('compact'), extra: 1 }])).length).toBeGreaterThan(0);
    expect(validate(doc([{ prefab: 'vehicle.compact', nameKey: 'car.compact' }])).length).toBeGreaterThan(0);
    expect(validate(doc([])).length).toBeGreaterThan(0);
    expect(validate(doc(Array.from({ length: 33 }, (_, i) => row(`car-${i}`)))).length).toBeGreaterThan(0);
  });

  it('accepts 1 and 32 rows', () => {
    expect(validate(doc([row('compact')]))).toEqual([]);
    expect(validate(doc(Array.from({ length: 32 }, (_, i) => row(`car-${i}`))))).toEqual([]);
  });
});
