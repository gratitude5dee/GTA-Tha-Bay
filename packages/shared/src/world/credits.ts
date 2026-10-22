/**
 * The world half of `credits.json` (M02c2, DL-662, DL-695): every `config/attribution.world.json` entry, the ODbL notice and the
 * ODbL offer URL. The build emits it (`provenance-check --emit-credits --emit-only`); the credits page reads `/credits.json` and
 * falls back to a bundled copy of the attribution file; `deploy:prod` and M14b3's `odbl-offer` gate check that the offer URL is in both.
 * Pure data and string helpers; C02 lint applies.
 */

export interface WorldCreditEntry {
  id: string;
  text: string;
  licence: string;
  licenceUrl: string;
  source: string;
  surfaces: string[];
  /** The OSM row only, once the ODbL offer is published. */
  offerUrl?: string;
}

export interface WorldAttributionFile {
  schema?: string;
  entries: WorldCreditEntry[];
}

/** The line the credits page shows under the data credits (02-world-maps.md section 6 rule 3). */
export const ODBL_NOTICE = 'World data derived from OpenStreetMap is available under the ODbL 1.0; the bake tools and packs are published.';

export interface WorldCredits {
  world: WorldCreditEntry[];
  odblNotice: string;
}

/** The `world` array and notice of `credits.json` for an attribution file: entries in id order, the notice naming the offer URL when there is one. */
export function worldCreditsOf(file: WorldAttributionFile): WorldCredits {
  const world = [...file.entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((e) => ({ ...e, surfaces: [...e.surfaces] }));
  const offer = world.find((e) => e.id === 'osm')?.offerUrl;
  return { world, odblNotice: offer ? `${ODBL_NOTICE} Offer: ${offer}` : ODBL_NOTICE };
}

/** The entries shown on one surface (`boot-splash`, `full-map`, `pause-credits`), de-duplicated by text. */
export function creditsForSurface(entries: readonly WorldCreditEntry[], surface: string): WorldCreditEntry[] {
  const seen = new Set<string>();
  const out: WorldCreditEntry[] = [];
  for (const e of entries) {
    if (!e.surfaces.includes(surface) || seen.has(e.text)) continue;
    seen.add(e.text);
    out.push(e);
  }
  return out;
}
