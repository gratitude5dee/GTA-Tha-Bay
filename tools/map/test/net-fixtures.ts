/** Hand-built OSM and DataSF fixtures for the S5 to S9 stage specs: ENU metres in, GeoJSON lines out. */
import { CHUNK_EDGE_M, GRID_MIN_M, TERRAIN_POSTS, latLngFromEnu, type ChunkKey } from '../../../packages/shared/src/index.ts';
import { loadBridges, loadRoadClass } from '../src/config.ts';
import type { OsmFeature } from '../src/sources/geo.ts';
import { runRoads, type RoadFixes, type RoadsProduct, type StreetRow } from '../src/stages/s5-roads.ts';
import { buildJunctions, type JunctionsProduct } from '../src/stages/s6-junctions.ts';

export const roadCfg = loadRoadClass();
export const bridgesCfg = loadBridges();
export const BOX = { minX: -9000, minZ: -9000, maxX: 9000, maxZ: 9000 };

const coord = (x: number, z: number): number[] => {
  const p = latLngFromEnu(x, z);
  return [Number(p.lng.toFixed(9)), Number(p.lat.toFixed(9))];
};

let seq = 0;
export const resetIds = (): void => { seq = 0; };

export function way(pts: number[], tags: Record<string, string>, id?: string): OsmFeature {
  const co: number[][] = [];
  for (let i = 0; i < pts.length; i += 2) co.push(coord(pts[i] as number, pts[i + 1] as number));
  return { id: id ?? `w${1000 + seq++}`, tags, geometry: { type: 'LineString', coordinates: co } };
}

export function point(x: number, z: number, tags: Record<string, string>, id?: string): OsmFeature {
  return { id: id ?? `n${5000 + seq++}`, tags, geometry: { type: 'Point', coordinates: coord(x, z) } };
}

export function row(line: number[], o: Partial<StreetRow> & { cnn: number }): StreetRow {
  const co: number[][] = [];
  for (let i = 0; i < line.length; i += 2) co.push(coord(line[i] as number, line[i + 1] as number));
  return { streetname: '', classcode: '5', oneway: 'B', layer: 'STREETS', active: 'true', ...o, line: { type: 'MultiLineString', coordinates: [co] } };
}

export function net(osm: OsmFeature[], streets: StreetRow[] = [], fixes?: RoadFixes): { roads: RoadsProduct; junctions: JunctionsProduct } {
  const roads = runRoads({ osm, streets, hoods: [], cfg: roadCfg, box: BOX, fixes });
  return { roads, junctions: buildJunctions(roads) };
}

/** A four-way crossing at the origin: Main (west-east) and Cross (north-south), `len` metres each way, both residential. */
export function crossing(len = 120, tagsA: Record<string, string> = {}, tagsB: Record<string, string> = {}): OsmFeature[] {
  const a = { highway: 'residential', name: 'Main Street', ...tagsA };
  const b = { highway: 'residential', name: 'Cross Street', ...tagsB };
  return [
    way([-len, 0, 0, 0], a, 'w1'), way([0, 0, len, 0], a, 'w2'),
    way([0, -len, 0, 0], b, 'w3'), way([0, 0, 0, len], b, 'w4'),
  ];
}

/** 65 x 65 posts for each chunk key from a height function of ENU x, z (metres). */
export function gridsFor(keys: readonly ChunkKey[], h: (x: number, z: number) => number): Map<ChunkKey, Int16Array> {
  const out = new Map<ChunkKey, Int16Array>();
  for (const k of keys) {
    const [, cx, cz] = k.split('/').map(Number) as [number, number, number];
    const dm = new Int16Array(TERRAIN_POSTS * TERRAIN_POSTS);
    for (let j = 0; j < TERRAIN_POSTS; j++) for (let i = 0; i < TERRAIN_POSTS; i++) dm[j * TERRAIN_POSTS + i] = Math.round(h(GRID_MIN_M + cx * CHUNK_EDGE_M[9] + i * 4, GRID_MIN_M + cz * CHUNK_EDGE_M[9] + j * 4) * 10);
    out.set(k, dm);
  }
  return out;
}

/** The nine chunk keys around City Hall (9/255..257). */
export const CITY_KEYS: ChunkKey[] = [];
for (let cz = 255; cz <= 257; cz++) for (let cx = 255; cx <= 257; cx++) CITY_KEYS.push(`9/${cx}/${cz}` as ChunkKey);

/** Chunk keys covering an ENU box. */
export function keysBox(minX: number, maxX: number, minZ: number, maxZ: number): ChunkKey[] {
  const out: ChunkKey[] = [];
  for (let cz = Math.floor((minZ - GRID_MIN_M) / 256); cz <= Math.floor((maxZ - GRID_MIN_M) / 256); cz++) {
    for (let cx = Math.floor((minX - GRID_MIN_M) / 256); cx <= Math.floor((maxX - GRID_MIN_M) / 256); cx++) out.push(`9/${cx}/${cz}` as ChunkKey);
  }
  return out;
}
