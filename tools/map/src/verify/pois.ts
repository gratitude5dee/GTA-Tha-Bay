/**
 * `pnpm map:pois [-- --bake <id> | --area <id>]`: the POI seed validator (M02a2). Seeds: schema, counts by kind
 * (37 landmark POIs, 8 transit stations, 41 neighbourhood hubs, parks and plazas, fictional businesses and homes), unique
 * ids, fictional business names that pass the `names:lint` and `ip:strings` matchers (the denylist matcher
 * `compileStringMatcher`, so a denylisted brand fails), and no EAS address as a home. With an `sf` bake the id prefix must
 * equal the neighbourhood slug of the point and every POI must bind to a pedestrian node within 25 m; on `synth` those two
 * are warnings.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compileStringMatcher, scanText, type IpDenylistConfig } from '../../../../packages/shared/src/assets/gates/ip.ts';
import { toolsRoot } from '../../../ci/lib/common.ts';
import { loadContentWorld, type PoiSeed } from '../content.ts';
import type { Finding } from './landmarks.ts';

export const MIN_COUNTS: Record<string, number> = { landmark: 37, transit: 8, hub: 41, parkplaza: 20, other: 45 };
const KIND_GROUP = (k: string): string => (k === 'park' || k === 'plaza' ? 'parkplaza' : k === 'landmark' || k === 'transit' || k === 'hub' ? k : 'other');

export function loadDenylist(root = toolsRoot): IpDenylistConfig {
  return JSON.parse(readFileSync(path.join(root, 'config', 'ip-denylist.json'), 'utf8')) as IpDenylistConfig;
}

export function countsByKind(seeds: readonly PoiSeed[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const p of seeds) c[p.kind] = (c[p.kind] ?? 0) + 1;
  return c;
}

/** Names a POI seed shows or carries: its display name and its name key. */
export function nameFindings(seeds: readonly PoiSeed[], deny: IpDenylistConfig = loadDenylist()): Finding[] {
  const m = compileStringMatcher(deny);
  const out: Finding[] = [];
  for (const p of seeds) {
    for (const text of [p.name ?? '', p.nameKey, p.id]) {
      for (const h of scanText(text, m)) out.push({ level: 'fail', id: 'pois.name', detail: `${p.id}: "${text}" matches the denylist (${h.rule}: ${h.match})` });
    }
  }
  return out;
}

export function validatePoiSeeds(seeds: readonly PoiSeed[] = loadContentWorld().pois, deny: IpDenylistConfig = loadDenylist()): Finding[] {
  const out: Finding[] = [];
  const ids = new Set<string>();
  const groups: Record<string, number> = {};
  for (const p of seeds) {
    if (ids.has(p.id)) out.push({ level: 'fail', id: 'pois.unique', detail: `duplicate id ${p.id}` });
    ids.add(p.id);
    groups[KIND_GROUP(p.kind)] = (groups[KIND_GROUP(p.kind)] ?? 0) + 1;
    if (!p.id.startsWith(`poi.${p.nhood}.`)) out.push({ level: 'fail', id: 'pois.prefix', detail: `${p.id}: the id prefix is not poi.${p.nhood}.` });
    if (p.kind === 'home' && (p.name !== undefined || /\d{1,5}\s+[A-Za-z]/.test(p.nameKey))) out.push({ level: 'fail', id: 'pois.home', detail: `${p.id}: a home is anonymous (no name, no street address)` });
    if (!/^poi\.[a-z0-9.-]{3,64}$/.test(p.id)) out.push({ level: 'fail', id: 'pois.id', detail: `${p.id} does not match ^poi\\.[a-z0-9.-]{3,64}$` });
  }
  for (const [g, min] of Object.entries(MIN_COUNTS)) {
    if ((groups[g] ?? 0) < min) out.push({ level: 'fail', id: 'pois.count', detail: `${g}: ${groups[g] ?? 0} seeds, at least ${min} required` });
  }
  if (seeds.length < 150) out.push({ level: 'fail', id: 'pois.total', detail: `${seeds.length} seeds, at least 150 required` });
  out.push(...nameFindings(seeds, deny));
  return out;
}

export function validatePoisInBake(bakeDir: string, area: string): Finding[] {
  const out: Finding[] = [];
  const report = JSON.parse(readFileSync(path.join(bakeDir, 'bake-report.json'), 'utf8')) as { places?: { poisUnbound: string[]; poisHoodMismatch: { id: string; hood: string }[]; pois: number } };
  const level = area === 'sf' ? 'fail' : 'warn';
  const p = report.places;
  if (!p) return out;
  for (const id of p.poisUnbound) out.push({ level, id: 'pois.bind', detail: `${id} has no pedestrian node within 25 m` });
  for (const m of p.poisHoodMismatch) out.push({ level, id: 'pois.nhood', detail: `${m.id} lies in ${m.hood}; the id prefix names another neighbourhood` });
  return out;
}
