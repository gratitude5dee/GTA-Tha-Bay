// packages/shared/src/world/c08.ts — C08 v1.0.0 (S02). Types, constants and pure functions only (C02 lint applies).
// Builder edits (M01f, see spec/11 Builder decisions): `2 ** (p.z - z)` is `1 << (p.z - z)` in ancestorKey (C02 bans `**`;
// same value for 0-6); import paths carry the `.ts` extension. No shape change.
import type { AssetRef } from '../assets/c07.ts';
import type { QualityTierId } from '../platform/c13.ts';

export const C08_VERSION = '1.0.0' as const;

// ---- 1. Frame and grid ------------------------------------------------------------------
export const ORIGIN = { lat: 37.7793, lng: -122.4193 } as const;     // SF City Hall = ENU (0,0,0)
export const M_PER_DEG_LAT = 110992.06, M_PER_DEG_LNG = 88083.39;   // [research/repos-world.md §1.1]
export const enuFromLatLng = (lat: number, lng: number) =>
  ({ x: (lng - ORIGIN.lng) * M_PER_DEG_LNG, z: -(lat - ORIGIN.lat) * M_PER_DEG_LAT });
export const latLngFromEnu = (x: number, z: number) =>
  ({ lat: ORIGIN.lat - z / M_PER_DEG_LAT, lng: ORIGIN.lng + x / M_PER_DEG_LNG });

export const GRID_MIN_M = -65664;            // NW corner of the root square, both axes (City Hall is the centre of chunk 9/256/256)
export const GRID_EDGE_M = 131072;           // root square edge = 2^17 m
export type ChunkZ = 9 | 7 | 5 | 3;         // 256 m chunk · 1,024 m tile · 4,096 m block · 16,384 m region
export const CHUNK_EDGE_M = { 9: 256, 7: 1024, 5: 4096, 3: 16384 } as const;
export const TERRAIN_POSTS = 65 as const;    // every level: 64 cells, shared edge posts → cell 4 / 16 / 64 / 256 m
export type ChunkKey = `${ChunkZ}/${number}/${number}`;   // "z/x/y", x east, y south; no ':' (ambient cell keys, C01)
export interface ChunkBounds { minX: number; minZ: number; maxX: number; maxZ: number }
export type PackFamily = 'p0' | 'l0' | 'l1' | 'l2';       // sim data z9 · render z9 · render z7 · render z5

export function chunkKeyAt(z: ChunkZ, x: number, zEnu: number): ChunkKey {
  const e = CHUNK_EDGE_M[z];
  return `${z}/${Math.floor((x - GRID_MIN_M) / e)}/${Math.floor((zEnu - GRID_MIN_M) / e)}`;
}
/** Pure: the z=9 chunk key of an authored or anchor position (C17 anchors, route 37, CLI and server anchor checks; DL-079). */
export const chunkKeyOf = (lat: number, lng: number): ChunkKey => { const p = enuFromLatLng(lat, lng); return chunkKeyAt(9, p.x, p.z); };
export function parseChunkKey(k: string): { z: ChunkZ; x: number; y: number } | null {
  const m = /^(9|7|5|3)\/(\d{1,3})\/(\d{1,3})$/.exec(k);
  return m ? { z: Number(m[1]) as ChunkZ, x: Number(m[2]), y: Number(m[3]) } : null;
}
export function chunkBounds(k: ChunkKey): ChunkBounds {
  const p = parseChunkKey(k)!, e = CHUNK_EDGE_M[p.z];
  return { minX: GRID_MIN_M + p.x * e, minZ: GRID_MIN_M + p.y * e, maxX: GRID_MIN_M + (p.x + 1) * e, maxZ: GRID_MIN_M + (p.y + 1) * e };
}
export function ancestorKey(k: ChunkKey, z: ChunkZ): ChunkKey {          // z must be coarser than k
  const p = parseChunkKey(k)!, f = 1 << (p.z - z);
  return `${z}/${Math.floor(p.x / f)}/${Math.floor(p.y / f)}`;
}
/** Pack AssetRef for a chunk: p0/l0 live under the z7 tile of a z9 chunk, l1 under the z5 block of a z7 chunk, l2 under the z3 region of a z5 chunk. */
export function packRefOf(k: ChunkKey, family: PackFamily): AssetRef {
  const host = family === 'l1' ? 5 : family === 'l2' ? 3 : 7;
  const a = parseChunkKey(ancestorKey(k, host as ChunkZ))!;
  return `world_pack/${family}-${a.x}-${a.y}` as AssetRef;               // AssetId ^[a-z0-9][a-z0-9._-]{1,62}$
}

