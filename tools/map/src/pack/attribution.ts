/**
 * config/attribution.world.json: one entry per source `{id, text, licence, licenceUrl, source, surfaces}`, generated from
 * config/world/sources.json and the committed `sf` raw lock, so it is reproducible offline. The Terrarium entry carries the
 * registry citation "Terrain Tiles was accessed on DATE from https://registry.opendata.aws/terrain-tiles" once the lock is
 * committed (M02a1 AC-9; DATE is the UTC date of the Terrarium `retrievedAt`); without the lock it omits the citation.
 * Each bake copies the entries of its area next to its packs.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { toolsRoot } from '../../../ci/lib/common.ts';
import type { AreaId, SourcesConfig } from '../config.ts';
import { cmp, stableJson, writeEnsured } from '../util.ts';

export interface AttributionEntry { id: string; text: string; licence: string; licenceUrl: string; source: string; surfaces: string[]; offerUrl?: string }
export interface AttributionFile { schema: 'attribution-world/1'; entries: AttributionEntry[] }

export const ATTRIBUTION_PATH = path.join(toolsRoot, 'config', 'attribution.world.json');

export const SF_LOCK_PATH = path.join(toolsRoot, 'content', 'world', 'raw.lock.sf.json');

/** `YYYY-MM-DD` of the Terrarium entry of the committed sf lock, or null while the lock is not committed. */
export function terrariumAccessDate(file = SF_LOCK_PATH): string | null {
  if (!existsSync(file)) return null;
  const lock = JSON.parse(readFileSync(file, 'utf8')) as { sources?: { id: string; retrievedAt: string }[] };
  const t = lock.sources?.find((x) => x.id === 'terrarium');
  return t ? t.retrievedAt.slice(0, 10) : null;
}

export const TERRARIUM_CITATION_URL = 'https://registry.opendata.aws/terrain-tiles';

export function buildAttribution(cfg: SourcesConfig, accessed: string | null = terrariumAccessDate()): AttributionFile {
  const entries = cfg.sources
    .map((s) => ({ id: s.id, text: s.id === 'terrarium' && accessed ? `${s.attribution}. Terrain Tiles was accessed on ${accessed} from ${TERRARIUM_CITATION_URL}` : s.attribution, licence: s.licence, licenceUrl: s.licenceUrl, source: s.source, surfaces: [...s.surfaces], ...(s.offerUrl ? { offerUrl: s.offerUrl } : {}) }))
    .sort((a, b) => cmp(a.id, b.id));
  return { schema: 'attribution-world/1', entries };
}

export function attributionFor(cfg: SourcesConfig, area: AreaId): AttributionFile {
  const used = new Set(cfg.areas[area].sources);
  const all = buildAttribution(cfg);
  return { schema: 'attribution-world/1', entries: all.entries.filter((e) => used.has(e.id)) };
}

/** Writes config/attribution.world.json when it differs; returns true when it changed. */
export function writeAttribution(cfg: SourcesConfig, file = ATTRIBUTION_PATH): boolean {
  const text = stableJson(buildAttribution(cfg));
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return false;
  writeEnsured(file, text);
  return true;
}
