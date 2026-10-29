/**
 * assets:vehicle (M10d1): builds the 24 vehicle and prop assets of the look program from code recipes, checks them and wires them in.
 *
 *   tsx tools/assets/src/vehicle-gen.ts [--dry-run]              build every asset (recipes only) and write files, specs and provenance;
 *                                                                 the fal bodies are only planned (nothing is called)
 *   tsx tools/assets/src/vehicle-gen.ts --live                   run the planned fal bodies: needs FAL_KEY and a live M00c spike, else SKIP
 *   tsx tools/assets/src/vehicle-gen.ts --turntable [--only id]  write review sheets to .cache/turntable/vehicle/
 *   tsx tools/assets/src/vehicle-gen.ts --repoint                point the prefabs at the new assets (config/art-placeholders.json)
 *   tsx tools/assets/src/vehicle-gen.ts --check                  committed files equal the recipes' output; prefabs and the fal ledger obey
 *
 * Every asset is `authored` (licence LicenseRef-DeeVerse-Owned) unless a licensed base or a fal body replaces its recipe; both paths need
 * a vetted intake record and are not used while no base is in `content-incoming/` and no live spike exists. Deterministic: two runs give
 * the same bytes.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { lineCapMicros } from '../../../packages/shared/src/genai/lines.ts';
import { canonicalize } from '../../../packages/shared/src/json.ts';
import type { ProvenanceRecord } from '../../../packages/shared/src/assets/provenance.ts';
import { finding, formatFinding, type GateFinding } from '../../../packages/shared/src/assets/gates/types.ts';
import { ART_NODE } from '../../../packages/shared/src/assets/art-parts.ts';
import { args } from '../../ci/run.ts';
import { isMain, toolsRoot } from '../../ci/lib/common.ts';
import { diffPlan, writePlan, type AssetPlan } from '../../map/src/landmarks/kit/build.ts';
import { simplifierReady } from './lod.ts';
import {
  applyRepoint, m10d1Targets, prefabRepoints, readRegistry, registryFindings, remainingGrayboxPrefabs, seedFindings,
} from './placeholders.ts';
import { ART_ASSETS, buildModel, refOf, type ArtAssetDef } from './recipes/catalog.ts';
import { FIDELITIES, VARIANT_OF, modelStats, writeModelGlb, type Fidelity, type ModelStats } from './recipes/model.ts';
import { SHEET_VIEWS, sheetPng } from './recipes/preview.ts';

export const GATE = 'assets:vehicle';
export const VEHICLE_GEN_VERSION = '1.0.0';
export const VEHICLE_GEN_TOOL = 'tools/assets vehicle';
/** Fixed so records are reproducible: the recipes are repo content, not a download. */
export const VEHICLE_GEN_CREATED_AT = '2026-10-29T00:00:00Z';

/** At most two generated bodies (DL-OWN-07 (3)): four 2K views and two candidates each, 2 x (252,000 + 600,000) micros. */
export const FAL_BODIES = ['vehicle/traffic.sedan', 'vehicle/traffic.pickup'] as const;
export const FAL_BODIES_CAP_MICROS = 1_704_000;
export const FAL_VIEWS_MICROS = 252_000;
export const FAL_CANDIDATES_MICROS = 600_000;
export const LEDGER_FILE = 'assets/genai/vehicles-props.ledger.json';

const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

export interface ArtPlan extends AssetPlan {
  def: ArtAssetDef;
  modelStats: Record<string, ModelStats>;
}

