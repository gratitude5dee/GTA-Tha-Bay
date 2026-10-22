import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NameKind, enuFromLatLng, encodeGeocode, type GeocodeSource } from '@dv/shared';
import { PlaceIndexImpl } from '../src/sim/api/places.ts';
import { Geocoder, parseNumberToken } from '../src/sim/map/geocoder.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';
import { readJsonl } from '../../../tools/map/src/sources/socrata.ts';
import { CIVIC_FIXTURE_DIR } from '../../../tools/map/src/config.ts';
import { indexOf, landmarkAt, poiAt } from './fixtures/world.ts';

const BAKE = 'ab'.repeat(32);
const src = (): GeocodeSource => ({
  bakeId: BAKE,
  streets: [{ name: '9TH', type: 'AVE' }, { name: 'FULTON', type: 'ST' }, { name: 'VAN NESS', type: 'AVE' }],
  addresses: [
    ...[1, 3, 5, 7, 9, 11].map((n, i) => ({ streetId: 1, number: 300 + n * 2, suffix: 0, x: 10 * i, z: 0, cnn: 5882000 })),
    { streetId: 1, number: 329, suffix: 0, x: 100, z: 2, cnn: 5882000 },
    { streetId: 1, number: 329, suffix: 1, x: 101, z: 2, cnn: 5882000 },
    { streetId: 0, number: 100, suffix: 0, x: 500, z: 500, cnn: 1111000 },
    { streetId: 2, number: 500, suffix: 0, x: -200, z: 40, cnn: 2222000 },
    { streetId: 2, number: 1500, suffix: 0, x: -200, z: 640, cnn: 2222001 },
  ],
  names: [
    { kind: NameKind.Landmark, label: 'Coit Tower', x: 1186, z: -2562 },
    { kind: NameKind.Poi, label: 'Dolores Cafe', x: 100, z: 130 },
    { kind: NameKind.Hood, label: 'Hayes Valley', x: -50, z: 10 },
    { kind: NameKind.Hood, label: 'Mission', x: 300, z: 300 },
  ],
});

describe('Geocoder on a small file', () => {
  const g = Geocoder.fromBytes(encodeGeocode(src()));

  it('finds a base address by number and street, with or without the type, in any case', () => {
    for (const q of ['329 Fulton St', '329 fulton street', '329 FULTON', '329 fulton']) {
      const h = g.address(q);
      expect(h, q).toHaveLength(1);
      expect(h[0]).toMatchObject({ label: '329 Fulton St', kind: 'address', cnn: 5882000, exact: true });
      expect(h[0]!.x).toBeCloseTo(100, 6);
    }
    expect(g.address('329a Fulton St')[0]!.label).toBe('329A Fulton St');
    expect(g.address('1500 Van Ness Ave')[0]!.cnn).toBe(2222001);
    expect(g.address('1500 Van Ness')[0]!.cnn).toBe(2222001);
    expect(g.address('100 9th ave')[0]!.label).toBe('100 9th Ave');
  });

  it('answers the nearest number on the street for one that is not in the file', () => {
    const h = g.address('331 Fulton St')[0]!;
    expect(h.exact).toBe(false);
    expect(h.label).toBe('329 Fulton St');
    const far = g.address('4000 Van Ness Ave')[0]!;
    expect(far.exact).toBe(false);
    expect(far.label).toBe('1500 Van Ness Ave');
  });

  it('returns nothing for an unknown street, a missing number or a number out of range', () => {
    expect(g.address('12 Nowhere Blvd')).toEqual([]);
    expect(g.address('Fulton St')).toEqual([]);
    expect(g.address('99999 Fulton St')).toEqual([]);
    expect(parseNumberToken('329')).toEqual({ number: 329, suffix: 0 });
    expect(parseNumberToken('329b')).toEqual({ number: 329, suffix: 2 });
    expect(parseNumberToken('abc')).toBeNull();
  });

  it('finds streets, landmarks, points of interest and neighbourhoods by name', () => {
    expect(g.streets('van ness')[0]).toMatchObject({ label: 'Van Ness Ave', kind: 'street' });
    expect(g.streets('ful').map((h) => h.label)).toEqual(['Fulton St']);
    expect(g.names('coit')[0]).toMatchObject({ label: 'Coit Tower', kind: 'landmark' });
    expect(g.names('dolores cafe')[0]).toMatchObject({ kind: 'poi' });
    expect(g.names('hayes')[0]).toMatchObject({ label: 'Hayes Valley', kind: 'nhood' });
    expect(g.names('mission')[0]).toMatchObject({ kind: 'nhood', x: 300 });
    expect(g.names('zzz')).toEqual([]);
    expect(g.search('329 fulton st')[0]!.kind).toBe('address');
    expect(g.search('mission')[0]!.label).toBe('Mission');
    expect(g.search('')).toEqual([]);
  });
});

