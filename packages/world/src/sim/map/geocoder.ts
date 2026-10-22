/**
 * The offline geocoder over `map_data/sf-geocode.v1` (M02c2; 02-world-maps.md sections 1 and 3.4). It answers
 *
 *  - an address ("329 Fulton St", "329 fulton", "51st ave" with no number lists nothing but the street): exact base addresses, and when
 *    the number is not in the file the nearest number on the same street, marked `exact: false`;
 *  - a street name (its middle address);
 *  - a landmark, point of interest or neighbourhood name (exact, prefix, then every word a prefix).
 *
 * `PlaceIndex.findPlace` plugs it in through `PlaceIndexImpl.setGeocoder`; the `map:geocode` CLI and the phone Map app call the same
 * class. Pure over decoded data; C02 lint applies.
 */
import { NameKind, decodeGeocode, type GeocodeData } from '@dv/shared';

export type GeocodeKind = 'address' | 'street' | 'landmark' | 'poi' | 'nhood';

export interface GeocodeHit {
  label: string;
  x: number;
  z: number;
  kind: GeocodeKind;
  /** Street segment of an address result (the EAS `cnn`); 0 for names and streets. */
  cnn: number;
  /** False for the nearest-number answer of an address that is not in the file. */
  exact: boolean;
}

/** Street type words and their EAS abbreviations. */
const TYPE_ALIASES: Readonly<Record<string, string>> = {
  STREET: 'ST', AVENUE: 'AVE', BOULEVARD: 'BLVD', DRIVE: 'DR', COURT: 'CT', PLACE: 'PL', ROAD: 'RD', LANE: 'LN', TERRACE: 'TER', ALLEY: 'ALY',
  HIGHWAY: 'HWY', PARKWAY: 'PKWY', CIRCLE: 'CIR', PLAZA: 'PLZ', SQUARE: 'SQ', WALK: 'WALK', WAY: 'WAY', ROW: 'ROW', HILL: 'HL', PARK: 'PARK',
  ST: 'ST', AVE: 'AVE', BLVD: 'BLVD', DR: 'DR', CT: 'CT', PL: 'PL', RD: 'RD', LN: 'LN', TER: 'TER', ALY: 'ALY', HWY: 'HWY', PKWY: 'PKWY',
  CIR: 'CIR', PLZ: 'PLZ', SQ: 'SQ', HL: 'HL', AV: 'AVE', BL: 'BLVD',
};

const tokensOf = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);

const titleCase = (s: string): string => s.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_m, a: string, b: string) => `${a}${b.toUpperCase()}`);

/** "329A" gives { number: 329, suffix: 1 }; "329" gives suffix 0. */
export function parseNumberToken(tok: string): { number: number; suffix: number } | null {
  const m = /^(\d{1,5})([a-z])?$/i.exec(tok);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 65535 ? { number: n, suffix: m[2] === undefined ? 0 : m[2].toUpperCase().charCodeAt(0) - 64 } : null;
}

export class Geocoder {
  /** Name index entries with their lower-case words. */
  private readonly nameTokens: string[][];
  private readonly lowerNames: string[];

  constructor(readonly data: GeocodeData) {
    this.lowerNames = data.names.map((n) => n.label.toLowerCase());
    this.nameTokens = data.names.map((n) => tokensOf(n.label));
  }

  static fromBytes(buf: ArrayBuffer | ArrayBufferView): Geocoder {
    return new Geocoder(decodeGeocode(buf));
  }

  get addressCount(): number {
    return this.data.addresses.length;
  }

  /** Streets whose name equals (exact) or starts with `words`, and whose type is `type` when given. */
  private streetsFor(words: string, type: string | null): number[] {
    const exact: number[] = [];
    const prefix: number[] = [];
    const streets = this.data.streets;
    for (let i = 0; i < streets.length; i++) {
      const s = streets[i] as { name: string; type: string };
      if (type !== null && s.type !== type) continue;
      if (s.name === words) exact.push(i);
      else if (s.name.startsWith(`${words} `) || (words.length >= 3 && s.name.startsWith(words))) prefix.push(i);
    }
    return exact.length > 0 ? exact : prefix;
  }

  private streetLabel(id: number): string {
    const s = this.data.streets[id] as { name: string; type: string };
    return titleCase(s.type ? `${s.name} ${s.type}` : s.name);
  }

  private addressHit(i: number, exact: boolean): GeocodeHit {
    const a = this.data.addresses[i]!;
    const suffix = a.suffix === 0 ? '' : a.suffix === 27 ? ' 1/2' : String.fromCharCode(64 + a.suffix);
    return { label: `${a.number}${suffix} ${this.streetLabel(a.streetId)}`, x: a.x, z: a.z, kind: 'address', cnn: a.cnn, exact };
  }