/** The files, spec and provenance of one asset. */
export async function planArtAsset(def: ArtAssetDef): Promise<ArtPlan> {
  await simplifierReady();
  const dir = `assets/src/${def.kind}/${def.id}`;
  const files: AssetPlan['files'] = [];
  const stats: Record<string, ModelStats> = {};
  const variants: Record<string, string> = {};
  const records: AssetPlan['records'] = [];
  const argsSha = sha256(canonicalize({ id: refOf(def), version: VEHICLE_GEN_VERSION }));
  for (const f of FIDELITIES) {
    const model = buildModel(def, f);
    const bytes = await writeModelGlb(model);
    const v = VARIANT_OF[f];
    const rel = `${dir}/${v}.glb`;
    files.push({ path: rel, bytes });
    stats[v] = modelStats(model);
    variants[v] = rel;
    const sha = sha256(bytes);
    const rec: ProvenanceRecord = {
      schema: 'provenance/1.0',
      sha256: sha,
      paths: [rel],
      kind: def.kind,
      origin: 'authored',
      license: 'LicenseRef-DeeVerse-Owned',
      authors: ['studio:dee-verse'],
      derived_from: [],
      tool: { name: VEHICLE_GEN_TOOL, version: VEHICLE_GEN_VERSION, args_sha256: argsSha },
      review: [],
      ip_checks: { signatures: 'pass', strings: 'n/a', similarity: 'n/a' },
      ai_generated: false,
      status: 'active',
      created_at: VEHICLE_GEN_CREATED_AT,
    };
    records.push({ path: `assets/provenance/${sha.slice(0, 2)}/${sha}.json`, text: `${JSON.stringify(rec, null, 2)}\n`, sha256: sha });
  }
  const spec: Record<string, unknown> = {
    kind: def.kind,
    id: def.id,
    variants,
    stats,
    codec: { mesh: 'meshopt' },
    deps: [] as string[],
    tags: [def.tag, ...(def.kind === 'vehicle' ? ['art:m10d1'] : ['art:m10d1'])],
    ...(def.vehicle
      ? {
          extras: {
            t: 'vehicle',
            class: def.vehicle.class,
            fictionalMake: def.vehicle.make,
            wheelRadiusM: def.vehicle.wheelRadiusM,
            nodes: {
              body: ART_NODE.body,
              wheels: [...ART_NODE.wheels],
              steer: [...ART_NODE.steers],
              lights: [...ART_NODE.lights],
              collider: ART_NODE.collider,
            },
          },
        }
      : {}),
    status: 'active',
    visibility: 'public',
  };
  return { id: def.id, dir, files, spec: `${JSON.stringify(spec, null, 2)}\n`, records, stats, def, modelStats: stats };
}

export async function planAll(only?: readonly string[]): Promise<ArtPlan[]> {
  const out: ArtPlan[] = [];
  for (const def of ART_ASSETS) {
    if (only && !only.includes(def.id) && !only.includes(refOf(def))) continue;
    out.push(await planArtAsset(def));
  }
  return out;
}

// ---- the fal bodies (planned, never called without a live spike) --------------------------------------------------------------

export interface FalJob {
  /** The asset the body would replace. */
  ref: string;
  endpoint: string;
  usdMicros: number;
  /** The input: only images this milestone's own recipes rendered (a `recipe:` source), never a photo or a target image. */
  inputs: string[];
}

/** The planned jobs: per body, four edit views of the recipe's blockout, then two candidates. */
export function falPlan(): FalJob[] {
  const jobs: FalJob[] = [];
  for (const ref of FAL_BODIES) {
    jobs.push({ ref, endpoint: 'google/nano-banana-2.1/edit', usdMicros: FAL_VIEWS_MICROS, inputs: [`recipe:${ref}`] });
    jobs.push({ ref, endpoint: 'tripo3d/h3.1/multiview-to-3d', usdMicros: FAL_CANDIDATES_MICROS, inputs: [`recipe:${ref}`] });
  }
  return jobs;
}

export interface LedgerFile {
  schema: 'vehicles-props-ledger/1';
  line: 'vehiclesProps';
  lineCapMicros: number;
  bodiesCapMicros: number;
  totalMicros: number;
  entries: { ref: string; endpoint: string; usdMicros: number; requestId: string; at: string }[];
}

export const EMPTY_LEDGER: LedgerFile = {
  schema: 'vehicles-props-ledger/1', line: 'vehiclesProps', lineCapMicros: lineCapMicros('vehiclesProps'), bodiesCapMicros: FAL_BODIES_CAP_MICROS, totalMicros: 0, entries: [],
};

