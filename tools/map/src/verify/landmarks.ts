/**
 * `pnpm map:landmarks [-- --bake <id> | --area <id>]`: the landmark seed validator (M02a2). Without a bake it checks the
 * committed seeds against the table of 02-world-bake.md section 7 (ids, classes, districts, chunk keys, lat/lng against
 * the listed ENU within 1 m); with a bake it also reads the S10 results: on `sf` a seed more than 120 m from its OSM feature
 * is a failure (the seed is corrected from OSM in content/world/landmarks.json, never waived), and every landmark needs an
 * arrival pose.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chunkKeyOf, enuFromLatLng, type WorldIndex } from '../../../../packages/shared/src/index.ts';
import { toolsRoot } from '../../../ci/lib/common.ts';
import { loadContentWorld, type LandmarkSeed } from '../content.ts';

export interface Finding { level: 'fail' | 'warn'; id: string; detail: string }

export const SPEC_FILE = path.join(toolsRoot, 'spec', 'domains', '02-world-bake.md');

export interface SpecLandmark { id: string; lat: number; lng: number; x: number; z: number; chunk: string; district: string; cls: string }

/** The §7 landmark table of the spec file, or null when the spec is not in this checkout. */
export function specLandmarks(file = SPEC_FILE): SpecLandmark[] | null {
  if (!existsSync(file)) return null;
  const rows = readFileSync(file, 'utf8').split('\n').filter((l) => /^\| \d+ \| lm\./.test(l));
  const num = (s: string): number => Number(s.replace(/−/g, '-'));
  return rows.map((r) => {
    const c = r.split('|').map((s) => s.trim());
    const [lat, lng] = (c[3] as string).split(',').map(num) as [number, number];
    const [x, z] = (c[4] as string).split(',').map(num) as [number, number];
    return { id: c[2] as string, lat, lng, x, z, chunk: c[5] as string, district: c[6] as string, cls: c[7] as string };
  });
}

export function validateLandmarkSeeds(seeds: readonly LandmarkSeed[] = loadContentWorld().landmarks, table: SpecLandmark[] | null = specLandmarks()): Finding[] {
  const out: Finding[] = [];
  const ids = new Set<string>();
  for (const s of seeds) {
    if (ids.has(s.id)) out.push({ level: 'fail', id: 'landmarks.unique', detail: `duplicate id ${s.id}` });
    ids.add(s.id);
    const e = enuFromLatLng(s.lat, s.lng);
    const d = Math.hypot(e.x - s.x, e.z - s.z);
    if (d >= 1) out.push({ level: 'fail', id: 'landmarks.enu', detail: `${s.id}: lat/lng converts to (${e.x.toFixed(1)}, ${e.z.toFixed(1)}), the seed lists (${s.x}, ${s.z}): ${d.toFixed(2)} m apart` });
    if (chunkKeyOf(s.lat, s.lng) !== s.chunk) out.push({ level: 'fail', id: 'landmarks.chunk', detail: `${s.id}: lat/lng is in chunk ${chunkKeyOf(s.lat, s.lng)}, the seed lists ${s.chunk}` });
  }
  if (!table) {
    out.push({ level: 'warn', id: 'landmarks.table', detail: 'spec/domains/02-world-bake.md is not in this checkout; the section 7 table was not compared' });
    return out;
  }
  const bySeed = new Map(seeds.map((s) => [s.id, s] as const));
  for (const t of table) {
    const s = bySeed.get(t.id);
    if (!s) { out.push({ level: 'fail', id: 'landmarks.missing', detail: `${t.id} is in the section 7 table and not in landmarks.json` }); continue; }
    if (s.cls !== t.cls) out.push({ level: 'fail', id: 'landmarks.class', detail: `${t.id}: class ${s.cls}, the table says ${t.cls}` });
    if (s.district !== t.district) out.push({ level: 'fail', id: 'landmarks.district', detail: `${t.id}: district ${s.district}, the table says ${t.district}` });
    if (s.chunk !== t.chunk) out.push({ level: 'fail', id: 'landmarks.table-chunk', detail: `${t.id}: chunk ${s.chunk}, the table says ${t.chunk}` });
    const e = enuFromLatLng(t.lat, t.lng);
    if (Math.hypot(e.x - t.x, e.z - t.z) >= 1) out.push({ level: 'fail', id: 'landmarks.table-enu', detail: `${t.id}: the table's lat/lng converts to (${e.x.toFixed(1)}, ${e.z.toFixed(1)}) but lists (${t.x}, ${t.z})` });
    if (Math.hypot(s.lat - t.lat, s.lng - t.lng) > 1e-6) out.push({ level: 'fail', id: 'landmarks.table-latlng', detail: `${t.id}: lat/lng differs from the table` });
  }
  const tableIds = new Set(table.map((t) => t.id));
  for (const s of seeds) if (!tableIds.has(s.id)) out.push({ level: 'fail', id: 'landmarks.extra', detail: `${s.id} is not in the section 7 table` });
  return out;
}

/** Bake-level checks from bake-report.json and world-index.json of a finished bake. */
export function validateLandmarksInBake(bakeDir: string, area: string): Finding[] {
  const out: Finding[] = [];
  const report = JSON.parse(readFileSync(path.join(bakeDir, 'bake-report.json'), 'utf8')) as { places?: { featureTooFar: { id: string; distM: number }[]; featureMissing: string[]; noArrival: string[]; landmarks: number } };
  const index = JSON.parse(readFileSync(path.join(bakeDir, 'world-index.json'), 'utf8')) as WorldIndex;
  const p = report.places;
  if (p) {
    for (const f of p.featureTooFar) out.push({ level: area === 'sf' ? 'fail' : 'warn', id: 'landmarks.feature', detail: `${f.id} is ${f.distM} m from its OSM feature (limit 120 m)` });
    for (const id of p.noArrival) out.push({ level: 'fail', id: 'landmarks.arrival', detail: `${id} has no arrival pose on ground` });
    if (area === 'sf') for (const id of p.featureMissing) out.push({ level: 'warn', id: 'landmarks.feature-missing', detail: `${id}: its OSM feature is not in the extract` });
  }
  for (const l of index.landmarks) if (!l.arrival) out.push({ level: 'fail', id: 'landmarks.arrival', detail: `${l.id} has no arrival pose` });
  return out;
}
