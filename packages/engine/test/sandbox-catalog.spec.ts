import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAR_CLASSES, sandboxCatalog } from '../src/sim/modes/builtin/sandbox-vehicles.ts';
import { RACE_CAR_PREFABS, VEHICLE_PREFABS } from '../src/sim/prefabs/registry.ts';
import { handlingById } from '../src/sim/vehicle/presets.ts';

const ROOT = new URL('../../../', import.meta.url);
const read = <T>(p: string): T => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8')) as T;
const rows = read<{ rows: { prefab: string; nameKey: string }[] }>('content/vehicles/sandbox-catalog.json').rows;
const en = read<Record<string, string>>('content/ui/i18n/en.json');
const defs = new Map([...VEHICLE_PREFABS, ...RACE_CAR_PREFABS].map((d) => [d.id, d]));

describe('sandbox car catalog (M04e3 AC-2)', () => {
  it('has twelve rows with unique prefabs and names', () => {
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((r) => r.prefab)).size).toBe(12);
    expect(new Set(rows.map((r) => r.nameKey)).size).toBe(12);
    expect(sandboxCatalog().map((c) => c.prefab)).toEqual(rows.map((r) => r.prefab));
  });

  it('every row is a vehicle prefab with a handling preset that is not police or the ambient robotaxi', () => {
    for (const r of rows) {
      const def = defs.get(r.prefab);
      expect(def, r.prefab).toBeDefined();
      expect(def?.kind, r.prefab).toBe('vehicle');
      const id = def?.vehicle?.handling ?? '';
      expect(() => handlingById(id), r.prefab).not.toThrow();
      expect(id.startsWith('hp.police-'), r.prefab).toBe(false);
      expect(id, r.prefab).not.toBe('hp.robotaxi-ambient');
    }
  });

  it('every class D, C, B, A, S and R has a car, and the class comes from the preset', () => {
    const cat = sandboxCatalog();
    for (const cls of CAR_CLASSES) expect(cat.some((c) => c.cls === cls), cls).toBe(true);
    for (const c of cat) expect(c.cls).toBe(handlingById(defs.get(c.prefab)?.vehicle?.handling ?? '').class);
  });

  it('every name has English text, and the bus and cable car stay out', () => {
    for (const r of rows) expect(en[r.nameKey], r.nameKey).toMatch(/\S/);
    expect(rows.some((r) => r.prefab === 'vehicle.bus' || r.prefab === 'vehicle.cablecar')).toBe(false);
  });
});