// ---- 2. Static collision and terrain ------------------------------------------------------
export interface HeightGrid {                  // 65 × 65 posts; row-major, z outer; metres × 10; identical in every tier variant
  originX: number; originZ: number; cellM: number; dm: Int16Array;
}
/** Packed prisms for C01 StaticShapeSet.prisms: repeat [nVerts, baseY, heightM, x0, z0, … x(n-1), z(n-1)] (Float32, ENU m, CCW). */
export type PrismPack = Float32Array;

// ---- 3. Road graph ---------------------------------------------------------------------
export type EdgeId = number; export type NodeId = number; export type SegId = number;   // u32, global per bake
export const enum RoadClass { Freeway = 0, Ramp = 1, Arterial = 2, Collector = 3, Local = 4, Service = 5 }
export const enum EdgeFlag { OneWay = 1, Bridge = 2, Tunnel = 4, Divided = 8, NoParking = 16, Hill = 32, TramEmbedded = 64, BusLane = 128 }
export interface RoadSegment {                 // geometry shared by the two directed edges of a street
  id: SegId; pts: Float32Array;                // x,y,z triples (ENU), centreline, ≤ 20 m spacing
  lengthM: number; widthM: number;             // carriageway incl. parking lanes
  osmWay: number; cnn: number;                 // provenance for authoring tools (cnn 0 = unmatched)
}
export interface RoadEdge {
  id: EdgeId; seg: SegId; dir: 1 | -1; from: NodeId; to: NodeId; twin: EdgeId | -1;
  cls: RoadClass; lanes: number; laneWidthM: number; speedMps: number; flags: number; layer: number /* i8 */;
  medianM: number; parkingSides: 0 | 1 | 2; maxGradePct: number; nhood: number /* 0..40, 255 none */;
}
export const enum NodeControl { None = 0, Signal = 1, AllWayStop = 2, MinorStop = 3, Yield = 4, DeadEnd = 5, Roundabout = 6 }
export interface RoadNode { id: NodeId; x: number; y: number; z: number; layer: number; control: NodeControl; junction: number /* index into intersections or -1 */ }
export type Turn = 'straight' | 'left' | 'right' | 'uturn';
export interface Movement { id: number; inEdge: EdgeId; outEdge: EdgeId; turn: Turn; lengthM: number; conflicts: number[] }
export type Aspect = 'green' | 'amber' | 'red' | 'dark';
export interface SignalPhase { startTick: number; greenTicks: number; amberTicks: number; clearTicks: number; movements: number[] }
export interface SignalProgram { id: number; cycleTicks: number; offsetTicks: number; phases: SignalPhase[]; pedWalkTicks: number }
export interface Junction { id: number; nodes: NodeId[]; x: number; z: number; control: NodeControl; movements: Movement[]; program: SignalProgram | null; stopApproaches: EdgeId[] }
/** Pure: aspect of one movement. `dark` when blackout. Phase times are in sim ticks (60 Hz). */
export function signalAspect(p: SignalProgram, tick: number, movementId: number, blackout: boolean): Aspect {
  if (blackout) return 'dark';
  const t = (tick + p.offsetTicks) % p.cycleTicks;
  for (const ph of p.phases) {
    if (ph.movements.indexOf(movementId) < 0) continue;
    const u = t - ph.startTick;
    if (u >= 0 && u < ph.greenTicks) return 'green';
    if (u >= ph.greenTicks && u < ph.greenTicks + ph.amberTicks) return 'amber';
  }
  return 'red';
}

// ---- 4. Pedestrian graph ----------------------------------------------------------------
export const enum PedNodeFlag { Crossing = 1, Plaza = 2, Stairs = 4, Park = 8, Transit = 16, Waiting = 32 }
export interface PedNode { id: number; x: number; y: number; z: number; flags: number }
export const enum PedEdgeKind { Sidewalk = 0, Crosswalk = 1, Path = 2, Plaza = 3, Stairs = 4 }
export interface PedEdge { a: number; b: number; kind: PedEdgeKind; widthM: number; junction: number /* -1 none */; movement: number /* crossing parallel to this vehicle movement group, -1 */ }

