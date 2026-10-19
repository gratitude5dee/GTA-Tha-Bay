/**
 * Bake configuration: config/world/sources.json (validated by tools/map/schemas/sources.schema.json), config/world/synth.json,
 * area boxes and the chunk-aligned grid every raster and stage works on.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { CHUNK_EDGE_M, GRID_MIN_M, TERRAIN_POSTS, sha256Hex, canonicalize, type ChunkKey, type WorldBounds } from '../../../packages/shared/src/index.ts';
import { toolsRoot } from '../../ci/lib/common.ts';
import { contentWorldSha } from './content.ts';
import type { BridgesConfig } from './stages/s7-grading.ts';
import type { RoadClassConfig } from './stages/s5-roads.ts';

export const TOOL_NAME = 'tools/map';
/** Bumped by hand when a change alters baked bytes; part of the bakeId (C08 rule 16). */
export const TOOL_VERSION = '0.3.0';
export const TOOL_ID = `${TOOL_NAME}@${TOOL_VERSION}`;

export type AreaId = 'sf' | 'civic-excerpt' | 'synth';
export const AREA_IDS: readonly AreaId[] = ['sf', 'civic-excerpt', 'synth'];
export const isAreaId = (s: string): s is AreaId => (AREA_IDS as readonly string[]).includes(s);

export interface EnuBox { minX: number; minZ: number; maxX: number; maxZ: number }
export interface SourceDef {
  id: string;
  kind: 'socrata' | 'terrarium' | 'osm';
  dataset?: string;
  url: string;
  select?: string;
  geometryColumn?: string | null;
  file: string;
  licence: string;
  licenceUrl: string;
  attribution: string;
  source: string;
  surfaces: string[];
}
export interface AreaGates {
  s0: { minRows: Record<string, number>; exactRows: Record<string, number> };
  s2: { cityHallM: [number, number]; minM: number };
  s3: { landRatioTolerance: number; minRingKm2: number };
  s4: { minBakedFraction: number; maxOsmFraction: number };
  s13: { packMaxBytes: number; packWarnBytes: number };
  s14: { sccMin: number; signalMin: number; worldIndex: boolean; transit: boolean; heroEdges: boolean; cablecars: boolean };
}
export interface AreaDef { label: string; network: boolean; box: 'play' | 'stream' | 'far' | EnuBox; sources: string[]; gates: AreaGates }
export interface BBox { minLat: number; minLng: number; maxLat: number; maxLng: number }
export interface SourcesConfig {
  schema: 'world-sources/1';
  note?: string;
  sources: SourceDef[];
  database: { licence: 'ODbL-1.0'; assets: string[]; note: string };
  terrarium: { core: { z: number; boxes: ('play' | 'stream' | 'far')[] }; far: { z: number; boxes: ('play' | 'stream' | 'far')[] } };
  osm: { note: string; bboxes: { sf: BBox; backdrop: BBox }; tagFilter: string; commands: string[]; backdropCommands: string[] };
  areas: Record<AreaId, AreaDef>;
}

export const SOURCES_PATH = path.join(toolsRoot, 'config', 'world', 'sources.json');
export const SYNTH_PATH = path.join(toolsRoot, 'config', 'world', 'synth.json');
export const BOUNDS_PATH = path.join(toolsRoot, 'config', 'world.bounds.json');
export const ROADCLASS_PATH = path.join(toolsRoot, 'config', 'world', 'roadclass.json');
export const BRIDGES_PATH = path.join(toolsRoot, 'config', 'world', 'bridges.json');
export const DENSITY_PATH = path.join(toolsRoot, 'config', 'world', 'density.json');
export const SCHEMAS_DIR = path.join(toolsRoot, 'tools', 'map', 'schemas');

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

