/**
 * The authored world seeds of `content/world/` (M02a2) and the `content-world` source stamp (DL-677): one `authored`
 * stamp, licence ODbL-1.0, whose sha256 is the hash of the canonical JSON of all seed files. Every pack's provenance lists
 * it in `derived_from` next to the open-data stamps, so changing one POI name changes the stamp and every pack hash.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalize, sha256Hex, type SourceStamp } from '../../../packages/shared/src/index.ts';
import { toolsRoot } from '../../ci/lib/common.ts';
import { mapSchema } from './config.ts';
import type { RoadFixes } from './stages/s5-roads.ts';

export const CONTENT_DIR = path.join(toolsRoot, 'content', 'world');
export const CONTENT_STAMP_ID = 'content-world';
export const CONTENT_ATTRIBUTION = 'Dee-Verse authored world seeds (content/world), contributed to the ODbL database';
/** Fixed so the stamp is reproducible: the seeds are repo content, not a download. */
export const CONTENT_STAMP_AT = '2026-10-19T00:00:00Z';

export interface LandmarkSeed {
  id: string; lat: number; lng: number; x: number; z: number; chunk: string; district: string; nhood: string; cls: 'hero' | 'major' | 'minor';
  osm: string; role: string; skyline: boolean; replaceRadiusM: number;
  /** M02d1: the landmark recipe's parameters (the 12 modelled landmarks only). */
  recipe?: Record<string, number | number[] | string>;
}
export interface PoiSeed {
  id: string; kind: string; nameKey: string; name?: string; lat: number; lng: number; nhood: string; district: string; landmark: string | null;
  hours: [number, number] | null; snap?: boolean;
}
export interface DistrictsFile {
  schema: 'world-districts/1';
  districts: { id: string; name: string; tier: 'A' | 'B' | 'C' | 'stage'; profile: string; nhoods: string[] }[];
  nhoodProfile?: Record<string, string>;
}
export interface BreakerSeed { id: string; kind: string; prefab: string; lat: number; lng: number; triggerRadiusM: number; mission: boolean }
export interface CablecarsFile { lines: { id: string; legs: { street: string; from: string; to: string }[] }[] }
export interface TransitLinesFile {
  stations: { id: string; kind: 'bay-rail' | 'city-metro' | 'rail-terminus'; nameKey: string; lat: number; lng: number; fastTravel: boolean }[];
  ferry: { id: string; nameKey: string; points: { lat: number; lng: number }[] }[];
  air: { id: string; nameKey: string; altitudeM: [number, number]; points: { lat: number; lng: number }[] }[];
}
export interface ContentWorld {
  landmarks: LandmarkSeed[];
  pois: PoiSeed[];
  districts: DistrictsFile;
  pursuitBreakers: BreakerSeed[];
  cablecars: CablecarsFile;
  teleports: string[];
  transitLines: TransitLinesFile;
  roadFixes: RoadFixes;
}

/** File name, schema name, key in the canonical JSON. */
export const CONTENT_FILES = [
  ['landmarks.json', 'landmarks'], ['pois.json', 'pois'], ['districts.json', 'districts'], ['pursuit-breakers.json', 'pursuit-breakers'],
  ['cablecars.json', 'cablecars'], ['teleports.json', 'teleports'], ['transit-lines.json', 'transit-lines'], ['road-fixes.json', 'road-fixes'],
] as const;

const read = (dir: string, f: string): unknown => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));

export function loadContentRaw(dir = CONTENT_DIR): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [f, schema] of CONTENT_FILES) {
    const doc = read(dir, f);
    const errs = mapSchema(schema)(doc);
    if (errs.length > 0) throw new Error(`content/world/${f} is invalid:\n  ${errs.slice(0, 12).join('\n  ')}`);
    out[f] = doc;
  }
  return out;
}

export function loadContentWorld(dir = CONTENT_DIR): ContentWorld {
  const raw = loadContentRaw(dir);
  return {
    landmarks: (raw['landmarks.json'] as { landmarks: LandmarkSeed[] }).landmarks,
    pois: (raw['pois.json'] as { pois: PoiSeed[] }).pois,
    districts: raw['districts.json'] as DistrictsFile,
    pursuitBreakers: (raw['pursuit-breakers.json'] as { breakers: BreakerSeed[] }).breakers,
    cablecars: raw['cablecars.json'] as CablecarsFile,
    teleports: (raw['teleports.json'] as { sandbox: string[] }).sandbox,
    transitLines: raw['transit-lines.json'] as TransitLinesFile,
    roadFixes: raw['road-fixes.json'] as RoadFixes,
  };
}

/** SHA-256 of the canonical JSON of every seed file, keyed by file name. */
export function contentWorldSha(dir = CONTENT_DIR): string {
  const docs: Record<string, unknown> = {};
  for (const [f] of CONTENT_FILES) docs[f] = read(dir, f);
  return sha256Hex(canonicalize(docs));
}

export function contentRows(c: ContentWorld): number {
  return c.landmarks.length + c.pois.length + c.districts.districts.length + c.pursuitBreakers.length + c.cablecars.lines.length + c.transitLines.stations.length + (c.roadFixes?.keepWays.length ?? 0) + (c.roadFixes?.connectors.length ?? 0);
}

/** The C08 stamp and the matching raw-lock entry for the seeds. */
export function contentStamp(dir = CONTENT_DIR): SourceStamp {
  return {
    id: CONTENT_STAMP_ID, url: 'repo://content/world', retrievedAt: CONTENT_STAMP_AT, sha256: contentWorldSha(dir), licence: 'ODbL-1.0',
    attribution: CONTENT_ATTRIBUTION,
  };
}