// ---- 5. Tags (06 §4.4 fixed list) -------------------------------------------------------------
export interface HidingSpot { id: string; x: number; y: number; z: number; radiusM: number; kind: 'viaduct' | 'garage' | 'alley' | 'carwash' | 'tunnel-portal' }
export interface PursuitBreaker { id: string; x: number; y: number; z: number; triggerRadiusM: number; kind: 'scaffold' | 'produce-stand' | 'crane-load' | 'cable-car' | 'billboard'; prefab: string; mission: boolean }
export interface ChokePoint { id: string; x: number; y: number; z: number; edge: EdgeId; widthM: number; kind: 'bridge' | 'tunnel' | 'ramp' | 'narrow' }
export interface JumpZone { id: string; x: number; y: number; z: number; yaw: number; lengthM: number; kind: 'hill-crest' | 'ramp' }
export interface Portal { id: string; x: number; y: number; z: number; yaw: number; widthM: number; kind: 'bridge' | 'county-line' | 'ferry' | 'tunnel'; state: 'closed' | 'open' | 'sealed'; toArea: string | null; edges: EdgeId[] }
export interface ShoreNode { id: string; x: number; y: number; z: number; nx: number; nz: number }
export interface TeleportNode { id: string; x: number; y: number; z: number; yaw: number; kind: 'xr' | 'landmark' | 'transit' | 'safehouse' | 'spawn' }
export interface ChunkTags {
  hidingSpots: HidingSpot[]; pursuitBreakers: PursuitBreaker[]; chokePoints: ChokePoint[]; jumpZones: JumpZone[];
  portals: Portal[]; shoreNodes: ShoreNode[]; teleportNodes?: TeleportNode[];
}

// ---- 6. Spawn tables (C01 rule 5: lower tiers run a prefix of slots) ------------------------------
export const SLOT = { traffic: [0, 255], ped: [256, 511], parked: [512, 767], transit: [768, 831], boat: [832, 863], air: [864, 895] } as const;
export interface ParkedSlot { slot: number; seg: SegId; s: number; side: -1 | 1; yawJitterDm: number }
export interface SpawnTable {
  cellKey: ChunkKey; densityProfile: number;        // index into config/world/density.json profiles
  trafficSlots: number; pedSlots: number; parked: ParkedSlot[];   // counts = capacity at 'desktop-ultra' peak
}
export const ambientKey = (cell: ChunkKey, slot: number) => `amb:${cell}:${slot}` as const;   // C01 StableKey
/** C01 rule 5: a tier may run slots 0 … densityCap − 1. tierFactor comes from C13 CrowdLimits (living part §7). */
export const densityCap = (capacity: number, tierFactor: number): number => Math.min(capacity, Math.floor(capacity * tierFactor));
/** Pure: active prefix length now. hour and weather factors come from config/world/density.json, override from TrafficControl. */
export function activeSlots(capacity: number, tierFactor: number, hourFactor: number, weatherFactor: number, override: number): number {
  return Math.min(densityCap(capacity, tierFactor), Math.floor(capacity * tierFactor * hourFactor * weatherFactor * override));
}

