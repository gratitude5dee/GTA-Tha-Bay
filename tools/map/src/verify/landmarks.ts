/**
 * `pnpm map:landmarks [-- --bake <id> | --area <id>]`: the landmark seed validator (M02a2). Without a bake it checks the
 * committed seeds against the table of 02-world-bake.md section 7 (ids, classes, districts, chunk keys, lat/lng against
 * the listed ENU within 1 m); with a bake it also reads the S10 results: on `sf` a seed more than 120 m from its OSM feature
 * is a failure (the seed is corrected from OSM in content/world/landmarks.json, never waived), and every landmark needs an
 * arrival pose.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { chunkKeyOf, enuFromLatLng, type WorldIndex } from '../../../../packages/shared/src/index.ts';
import { toolsRoot } from '../../../ci/lib/common.ts';
import { loadContentWorld, type LandmarkSeed } from '../content.ts';
import { diffPlan, paramFindings, planAsset, writePlan, type AssetPlan, type BaseParams } from '../landmarks/kit/build.ts';
import { RECIPES } from '../landmarks/index.ts';

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

/** `--build [--slug <id>] [--check]`: the landmark models (M02d1). */
export interface LandmarkBuildResult { findings: Finding[]; plans: AssetPlan[]; written: string[] }

/** The recipe id of `--slug` (`lm.coit-tower` or `coit-tower`), or null for all. */
export const normalizeSlug = (slug: string): string => (slug.startsWith('lm.') ? slug : `lm.${slug}`);

export async function buildLandmarks(opts: { root?: string; slug?: string | undefined; check: boolean }): Promise<LandmarkBuildResult> {
  const root = opts.root ?? toolsRoot;
  const findings: Finding[] = [];
  const plans: AssetPlan[] = [];
  const written: string[] = [];
  const seeds = new Map(loadContentWorld().landmarks.map((l) => [l.id, l] as const));
  const want = opts.slug ? normalizeSlug(opts.slug) : null;
  if (want && !RECIPES.some((r) => r.id === want)) {
    findings.push({ level: 'fail', id: 'landmarks.build-slug', detail: `${want} has no recipe (${RECIPES.map((r) => r.id).join(', ')})` });
    return { findings, plans, written };
  }
  for (const def of RECIPES) {
    if (want && def.id !== want) continue;
    const seed = seeds.get(def.id);
    if (!seed) { findings.push({ level: 'fail', id: 'landmarks.build-seed', detail: `${def.id} is not in content/world/landmarks.json` }); continue; }
    if (!seed.recipe) { findings.push({ level: 'fail', id: 'landmarks.build-recipe', detail: `${def.id}: no recipe key in content/world/landmarks.json` }); continue; }
    const bad = paramFindings(def, seed.recipe);
    if (bad.length > 0) { for (const b of bad) findings.push({ level: 'fail', id: 'landmarks.build-params', detail: b }); continue; }
    const plan = await planAsset(def, seed.recipe as unknown as BaseParams, seed.cls);
    plans.push(plan);
    if (opts.check) {
      for (const d of diffPlan(root, plan)) findings.push({ level: 'fail', id: 'landmarks.build-check', detail: `${d.path} ${d.why === 'missing' ? 'is missing' : d.why === 'stale' ? 'is a stale provenance record' : 'differs from a fresh build'}` });
    } else {
      writePlan(root, plan);
      written.push(plan.dir);
    }
  }
  return { findings, plans, written };
}

// ---- catalog completeness (M02d2) -----------------------------------------------------------------------------------------------

const VARIANTS = ['desktop', 'mobile', 'mobile-low'] as const;

/**
 * Every landmark of landmarks.json needs a `building/lm.<slug>` asset under assets/src (an asset.json with the three variants, each
 * file present), and every `lm.*` asset there needs a landmark entry. Run by `map:landmarks` in content mode (M02d2).
 */
export function validateLandmarkAssets(seeds: readonly LandmarkSeed[] = loadContentWorld().landmarks, root = toolsRoot): Finding[] {
  const out: Finding[] = [];
  const dir = path.join(root, 'assets', 'src', 'building');
  const onDisk = existsSync(dir) ? readdirSync(dir).filter((n) => n.startsWith('lm.')).sort() : [];
  const ids = new Set(seeds.map((s) => s.id));
  for (const s of seeds) {
    const specFile = path.join(dir, s.id, 'asset.json');
    if (!existsSync(specFile)) { out.push({ level: 'fail', id: 'landmarks.asset-missing', detail: `${s.id} has no building/${s.id} asset (assets/src/building/${s.id}/asset.json)` }); continue; }
    let spec: { variants?: Record<string, string>; tags?: string[] };
    try {
      spec = JSON.parse(readFileSync(specFile, 'utf8')) as typeof spec;
    } catch {
      out.push({ level: 'fail', id: 'landmarks.asset-spec', detail: `${s.id}: asset.json is not valid JSON` });
      continue;
    }
    for (const v of VARIANTS) {
      const rel = spec.variants?.[v];
      if (!rel) out.push({ level: 'fail', id: 'landmarks.asset-variant', detail: `${s.id}: the ${v} variant is missing from asset.json` });
      else if (!existsSync(path.join(root, rel))) out.push({ level: 'fail', id: 'landmarks.asset-file', detail: `${s.id}: ${rel} is listed and not on disk` });
    }
    if (!spec.tags?.includes(`lm-class:${s.cls}`)) out.push({ level: 'fail', id: 'landmarks.asset-class', detail: `${s.id}: asset.json lacks the tag lm-class:${s.cls}` });
  }
  for (const n of onDisk) if (!ids.has(n)) out.push({ level: 'fail', id: 'landmarks.asset-extra', detail: `building/${n} has no entry in content/world/landmarks.json` });
  return out;
}
