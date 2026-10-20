import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapSchema } from '../src/config.ts';
import { TELEPORT_MSG, TRANSIT } from '../../../packages/world/src/sim/api/teleport.ts';

const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8'));

describe('config/world/transit.json (M02c1)', () => {
  it('validates against its schema and holds the design fares of 02-world-maps.md section 5 in integer cents', () => {
    const cfg = read('config/world/transit.json');
    expect(mapSchema('transit')(cfg)).toEqual([]);
    expect(TRANSIT.fares['bay-rail']).toEqual({ baseCents: 200, perStopCents: 50 });
    expect(TRANSIT.fares['cable-car']).toEqual({ baseCents: 100 });
    expect(TRANSIT.fares.robotaxi).toEqual({ baseCents: 300, perKmCents: 120 });
    expect(TRANSIT.cooldown.fastTravelS).toBe(30);
  });

  it('rejects a fare that is not an integer, an unknown key and a missing section', () => {
    const cfg = read('config/world/transit.json') as { fares: Record<string, Record<string, number>> };
    expect(mapSchema('transit')({ ...cfg, fares: { ...cfg.fares, 'bay-rail': { baseCents: 2.5, perStopCents: 50 } } })).not.toEqual([]);
    expect(mapSchema('transit')({ ...cfg, extra: 1 })).not.toEqual([]);
    const { cooldown: _c, ...noCooldown } = cfg as Record<string, unknown>;
    expect(mapSchema('transit')(noCooldown)).not.toEqual([]);
  });

  it('every teleport message key and the county-line key exist in the English catalogue', () => {
    const en = read('packages/ui/src/i18n/en.json') as Record<string, string>;
    for (const key of Object.values(TELEPORT_MSG)) expect(en[key], key).toBeTypeOf('string');
    expect(en['world.teleport.notLoaded']).toBe('Ground not loaded; player was not moved');
    expect(en['world.boundary.countyLine']).toBe('Leaving SF — coming soon');
  });
});