const validators = new Map<string, (data: unknown) => string[]>();
/** Compiles tools/map/schemas/<name>.schema.json once; returns "<path> <message>" strings (empty when valid). */
export function mapSchema(name: string): (data: unknown) => string[] {
  const have = validators.get(name);
  if (have) return have;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(readJson(path.join(SCHEMAS_DIR, `${name}.schema.json`)));
  const fn = (data: unknown): string[] => (validate(data) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`));
  validators.set(name, fn);
  return fn;
}

/** Hosts the bake must never read from (F-055 Photorealistic 3D Tiles, F-056 Mapbox; DL-676). */
export function isDeniedHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return host === 'mapbox.com' || host.endsWith('.mapbox.com') || host === 'tile.googleapis.com';
}
export function assertAllowedHost(url: string): void {
  if (isDeniedHost(url)) throw new Error(`refusing ${url}: Google Photorealistic 3D Tiles and Mapbox are never sources (F-055, F-056)`);
}

export function validateSources(raw: unknown): string[] {
  const errors = mapSchema('sources')(raw);
  if (errors.length > 0) return errors;
  const cfg = raw as SourcesConfig;
  const ids = new Set<string>();
  for (const s of cfg.sources) {
    if (ids.has(s.id)) errors.push(`/sources duplicate id ${s.id}`);
    ids.add(s.id);
    if (isDeniedHost(s.url) || isDeniedHost(s.licenceUrl)) errors.push(`/sources/${s.id} uses a denied host`);
  }
  for (const [area, def] of Object.entries(cfg.areas)) for (const id of def.sources) if (!ids.has(id)) errors.push(`/areas/${area} names unknown source ${id}`);
  return errors;
}

export function loadSources(file = SOURCES_PATH): SourcesConfig {
  const raw = readJson<unknown>(file);
  const errors = validateSources(raw);
  if (errors.length > 0) throw new Error(`${path.relative(toolsRoot, file)} is invalid:\n  ${errors.join('\n  ')}`);
  return raw as SourcesConfig;
}

export interface DensityConfig { schema: 'world-density/1'; profiles: { name: string; perKm: number }[]; perLaneKm: Record<string, number> }

function loadChecked<T>(file: string, schema: string): T {
  const raw = readJson<unknown>(file);
  const errors = mapSchema(schema)(raw);
  if (errors.length > 0) throw new Error(`${path.relative(toolsRoot, file)} is invalid:\n  ${errors.join('\n  ')}`);
  return raw as T;
}
export const loadRoadClass = (file = ROADCLASS_PATH): RoadClassConfig => loadChecked<RoadClassConfig>(file, 'roadclass');
export const loadBridges = (file = BRIDGES_PATH): BridgesConfig => loadChecked<BridgesConfig>(file, 'bridges');
export const loadDensity = (file = DENSITY_PATH): DensityConfig => loadChecked<DensityConfig>(file, 'density');

export function loadBounds(): WorldBounds {
  return readJson<WorldBounds>(BOUNDS_PATH);
}

export function sourceById(cfg: SourcesConfig, id: string): SourceDef {
  const s = cfg.sources.find((x) => x.id === id);
  if (!s) throw new Error(`unknown source ${id}`);
  return s;
}

export function enuBoxOf(box: AreaDef['box'] | 'play' | 'stream' | 'far', bounds: WorldBounds = loadBounds()): EnuBox {
  if (typeof box === 'string') {
    const b = bounds[box];
    return { minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ };
  }
  return box;
}

/** The chunk-aligned rectangle every raster and stage of one area uses (inclusive chunk indices at z=9). */
export interface AreaGrid {
  box: EnuBox;
  cx0: number; cy0: number; cx1: number; cy1: number;
  nx: number; ny: number;
  minX: number; minZ: number; maxX: number; maxZ: number;
  /** Terrain posts across / down the whole rectangle: nx * 64 + 1. */
  postsX: number; postsY: number;
}

export function areaGridOf(box: EnuBox): AreaGrid {
  const e = CHUNK_EDGE_M[9];
  const cx0 = Math.floor((box.minX - GRID_MIN_M) / e);
  const cy0 = Math.floor((box.minZ - GRID_MIN_M) / e);
  const cx1 = Math.ceil((box.maxX - GRID_MIN_M) / e) - 1;
  const cy1 = Math.ceil((box.maxZ - GRID_MIN_M) / e) - 1;
  const nx = cx1 - cx0 + 1;
  const ny = cy1 - cy0 + 1;
  return {
    box, cx0, cy0, cx1, cy1, nx, ny,
    minX: GRID_MIN_M + cx0 * e, minZ: GRID_MIN_M + cy0 * e, maxX: GRID_MIN_M + (cx1 + 1) * e, maxZ: GRID_MIN_M + (cy1 + 1) * e,
    postsX: nx * (TERRAIN_POSTS - 1) + 1, postsY: ny * (TERRAIN_POSTS - 1) + 1,
  };
}

export const chunkKeyOfIndex = (cx: number, cy: number): ChunkKey => `9/${cx}/${cy}` as ChunkKey;

export interface SynthConfig {
  schema: 'world-synth/1';
  generator: string;
  seed: number;
  land: EnuBox;
  landPads: ({ id: string; kind: 'island'; x: number; z: number; size: number } | { id: string; kind: 'strip'; x: number; z: number; width: number; length: number })[];
  piers: ({ id: string; kind: 'line'; x0: number; z0: number; x1: number; z1: number; width: number } | { id: string; kind: 'polygon' } & EnuBox)[];
  terrain: { landFloorM: number; cityHallM: number; hills: { id: string; x: number; z: number; amp: number; sigma: number }[]; padHillM: number; padHillSigmaM: number; seabedM: number };
  parks: ({ id: string; name: string } & EnuBox)[];
  landuse: ({ cls: string } & EnuBox)[];
  buildings: {
    downtown: { chunkX: [number, number]; chunkY: [number, number]; perChunk: number };
    dense: { boxes: EnuBox[]; perChunk: number };
    bulk: { perChunk: number };
    civicSites: { id: string; x: number; z: number; w: number; d: number; h: number; tag: string }[];
    osmTowers: { id: string; x: number; z: number; w: number; d: number; heightM: number }[];
    osmGapFill: { count: number; box: EnuBox };
    palette: number;
  };
  trees: { perChunk: number };
  neighbourhoods: { cols: number; rows: number; names: string[] };
  roads: SynthRoadsConfig;
}

/** The synth street grid (M02a2): global lines at originX + i * pitchM and originZ + j * pitchM. */
export interface SynthRoadsConfig {
  pitchM: number;
  originX: number;
  originZ: number;
  marginM: number;
  arterial: { everyI: number; phaseI: number; everyJ: number; phaseJ: number };
  collectorEvery: number;
  oneWay: { everyI: number; phaseI: number; everyJ: number; phaseJ: number };
  overpass: { i: number; j0: number; blocks: number };
  tunnel: { j: number; i0: number; blocks: number };
  lightRail: { i: number; z0: number; z1: number; offsetM: number };
  bus: { route: string; line: 'v' | 'h'; idx: number; from: number; to: number; stopEveryBlocks: number }[];
  ferry: { from: { x: number; z: number }; to: { x: number; z: number } };
  footways: { id: string; kind: 'footway' | 'steps'; pts: number[] }[];
  restrictions: { kind: 'no_left_turn' | 'no_right_turn' | 'no_u_turn' | 'only_straight_on'; i: number; j: number; from: 'n' | 's' | 'e' | 'w' }[];
}

export function loadSynth(file = SYNTH_PATH): SynthConfig {
  const raw = readJson<unknown>(file);
  const errors = mapSchema('synth')(raw);
  if (errors.length > 0) throw new Error(`${path.relative(toolsRoot, file)} is invalid:\n  ${errors.join('\n  ')}`);
  return raw as SynthConfig;
}

/** Hash of the config that decides one area's bytes: its sources' definitions, its section, and synth.json for `synth`. */
export function configHashesOf(cfg: SourcesConfig, area: AreaId): Record<string, string> {
  const def = cfg.areas[area];
  const out: Record<string, string> = {
    area: sha256Hex(canonicalize({ id: area, def })),
    sources: sha256Hex(canonicalize(cfg.sources.filter((s) => def.sources.includes(s.id)))),
    terrarium: sha256Hex(canonicalize(cfg.terrarium)),
    bounds: sha256Hex(canonicalize(loadBounds())),
    roadclass: sha256Hex(canonicalize(loadRoadClass())),
    bridges: sha256Hex(canonicalize(loadBridges())),
    density: sha256Hex(canonicalize(loadDensity())),
    contentWorld: contentWorldSha(),
    sourcesDatabase: sha256Hex(canonicalize(cfg.database)),
  };
  if (area === 'synth') out['synth'] = sha256Hex(canonicalize(loadSynth()));
  return out;
}

/** Hash of every tools/map source file: part of stage cache keys so a code edit never reuses a stale stage. */
let codeHashMemo: string | null = null;
export function codeHash(): string {
  if (codeHashMemo) return codeHashMemo;
  const dir = path.join(toolsRoot, 'tools', 'map', 'src');
  const parts: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.ts')) parts.push(`${path.relative(dir, p)}:${sha256Hex(readFileSync(p))}`);
    }
  };
  walk(dir);
  codeHashMemo = sha256Hex(parts.join('\n'));
  return codeHashMemo;
}

export const CACHE_ROOT = path.join(toolsRoot, '.cache', 'map');
export const DIST_ROOT = path.join(toolsRoot, 'dist', 'world');
export const CIVIC_FIXTURE_DIR = path.join(toolsRoot, 'tests', 'fixtures', 'map', 'civic-excerpt');
export const rawDirOf = (area: AreaId): string => (area === 'civic-excerpt' ? CIVIC_FIXTURE_DIR : path.join(CACHE_ROOT, 'raw', area));
export const hasFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();
