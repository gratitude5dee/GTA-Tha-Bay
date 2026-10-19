/**
 * S13 pack writer and world index. `p0` (sim: HEIGHT, PRISM, GROUND; the other sections empty until M02a2) and `l0` (render:
 * BUILDING, TREE; LAMP, FURNITURE empty) DVWP v1 packs per z=7 tile that holds at least one baked chunk, and
 * `data/world-index`. The codec is M01f's; this stage only fills C08 structures.
 *
 * Landuse classes land in the p0 GROUND grid (Grass, Park, Sand, Paved, Rock, Pier, shallow and deep Water). The M01f l0
 * layout has no LANDUSE section and RenderChunk has no field for one, so none is written (BD note).
 */
import {
  C08_VERSION, GroundClass, TERRAIN_POSTS, chunkBounds, chunkKeyAt, parseChunkKey,
  type BuildingRecord, type ChunkKey, type RenderChunk, type SimChunk, type SourceStamp, type WorldIndex,
} from '../../../../packages/shared/src/index.ts';
import { loadBounds, type AreaGrid } from '../config.ts';
import { encodeL0, encodeP0 } from '../pack/encode.ts';
import type { Raster } from '../geom/raster.ts';
import { districtSeeds } from '../districts-seed.ts';
import { cmp } from '../util.ts';
import type { BuildingsProduct } from './s4-buildings.ts';
import { cellRaster, type LanduseClass, type WaterProduct } from './s3-water.ts';
import { heightGridOf, type TerrainProduct } from './s2-terrain.ts';

const GROUND_OF: Partial<Record<LanduseClass, GroundClass>> = {
  grass: GroundClass.Grass, park: GroundClass.Park, sand: GroundClass.Sand, plaza: GroundClass.Paved, rock: GroundClass.Rock,
};
export const SHALLOW_WATER_M = -3;

/** Ground classes at 4 m cell centres over the whole area rectangle (water until land is painted). */
export function groundRaster(grid: AreaGrid, w: WaterProduct): Raster {
  const r = cellRaster(grid, GroundClass.Water);
  r.fillRings(w.landRings, GroundClass.Paved);
  for (const lake of w.waterPolys) r.fillRings([lake], GroundClass.Water);
  for (const u of w.landuse) {
    const g = GROUND_OF[u.cls];
    if (g !== undefined) r.fillRings(u.rings, g);
  }
  for (const p of w.piers) r.fillRings([p], GroundClass.Pier);
  return r;
}

export interface PackFile { name: string; family: 'p0' | 'l0'; x: number; y: number; chunks: number; bytes: Uint8Array }
export interface PackOutput { files: PackFile[]; index: WorldIndex }

export interface PackInputs {
  bakeId: string;
  grid: AreaGrid;
  water: WaterProduct;
  terrain: TerrainProduct;
  buildings: BuildingsProduct;
  stamps: SourceStamp[];
}

const q1 = (v: number): number => Math.round(v * 10) / 10;

