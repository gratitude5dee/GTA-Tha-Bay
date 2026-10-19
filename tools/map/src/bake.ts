/**
 * runBake: the S0 check, S3 water, S2 terrain, S4 buildings and S13 pack stages of one area, with the stage cache,
 * gates, `dist/world/<bakeId>/` outputs and `--repro`.
 *
 * Stage order is fetch, water, terrain, buildings, pack: S2 needs the S3 water mask for its clamps, so S3 runs first
 * (the spec table lists S2 before S3; the dependency decides).
 */
import v8 from 'node:v8';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalize, sha256Hex } from '../../../packages/shared/src/index.ts';
import {
  CACHE_ROOT, DIST_ROOT, TOOL_ID, areaGridOf, codeHash, configHashesOf, enuBoxOf, loadSources, loadSynth, mapSchema, rawDirOf,
  type AreaGrid, type AreaId, type SourcesConfig, type SynthConfig,
} from './config.ts';
import { RAW_LOCK_NAME, rawLockText, readRawLock, sha256Text, stampsOf, type RawLockFile } from './raw-lock.ts';
import { generateSynth, synthSourceSha } from './sources/synth.ts';
import { loadMosaic, type TerrariumMosaic } from './sources/terrarium.ts';
import { readJsonl } from './sources/socrata.ts';
import { readOsm, type OsmFeature } from './sources/geo.ts';
import { runWater, hoodUnionMask, kindMask, cellRaster, landMask, pierMask, postRaster, waterGate, type HoodRow, type ParkRow, type TreeRow, type WaterProduct } from './stages/s3-water.ts';
import { TerrainField, runTerrain, type TerrainProduct } from './stages/s2-terrain.ts';
import { bakeBuildings, CHUNK_BUILDING_LIMIT, type BuildingsProduct, type FootprintRow } from './stages/s4-buildings.ts';
import { buildPacks, type PackOutput } from './stages/s13-pack.ts';
import { failed, s0Gates, s13Gates, s2Gates, s3Gates, s4Gates, type GateResult } from './verify/gates.ts';
import { attributionFor } from './pack/attribution.ts';
import { renderPreview } from './pack/preview.ts';
import { cmp, stableJson } from './util.ts';

export type StageId = 'fetch' | 'water' | 'terrain' | 'buildings' | 'pack';
export const STAGE_ORDER: readonly StageId[] = ['fetch', 'water', 'terrain', 'buildings', 'pack'];
export const isStageId = (s: string): s is StageId => (STAGE_ORDER as readonly string[]).includes(s);

export interface BakeOptions {
  area: AreaId;
  stages?: readonly StageId[] | undefined;
  force?: boolean | undefined;
  outRoot?: string | undefined;
  cacheRoot?: string | undefined;
  rawDir?: string | undefined;
  log?: ((line: string) => void) | undefined;
  cfg?: SourcesConfig | undefined;
  synth?: SynthConfig | undefined;
  /** Write dist/world/latest*.json (off for the second run of --repro). */
  writeLatest?: boolean | undefined;
}

export interface BakeResult {
  ok: boolean;
  bakeId: string;
  outDir: string;
  gates: GateResult[];
  /** relative path under outDir to sha256, bake-times.json excluded. */
  hashes: Record<string, string>;
  ms: Record<string, number>;
}

const TIMES_FILE = 'bake-times.json';

// ---- raw inputs ---------------------------------------------------------------------------------------------------

function jsonlOrEmpty<T>(file: string): T[] {
  return existsSync(file) ? readJsonl<T>(file) : [];
}

/** True when a synth raw directory matches the current generator configuration. */
export function synthFresh(rawDir: string, cfg: SynthConfig, sources: SourcesConfig, area: AreaId): boolean {
  const lock = readRawLock(rawDir);
  if (!lock || !lock.synthetic || lock.area !== area) return false;
  const box = enuBoxOf(sources.areas[area].box);
  const want = new Map(sources.areas[area].sources.map((id) => [id, synthSourceSha(cfg, id, box, false)]));
  if (lock.sources.length !== want.size) return false;
  if (!lock.sources.every((s) => want.get(s.id) === s.sha256)) return false;
  return existsSync(path.join(rawDir, 'ynuv-fyni.jsonl')) && existsSync(path.join(rawDir, 'terrarium'));
}

