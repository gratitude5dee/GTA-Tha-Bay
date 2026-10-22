import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRID_MIN_M, MapBuildings, MapData, decodeGeocode, enuFromLatLng } from '../../../packages/shared/src/index.ts';
import { CIVIC_FIXTURE_DIR } from '../src/config.ts';
import { readJsonl } from '../src/sources/socrata.ts';
import { mapStreetKept, onewayCode, streetLabel, labelPoint, type MapStreetRow } from '../src/stages/s12-map.ts';
import { findAddress, seededSample, sourceStreets, verifyMapAssets } from '../src/verify/map-verify.ts';
import { parseAddressNumber, type EasRow } from '../src/stages/s12-geocode.ts';
import { genAddresses } from '../src/sources/synth.ts';
import { loadSynth } from '../src/config.ts';
import { bakeExcerpt } from './helpers.ts';

const streets = readJsonl<MapStreetRow>(path.join(CIVIC_FIXTURE_DIR, '3psu-pn9h.jsonl'));
const eas = readJsonl<EasRow>(path.join(CIVIC_FIXTURE_DIR, 'ramy-di5m.jsonl'));

describe('S12 map on the civic-excerpt (AC-1)', () => {
  it('writes sf-map.v1, sf-map-bldg.v1 and sf-geocode.v1 that decode, with every street segment carrying its cnn', async () => {
    const b = await bakeExcerpt();
    const map = MapData.decode(readFileSync(path.join(b.outDir, 'packs', 'sf-map.v1.pack')));
    const bldg = MapBuildings.decode(readFileSync(path.join(b.outDir, 'packs', 'sf-map-bldg.v1.pack')));
    const geo = decodeGeocode(readFileSync(path.join(b.outDir, 'packs', 'sf-geocode.v1.pack')));
    expect(map.bakeId).toBe(b.result.bakeId);
    expect(bldg.bakeId).toBe(b.result.bakeId);
    expect(geo.bakeId).toBe(b.result.bakeId);
    const z9 = map.allStreets(9);
    expect(z9.length).toBeGreaterThan(0);
    expect(z9.every((s) => s.line.cnn > 0)).toBe(true);
    const wantCnns = new Set(streets.map((r) => mapStreetKept(r)?.cnn).filter((c): c is number => c !== undefined));
    expect(new Set(z9.map((s) => s.line.cnn))).toEqual(wantCnns);
    expect(map.allStreets(7).length).toBeGreaterThan(0);
    expect(map.hoods.length).toBe(4);
    expect(map.polys.length).toBeGreaterThan(0);
    expect(map.hill && map.hill.cells.length).toBeGreaterThan(0);
    expect(bldg.chunks().length).toBeGreaterThan(0);
    expect(b.report['map']).toBeTruthy();
    expect(b.report.gates.filter((g) => g.level === 'fail')).toEqual([]);
    expect(b.report.gates.map((g) => g.id)).toEqual(expect.arrayContaining(['s12.map-size', 's12.map-streets', 's12.map-oneway', 's12.geocode-sample']));
  });

  it('carries the one-way flag of every source row (F along the line, T against it) on all one-way segments', async () => {
    const b = await bakeExcerpt();
    const map = MapData.decode(readFileSync(path.join(b.outDir, 'packs', 'sf-map.v1.pack')));
    const table = map.cnnTable();
    const want = sourceStreets(streets).oneway;
    let oneWay = 0;
    for (const [cnn, v] of want) {
      expect(table.get(cnn)?.oneway, `cnn ${cnn}`).toBe(v);
      if (v !== 0) oneWay++;
    }
    expect(oneWay).toBeGreaterThan(0);
    expect(onewayCode('F')).toBe(1);
    expect(onewayCode('T')).toBe(2);
    expect(onewayCode('B')).toBe(0);
    expect(onewayCode(undefined)).toBe(0);
  });

  it('applies the gate filter: active, no PAPER layer, a cnn and a classcode of 1 to 6', () => {
    expect(mapStreetKept({ cnn: '5', classcode: '3', layer: 'STREETS', active: true, line: { type: 'LineString', coordinates: [] } })).toEqual({ cnn: 5, classcode: 3 });
    expect(mapStreetKept({ cnn: '5', classcode: '3', layer: 'PAPER_FWYS', active: true, line: { type: 'LineString', coordinates: [] } })).toBeNull();
    expect(mapStreetKept({ cnn: '5', classcode: '0', layer: 'STREETS', active: true, line: { type: 'LineString', coordinates: [] } })).toBeNull();
    expect(mapStreetKept({ cnn: '5', classcode: '3', layer: 'STREETS', active: false, line: { type: 'LineString', coordinates: [] } })).toBeNull();
    expect(mapStreetKept({ cnn: '', classcode: '3', layer: 'STREETS', active: 'true', line: { type: 'LineString', coordinates: [] } })).toBeNull();
    expect(streetLabel({ streetname: 'FULTON ST', st_type: 'ST' })).toBe('Fulton St');
    expect(streetLabel({ streetname: '51ST', st_type: 'AVE' })).toBe('51st Ave');
  });

  it('puts the label point of a polygon with a hole inside the polygon', () => {
    const outer = [0, 0, 100, 0, 100, 100, 0, 100];
    const hole = [30, 30, 70, 30, 70, 70, 30, 70];
    const p = labelPoint(outer, [hole]);
    const inHole = p.x > 30 && p.x < 70 && p.z > 30 && p.z < 70;
    expect(inHole).toBe(false);
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(100);
  });
});

