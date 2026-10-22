/**
 * The S12 map gates (M02c2): they read the three finished assets back through `map-format.ts` and compare them with the source rows.
 *
 *  - size: `sf-map.v1` and `sf-map-bldg.v1` at most 4 MiB each (fail), 2.5 MiB warns;
 *  - decode: all three decode and carry the bake id;
 *  - street count: the distinct `cnn` with a `classcode` of 1 to 5 in `sf-map.v1` equals the count of the same filter on the source
 *    rows within 0.5 % (02-world-bake.md S12 row; DL-675), and every street record carries a `cnn`;
 *  - one-way: 30 seeded sampled segments (all when fewer) carry the `oneway` F/T/B flag of their source row;
 *  - geocode: 50 seeded base addresses (all when fewer) decode to a position within 10 m of the source row on the same `cnn`.
 * Pure over bytes and rows; the seeded sample is a hash of the bake id and an index.
 */
import { MapBuildings, MapData, decodeGeocode, sha256Hex, type GeocodeData } from '../../../../packages/shared/src/index.ts';
import { enuFromLatLng } from '../../../../packages/shared/src/index.ts';
import { mapStreetKept, onewayCode, type MapStreetRow } from '../stages/s12-map.ts';
import { parseAddressNumber, type EasRow } from '../stages/s12-geocode.ts';
import type { GateResult } from './gates.ts';

export const MAP_MAX_BYTES = 4 * 1024 * 1024;
export const MAP_WARN_BYTES = 2.5 * 1024 * 1024;
export const COUNT_TOLERANCE = 0.005;
export const ONEWAY_SAMPLE = 30;
export const GEOCODE_SAMPLE = 50;
export const GEOCODE_TOLERANCE_M = 10;

export interface MapVerifyInput {
  bakeId: string;
  map: Uint8Array;
  bldg: Uint8Array;
  geocode: Uint8Array;
  streets: readonly MapStreetRow[];
  addresses: readonly EasRow[];
}

/** `count` distinct indices below `n`, seeded by the bake id; all of `0 .. n - 1` when `n <= count`. */
export function seededSample(bakeId: string, tag: string, n: number, count: number): number[] {
  if (n <= count) return Array.from({ length: n }, (_v, i) => i);
  const picked = new Set<number>();
  for (let i = 0; picked.size < count; i++) picked.add(parseInt(sha256Hex(`${bakeId}:${tag}:${i}`).slice(0, 8), 16) % n);
  return [...picked].sort((a, b) => a - b);
}

const g = (id: string, ok: boolean, detail: string, values?: Record<string, number>, warn = false): GateResult => ({
  id, stage: 'S12', level: ok ? (warn ? 'warn' : 'pass') : 'fail', detail, ...(values ? { values } : {}),
});

/** Source counts: distinct cnn with classcode 1 to 5 under the gate filter, and the one-way flag per cnn. */
export function sourceStreets(rows: readonly MapStreetRow[]): { count15: number; oneway: Map<number, number> } {
  const cnns = new Set<number>();
  const oneway = new Map<number, number>();
  for (const r of rows) {
    const k = mapStreetKept(r);
    if (!k) continue;
    if (k.classcode <= 5) cnns.add(k.cnn);
    if (!oneway.has(k.cnn)) oneway.set(k.cnn, onewayCode(r.oneway));
  }
  return { count15: cnns.size, oneway };
}

/** Index of the geocoder entry for a source row, or -1. */
export function findAddress(d: GeocodeData, name: string, type: string, number: number, suffix: number): number {
  let sid = -1;
  for (let i = 0; i < d.streets.length; i++) {
    const s = d.streets[i] as { name: string; type: string };
    if (s.name === name && s.type === type) {
      sid = i;
      break;
    }
  }
  if (sid < 0) return -1;
  const lo0 = d.streetStart[sid] as number, hi0 = d.streetStart[sid + 1] as number;
  let lo = lo0, hi = hi0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const a = d.addresses[mid]!;
    if (a.number < number || (a.number === number && a.suffix < suffix)) lo = mid + 1;
    else hi = mid;
  }
  const a = d.addresses[lo];
  return lo < hi0 && a && a.number === number && a.suffix === suffix ? lo : -1;
}