/** Refuses a job list that takes an input the recipes did not render, passes the bodies cap or passes the line cap. */
export function falRefusals(jobs: readonly FalJob[], spentMicros = 0): string[] {
  const out: string[] = [];
  for (const j of jobs) {
    for (const i of j.inputs) if (!i.startsWith('recipe:')) out.push(`${j.ref}: input ${i} is not rendered by the M10d1 recipes`);
  }
  const total = jobs.reduce((a, j) => a + j.usdMicros, 0);
  if (spentMicros + total > FAL_BODIES_CAP_MICROS) out.push(`the jobs cost ${spentMicros + total} micros, over the ${FAL_BODIES_CAP_MICROS} of the two bodies`);
  if (spentMicros + total > lineCapMicros('vehiclesProps')) out.push(`the jobs pass the vehiclesProps line cap of ${lineCapMicros('vehiclesProps')} micros`);
  return out;
}

/** The sum of `generator.cost_usd_micros` over the provenance records of the generated vehicle and prop assets. */
export function provenanceCostMicros(root: string): number {
  const dir = path.join(root, 'assets/provenance');
  let sum = 0;
  if (!existsSync(dir)) return 0;
  for (const sub of readdirSync(dir)) {
    for (const name of readdirSync(path.join(dir, sub))) {
      if (!name.endsWith('.json')) continue;
      const r = JSON.parse(readFileSync(path.join(dir, sub, name), 'utf8')) as Partial<ProvenanceRecord>;
      if ((r.kind === 'vehicle' || r.kind === 'prop') && r.generator?.cost_usd_micros) sum += r.generator.cost_usd_micros;
    }
  }
  return sum;
}

export function ledgerFindings(root: string): GateFinding[] {
  const out: GateFinding[] = [];
  const file = path.join(root, LEDGER_FILE);
  if (!existsSync(file)) return [finding(GATE, LEDGER_FILE, 'ledger-missing', 'run pnpm assets:vehicle to write it')];
  const l = JSON.parse(readFileSync(file, 'utf8')) as LedgerFile;
  const sum = l.entries.reduce((a, e) => a + e.usdMicros, 0);
  if (sum !== l.totalMicros) out.push(finding(GATE, LEDGER_FILE, 'ledger-total', `entries sum to ${sum}, totalMicros is ${l.totalMicros}`));
  if (l.lineCapMicros !== lineCapMicros('vehiclesProps')) out.push(finding(GATE, LEDGER_FILE, 'ledger-line-cap', `lineCapMicros ${l.lineCapMicros} differs from guardrails (${lineCapMicros('vehiclesProps')})`));
  if (l.bodiesCapMicros !== FAL_BODIES_CAP_MICROS) out.push(finding(GATE, LEDGER_FILE, 'ledger-bodies-cap', `bodiesCapMicros ${l.bodiesCapMicros}, ${FAL_BODIES_CAP_MICROS} expected`));
  if (sum > l.bodiesCapMicros || sum > l.lineCapMicros) out.push(finding(GATE, LEDGER_FILE, 'ledger-over-cap', `${sum} micros is over a cap`));
  const prov = provenanceCostMicros(root);
  if (prov !== sum) out.push(finding(GATE, LEDGER_FILE, 'ledger-provenance', `the ledger holds ${sum} micros, the provenance records ${prov}`));
  return out;
}

// ---- the checks --------------------------------------------------------------------------------------------------------------

/** The committed assets equal the recipes' output (bytes, specs, provenance). */
export async function checkAssets(root: string, only?: readonly string[]): Promise<GateFinding[]> {
  const out: GateFinding[] = [];
  for (const p of await planAll(only)) {
    for (const d of diffPlan(root, p)) out.push(finding(GATE, d.path, `recipe-${d.why}`, `${refOf(p.def)}: ${d.why}; run pnpm assets:vehicle`));
  }
  return out;
}

/** Prefab, registry and ledger rules (AC-5, AC-7). */
export function wiringFindings(root: string): GateFinding[] {
  const out: GateFinding[] = [];
  const reg = readRegistry(root);
  const catalog = new Set<string>();
  for (const kind of ['vehicle', 'prop']) {
    const dir = path.join(root, 'assets/src', kind);
    if (!existsSync(dir)) continue;
    for (const id of readdirSync(dir)) if (existsSync(path.join(dir, id, 'asset.json'))) catalog.add(`${kind}/${id}`);
  }
  out.push(...registryFindings(reg, root, catalog), ...seedFindings(reg));
  for (const r of remainingGrayboxPrefabs(root, reg)) {
    if (!r.row) out.push(finding(GATE, r.file, 'graybox-unowned', `${r.asset} is matched by no row of the placeholder registry`));
    else if (r.row.owner === 'M10d1') out.push(finding(GATE, r.file, 'graybox-m10d1', `${r.asset} is owned by M10d1 and still a gray-box ref; run pnpm assets:vehicle -- --repoint`));
  }
  for (const t of m10d1Targets(reg)) if (!catalog.has(t)) out.push(finding(GATE, REGISTRY, 'target-missing', `${t} has no asset`));
  out.push(...ledgerFindings(root));
  return out;
}
const REGISTRY = 'config/art-placeholders.json';

