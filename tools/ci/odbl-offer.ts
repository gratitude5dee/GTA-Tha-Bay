/**
 * `odblOffer` (M02c2, DL-695): the pure check that the ODbL offer is published and shown. It passes only when the OSM entry of
 * `config/attribution.world.json` carries an `https` `offerUrl` and the built `credits.json` holds the same URL in its `world`
 * array. `deploy:prod` runs it on a release build before `versions upload`; M14b3's `odbl-offer` gate imports it.
 */

export interface OdblAttributionInput {
  entries?: { id: string; offerUrl?: string }[];
}
export interface OdblCreditsInput {
  world?: { id: string; offerUrl?: string }[];
  odblNotice?: string;
}
export interface OdblOfferResult {
  status: 'pass' | 'pending';
  evidence: string;
}

const HTTPS = /^https:\/\/[^\s/@]+\/\S*$/;

export function odblOffer(input: { attribution: OdblAttributionInput | null; credits: OdblCreditsInput | null }): OdblOfferResult {
  const osm = input.attribution?.entries?.find((e) => e.id === 'osm');
  if (!osm) return { status: 'pending', evidence: 'config/attribution.world.json has no osm entry' };
  const url = osm.offerUrl;
  if (typeof url !== 'string' || !HTTPS.test(url)) return { status: 'pending', evidence: 'the osm entry of config/attribution.world.json has no https offerUrl' };
  if (!input.credits) return { status: 'pending', evidence: 'credits.json was not built' };
  const inCredits = input.credits.world?.find((e) => e.id === 'osm')?.offerUrl;
  if (inCredits !== url) return { status: 'pending', evidence: `credits.json ${inCredits ? `names ${inCredits}` : 'has no offerUrl'}, the attribution names ${url}` };
  return { status: 'pass', evidence: `the credits show the ODbL offer ${url}` };
}
