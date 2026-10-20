/**
 * The landmark build (M02d1): recipes in, `.glb` files, `asset.json` specs and provenance records out, deterministically.
 *
 *   map:landmarks -- --build [--slug lm.coit-tower] [--check]
 *
 * For each recipe and each fidelity (`hi` -> desktop.glb, `mid` -> mobile.glb, `lo` -> mobile-low.glb) the recipe's parameters (the
 * `recipe` key of its entry in content/world/landmarks.json) build one model; the writer returns bytes and `VariantStats`.
 * `--check` regenerates everything in memory and fails on any byte difference from the committed files (the `assets:seed --check`
 * pattern of M01d). Provenance: one `authored` record per file, licence `LicenseRef-DeeVerse-Owned`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalize } from '../../../../../packages/shared/src/json.ts';
import type { ProvenanceRecord } from '../../../../../packages/shared/src/assets/provenance.ts';
import { FIDELITIES, rulesOf, variantOf, type Fidelity } from './fidelity.ts';
import { writeGlb, type ModelStats } from './gltf-writer.ts';
import { Geo } from './primitives.ts';

/** Bumped by hand when a change alters landmark bytes; part of the provenance `tool` field. */
export const LANDMARKS_VERSION = '1.0.0';
export const LANDMARKS_TOOL = 'tools/map landmarks';
/** Fixed so records are reproducible: the recipes are repo content, not a download. */
export const LANDMARKS_CREATED_AT = '2026-10-19T00:00:00Z';

export type Anchor = 'ground' | 'sea';
/** Every recipe takes these; the rest of its parameters are its own. */
export interface BaseParams { yawDeg: number; anchor: Anchor }
export type RecipeParams = BaseParams & Record<string, unknown>;

export interface RecipeDef<P extends BaseParams = BaseParams> {
  /** `lm.<slug>` */
  id: string;
  /** The parameter set that ships in content/world/landmarks.json (the JSON is the source of truth; this seeds it and types it). */
  defaults: P;
  build(g: Geo, p: P): void;
}

export const slugOf = (id: string): string => id.replace(/^lm\./, '');

/** Builds one model of one recipe at one fidelity. */
export async function buildModel(def: RecipeDef<never>, params: BaseParams, f: Fidelity): Promise<{ bytes: Uint8Array; stats: ModelStats }> {
  const g = new Geo(rulesOf(f));
  g.setYaw(((params.yawDeg ?? 0) * Math.PI) / 180);
  (def as RecipeDef<BaseParams>).build(g, params);
  return writeGlb(g, { id: def.id, extras: { id: def.id, fidelity: f, anchor: params.anchor, yawDeg: params.yawDeg } });
}

/** Parameter keys of a recipe's defaults must equal the keys in the JSON (no missing, no unknown). */
export function paramFindings(def: RecipeDef<never>, params: unknown): string[] {
  const out: string[] = [];
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return [`${def.id}: recipe must be an object`];
  const want = Object.keys(def.defaults).sort();
  const have = Object.keys(params).sort();
  for (const k of want) if (!have.includes(k)) out.push(`${def.id}: recipe parameter ${k} is missing`);
  for (const k of have) if (!want.includes(k)) out.push(`${def.id}: recipe parameter ${k} is not used by the recipe`);
  const d = def.defaults as Record<string, unknown>;
  const p = params as Record<string, unknown>;
  for (const k of want) {
    if (!(k in p)) continue;
    if (typeof d[k] !== typeof p[k] || Array.isArray(d[k]) !== Array.isArray(p[k])) out.push(`${def.id}: recipe parameter ${k} has the wrong type`);
  }
  return out;
}

// ---- files -----------------------------------------------------------------------------------------------------------------------

export interface PlannedFile { path: string; bytes: Uint8Array }