  /** The index of the address (number, suffix) on a street, or the insertion point; `found` says which. */
  private lookup(streetId: number, number: number, suffix: number): { index: number; found: boolean } {
    const d = this.data;
    const lo0 = d.streetStart[streetId] as number, hi0 = d.streetStart[streetId + 1] as number;
    let lo = lo0, hi = hi0;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const a = d.addresses[mid]!;
      if (a.number < number || (a.number === number && a.suffix < suffix)) lo = mid + 1;
      else hi = mid;
    }
    const a = d.addresses[lo];
    return { index: lo, found: lo < hi0 && a !== undefined && a.number === number && a.suffix === suffix };
  }

  /** Address results for "<number> <street words>"; empty when the text is not an address or names no street. */
  address(text: string, limit = 5): GeocodeHit[] {
    const toks = text.trim().toUpperCase().split(/[\s,]+/).filter((t) => t.length > 0);
    const first = toks[0];
    const num = first === undefined ? null : parseNumberToken(first);
    if (!num || toks.length < 2) return [];
    let rest = toks.slice(1);
    let type: string | null = null;
    const last = rest[rest.length - 1] as string;
    const alias = TYPE_ALIASES[last];
    if (alias !== undefined && rest.length > 1) {
      type = alias;
      rest = rest.slice(0, -1);
    }
    const words = rest.join(' ');
    let ids = this.streetsFor(words, type);
    // "9th ave" where the type word is part of the name: retry with the whole text as the name
    if (ids.length === 0 && type !== null) ids = this.streetsFor(toks.slice(1).join(' '), null);
    const out: GeocodeHit[] = [];
    for (const id of ids) {
      const r = this.lookup(id, num.number, num.suffix);
      if (r.found) out.push(this.addressHit(r.index, true));
      else {
        // nearest number on the street, the same parity first
        const lo0 = this.data.streetStart[id] as number, hi0 = this.data.streetStart[id + 1] as number;
        if (hi0 === lo0) continue;
        let best = -1, bestScore = Infinity;
        for (const j of [r.index - 2, r.index - 1, r.index, r.index + 1]) {
          if (j < lo0 || j >= hi0) continue;
          const a = this.data.addresses[j]!;
          const score = Math.abs(a.number - num.number) * 2 + ((a.number - num.number) % 2 === 0 ? 0 : 1);
          if (score < bestScore) {
            bestScore = score;
            best = j;
          }
        }
        if (best >= 0) out.push(this.addressHit(best, false));
      }
      if (out.length >= limit) break;
    }
    return out.slice(0, limit);
  }

  /** The middle address of each street whose name starts with the text. */
  streets(text: string, limit = 5): GeocodeHit[] {
    const toks = text.trim().toUpperCase().split(/[\s,]+/).filter((t) => t.length > 0);
    if (toks.length === 0) return [];
    let type: string | null = null;
    let words = toks;
    const alias = TYPE_ALIASES[toks[toks.length - 1] as string];
    if (alias !== undefined && toks.length > 1) {
      type = alias;
      words = toks.slice(0, -1);
    }
    const out: GeocodeHit[] = [];
    for (const id of this.streetsFor(words.join(' '), type)) {
      const lo = this.data.streetStart[id] as number, hi = this.data.streetStart[id + 1] as number;
      if (hi === lo) continue;
      const a = this.data.addresses[lo + ((hi - lo) >>> 1)]!;
      out.push({ label: this.streetLabel(id), x: a.x, z: a.z, kind: 'street', cnn: a.cnn, exact: true });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Landmarks, points of interest and neighbourhoods by name. */
  names(text: string, limit = 5): GeocodeHit[] {
    const q = text.toLowerCase().trim();
    const qt = tokensOf(q);
    if (qt.length === 0) return [];
    const scored: { i: number; score: number }[] = [];
    for (let i = 0; i < this.lowerNames.length; i++) {
      const lower = this.lowerNames[i] as string;
      let score = 0;
      if (lower === q) score = 100;
      else if (lower.startsWith(q)) score = 80;
      else if (qt.every((t) => (this.nameTokens[i] as string[]).some((et) => et.startsWith(t)))) score = 60;
      else continue;
      if (this.data.names[i]!.kind === NameKind.Landmark) score += 5;
      scored.push({ i, score });
    }
    scored.sort((a, b) => b.score - a.score || (this.lowerNames[a.i]! < this.lowerNames[b.i]! ? -1 : this.lowerNames[a.i]! > this.lowerNames[b.i]! ? 1 : 0) || a.i - b.i);
    return scored.slice(0, limit).map(({ i }) => {
      const n = this.data.names[i]!;
      return { label: n.label, x: n.x, z: n.z, kind: n.kind === NameKind.Landmark ? 'landmark' : n.kind === NameKind.Poi ? 'poi' : 'nhood', cnn: 0, exact: true } as GeocodeHit;
    });
  }

  /** Everything the text can mean, best first: addresses when it starts with a number, then names, then streets. */
  search(text: string, limit = 8): GeocodeHit[] {
    const out: GeocodeHit[] = [];
    const add = (hs: GeocodeHit[]): void => {
      for (const h of hs) if (out.length < limit) out.push(h);
    };
    add(this.address(text, limit));
    add(this.names(text, limit));
    add(this.streets(text, limit));
    return out;
  }
}
