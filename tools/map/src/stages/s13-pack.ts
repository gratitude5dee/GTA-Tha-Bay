/**
 * S13 pack writer and world index. `p0` (sim: HEIGHT, PRISM, SLAB, HOOD, SEGMENT, NODE, EDGE, JUNCTION, PED, TAGS, SPAWN,
 * GROUND) and `l0` (render: BUILDING with landmark proxies, TREE, LAMP, LMREF; FURNITURE stays empty until its milestone)
 * DVWP v1 packs per z=7 tile that holds at least one baked chunk, the S11 `l1`/`l2`/`far-bay-*` packs passed in, the
 * `map_data/sf-graph.v1` topology and `data/world-index`. The codec is M01f's; this stage only fills C08 structures.
 *
 * Landuse classes land in the p0 GROUND grid (Grass, Park, Sand, Paved, Rock, Pier, shallow and deep Water; Asphalt and
 * Sidewalk where the road graph runs). The M01f l0 layout has no LANDUSE section, so none is written (BD note).
 */
import {
  C08_VERSION, GroundClass, TERRAIN_POSTS, chunkBounds, chunkKeyAt, parseChunkKey, encodeGraph,
  type BuildingRecord, type ChunkKey, type ChunkTags, type Junction, type PedEdge, type PedNode, type Portal, type RenderChunk, type RoadEdge,
  type RoadNode, type RoadSegment, type SimChunk, type SourceStamp, type SpawnTable, type WorldIndex,
} from '../../../../packages/shared/src/index.ts';
import { loadBounds, type AreaGrid } from '../config.ts';
import { encodeL0, encodeP0 } from '../pack/encode.ts';
import type { Raster } from '../geom/raster.ts';
import { cmp } from '../util.ts';
import type { BuildingsProduct } from './s4-buildings.ts';
import { bufferLine, cellRaster, type LanduseClass, type WaterProduct } from './s3-water.ts';
import { heightGridOf, type TerrainProduct } from './s2-terrain.ts';
import type { NodeB, SegB } from './s5-roads.ts';
import type { PedProduct } from './s8-ped.ts';
import type { PlacesProduct } from './s10-places.ts';
import type { LodFile } from './s11-lod.ts';

const GROUND_OF: Partial<Record<LanduseClass, GroundClass>> = {
  grass: GroundClass.Grass, park: GroundClass.Park, sand: GroundClass.Sand, plaza: GroundClass.Paved, rock: GroundClass.Rock,
};
export const SHALLOW_WATER_M = -3;
export const SIDEWALK_EXTRA_M = 3.2;

/** Ground classes at 4 m cell centres over the whole area rectangle (water until land is painted), roads painted last. */
export function groundRaster(grid: AreaGrid, w: WaterProduct, segs: readonly SegB[] = []): Raster {
  const r = cellRaster(grid, GroundClass.Water);
  r.fillRings(w.landRings, GroundClass.Paved);
  for (const lake of w.waterPolys) r.fillRings([lake], GroundClass.Water);
  for (const u of w.landuse) {
    const g = GROUND_OF[u.cls];
    if (g !== undefined) r.fillRings(u.rings, g);
  }
  for (const p of w.piers) r.fillRings([p], GroundClass.Pier);
  // road surfaces: sidewalks first (class 4 and better), then asphalt; never over water and never under a deck or a hood
  const paint = (width: (s: SegB) => number, cls: GroundClass, only: (s: SegB) => boolean): void => {
    for (const s of segs) {
      if (s.bridge || s.tunnel || !only(s)) continue;
      for (const ring of bufferLine(s.pts, width(s))) r.fillRings([ring], cls, (v) => v !== GroundClass.Water);
    }
  };
  paint((s) => s.widthM + SIDEWALK_EXTRA_M, GroundClass.Sidewalk, (s) => s.cls >= 2 && s.cls <= 4 && !s.noSidewalk);
  paint((s) => s.widthM, GroundClass.Asphalt, () => true);
  return r;
}

export interface PackFile { name: string; family: 'p0' | 'l0' | 'l1' | 'l2' | 'far' | 'graph'; x: number; y: number; chunks: number; bytes: Uint8Array }
export interface PackOutput {
  files: PackFile[];
  index: WorldIndex;
  sims: Map<ChunkKey, SimChunk>;
  renders: Map<ChunkKey, RenderChunk>;
}