export interface AssetPlan {
  id: string;
  dir: string;
  files: PlannedFile[];
  /** asset.json text */
  spec: string;
  /** Provenance records by repo path. */
  records: { path: string; text: string; sha256: string }[];
  stats: Record<string, ModelStats>;
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

export const lmClassTag = (cls: string): string => `lm-class:${cls}`;

/** The plan (every output file with its bytes) for one landmark. */
export async function planAsset(def: RecipeDef<never>, params: BaseParams, cls: 'hero' | 'major' | 'minor'): Promise<AssetPlan> {
  const dir = `assets/src/building/${def.id}`;
  const files: PlannedFile[] = [];
  const stats: Record<string, ModelStats> = {};
  const variants: Record<string, string> = {};
  const records: AssetPlan['records'] = [];
  const argsSha = sha256(Buffer.from(canonicalize({ id: def.id, params })));
  for (const f of FIDELITIES) {
    const v = variantOf(f);
    const built = await buildModel(def, params, f);
    const rel = `${dir}/${v}.glb`;
    files.push({ path: rel, bytes: built.bytes });
    stats[v] = built.stats;
    variants[v] = rel;
    const sha = sha256(built.bytes);
    const rec: ProvenanceRecord = {
      schema: 'provenance/1.0',
      sha256: sha,
      paths: [rel],
      kind: 'building',
      origin: 'authored',
      license: 'LicenseRef-DeeVerse-Owned',
      authors: ['studio:dee-verse'],
      derived_from: [],
      tool: { name: LANDMARKS_TOOL, version: LANDMARKS_VERSION, args_sha256: argsSha },
      review: [],
      ip_checks: { signatures: 'pass', strings: 'n/a', similarity: 'n/a' },
      ai_generated: false,
      status: 'active',
      created_at: LANDMARKS_CREATED_AT,
    };
    records.push({ path: `assets/provenance/${sha.slice(0, 2)}/${sha}.json`, text: `${JSON.stringify(rec, null, 2)}\n`, sha256: sha });
  }
  const spec = {
    kind: 'building',
    id: def.id,
    variants,
    stats,
    codec: { mesh: 'meshopt' },
    deps: [] as string[],
    tags: ['landmark', lmClassTag(cls)],
    status: 'active',
    visibility: 'public',
  };
  return { id: def.id, dir, files, spec: `${JSON.stringify(spec, null, 2)}\n`, records, stats };
}

export interface Difference { path: string; why: 'missing' | 'differs' | 'stale' }

/** Compares a plan with the files under `root`; stale = a provenance record for one of the plan's paths with another hash. */
export function diffPlan(root: string, plan: AssetPlan): Difference[] {
  const out: Difference[] = [];
  const cmp = (rel: string, bytes: Uint8Array): void => {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) out.push({ path: rel, why: 'missing' });
    else if (!Buffer.from(readFileSync(abs)).equals(Buffer.from(bytes))) out.push({ path: rel, why: 'differs' });
  };
  for (const f of plan.files) cmp(f.path, f.bytes);
  cmp(`${plan.dir}/asset.json`, Buffer.from(plan.spec));
  for (const r of plan.records) cmp(r.path, Buffer.from(r.text));
  const keep = new Set(plan.records.map((r) => r.path));
  for (const stale of staleRecords(root, plan)) if (!keep.has(stale)) out.push({ path: stale, why: 'stale' });
  return out;
}

/** Provenance records whose `paths` name a file of the plan but whose hash is no longer the file's. */
export function staleRecords(root: string, plan: AssetPlan): string[] {
  const dir = path.join(root, 'assets/provenance');
  if (!existsSync(dir)) return [];
  const paths = new Set(plan.files.map((f) => f.path));
  const out: string[] = [];
  for (const sub of readdirSync(dir)) {
    const subDir = path.join(dir, sub);
    for (const name of readdirSync(subDir)) {
      if (!name.endsWith('.json')) continue;
      const rel = `assets/provenance/${sub}/${name}`;
      try {
        const rec = JSON.parse(readFileSync(path.join(subDir, name), 'utf8')) as { paths?: string[] };
        if (rec.paths?.some((p) => paths.has(p))) out.push(rel);
      } catch {
        // an unreadable record is provenance:check's to report
      }
    }
  }
  return out;
}

/** Writes the plan under `root` and removes the stale provenance records of the same paths. */
export function writePlan(root: string, plan: AssetPlan): void {
  const keep = new Set(plan.records.map((r) => r.path));
  for (const stale of staleRecords(root, plan)) if (!keep.has(stale)) rmSync(path.join(root, stale), { force: true });
  const put = (rel: string, data: Uint8Array | string): void => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, data);
  };
  for (const f of plan.files) put(f.path, f.bytes);
  put(`${plan.dir}/asset.json`, plan.spec);
  for (const r of plan.records) put(r.path, r.text);
}
