/**
 * runBake: the S0 check, S3 water, S2 terrain, S5 roads, S6 junctions, S7 grading, S4 buildings, S8 pedestrians, S9 tags and
 * spawn, S10 places and transit, S11 LOD and far, S13 pack and S14 verify stages of one area, with the stage cache, gates,
 * `dist/world/<bakeId>/` outputs and `--repro`.
 *
 * Stage order: fetch, water, terrain, roads, junctions, grading, buildings, ped, tags, places, lod, pack. S2 needs the S3 water
 * mask for its clamps, so S3 runs first; S4 follows S7 because buildings sit on the graded grid (the spec table lists S2
 * before S3 and S4 before S5; the dependency decides).
 */
import v8 from 'node:v8';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalize, chunkKeyAt, enuFromLatLng, sha256Hex, type ChunkKey, type SourceStamp } from '../../../packages/shared/src/index.ts';
import {
  CACHE_ROOT, DEFAULT_LAMP_PITCH_M, DIST_ROOT, TOOL_ID, areaGridOf, codeHash, configHashesOf, enuBoxOf, loadBridges, loadDensity, loadBounds, loadRoadClass, loadSources, loadSynth, mapSchema, rawDirOf,
  type AreaGrid, type AreaId, type SourcesConfig, type SynthConfig,
} from './config.ts';
import { CONTENT_STAMP_AT, CONTENT_STAMP_ID, contentRows, contentStamp, loadContentWorld, type ContentWorld } from './content.ts';
import { RAW_LOCK_NAME, rawLockText, readRawLock, sha256Text, stampsOf, type RawLockFile } from './raw-lock.ts';
import { generateSynth, synthSourceSha } from './sources/synth.ts';
import { loadMosaic, type TerrariumMosaic } from './sources/terrarium.ts';
import { readJsonl } from './sources/socrata.ts';
import { readOsm, type OsmFeature } from './sources/geo.ts';
import { runWater, hoodUnionMask, kindMask, cellRaster, landMask, pierMask, postRaster, waterGate, type HoodRow, type ParkRow, type TreeRow, type WaterProduct } from './stages/s3-water.ts';
import { TerrainField, runTerrain, type TerrainProduct } from './stages/s2-terrain.ts';
import { runRoads, type RoadsProduct, type StreetRow } from './stages/s5-roads.ts';
import { buildJunctions, type JunctionsProduct } from './stages/s6-junctions.ts';
import { runGrading, type GradingProduct } from './stages/s7-grading.ts';
import { bakeBuildings, CHUNK_BUILDING_LIMIT, type BuildingsProduct, type FootprintRow } from './stages/s4-buildings.ts';
import { runPed, type PedProduct } from './stages/s8-ped.ts';
import { runTags, type TagsProduct } from './stages/s9-tags.ts';
import { runSpawn } from './stages/s9-spawn.ts';
import { hoodAt, runPlaces, type PlacesProduct } from './stages/s10-places.ts';
import { runTransit, type RouteRow, type StopRow, type TransitRoutes } from './stages/s10-transit.ts';
import { runLod } from './stages/s11-lod.ts';
import { runFar } from './stages/s11-far.ts';
import { buildPacks, graphBytes, type PackOutput } from './stages/s13-pack.ts';
import { failed, s0Gates, s10Gates, s13Gates, s2Gates, s3Gates, s4Gates, s5Gates, s6Gates, s7Gates, s8Gates, s9Gates, type GateResult } from './verify/gates.ts';
import { verifyBakeDir } from './verify/verify.ts';
import { buildEdgeGraph } from './graph/route.ts';
import { attributionFor } from './pack/attribution.ts';
import { renderPreview } from './pack/preview.ts';
import { PrismIndex } from './geom/prisms.ts';
import { cmp, stableJson } from './util.ts';
import type { SpawnTable } from '../../../packages/shared/src/index.ts';

export type StageId = 'fetch' | 'water' | 'terrain' | 'roads' | 'junctions' | 'grading' | 'buildings' | 'ped' | 'tags' | 'places' | 'lod' | 'pack';
export const STAGE_ORDER: readonly StageId[] = ['fetch', 'water', 'terrain', 'roads', 'junctions', 'grading', 'buildings', 'ped', 'tags', 'places', 'lod', 'pack'];
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
  content?: ContentWorld | undefined;
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
  osm: OsmFeature[] | null;
}