export function writeLedgerIfMissing(root: string): void {
  const file = path.join(root, LEDGER_FILE);
  if (existsSync(file)) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(EMPTY_LEDGER, null, 2)}\n`);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: args(),
    options: {
      'dry-run': { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
      turntable: { type: 'boolean', default: false },
      repoint: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      only: { type: 'string' },
      root: { type: 'string' },
    },
  });
  const root = path.resolve(values.root ?? toolsRoot);
  const only = values.only?.split(',');
  if (values.check) {
    const findings = [...(await checkAssets(root, only)), ...wiringFindings(root)];
    for (const f of findings) console.log(formatFinding(f));
    console.log(`assets:vehicle --check: ${ART_ASSETS.length} assets, ${findings.length} finding(s)`);
    return findings.length === 0 ? 0 : 1;
  }
  if (values.repoint) {
    const reg = readRegistry(root);
    const changes = prefabRepoints(root, reg);
    applyRepoint(root, changes);
    for (const c of changes) console.log(`${c.file}: ${c.from} -> ${c.to}`);
    console.log(`assets:vehicle --repoint: ${changes.length} prefab(s) changed`);
    return 0;
  }
  if (values.turntable) {
    const dir = path.join(root, '.cache/turntable/vehicle');
    mkdirSync(dir, { recursive: true });
    await simplifierReady();
    for (const def of ART_ASSETS) {
      if (only && !only.includes(def.id)) continue;
      const hi = buildModel(def, 'hi');
      const file = path.join(dir, `${def.id}.png`);
      writeFileSync(file, sheetPng(hi, SHEET_VIEWS));
      console.log(`${refOf(def)}: ${path.relative(root, file)}`);
    }
    return 0;
  }
  if (values.live) {
    const jobs = falPlan();
    const refused = falRefusals(jobs);
    if (refused.length > 0) {
      for (const r of refused) console.error(`${GATE}: refused: ${r}`);
      return 1;
    }
    if (!process.env['FAL_KEY']) {
      console.log('SKIP assets:vehicle --live: FAL_KEY not set; the recipes stand at the same AssetIds');
      return 0;
    }
    const spike = path.join(root, 'research/genai-spike/ledger.json');
    const live = existsSync(spike) && (JSON.parse(readFileSync(spike, 'utf8')) as { totalMicros?: number }).totalMicros !== 0 && (JSON.parse(readFileSync(spike, 'utf8')) as { entries?: unknown[] }).entries?.length !== 0;
    if (!live) {
      console.log('SKIP assets:vehicle --live: the M00c spike ledger shows no live run (0 micros); the recipes stand at the same AssetIds');
      return 0;
    }
    console.log('assets:vehicle --live: a live spike exists, but the fal bodies of M10d1 are run by the operator through the queue CLI (DL-OWN-01); nothing was called');
    return 0;
  }
  // default and --dry-run: recipes only; the fal plan is printed and never called
  const plans = await planAll(only);
  for (const p of plans) {
    writePlan(root, p);
    const s = p.modelStats;
    console.log(`${refOf(p.def)}: ${FIDELITIES.map((f: Fidelity) => `${f} ${(s[VARIANT_OF[f]] as ModelStats).tris} tris`).join(', ')}`);
  }
  writeLedgerIfMissing(root);
  const jobs = falPlan();
  console.log(`fal plan (not called): ${jobs.length} jobs, ${jobs.reduce((a, j) => a + j.usdMicros, 0)} micros of ${FAL_BODIES_CAP_MICROS}`);
  console.log('next: pnpm assets:lock && pnpm assets:catalog');
  return 0;
}

if (isMain(import.meta.url)) process.exit(await main());