export function verifyMapAssets(inp: MapVerifyInput): GateResult[] {
  const out: GateResult[] = [];
  out.push(g('s12.map-size', inp.map.length <= MAP_MAX_BYTES, `sf-map.v1 is ${inp.map.length} B (limit ${MAP_MAX_BYTES})`, { bytes: inp.map.length }, inp.map.length > MAP_WARN_BYTES));
  out.push(g('s12.bldg-size', inp.bldg.length <= MAP_MAX_BYTES, `sf-map-bldg.v1 is ${inp.bldg.length} B (limit ${MAP_MAX_BYTES})`, { bytes: inp.bldg.length }, inp.bldg.length > MAP_WARN_BYTES));
  let map: MapData;
  let geo: GeocodeData;
  try {
    map = MapData.decode(inp.map);
    const bl = MapBuildings.decode(inp.bldg);
    geo = decodeGeocode(inp.geocode);
    const ok = map.bakeId === inp.bakeId && bl.bakeId === inp.bakeId && geo.bakeId === inp.bakeId;
    out.push(g('s12.map-decode', ok, ok ? `the three assets decode and carry bake ${inp.bakeId.slice(0, 12)}` : 'a map asset carries another bake id'));
    if (!ok) return out;
  } catch (e) {
    out.push(g('s12.map-decode', false, (e as Error).message));
    return out;
  }

  // street count and cnn on every record
  const table = map.cnnTable();
  const src = sourceStreets(inp.streets);
  let have = 0;
  for (const v of table.values()) if (v.classcode >= 1 && v.classcode <= 5) have++;
  const diff = src.count15 === 0 ? (have === 0 ? 0 : 1) : Math.abs(have - src.count15) / src.count15;
  out.push(g('s12.map-streets', diff <= COUNT_TOLERANCE, `${have} street segments with classcode 1 to 5 in sf-map.v1, ${src.count15} in the source rows (${(diff * 100).toFixed(3)} %, limit ${COUNT_TOLERANCE * 100} %)`, { have, source: src.count15 }));
  let noCnn = 0;
  for (const { line } of map.allStreets(9)) if (!(line.cnn > 0)) noCnn++;
  out.push(g('s12.map-cnn', noCnn === 0, noCnn === 0 ? 'every z9 street record carries its cnn' : `${noCnn} z9 street records have no cnn`));

  // one-way arrows
  const cnns = [...table.keys()].sort((a, b) => a - b);
  const pick = seededSample(inp.bakeId, 'oneway', cnns.length, ONEWAY_SAMPLE);
  const bad: string[] = [];
  for (const i of pick) {
    const c = cnns[i] as number;
    const want = src.oneway.get(c);
    const got = table.get(c)?.oneway;
    if (want !== got) bad.push(`${c}: map ${got} source ${want}`);
  }
  out.push(g('s12.map-oneway', bad.length === 0, bad.length === 0 ? `one-way arrows equal the source flag on ${pick.length} sampled segments` : bad.slice(0, 6).join('; '), { sampled: pick.length }));

  // geocode sample
  const rows: { name: string; type: string; num: number; suffix: number; x: number; z: number; cnn: number }[] = [];
  for (const r of inp.addresses) {
    const num = parseAddressNumber(r.address ?? '', r.address_number);
    const cnn = Number(r.cnn);
    const p = enuFromLatLng(Number(r.latitude), Number(r.longitude));
    if (!num || !(cnn > 0) || !Number.isFinite(p.x)) continue;
    rows.push({ name: (r.street_name ?? '').trim().toUpperCase(), type: (r.street_type ?? '').trim().toUpperCase(), num: num.number, suffix: num.suffix, x: p.x, z: p.z, cnn });
  }
  const keyed = rows.filter((r) => findAddress(geo, r.name, r.type, r.num, r.suffix) >= 0).sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type) || a.num - b.num || a.suffix - b.suffix);
  const gpick = seededSample(inp.bakeId, 'geocode', keyed.length, GEOCODE_SAMPLE);
  const gbad: string[] = [];
  for (const i of gpick) {
    const r = keyed[i]!;
    const a = geo.addresses[findAddress(geo, r.name, r.type, r.num, r.suffix)]!;
    const d = Math.hypot(a.x - r.x, a.z - r.z);
    // duplicates of one base address keep the lowest eas_baseid, whose position can differ from this row by a unit's offset
    if (d > GEOCODE_TOLERANCE_M || (a.cnn !== r.cnn && d > 0.5)) gbad.push(`${r.num} ${r.name} ${r.type}: ${d.toFixed(1)} m, cnn ${a.cnn} vs ${r.cnn}`);
  }
  out.push(g('s12.geocode-sample', gbad.length === 0 && geo.addresses.length > 0 || inp.addresses.length === 0, gbad.length === 0 ? `${gpick.length} sampled addresses geocode within ${GEOCODE_TOLERANCE_M} m on the same cnn (${geo.addresses.length} base addresses)` : gbad.slice(0, 6).join('; '), { sampled: gpick.length, addresses: geo.addresses.length }));
  return out;
}
