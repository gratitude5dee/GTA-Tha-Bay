/**
 * config/attribution.world.json: one entry per source `{id, text, licence, licenceUrl, source, surfaces}`, generated from
 * config/world/sources.json alone so it is reproducible offline. Each bake copies the entries of its area next to its packs.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { toolsRoot } from '../../../ci/lib/common.ts';
import type { AreaId, SourcesConfig } from '../config.ts';
import { cmp, stableJson, writeEnsured } from '../util.ts';

export interface AttributionEntry { id: string; text: string; licence: string; licenceUrl: string; source: string; surfaces: string[] }
export interface AttributionFile { schema: 'attribution-world/1'; entries: AttributionEntry[] }

export const ATTRIBUTION_PATH = path.join(toolsRoot, 'config', 'attribution.world.json');

export function buildAttribution(cfg: SourcesConfig): AttributionFile {
  const entries = cfg.sources
    .map((s) => ({ id: s.id, text: s.attribution, licence: s.licence, licenceUrl: s.licenceUrl, source: s.source, surfaces: [...s.surfaces] }))
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