/** Problems found when a non-synth raw directory is compared with its lock (file presence and SHA-256). */
export function rawProblems(rawDir: string, lock: RawLockFile, sources: SourcesConfig): string[] {
  const out: string[] = [];
  for (const s of lock.sources) {
    const def = sources.sources.find((d) => d.id === s.id);
    if (!def) { out.push(`${s.id}: not in sources.json`); continue; }
    const file = path.join(rawDir, def.file);
    if (!existsSync(file)) { out.push(`${s.id}: ${def.file} is missing`); continue; }
    if (def.kind !== 'terrarium' && statSync(file).isFile()) {
      const sha = sha256Text(readFileSync(file));
      if (sha !== s.sha256) out.push(`${s.id}: ${def.file} has sha256 ${sha.slice(0, 12)}, the lock says ${s.sha256.slice(0, 12)}`);
    }
  }
  return out;
}

interface Ctx {
  o: BakeOptions;
  cfg: SourcesConfig;
  area: AreaId;
  rawDir: string;
  grid: AreaGrid;
  lock: RawLockFile;
  bakeId: string;
  log: (l: string) => void;
  mosaic: TerrariumMosaic | null;
}

function mosaicOf(c: Ctx): TerrariumMosaic {
  if (!c.mosaic) c.mosaic = loadMosaic(path.join(c.rawDir, 'terrarium'), 15);
  return c.mosaic;
}

function cachePath(c: Ctx, stage: string): string {
  const key = sha256Hex(`${c.bakeId}|${codeHash()}|${stage}`);
  return path.join(c.o.cacheRoot ?? CACHE_ROOT, 'stages', stage, `${key}.bin`);
}

async function stage<T>(c: Ctx, id: StageId, selected: boolean, ms: Record<string, number>, run: () => T): Promise<T> {
  const file = cachePath(c, id);
  if (!selected || (!c.o.force && existsSync(file))) {
    if (existsSync(file)) {
      c.log(`${id}: cached`);
      return v8.deserialize(readFileSync(file)) as T;
    }
    throw new Error(`stage ${id} is not selected and has no cached output for bake ${c.bakeId.slice(0, 12)}; run it first (pnpm map:build -- --area ${c.area} --stage ${id})`);
  }
  const t0 = Date.now();
  const out = run();
  ms[id] = Date.now() - t0;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, v8.serialize(out));
  c.log(`${id}: done in ${ms[id]} ms`);
  return out;
}

interface WaterStage { product: WaterProduct; gates: GateResult[] }
interface TerrainStage { product: TerrainProduct; gates: GateResult[] }
interface BuildingsStage { product: BuildingsProduct; gates: GateResult[] }