describe('PlaceIndex with the geocoder plugged in', () => {
  const index = indexOf({ landmarks: [landmarkAt('lm.coit-tower', 1186, -2562, '9/261/246')], pois: [poiAt('poi.mission.dolores-cafe', 100, 130, 'cafe')] });

  it('keeps the landmark and POI search without a geocoder, and adds addresses and neighbourhoods with one', async () => {
    const plain = new PlaceIndexImpl(index);
    expect((await plain.findPlace('coit', 5)).map((r) => r.label)).toEqual(['Coit Tower']);
    expect(await plain.findPlace('329 fulton st', 5)).toEqual([]);

    const places = new PlaceIndexImpl(index);
    let loads = 0;
    places.setGeocoder(() => {
      loads++;
      return Promise.resolve(Geocoder.fromBytes(encodeGeocode(src())));
    });
    expect(loads).toBe(0);
    const a = await places.findPlace('329 fulton st', 5);
    expect(a[0]).toMatchObject({ label: '329 Fulton St', kind: 'address' });
    const h = await places.findPlace('hayes', 5);
    expect(h.map((r) => r.kind)).toEqual(['nhood']);
    const both = await places.findPlace('coit', 5);
    expect(both[0]).toMatchObject({ label: 'Coit Tower', kind: 'landmark' });
    expect(loads).toBe(1);
  });

  it('falls back to the index when the geocoder does not load', async () => {
    const places = new PlaceIndexImpl(index);
    places.setGeocoder(() => Promise.resolve(null));
    expect((await places.findPlace('coit', 5)).map((r) => r.label)).toEqual(['Coit Tower']);
    const failing = new PlaceIndexImpl(index);
    failing.setGeocoder(() => Promise.reject(new Error('offline')));
    expect((await failing.findPlace('coit', 5)).map((r) => r.label)).toEqual(['Coit Tower']);
  });
});

describe('Geocoder on the civic-excerpt bake (AC-2; needs pnpm map:build -- --area civic-excerpt)', () => {
  const found = requireBake('civic-excerpt', 'geocoder.spec');

  it('geocodes every EAS row of the excerpt within 10 m of the row, on the same cnn', () => {
    if (!found) return;
    const g = Geocoder.fromBytes(readFileSync(path.join(found.dir, 'packs', 'sf-geocode.v1.pack')));
    const rows = readJsonl<{ address: string; cnn: string; latitude: string; longitude: string }>(path.join(CIVIC_FIXTURE_DIR, 'ramy-di5m.jsonl')).filter((r) => !r.address.includes('#'));
    expect(rows.length).toBeGreaterThan(100);
    for (const r of rows) {
      const p = enuFromLatLng(Number(r.latitude), Number(r.longitude));
      const hit = g.address(r.address, 3).find((h) => h.exact && h.cnn === Number(r.cnn));
      expect(hit, r.address).toBeDefined();
      expect(Math.hypot(hit!.x - p.x, hit!.z - p.z), r.address).toBeLessThanOrEqual(10);
    }
  });

  it('resolves landmark, POI and neighbourhood names of the excerpt', () => {
    if (!found) return;
    const g = Geocoder.fromBytes(readFileSync(path.join(found.dir, 'packs', 'sf-geocode.v1.pack')));
    const hall = g.names('city hall')[0];
    expect(hall).toMatchObject({ kind: 'landmark' });
    expect(Math.hypot(hall!.x - 3.5, hall!.z - 1)).toBeLessThan(40);
    const hoods = g.data.names.filter((n) => n.kind === NameKind.Hood);
    expect(hoods.length).toBe(4);
    for (const n of hoods) expect(g.names(n.label, 8)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'nhood', label: n.label })]));
    const pois = g.data.names.filter((n) => n.kind === NameKind.Poi);
    expect(pois.length).toBeGreaterThan(0);
    expect(g.names(pois[0]!.label, 8)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'poi' })]));
  });
});