function mosaicOf(c: Ctx): TerrariumMosaic {
  if (!c.mosaic) c.mosaic = loadMosaic(path.join(c.rawDir, 'terrarium'), 15);
  return c.mosaic;
}
function osmOf(c: Ctx): OsmFeature[] {
  if (!c.osm) c.osm = readOsm(path.join(c.rawDir, 'osm.geojsonl'));
  return c.osm;
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
interface RoadsStage { product: RoadsProduct; gates: GateResult[] }
interface JunctionsStage { product: JunctionsProduct; gates: GateResult[] }
interface GradingStage { product: GradingProduct; gates: GateResult[] }
interface BuildingsStage { product: BuildingsProduct; gates: GateResult[] }
interface PedStage { product: PedProduct; gates: GateResult[] }
interface TagsStage { tags: TagsProduct; spawn: Map<ChunkKey, SpawnTable>; spawnReport: Record<string, number>; gates: GateResult[] }
interface PlacesStage { places: PlacesProduct; transit: TransitRoutes; transitReport: Record<string, unknown>; gates: GateResult[] }
interface LodStage { files: { name: string; family: 'l1' | 'l2'; x: number; y: number; units: number; bytes: Uint8Array }[]; far: { dem: Uint8Array; massing: Uint8Array; cards: Uint8Array }; report: Record<string, unknown>; farReport: Record<string, unknown> }

export async function runBake(o: BakeOptions): Promise<BakeResult> {
  const log = o.log ?? ((l: string) => console.log(l));
  const cfg = o.cfg ?? loadSources();
  const def = cfg.areas[o.area];
  const rawDir = o.rawDir ?? rawDirOf(o.area);
  const wanted = new Set<StageId>(o.stages && o.stages.length > 0 ? o.stages : STAGE_ORDER);
  const ms: Record<string, number> = {};
  const content = o.content ?? loadContentWorld();

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
  const c: Ctx = { o, cfg, area: o.area, rawDir, grid, lock, bakeId, log, mosaic: null, osm: null };
  log(`bake ${bakeId.slice(0, 12)} area=${o.area} stages=${[...wanted].join(',')}`);

  const gates: GateResult[] = [...s0Gates(lock, def.gates.s0)];
  const box = { minX: grid.box.minX, minZ: grid.box.minZ, maxX: grid.box.maxX, maxZ: grid.box.maxZ };
  const gridBox = { minX: grid.minX, minZ: grid.minZ, maxX: grid.maxX, maxZ: grid.maxZ };
  const roadCfg = loadRoadClass();
  const bridgesCfg = loadBridges();
  const densityCfg = loadDensity();

  // S3 water
  const water = await stage<WaterStage>(c, 'water', wanted.has('water'), ms, () => {
    const parks = jsonlOrEmpty<ParkRow>(path.join(rawDir, 'gtr9-ntp6.jsonl'));
    const hoods = jsonlOrEmpty<HoodRow>(path.join(rawDir, 'j2bu-swwd.jsonl'));
    const trees = jsonlOrEmpty<TreeRow>(path.join(rawDir, 'tkzw-k3nq.jsonl'));
    const product = runWater({
      grid, osm: osmOf(c), parks, hoods, trees, minRingKm2: def.gates.s3.minRingKm2,
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

  // S2 terrain (plus a grid for every chunk a bridge deck crosses over open water)
  const terrain = await stage<TerrainStage>(c, 'terrain', wanted.has('terrain'), ms, () => {
    const land = landMask(postRaster(grid), water.product);
    const pier = pierMask(postRaster(grid), water.product);
    const extra = new Set<ChunkKey>();
    for (const f of osmOf(c)) {
      if (f.tags['highway'] === undefined || f.tags['bridge'] === undefined || f.tags['bridge'] === 'no' || f.geometry.type !== 'LineString') continue;
      const co = f.geometry.coordinates as number[][];
      for (let i = 0; i < co.length; i++) {
        const p = enuFromLatLng((co[i] as number[])[1] as number, (co[i] as number[])[0] as number);
        const a = i === 0 ? p : enuFromLatLng((co[i - 1] as number[])[1] as number, (co[i - 1] as number[])[0] as number);
        const n = Math.max(1, Math.ceil(Math.hypot(p.x - a.x, p.z - a.z) / 64));
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((p.x - a.x) * k) / n, z = a.z + ((p.z - a.z) * k) / n;
          if (x < box.minX || x >= box.maxX || z < box.minZ || z >= box.maxZ) continue;
          extra.add(chunkKeyAt(9, x, z));
        }
      }
    }
    const product = runTerrain(grid, mosaicOf(c), land, pier, extra);
    return { product, gates: s2Gates(product.stats, def.gates.s2) };
  });
  gates.push(...terrain.gates);

  // S5 roads
  const roads = await stage<RoadsStage>(c, 'roads', wanted.has('roads'), ms, () => {
    const streets = jsonlOrEmpty<StreetRow>(path.join(rawDir, '3psu-pn9h.jsonl'));
    const product = runRoads({ osm: osmOf(c), streets, hoods: water.product.hoods, cfg: roadCfg, box: gridBox });
    return { product, gates: s5Gates(product.report, roadCfg.oneway.minAgreement) };
  });
  gates.push(...roads.gates);

  // S6 junctions and signal programs
  const junctions = await stage<JunctionsStage>(c, 'junctions', wanted.has('junctions'), ms, () => {
    const product = buildJunctions(roads.product);
    return { product, gates: s6Gates(product.report, def.gates.s14.signalMin) };
  });
  gates.push(...junctions.gates);

  // S7 grading
  const grading = await stage<GradingStage>(c, 'grading', wanted.has('grading'), ms, () => {
    const product = runGrading({
      segs: roads.product.segs, nodes: junctions.product.nodes, edges: roads.product.edges, grids: terrain.product.grids, cfg: bridgesCfg, hillGradePct: roadCfg.hillGradePct,
    });
    return { product, gates: s7Gates(product.stats) };
  });
  gates.push(...grading.gates);
  const graded = new TerrainField(grading.product.grids);

  // S4 buildings (on the graded grid)
  const buildings = await stage<BuildingsStage>(c, 'buildings', wanted.has('buildings'), ms, () => {
    const footprints = readJsonl<FootprintRow>(path.join(rawDir, 'ynuv-fyni.jsonl'));
    const product = bakeBuildings({
      footprints, osm: osmOf(c), terrain: graded,
      kindRaster: kindMask(cellRaster(grid), water.product), palettes: 16, maxOsmFraction: def.gates.s4.maxOsmFraction,
    });
    return { product, gates: s4Gates(product.report, def.gates.s4, CHUNK_BUILDING_LIMIT) };
  });
  gates.push(...buildings.gates);

  const prisms = new PrismIndex();
  for (const list of buildings.product.byChunk.values()) for (const b of list) prisms.add(b.prism);
  const landR = landMask(cellRaster(grid), water.product);
  const pierR = pierMask(cellRaster(grid), water.product);
  const unionR = hoodUnionMask(cellRaster(grid), water.product, box);
  const isLand = (x: number, z: number): boolean => landR.at(x, z, 0) === 1;
  const isWater = (x: number, z: number): boolean => landR.at(x, z, 0) !== 1 && pierR.at(x, z, 0) !== 1;
  const inUnion = (x: number, z: number): boolean => unionR.at(x, z, 0) === 1;
  const nhoodDistrict = new Map<string, string>();
  const nhoodProfile = new Map<string, string>();
  for (const d of content.districts.districts) for (const n of d.nhoods) { nhoodDistrict.set(n, d.id); nhoodProfile.set(n, content.districts.nhoodProfile?.[n] ?? d.profile); }
  const outerProfile = content.districts.districts.find((d) => d.id === 'outer')?.profile ?? 'residential';
  const districtAt = (x: number, z: number): string | null => { const h = hoodAt(water.product.hoods, x, z); return h ? nhoodDistrict.get(h) ?? null : null; };
  const profileAt = (x: number, z: number): string => { const h = hoodAt(water.product.hoods, x, z); return h ? nhoodProfile.get(h) ?? outerProfile : outerProfile; };

  // S8 pedestrian graph
  const ped = await stage<PedStage>(c, 'ped', wanted.has('ped'), ms, () => {
    const product = runPed({
      segs: grading.product.segs, edges: grading.product.edges, nodes: grading.product.nodes, junctions: junctions.product.junctions, osm: osmOf(c), field: graded,
      landuse: water.product.landuse, prisms, isWater, box: gridBox,
    });
    return { product, gates: s8Gates(product.report) };
  });
  gates.push(...ped.gates);

  // S9 tags and spawn tables
  const tagStage = await stage<TagsStage>(c, 'tags', wanted.has('tags'), ms, () => {
    const tags = runTags({
      segs: grading.product.segs, edges: grading.product.edges, nodes: grading.product.nodes, ped: ped.product, osm: osmOf(c), field: graded,
      landRings: water.product.landRings, pierRings: water.product.piers, box: gridBox, inUnion, isLand, content, bridges: bridgesCfg,
      lampPitchM: densityCfg.lampPitchM ?? DEFAULT_LAMP_PITCH_M,
    });
    const sp = runSpawn({
      segs: grading.product.segs, edges: grading.product.edges, nodes: grading.product.nodes, chunks: grading.product.grids.keys(),
      sidewalkM: ped.product.sidewalkM, latticeNodes: ped.product.latticeNodes, density: densityCfg, profileAt,
    });
    return { tags, spawn: sp.spawn, spawnReport: sp.report as unknown as Record<string, number>, gates: s9Gates(tags.report) };
  });
  gates.push(...tagStage.gates);

  // S10 places and transit routes
  const placesStage = await stage<PlacesStage>(c, 'places', wanted.has('places'), ms, () => {
    const places = runPlaces({
      content, box: gridBox, osm: osmOf(c), buildings: buildings.product, prisms, ped: ped.product, hoods: water.product.hoods, density: densityCfg,
      chunkExists: (k) => grading.product.grids.has(k), groundY: (x, z) => graded.heightAt(x, z) ?? 0, isWater,
    });
    const net = grading.product;
    const graph = buildEdgeGraph(net.edges, junctions.product.junctions, (n) => (net.nodes[n] as { junction: number }).junction, (e) => (net.segs[e.seg] as { lengthM: number }).lengthM, (n) => (net.nodes[n] as { out: number[] }).out);
    const tr = runTransit({
      bakeId, osm: osmOf(c), routes: jsonlOrEmpty<RouteRow>(path.join(rawDir, '9exe-acju.jsonl')), stops: jsonlOrEmpty<StopRow>(path.join(rawDir, 'i28k-bkz6.jsonl')),
      segs: net.segs, edges: net.edges, nodes: net.nodes, graph, content, box: gridBox, requireCablecars: def.gates.s14.cablecars,
    });
    const g = s10Gates(places.report, o.area === 'sf');
    if (def.gates.s14.cablecars && tr.report.cablecarMissing.length > 0) {
      g.push({ id: 's10.cablecars', stage: 'S10', level: 'fail', detail: `cable-car chains not found in the street graph (U-W6): ${tr.report.cablecarMissing.join(', ')}` });
    }
    return { places, transit: tr.routes, transitReport: tr.report as unknown as Record<string, unknown>, gates: g };
  });
  gates.push(...placesStage.gates);

  // S11 LOD packs and the far backdrop
  const lodStage = await stage<LodStage>(c, 'lod', wanted.has('lod'), ms, () => {
    const lod = runLod({
      bakeId, grid, terrain: graded, landRings: water.product.landRings, landuse: water.product.landuse, buildings: buildings.product, segs: grading.product.segs, districtAt,
    });
    const z12 = (() => { try { return loadMosaic(path.join(rawDir, 'terrarium'), 12); } catch { return null; } })();
    const far = runFar({
      bakeId, bounds: loadBounds(), mosaic12: z12, mosaic15: mosaicOf(c), area: gridBox, areaHeight: (x, z) => graded.heightAt(x, z), isLand,
      buildings: buildings.product, segs: grading.product.segs,
    });
    return { files: lod.files, far: { dem: far.dem, massing: far.massing, cards: far.cards }, report: lod.report as unknown as Record<string, unknown>, farReport: far.report as unknown as Record<string, unknown> };
  });

  // S13 pack, then S14 verify on the written bake
  let outputs: PackOutput | null = null;
  if (wanted.has('pack')) {
    const t0 = Date.now();
    const stamps: SourceStamp[] = [...stampsOf(lock, cfg), contentStamp()];
    outputs = buildPacks({
      bakeId, grid, water: water.product, terrain: { ...terrain.product, grids: grading.product.grids }, buildings: buildings.product, stamps,
      segs: grading.product.segs, nodes: grading.product.nodes, edges: grading.product.edges, junctions: junctions.product.junctions,
      slabs: grading.product.slabs, hoods: grading.product.hoods, ped: ped.product, tags: tagStage.tags.tags, lamps: tagStage.tags.lamps, portals: tagStage.tags.portals, spawn: tagStage.spawn,
      places: placesStage.places, lod: lodStage.files,
      far: [{ name: 'far-bay-dem.pack', bytes: lodStage.far.dem }, { name: 'far-bay-massing.pack', bytes: lodStage.far.massing }, { name: 'far-bay-cards.png', bytes: lodStage.far.cards }],
    });
    outputs.files.push({
      name: 'sf-graph.v1.pack', family: 'graph', x: 0, y: 0, chunks: 1,
      bytes: graphBytes(bakeId, grading.product.nodes, grading.product.edges, grading.product.segs),
    });
    const idxErr = mapSchema('world-index')(outputs.index);
    gates.push({ id: 's13.index-schema', stage: 'S13', level: idxErr.length === 0 ? 'pass' : 'fail', detail: idxErr.length === 0 ? 'data/world-index validates against world-index.schema.json' : idxErr.join('; ') });
    const trErr = mapSchema('transit-routes')(placesStage.transit);
    gates.push({ id: 's13.transit-schema', stage: 'S13', level: trErr.length === 0 ? 'pass' : 'fail', detail: trErr.length === 0 ? 'data/transit-routes.v1 validates against transit-routes.schema.json' : trErr.slice(0, 6).join('; ') });
    const bakeLock: RawLockFile = {
      ...lock,
      sources: [...lock.sources, { id: CONTENT_STAMP_ID, url: 'repo://content/world', retrievedAt: CONTENT_STAMP_AT, sha256: contentStamp().sha256, rows: contentRows(content), licence: 'ODbL-1.0' }],
    };
    const extra = [
      { name: 'world-index.json', bytes: Buffer.from(stableJson(outputs.index)) },
      { name: 'transit-routes.json', bytes: Buffer.from(stableJson(placesStage.transit)) },
      { name: RAW_LOCK_NAME, bytes: Buffer.from(rawLockText(bakeLock)) },
      { name: 'attribution.world.json', bytes: Buffer.from(stableJson(attributionFor(cfg, o.area))) },
      { name: 'preview.png', bytes: renderPreview(grid, outputs.sims, outputs.renders) },
    ];
    gates.push(...s13Gates(outputs.files.map((f) => ({ name: f.name, bytes: f.bytes.length })), [...outputs.files.map((f) => ({ name: f.name, bytes: f.bytes })), ...extra], def.gates.s13));

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(path.join(outDir, 'packs'), { recursive: true });
    for (const f of outputs.files) writeFileSync(path.join(outDir, 'packs', f.name), f.bytes);
    for (const e of extra) writeFileSync(path.join(outDir, e.name), e.bytes);
    const baseReport = {
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
      roads: roads.product.report,
      junctions: junctions.product.report,
      grading: grading.product.stats,
      ped: ped.product.report,
      tags: tagStage.tags.report,
      spawn: tagStage.spawnReport,
      places: placesStage.places.report,
      transit: placesStage.transitReport,
      lod: lodStage.report,
      far: lodStage.farReport,
      packs: outputs.files.map((f) => ({ name: f.name, bytes: f.bytes.length, chunks: f.chunks })),
    };
    const writeReport = (g: GateResult[]): void => {
      const report = { ...baseReport, gates: g, ok: failed(g).length === 0 };
      const repErr = mapSchema('bake-report')(report);
      if (repErr.length > 0) throw new Error(`bake-report.json does not validate: ${repErr.join('; ')}`);
      writeFileSync(path.join(outDir, 'bake-report.json'), stableJson(report));
    };
    writeReport(gates);
    // S14: the gates that read the finished bake back from disk
    const s14 = verifyBakeDir(outDir, { cfg, content });
    gates.push(...s14);
    writeReport(gates);
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