describe('the gates that read the assets back', () => {
  it('fail a street count that differs by more than 0.5 percent and pass the real one', async () => {
    const b = await bakeExcerpt();
    const input = {
      bakeId: b.result.bakeId,
      map: readFileSync(path.join(b.outDir, 'packs', 'sf-map.v1.pack')),
      bldg: readFileSync(path.join(b.outDir, 'packs', 'sf-map-bldg.v1.pack')),
      geocode: readFileSync(path.join(b.outDir, 'packs', 'sf-geocode.v1.pack')),
      streets,
      addresses: eas,
    };
    expect(verifyMapAssets(input).filter((g) => g.level === 'fail')).toEqual([]);
    const dropped = verifyMapAssets({ ...input, streets: streets.slice(0, streets.length - 10) });
    expect(dropped.find((g) => g.id === 's12.map-streets')?.level).toBe('fail');
    const wrongBake = verifyMapAssets({ ...input, bakeId: 'ab'.repeat(32) });
    expect(wrongBake.find((g) => g.id === 's12.map-decode')?.level).toBe('fail');
    const garbage = verifyMapAssets({ ...input, map: new Uint8Array(100) });
    expect(garbage.find((g) => g.id === 's12.map-decode')?.level).toBe('fail');
  });

  it('samples 30 seeded one-way segments and 50 addresses, or all when there are fewer', () => {
    expect(seededSample('ab'.repeat(32), 'x', 100, 30)).toHaveLength(30);
    expect(seededSample('ab'.repeat(32), 'x', 100, 30)).toEqual(seededSample('ab'.repeat(32), 'x', 100, 30));
    expect(seededSample('ab'.repeat(32), 'x', 100, 30)).not.toEqual(seededSample('cd'.repeat(32), 'x', 100, 30));
    expect(seededSample('ab'.repeat(32), 'x', 7, 30)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('EAS rows of the excerpt (AC-2) and the synth generator', () => {
  it('gives each base address a position within 10 m of the row on the same cnn', async () => {
    const b = await bakeExcerpt();
    const geo = decodeGeocode(readFileSync(path.join(b.outDir, 'packs', 'sf-geocode.v1.pack')));
    let checked = 0;
    for (const r of eas) {
      if ((r.address ?? '').includes('#')) continue;
      const num = parseAddressNumber(r.address ?? '', r.address_number);
      expect(num).not.toBeNull();
      const i = findAddress(geo, (r.street_name ?? '').toUpperCase(), (r.street_type ?? '').toUpperCase(), num!.number, num!.suffix);
      expect(i, r.address).toBeGreaterThanOrEqual(0);
      const a = geo.addresses[i]!;
      const p = enuFromLatLng(Number(r.latitude), Number(r.longitude));
      expect(Math.hypot(a.x - p.x, a.z - p.z)).toBeLessThanOrEqual(10);
      expect(a.cnn).toBe(Number(r.cnn));
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('emits EAS-shaped rows along the synth streets, seeded, with unit rows that collapse to one base address', () => {
    const cfg = loadSynth();
    const rows = genAddresses(cfg, [
      { cnn: 1000000, streetname: '1ST', st_type: 'AVE', classcode: '5', oneway: 'B', layer: 'STREETS', f_node_cnn: 1, t_node_cnn: 2, nhood: 'Mission', active: 'true', line: [0, 0, 0, 200] },
      { cnn: 1000001, streetname: '1ST', st_type: 'AVE', classcode: '5', oneway: 'B', layer: 'STREETS', f_node_cnn: 2, t_node_cnn: 3, nhood: 'Mission', active: 'true', line: [0, 200, 0, 400] },
    ], { minX: -500, minZ: -500, maxX: 500, maxZ: 500 });
    expect(rows.length).toBeGreaterThan(20);
    expect(rows).toEqual(genAddresses(cfg, [
      { cnn: 1000001, streetname: '1ST', st_type: 'AVE', classcode: '5', oneway: 'B', layer: 'STREETS', f_node_cnn: 2, t_node_cnn: 3, nhood: 'Mission', active: 'true', line: [0, 200, 0, 400] },
      { cnn: 1000000, streetname: '1ST', st_type: 'AVE', classcode: '5', oneway: 'B', layer: 'STREETS', f_node_cnn: 1, t_node_cnn: 2, nhood: 'Mission', active: 'true', line: [0, 0, 0, 200] },
    ], { minX: -500, minZ: -500, maxX: 500, maxZ: 500 }));
    const parsed = rows.map((r) => JSON.parse(r) as EasRow);
    expect(Object.keys(parsed[0] as object).sort()).toEqual(['address', 'address_number', 'cnn', 'eas_baseid', 'latitude', 'longitude', 'nhood', 'street_name', 'street_type']);
    expect(parsed.some((r) => (r.address ?? '').endsWith('#2'))).toBe(true);
    const x = enuFromLatLng(Number(parsed[0]!.latitude), Number(parsed[0]!.longitude));
    expect(Math.abs(x.x)).toBeLessThan(20);
    expect(x.z).toBeGreaterThan(-5);
    expect(GRID_MIN_M).toBeLessThan(0);
  });
});