export async function runBake(o: BakeOptions): Promise<BakeResult> {
  const log = o.log ?? ((l: string) => console.log(l));
  const cfg = o.cfg ?? loadSources();
  const def = cfg.areas[o.area];
  const rawDir = o.rawDir ?? rawDirOf(o.area);
  const wanted = new Set<StageId>(o.stages && o.stages.length > 0 ? o.stages : STAGE_ORDER);
  const ms: Record<string, number> = {};

  // S0: the raw snapshot (synth is generated, the excerpt and sf are read as locked)
  if (o.area === 'synth') {
    const synth = o.synth ?? loadSynth();
    const fresh = synthFresh(rawDir, synth, cfg, o.area);
    if ((wanted.has('fetch') && o.force) || !fresh) {
      const t0 = Date.now();
      rmSync(rawDir, { recursive: true, force: true });
      const g = generateSynth(synth, cfg, o.area, { outDir: rawDir, box: enuBoxOf(def.box) });
      ms['fetch'] = Date.now() - t0;
      log(`fetch: generated synth sources in ${ms['fetch']} ms (${Object.entries(g.stats.rows).map(([k, v]) => `${k} ${v}`).join(', ')})`);
    } else log('fetch: synth sources are current');
  }
  const lock = readRawLock(rawDir);
  if (!lock) throw new Error(`${path.join(rawDir, RAW_LOCK_NAME)} does not exist${o.area === 'sf' ? '; run pnpm map:fetch -- --area sf first' : ''}`);
  if (o.area !== 'synth') {
    const problems = rawProblems(rawDir, lock, cfg);
    if (problems.length > 0) throw new Error(`raw snapshot does not match raw.lock.json:\n  ${problems.join('\n  ')}`);
  }
  for (const id of def.sources) if (!lock.sources.some((s) => s.id === id)) throw new Error(`raw.lock.json has no entry for source ${id}`);

  const sourceHashes: Record<string, string> = {};
  for (const s of lock.sources) sourceHashes[s.id] = s.sha256;
  const bakeId = sha256Hex(canonicalize({ sourceHashes, toolVersion: TOOL_ID, configHashes: configHashesOf(cfg, o.area) }));
  const outDir = path.join(o.outRoot ?? DIST_ROOT, bakeId);
  const grid = areaGridOf(enuBoxOf(def.box));
  const c: Ctx = { o, cfg, area: o.area, rawDir, grid, lock, bakeId, log, mosaic: null };
  log(`bake ${bakeId.slice(0, 12)} area=${o.area} stages=${[...wanted].join(',')}`);

  const gates: GateResult[] = [...s0Gates(lock, def.gates.s0)];
  const box = { minX: grid.box.minX, minZ: grid.box.minZ, maxX: grid.box.maxX, maxZ: grid.box.maxZ };

  // S3 water
  const water = await stage<WaterStage>(c, 'water', wanted.has('water'), ms, () => {
    const osm: OsmFeature[] = readOsm(path.join(rawDir, 'osm.geojsonl'));
    const parks = jsonlOrEmpty<ParkRow>(path.join(rawDir, 'gtr9-ntp6.jsonl'));
    const hoods = jsonlOrEmpty<HoodRow>(path.join(rawDir, 'j2bu-swwd.jsonl'));
    const trees = jsonlOrEmpty<TreeRow>(path.join(rawDir, 'tkzw-k3nq.jsonl'));
    const product = runWater({
      grid, osm, parks, hoods, trees, minRingKm2: def.gates.s3.minRingKm2,
      // Only used when no coastline reaches the box: land when most box corners are above 0.5 m.
      baseLandHint: () => {
        const m = mosaicOf(c);
        const corners: [number, number][] = [[box.minX, box.minZ], [box.minX, box.maxZ], [box.maxX, box.minZ], [box.maxX, box.maxZ]];
        return corners.filter(([x, z]) => m.atEnu(x, z) >= 0.5).length >= 3;
      },
    });
    const land = landMask(cellRaster(grid), product);
    const union = hoodUnionMask(cellRaster(grid), product, box);
    return { product, gates: s3Gates(waterGate(land, union, box), def.gates.s3) };
  });
  gates.push(...water.gates);

  // S2 terrain
  const terrain = await stage<TerrainStage>(c, 'terrain', wanted.has('terrain'), ms, () => {
    const land = landMask(postRaster(grid), water.product);
    const pier = pierMask(postRaster(grid), water.product);
    const product = runTerrain(grid, mosaicOf(c), land, pier);
    return { product, gates: s2Gates(product.stats, def.gates.s2) };
  });
  gates.push(...terrain.gates);

  // S4 buildings
  const buildings = await stage<BuildingsStage>(c, 'buildings', wanted.has('buildings'), ms, () => {
    const footprints = readJsonl<FootprintRow>(path.join(rawDir, 'ynuv-fyni.jsonl'));
    const product = bakeBuildings({
      footprints, osm: readOsm(path.join(rawDir, 'osm.geojsonl')), terrain: new TerrainField(terrain.product.grids),
      kindRaster: kindMask(cellRaster(grid), water.product), palettes: 16, maxOsmFraction: def.gates.s4.maxOsmFraction,
    });
    return { product, gates: s4Gates(product.report, def.gates.s4, CHUNK_BUILDING_LIMIT) };
  });
  gates.push(...buildings.gates);

  // S13 pack
  let outputs: PackOutput | null = null;
  if (wanted.has('pack')) {
    const t0 = Date.now();
    const stamps = stampsOf(lock, cfg);
    outputs = buildPacks({ bakeId, grid, water: water.product, terrain: terrain.product, buildings: buildings.product, stamps });
    const idxErr = mapSchema('world-index')(outputs.index);
    gates.push({ id: 's13.index-schema', stage: 'S13', level: idxErr.length === 0 ? 'pass' : 'fail', detail: idxErr.length === 0 ? 'data/world-index validates against world-index.schema.json' : idxErr.join('; ') });
    const extra = [
      { name: 'world-index.json', bytes: Buffer.from(stableJson(outputs.index)) },
      { name: RAW_LOCK_NAME, bytes: Buffer.from(rawLockText(lock)) },
      { name: 'attribution.world.json', bytes: Buffer.from(stableJson(attributionFor(cfg, o.area))) },
      { name: 'preview.png', bytes: renderPreview(grid, outputs.sims, outputs.renders) },
    ];
    gates.push(...s13Gates(outputs.files.map((f) => ({ name: f.name, bytes: f.bytes.length })), [...outputs.files.map((f) => ({ name: f.name, bytes: f.bytes })), ...extra], def.gates.s13));

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(path.join(outDir, 'packs'), { recursive: true });
    for (const f of outputs.files) writeFileSync(path.join(outDir, 'packs', f.name), f.bytes);
    for (const e of extra) writeFileSync(path.join(outDir, e.name), e.bytes);
    const report = {
      schema: 'bake-report/1',
      bakeId,
      area: o.area,
      toolVersion: TOOL_ID,
      synthetic: lock.synthetic === true,
      sources: lock.sources.map((s) => ({ id: s.id, sha256: s.sha256, rows: s.rows })).sort((a, b) => cmp(a.id, b.id)),
      counts: {
        chunks: terrain.product.stats.chunks,
        tiles: outputs.index.tiles.p0.length,
        packs: outputs.files.length,
        buildings: buildings.product.report.records,
        trees: Math.floor(water.product.trees.length / 4),
      },
      terrain: terrain.product.stats,
      water: water.product.stats,
      buildings: buildings.product.report,
      packs: outputs.files.map((f) => ({ name: f.name, bytes: f.bytes.length, chunks: f.chunks })),
      gates,
      ok: failed(gates).length === 0,
    };
    const repErr = mapSchema('bake-report')(report);
    if (repErr.length > 0) throw new Error(`bake-report.json does not validate: ${repErr.join('; ')}`);
    writeFileSync(path.join(outDir, 'bake-report.json'), stableJson(report));
    ms['pack'] = Date.now() - t0;
    writeFileSync(path.join(outDir, TIMES_FILE), stableJson({ schema: 'bake-times/1', ms }));
    if (o.writeLatest !== false) {
      const root = o.outRoot ?? DIST_ROOT;
      const latest = stableJson({ bakeId, area: o.area });
      writeFileSync(path.join(root, 'latest.json'), latest);
      writeFileSync(path.join(root, `latest-${o.area}.json`), latest);
    }
  }
  for (const g of gates) log(`gate ${g.level.toUpperCase().padEnd(4)} ${g.id}: ${g.detail}`);
  const hashes = outputs ? hashTree(outDir) : {};
  return { ok: failed(gates).length === 0, bakeId, outDir, gates, hashes, ms };
}

