/**
 * The art half of `credits.json` (M10d0, DL-OWN-06): one entry per CC-BY record with the five fields CC BY 4.0 asks for
 * (title, author, source URL, licence URL, change notes), plus a courtesy line per used CC0 pack. The CC-BY attribution
 * of a provenance record is one string in a fixed shape that `parseCcByAttribution` reads back:
 *
 *   "<title>" by <author> (<source url>), licensed under CC BY 4.0 (<licence url>). Changes: <what was changed>.
 *
 * Pure data and string helpers; C02 lint applies.
 */
import type { ArtPack, ArtRecordView } from './gates/provenance.ts';

export interface CcByParts {
  title?: string;
  author?: string;
  sourceUrl?: string;
  licenceUrl?: string;
  changes?: string;
}

export const CC_BY_LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/';

const TITLE_AUTHOR_URL = /^\s*["“]([^"”]+)["”]\s+by\s+(.+?)\s+\((https?:\/\/[^\s)]+)\)/;
const LICENCE_URL = /\((https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/?[^\s)]*)\)/;
const CHANGES = /\bchanges:\s*(\S[^\n]*?)\.?\s*$/i;

/** The fields an attribution string carries; a field it lacks is absent from the result. */
export function parseCcByAttribution(attribution: string): CcByParts {
  const out: CcByParts = {};
  const head = TITLE_AUTHOR_URL.exec(attribution);
  if (head) {
    out.title = (head[1] as string).trim();
    out.author = (head[2] as string).trim();
    out.sourceUrl = head[3] as string;
  }
  const lic = LICENCE_URL.exec(attribution);
  if (lic) out.licenceUrl = lic[1] as string;
  const ch = CHANGES.exec(attribution);
  if (ch) out.changes = (ch[1] as string).trim();
  return out;
}

/** The names of the required CC-BY fields that `parts` lacks, in the order of CC BY 4.0 section 3(a)(1). */
export function missingCcByFields(parts: CcByParts): string[] {
  const missing: string[] = [];
  if (!parts.title) missing.push('title');
  if (!parts.author) missing.push('author');
  if (!parts.sourceUrl) missing.push('source URL');
  if (!parts.licenceUrl) missing.push('licence URL');
  if (!parts.changes) missing.push('changes:');
  return missing;
}

/** Builds the attribution string of a CC-BY record from its parts. */
export function ccByAttribution(p: Required<CcByParts>): string {
  return `"${p.title}" by ${p.author} (${p.sourceUrl}), licensed under CC BY 4.0 (${p.licenceUrl}). Changes: ${p.changes}.`;
}

export interface ArtCreditCcBy {
  pack: string;
  title: string;
  author: string;
  sourceUrl: string;
  licence: string;
  licenceUrl: string;
  changes: string;
}

export interface ArtCreditCourtesy {
  pack: string;
  courtesy: string;
}

export type ArtCredit = ArtCreditCcBy | ArtCreditCourtesy;

export function isCourtesy(c: ArtCredit): c is ArtCreditCourtesy {
  return 'courtesy' in c;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/([^/:?#]+)/i.exec(url);
  return m ? (m[1] as string).toLowerCase() : null;
}

/** The pack whose host list holds the host of `url` (a subdomain of a listed host counts), or undefined. */
export function packOfUrl(packs: readonly ArtPack[], url: string | null | undefined): ArtPack | undefined {
  const host = hostOf(url);
  if (host === null) return undefined;
  return packs.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
}

function byKey(a: ArtCredit, b: ArtCredit): number {
  const ka = `${a.pack}\u0000${isCourtesy(a) ? '' : a.title}`;
  const kb = `${b.pack}\u0000${isCourtesy(b) ? '' : b.title}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * The `art[]` of credits.json: a full entry per active CC-BY licensed record, a courtesy line per CC0 pack that an active
 * licensed record names, both sorted by pack then title, without duplicates.
 */
export function buildArtCredits(records: readonly ArtRecordView[], packs: readonly ArtPack[]): ArtCredit[] {
  const out: ArtCredit[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (r.origin !== 'licensed' || r.status !== 'active') continue;
    const pack = packOfUrl(packs, r.source?.url);
    if (!pack) continue;
    if (r.license === 'CC-BY-4.0' && r.attribution) {
      const p = parseCcByAttribution(r.attribution);
      if (missingCcByFields(p).length > 0) continue;
      const key = `${pack.id}\u0000${p.title ?? ''}\u0000${p.sourceUrl ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        pack: pack.id,
        title: p.title as string,
        author: p.author as string,
        sourceUrl: p.sourceUrl as string,
        licence: r.license,
        licenceUrl: p.licenceUrl as string,
        changes: p.changes as string,
      });
    } else if (r.license === 'CC0-1.0' && pack.courtesy) {
      const key = `${pack.id}\u0000`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ pack: pack.id, courtesy: pack.courtesy });
    }
  }
  return out.sort(byKey);
}
