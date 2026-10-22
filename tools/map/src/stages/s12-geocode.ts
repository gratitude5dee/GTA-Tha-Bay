/**
 * S12 geocode (M02c2; 02-world-maps.md section 1; stage id `map`): `map_data/sf-geocode.v1`, the offline address geocoder.
 *
 * Rows are the DataSF EAS addresses (`ramy-di5m`): one entry per base address (street, number, suffix; the unit rows "#2" collapse to
 * the lowest `eas_baseid`), sorted by street and number, with the EAS `cnn` kept so a result can say which street segment it is on.
 * The name index holds the landmarks, the points of interest and the 41 neighbourhoods. Pure: the same rows give the same bytes.
 */
import {
  NameKind, enuFromLatLng, encodeGeocode,
  type GeocodeAddress, type GeocodeName, type GeocodeStreet, type LandmarkRecord, type PoiRecord,
} from '../../../../packages/shared/src/index.ts';
import { labelFromKey } from './s12-map.ts';
import type { Bbox } from '../geom/rings.ts';

export interface EasRow {
  address?: string;
  address_number?: string | number;
  street_name?: string;
  street_type?: string;
  cnn?: string | number;
  latitude?: string | number;
  longitude?: string | number;
  eas_baseid?: string | number;
  nhood?: string;
}

export interface GeocodeInputs {
  bakeId: string;
  rows: readonly EasRow[];
  landmarks: readonly LandmarkRecord[];
  pois: readonly PoiRecord[];
  hoods: readonly { name: string; x: number; z: number }[];
  box: Bbox;
}

export interface GeocodeReport {
  rows: number;
  addresses: number;
  streets: number;
  names: number;
  skipped: { badRow: number; outOfBox: number; duplicate: number };
  bytes: number;
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Splits "329A FULTON ST #2" into number, suffix (0 none, 1 to 26 A to Z, 27 for 1/2) and the rest; null when there is no number. */
export function parseAddressNumber(address: string, fallbackNumber: string | number | undefined): { number: number; suffix: number } | null {
  const m = /^(\d+)\s?([A-Z]|1\/2)?(?=\s)/.exec(address.trim().toUpperCase());
  if (m) {
    const n = Number(m[1]);
    const s = m[2];
    return { number: n, suffix: s === undefined ? 0 : s === '1/2' ? 27 : (s.charCodeAt(0) - 64) };
  }
  const n = Number(fallbackNumber);
  return Number.isInteger(n) && n > 0 ? { number: n, suffix: 0 } : null;
}

export function runGeocode(inp: GeocodeInputs): { bytes: Uint8Array; report: GeocodeReport } {
  const skipped = { badRow: 0, outOfBox: 0, duplicate: 0 };
  const streetKey = (name: string, type: string): string => `${name}\u0000${type}`;
  const seenStreets = new Map<string, GeocodeStreet>();
  type Cand = { street: string; number: number; suffix: number; x: number; z: number; cnn: number; base: number };
  const cands: Cand[] = [];
  for (const r of inp.rows) {
    const name = (r.street_name ?? '').trim().toUpperCase();
    const type = (r.street_type ?? '').trim().toUpperCase();
    const lat = Number(r.latitude), lng = Number(r.longitude), cnn = Number(r.cnn);
    const num = parseAddressNumber(r.address ?? '', r.address_number);
    if (name === '' || !num || num.number > 65535 || !Number.isFinite(lat) || !Number.isFinite(lng) || !(cnn > 0)) {
      skipped.badRow++;
      continue;
    }
    const p = enuFromLatLng(lat, lng);
    if (p.x < inp.box.minX || p.x >= inp.box.maxX || p.z < inp.box.minZ || p.z >= inp.box.maxZ) {
      skipped.outOfBox++;
      continue;
    }
    const k = streetKey(name, type);
    if (!seenStreets.has(k)) seenStreets.set(k, { name, type });
    cands.push({ street: k, number: num.number, suffix: num.suffix, x: p.x, z: p.z, cnn, base: Number(r.eas_baseid) || 0 });
  }
  const streets = [...seenStreets.values()].sort((a, b) => cmpStr(a.name, b.name) || cmpStr(a.type, b.type));
  if (streets.length > 65535) throw new RangeError('S12 geocode: more than 65535 streets');
  const streetId = new Map(streets.map((s, i) => [streetKey(s.name, s.type), i] as const));
  // the base address: the lowest eas_baseid of the (street, number, suffix) group
  const best = new Map<string, Cand>();
  for (const c of cands) {
    const k = `${c.street}\u0000${c.number}\u0000${c.suffix}`;
    const cur = best.get(k);
    if (!cur) best.set(k, c);
    else {
      skipped.duplicate++;
      if (c.base < cur.base) best.set(k, c);
    }
  }
  const addresses: GeocodeAddress[] = [...best.values()].map((c) => ({
    streetId: streetId.get(c.street) as number, number: c.number, suffix: c.suffix, x: c.x, z: c.z, cnn: c.cnn,
  }));

  const names: GeocodeName[] = [];
  for (const l of inp.landmarks) names.push({ kind: NameKind.Landmark, label: labelFromKey(l.nameKey), x: l.x, z: l.z });
  for (const p of inp.pois) if (p.landmark === null && p.kind !== 'home' && p.nameKey !== '') names.push({ kind: NameKind.Poi, label: labelFromKey(p.nameKey), x: p.x, z: p.z });
  for (const h of inp.hoods) names.push({ kind: NameKind.Hood, label: h.name, x: h.x, z: h.z });

  const bytes = encodeGeocode({ bakeId: inp.bakeId, streets, addresses, names });
  return { bytes, report: { rows: inp.rows.length, addresses: addresses.length, streets: streets.length, names: names.length, skipped, bytes: bytes.length } };
}