/** relative path to sha256 of every file below `dir`, bake-times.json excluded. */
export function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(p).isDirectory()) walk(p, r);
      else if (r !== TIMES_FILE) out[r] = sha256Text(readFileSync(p));
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return out;
}

export interface ReproResult { ok: boolean; bakeId: string; differing: string[]; first: BakeResult; second: BakeResult }

/** Bakes the selected stages twice with --force into two directories and compares every output byte. */
export async function runRepro(o: BakeOptions): Promise<ReproResult> {
  const log = o.log ?? ((l: string) => console.log(l));
  log('repro: run 1');
  const first = await runBake({ ...o, force: true });
  const second2Root = path.join(o.cacheRoot ?? CACHE_ROOT, 'repro');
  rmSync(second2Root, { recursive: true, force: true });
  mkdirSync(second2Root, { recursive: true });
  log('repro: run 2');
  const second = await runBake({ ...o, force: true, outRoot: second2Root, writeLatest: false });
  const names = new Set([...Object.keys(first.hashes), ...Object.keys(second.hashes)]);
  const differing = [...names].sort().filter((n) => first.hashes[n] !== second.hashes[n]);
  rmSync(second2Root, { recursive: true, force: true });
  const identical = differing.length === 0 && Object.keys(first.hashes).length > 0 && first.bakeId === second.bakeId;
  log(identical ? `repro: ${Object.keys(first.hashes).length} outputs identical across both runs` : `repro: FAIL, differing outputs: ${differing.join(', ') || '(none listed; no outputs or bakeId differs)'}`);
  return { ok: identical && first.ok && second.ok, bakeId: first.bakeId, differing, first, second };
}