export interface PackInputs {
  bakeId: string;
  grid: AreaGrid;
  water: WaterProduct;
  /** Graded terrain. */
  terrain: TerrainProduct;
  buildings: BuildingsProduct;
  stamps: SourceStamp[];
  segs: readonly SegB[];
  nodes: readonly NodeB[];
  edges: readonly RoadEdge[];
  junctions: readonly Junction[];
  slabs: ReadonlyMap<ChunkKey, number[]>;
  hoods: ReadonlyMap<ChunkKey, number[]>;
  ped: PedProduct;
  tags: ReadonlyMap<ChunkKey, ChunkTags>;
  /** Street-lamp records per chunk, x, z, yaw triples (S9, M02b2). */
  lamps?: ReadonlyMap<ChunkKey, readonly number[]>;
  portals: readonly Portal[];
  spawn: ReadonlyMap<ChunkKey, SpawnTable>;
  places: PlacesProduct;
  lod: readonly LodFile[];
  /** Extra files named under packs/ (far-bay-*). */
  far: readonly { name: string; bytes: Uint8Array }[];
}

const q1 = (v: number): number => Math.round(v * 10) / 10;

export function graphBytes(bakeId: string, nodes: readonly NodeB[], edges: readonly RoadEdge[], segs: readonly SegB[]): Uint8Array {
  return encodeGraph({
    bakeId,
    nodes: nodes.map((n) => ({ x: n.x, z: n.z, y: n.y, layer: n.layer, control: n.control })),
    edges: edges.map((e) => ({
      from: e.from, to: e.to, lengthM: (segs[e.seg] as SegB).lengthM, cls: e.cls, lanes: e.lanes, flags: e.flags, dir: e.dir, layer: e.layer, speedMps: e.speedMps,
    })),
  });
}