// ---- 7. Chunks ----------------------------------------------------------------------
export interface SimChunk {                   // z9 only; decoded from p0 by packages/shared/src/world/pack-codec.ts (pure)
  key: ChunkKey; bakeId: string; height: HeightGrid; prisms: PrismPack; slabs: PrismPack; hoods: PrismPack;
  segments: RoadSegment[]; edges: RoadEdge[]; nodes: RoadNode[]; junctions: Junction[];
  pedNodes: PedNode[]; pedEdges: PedEdge[]; tags: ChunkTags; spawn: SpawnTable; ground: Uint8Array /* 64×64 GroundClass */;
}
export const enum GroundClass { Grass = 0, Park = 1, Sand = 2, Paved = 3, Dirt = 4, Rock = 5, Asphalt = 6, Sidewalk = 7, Pier = 8, WaterShallow = 9, Water = 10, Rail = 11 }
export const enum BuildingKind { ResLow = 0, ResMid = 1, Commercial = 2, Tower = 3, Industrial = 4, Civic = 5 }
export interface BuildingRecord {             // decoded l0 record; meshed in asset.worker (D-15)
  baseDm: number; heightDm: number; kind: BuildingKind; roof: 0 | 1 | 2 | 3; palette: number; seed: number;
  proxyOf: number;                            // landmark index + 1 when this extrusion is replaced by a glTF, else 0
  ring: Int16Array;                           // x,z pairs, 0.1 m, relative to the chunk NW corner
}
export interface RenderChunk {
  key: ChunkKey; z: ChunkZ; bakeId: string; height: HeightGrid; ground: Uint8Array;
  buildings: BuildingRecord[]; trees: Float32Array /* x,z,scale,species */; lamps: Float32Array /* x,z,yaw */;
  furniture: Float32Array /* x,z,yaw,type */; landmarks: number[];
}
export interface WorldChunk { key: ChunkKey; sim: SimChunk | null; render: RenderChunk | null }

// ---- 8. Index, landmarks, districts, bounds ---------------------------------------------
export type LandmarkId = `lm.${string}`;                      // S03 LandmarkId; AssetRef is `building/lm.<slug>`
export type PoiId = `poi.${string}`;                          // ^poi\.[a-z0-9.-]{3,64}$ ; poi.<nhoodSlug>.<name> (S04)
export type DistrictId = string;                              // ^[a-z0-9-]{2,32}$ : 'd1'…'d10', 'outer', or one of 41 neighbourhood slugs
export interface LandmarkRecord {
  id: LandmarkId; nameKey: string; lat: number; lng: number; x: number; z: number; chunk: ChunkKey; district: DistrictId; nhood: DistrictId;
  cls: 'hero' | 'major' | 'minor'; asset: AssetRef /* building/lm.<slug> */; replaces: string[] /* DataSF sf16_bldgid or OSM ids */;
  swapM: Record<QualityTierId, number>; skyline: boolean; arrival: { x: number; z: number; yaw: number }; roles: string[];
}
export interface PoiRecord {
  id: PoiId; nameKey: string; kind: 'home' | 'work' | 'cafe' | 'bar' | 'shop' | 'park' | 'plaza' | 'transit' | 'landmark' | 'venue' | 'street' | 'hub';
  lat: number; lng: number; x: number; y: number; z: number; chunk: ChunkKey; nhood: DistrictId; district: DistrictId;
  pedNode: number | null; hours: [number, number] | null /* local hours [open, close) */; landmark: LandmarkId | null;
}
export interface DistrictRecord { id: DistrictId; kind: 'district' | 'nhood'; parent: DistrictId | null; nameKey: string; tier: 'A' | 'B' | 'C' | 'stage'; nhoods: string[]; densityProfile: number }
export interface AreaRecord { id: string; status: 'playable' | 'backdrop'; bboxEnu: ChunkBounds; unlock: string | null }
export interface WorldIndex {
  schema: 'world-index/1'; c08: typeof C08_VERSION; bakeId: string; worldSeed: number;
  areas: AreaRecord[]; tiles: { p0: string[]; l0: string[]; l1: string[]; l2: string[] };   // existing pack tile coordinates "x-y"
  landmarks: LandmarkRecord[]; pois: PoiRecord[]; districts: DistrictRecord[]; portals: Portal[]; transit: TransitNode[]; sources: SourceStamp[];
}
export interface SourceStamp { id: string; url: string; retrievedAt: string /* ISO, repo-audited file */; sha256: string; licence: string; attribution: string }
export interface TransitNode { id: string; kind: 'bay-rail' | 'city-metro' | 'cable-car' | 'ferry' | 'rail-terminus'; x: number; z: number; nameKey: string; fastTravel: boolean }
export interface WorldBounds {                // config/world.bounds.json (read by C11 pose validation, S09)
  schema: 'world-bounds/1'; origin: typeof ORIGIN; mPerDegLat: number; mPerDegLng: number;
  play: ChunkBounds & { minY: number; maxY: number }; stream: ChunkBounds; far: ChunkBounds; gridMinM: number; gridEdgeM: number;
}