export function buildPacks(inp: PackInputs): PackOutput {
  const { bakeId, grid, water, terrain, buildings } = inp;
  const ground = groundRaster(grid, water);
  const keys = [...terrain.grids.keys()].sort((a, b) => {
    const pa = parseChunkKey(a)!, pb = parseChunkKey(b)!;
    return pa.y - pb.y || pa.x - pb.x;
  });

  // trees by chunk, only on land
  const treesBy = new Map<ChunkKey, number[]>();
  for (let i = 0; i + 3 < water.trees.length; i += 4) {
    const x = q1(water.trees[i] as number), z = q1(water.trees[i + 1] as number);
    const g = ground.at(x, z, GroundClass.Water);
    if (g === GroundClass.Water || g === GroundClass.WaterShallow || g === GroundClass.Pier) continue;
    const key = chunkKeyAt(9, x, z);
    if (!terrain.grids.has(key)) continue;
    (treesBy.get(key) ?? treesBy.set(key, []).get(key)!).push(x, z, water.trees[i + 2] as number, water.trees[i + 3] as number);
  }

  const sims = new Map<ChunkKey, SimChunk>();
  const renders = new Map<ChunkKey, RenderChunk>();
  for (const key of keys) {
    const dm = terrain.grids.get(key)!;
    const height = heightGridOf(key, dm);
    const b = chunkBounds(key);
    const g = new Uint8Array(64 * 64);
    for (let j = 0; j < 64; j++) {
      for (let i = 0; i < 64; i++) {
        let c = ground.at(b.minX + i * 4 + 2, b.minZ + j * 4 + 2, GroundClass.Water);
        if (c === GroundClass.Water) {
          const mean = ((dm[j * TERRAIN_POSTS + i] as number) + (dm[j * TERRAIN_POSTS + i + 1] as number) + (dm[(j + 1) * TERRAIN_POSTS + i] as number) + (dm[(j + 1) * TERRAIN_POSTS + i + 1] as number)) / 40;
          if (mean >= SHALLOW_WATER_M) c = GroundClass.WaterShallow;
        }
        g[j * 64 + i] = c;
      }
    }
    const list = buildings.byChunk.get(key) ?? [];
    const prisms: number[] = [];
    const recs: BuildingRecord[] = [];
    for (const bd of list) {
      prisms.push(bd.prism.length / 2, bd.baseDm / 10, bd.heightDm / 10, ...bd.prism);
      recs.push({ baseDm: bd.baseDm, heightDm: bd.heightDm, kind: bd.kind, roof: bd.roof, palette: bd.palette, seed: bd.seed, proxyOf: 0, ring: bd.ringDm });
    }
    sims.set(key, {
      key, bakeId, height, prisms: Float32Array.from(prisms), slabs: new Float32Array(0), hoods: new Float32Array(0),
      segments: [], edges: [], nodes: [], junctions: [], pedNodes: [], pedEdges: [],
      tags: { hidingSpots: [], pursuitBreakers: [], chokePoints: [], jumpZones: [], portals: [], shoreNodes: [] },
      spawn: { cellKey: key, densityProfile: 0, trafficSlots: 0, pedSlots: 0, parked: [] },
      ground: g,
    });
    renders.set(key, {
      key, z: 9, bakeId, height, ground: g, buildings: recs, trees: Float32Array.from(treesBy.get(key) ?? []),
      lamps: new Float32Array(0), furniture: new Float32Array(0), landmarks: [],
    });
  }

  // group by z=7 tile
  const tiles = new Map<string, ChunkKey[]>();
  for (const key of keys) {
    const p = parseChunkKey(key)!;
    const t = `${Math.floor(p.x / 4)}-${Math.floor(p.y / 4)}`;
    (tiles.get(t) ?? tiles.set(t, []).get(t)!).push(key);
  }
  const tileIds = [...tiles.keys()].sort((a, b) => {
    const [ax, ay] = a.split('-').map(Number) as [number, number];
    const [bx, by] = b.split('-').map(Number) as [number, number];
    return ax - bx || ay - by;
  });
  const files: PackFile[] = [];
  for (const t of tileIds) {
    const [tx, ty] = t.split('-').map(Number) as [number, number];
    const members = tiles.get(t)!;
    const header = { tileX: tx, tileY: ty, hostZ: 7, bakeId };
    files.push({ name: `p0-${t}.pack`, family: 'p0', x: tx, y: ty, chunks: members.length, bytes: encodeP0(members.map((k) => sims.get(k)!), header) });
    files.push({ name: `l0-${t}.pack`, family: 'l0', x: tx, y: ty, chunks: members.length, bytes: encodeL0(members.map((k) => renders.get(k)!), header) });
  }

  const bounds = loadBounds();
  const index: WorldIndex = {
    schema: 'world-index/1',
    c08: C08_VERSION,
    bakeId,
    worldSeed: Number.parseInt(bakeId.slice(0, 8), 16) >>> 0,
    areas: [
      { id: 'sf', status: 'playable', bboxEnu: { minX: grid.minX, minZ: grid.minZ, maxX: grid.maxX, maxZ: grid.maxZ }, unlock: null },
      { id: 'bay-backdrop', status: 'backdrop', bboxEnu: { minX: bounds.far.minX, minZ: bounds.far.minZ, maxX: bounds.far.maxX, maxZ: bounds.far.maxZ }, unlock: null },
    ],
    tiles: { p0: tileIds, l0: tileIds, l1: [], l2: [] },
    landmarks: [],
    pois: [],
    districts: districtSeeds(),
    portals: [],
    transit: [],
    sources: [...inp.stamps].sort((a, b) => cmp(a.id, b.id)),
  };
  return { files, index };
}