export function buildPacks(inp: PackInputs): PackOutput {
  const { bakeId, grid, water, terrain, buildings } = inp;
  const ground = groundRaster(grid, water, inp.segs);
  const keys = [...terrain.grids.keys()].sort((a, b) => {
    const pa = parseChunkKey(a)!, pb = parseChunkKey(b)!;
    return pa.y - pb.y || pa.x - pb.x;
  });
  const keySet = new Set(keys);

  // trees by chunk, only on land and off the asphalt
  const treesBy = new Map<ChunkKey, number[]>();
  for (let i = 0; i + 3 < water.trees.length; i += 4) {
    const x = q1(water.trees[i] as number), z = q1(water.trees[i + 1] as number);
    const g = ground.at(x, z, GroundClass.Water);
    if (g === GroundClass.Water || g === GroundClass.WaterShallow || g === GroundClass.Pier || g === GroundClass.Asphalt) continue;
    const key = chunkKeyAt(9, x, z);
    if (!terrain.grids.has(key)) continue;
    (treesBy.get(key) ?? treesBy.set(key, []).get(key)!).push(x, z, water.trees[i + 2] as number, water.trees[i + 3] as number);
  }

  // road data by owning chunk
  const segsBy = new Map<ChunkKey, RoadSegment[]>();
  const nodesBy = new Map<ChunkKey, RoadNode[]>();
  const edgesBy = new Map<ChunkKey, RoadEdge[]>();
  const junctionsBy = new Map<ChunkKey, Junction[]>();
  const push = <T>(m: Map<ChunkKey, T[]>, k: ChunkKey, v: T): void => { (m.get(k) ?? m.set(k, []).get(k)!).push(v); };
  const orphans: string[] = [];
  const own = (k: ChunkKey, what: string): ChunkKey | null => { if (keySet.has(k)) return k; orphans.push(`${what} in ${k}`); return null; };
  for (const n of inp.nodes) {
    const k = own(chunkKeyAt(9, n.x, n.z), `node ${n.id}`);
    if (k) push(nodesBy, k, { id: n.id, x: n.x, y: n.y, z: n.z, layer: n.layer, control: n.control, junction: n.junction });
  }
  for (const e of inp.edges) {
    const f = inp.nodes[e.from] as NodeB;
    const k = own(chunkKeyAt(9, f.x, f.z), `edge ${e.id}`);
    if (k) push(edgesBy, k, e);
  }
  for (const s of inp.segs) {
    const eid = Math.min(s.eF >= 0 ? s.eF : Infinity, s.eB >= 0 ? s.eB : Infinity);
    const e = inp.edges[eid] as RoadEdge;
    const f = inp.nodes[e.from] as NodeB;
    const k = own(chunkKeyAt(9, f.x, f.z), `segment ${s.id}`);
    if (!k) continue;
    const pts = new Float32Array((s.pts.length / 2) * 3);
    for (let i = 0; i < s.pts.length / 2; i++) { pts[i * 3] = s.pts[i * 2] as number; pts[i * 3 + 1] = s.ys[i] as number; pts[i * 3 + 2] = s.pts[i * 2 + 1] as number; }
    push(segsBy, k, { id: s.id, pts, lengthM: s.lengthM, widthM: s.widthM, osmWay: s.osmWay, cnn: s.cnn });
  }
  for (const j of inp.junctions) {
    const k = own(chunkKeyAt(9, j.x, j.z), `junction ${j.id}`);
    if (k) push(junctionsBy, k, j);
  }
  if (orphans.length > 0) throw new Error(`S13: ${orphans.length} road records lie in chunks without terrain (first: ${orphans.slice(0, 5).join('; ')}); the area terrain must cover every road`);
  for (const m of [segsBy, nodesBy, edgesBy, junctionsBy]) for (const l of m.values()) (l as { id: number }[]).sort((a, b) => a.id - b.id);

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
      recs.push({ baseDm: bd.baseDm, heightDm: bd.heightDm, kind: bd.kind, roof: bd.roof, palette: bd.palette, seed: bd.seed, proxyOf: inp.places.proxies.get(bd.sid) ?? 0, ring: bd.ringDm });
    }
    const ped = inp.ped.chunks.get(key);
    const tg = inp.tags.get(key);
    const tp = inp.places.teleportNodes.get(key) ?? [];
    const tags: ChunkTags = tg ? { ...tg } : { hidingSpots: [], pursuitBreakers: [], chokePoints: [], jumpZones: [], portals: [], shoreNodes: [] };
    // landmark and transit nodes first, then the XR comfort nodes, at most 24
    tags.teleportNodes = [...[...tp].sort((a, c2) => cmp(a.id, c2.id)), ...(tags.teleportNodes ?? [])].slice(0, 24);
    sims.set(key, {
      key, bakeId, height, prisms: Float32Array.from(prisms), slabs: Float32Array.from(inp.slabs.get(key) ?? []), hoods: Float32Array.from(inp.hoods.get(key) ?? []),
      segments: segsBy.get(key) ?? [], edges: edgesBy.get(key) ?? [], nodes: nodesBy.get(key) ?? [], junctions: junctionsBy.get(key) ?? [],
      pedNodes: (ped?.nodes ?? []) as PedNode[], pedEdges: (ped?.edges ?? []) as PedEdge[], tags,
      spawn: inp.spawn.get(key) ?? { cellKey: key, densityProfile: 0, trafficSlots: 0, pedSlots: 0, parked: [] },
      ground: g,
    });
    renders.set(key, {
      key, z: 9, bakeId, height, ground: g, buildings: recs, trees: Float32Array.from(treesBy.get(key) ?? []),
      lamps: Float32Array.from(inp.lamps?.get(key) ?? []), furniture: new Float32Array(0), landmarks: inp.places.lmrefs.get(key) ?? [],
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
  for (const f of inp.lod) files.push({ name: f.name, family: f.family, x: f.x, y: f.y, chunks: f.units, bytes: f.bytes });
  for (const f of inp.far) files.push({ name: f.name, family: 'far', x: 0, y: 0, chunks: 1, bytes: f.bytes });

  const bounds = loadBounds();
  const lodTiles = (fam: 'l1' | 'l2'): string[] => inp.lod.filter((f) => f.family === fam).map((f) => `${f.x}-${f.y}`).sort((a, b) => {
    const [ax, ay] = a.split('-').map(Number) as [number, number];
    const [bx, by] = b.split('-').map(Number) as [number, number];
    return ax - bx || ay - by;
  });
  const index: WorldIndex = {
    schema: 'world-index/1',
    c08: C08_VERSION,
    bakeId,
    worldSeed: Number.parseInt(bakeId.slice(0, 8), 16) >>> 0,
    areas: [
      { id: 'sf', status: 'playable', bboxEnu: { minX: grid.minX, minZ: grid.minZ, maxX: grid.maxX, maxZ: grid.maxZ }, unlock: null },
      { id: 'bay-backdrop', status: 'backdrop', bboxEnu: { minX: bounds.far.minX, minZ: bounds.far.minZ, maxX: bounds.far.maxX, maxZ: bounds.far.maxZ }, unlock: null },
    ],
    tiles: { p0: tileIds, l0: tileIds, l1: lodTiles('l1'), l2: lodTiles('l2') },
    landmarks: inp.places.landmarks,
    pois: inp.places.pois,
    districts: inp.places.districts,
    portals: [...inp.portals],
    transit: inp.places.transit,
    sources: [...inp.stamps].sort((a, b) => cmp(a.id, b.id)),
  };
  return { files, index, sims, renders };
}
