# 02 — World & Map, part 2: C08 contract (`WorldChunk` + `RoadGraph` + spawn tables)

> S02, Wave 2, 2026-10-18. Part of `spec/domains/02-world.md` (scope, design, runtime, platforms, facts, milestones, tests). Bake pipeline, landmarks and districts: `02-world-bake.md`. Road-graph semantics, traffic, pedestrians, transit, weather: `02-world-living.md`. Maps, teleports, attribution, expansion: `02-world-maps.md`. Binding inputs: `prompt-pack/06-SHARED-CONTEXT.md` v1.0 §4.3–4.4 (frozen; every *(fixed)* line is honored), `spec/.waves234-notes.md` item 9, DL-049. **C08 is finalized here at v1.0.0.** Consumers: S01 (statics, pursuit, clock), S03 (`WorldResolver`, zones), S04 (POIs, ped routes), S06 (edges, tags, closures), S09 (`world.bounds.json`), S10 (map views), S11 (packs, budgets), S12 (anchors, map markers, `world.find_place`).

## 1. Rules

1. **Frame.** ENU metres from SF City Hall (37.7793 N, −122.4193 W), +X east, +Y up, −Z north. Flat-earth constants 110,992.06 m/° latitude and 88,083.39 m/° longitude [research/repos-world.md §1.1]. f64 in sim, f32 on the C11 wire. lat/lng appear only in authored data, C17 anchors and tools.
2. **Grid.** One quadtree over the square `[−65,664, +65,408)` m on both axes (edge 2^17 m), offset so City Hall is the centre of chunk `9/256/256`. Four levels are used: `z=9` chunk 256 m, `z=7` tile 1,024 m, `z=5` block 4,096 m, `z=3` region 16,384 m. `x` counts east, `y` counts south. Every level carries 65 × 65 terrain posts (64 cells: 4, 16, 64, 256 m). The grid covers ±65 km, enough for San Jose (ENU +46.9 km, +49.0 km) in M15+.
3. **Keys.** `ChunkKey` is `"z/x/y"` and matches `^(9|7|5|3)/\d{1,3}/\d{1,3}$`. C16 and C12 route 37 carry only `z=9` keys. Ambient cell keys are `z=9` keys, so `amb:9/256/256:12` has no `:` inside the cell part.
4. **Packs.** World data ships as C07 assets of kind `world_pack`, each ≤ 4 MiB, variant `default` only (no tier variants), AssetId `<family>-<x>-<y>` where `x,y` are the host-level indices: `p0` (sim data) and `l0` (render data) at the `z=7` tile of their 16 chunks, `l1` at the `z=5` block, `l2` at the `z=3` region. Examples: `world_pack/p0-64-64`, `world_pack/l1-16-16`. Backdrop packs are named `far-bay-*` (§4.3 of the maps part).
5. **Tier independence of the sim.** `p0` bytes are identical for every tier: the heightfield, prisms, slabs, hoods, graphs, tags and spawn tables decide physics and AI, so the `canonical` profile (C02) is reproducible on every device. Tier differences live in `l0`/`l1`/`l2` mesher profiles and in C13 budgets, never in `p0`.
6. **Heightfield.** One 65 × 65 `Int16` grid (0.1 m units, 4 m posts at `z=9`) per chunk, shared by physics and render; adjacent chunks duplicate their edge posts exactly. Render meshes use every 1st, 2nd or 4th post (desktop, mobile, mobile-low) so vertices lie on the physics surface. Roads are graded into the grid at bake, so a lane surface is the physics surface.
7. **Static collision.** `StaticShapeSet` (C01 service) = the heightfield + `prisms` (buildings, ≤ 1.0 m ring simplification) + `slabs` (bridge, viaduct and overpass decks, ≤ 4 m long, 1.0 m thick, flat-topped steps ≤ 0.16 m) + `hoods` (tunnel covers over carved corridors). Slabs and hoods use the prism format. Proposal P2 replaces slab steps with sloped strips.
8. **Edge ids.** `EdgeId`, `NodeId`, `SegId` are u32, global for one bake, assigned in Morton order of the owning chunk then by local index. They are stable only per `bakeId`. Authors store lat/lng and call `resolve`/`WorldResolver`; C09 and S06 compile ids per bake and re-resolve on mismatch (S03 R-DSL-12, S06 5 % length rule).
9. **Edge ownership.** An edge belongs to the chunk that contains its `from` node. Its segment geometry is stored once, with the lower-id direction. Cross-chunk edges are visible once both chunks are resident; the always-resident topology asset `map_data/sf-graph.v1` (nodes, edges, lengths, classes, flags, no geometry) serves long routes.
10. **Lanes.** Right-hand traffic. Lane 0 is the rightmost lane of a directed edge. Lateral offset from the segment centreline, positive to the travel direction's right: two-way `medianM/2 + (lane + 0.5) × laneWidthM`; one-way `(lane + 0.5 − lanes/2) × laneWidthM`. Parked cars sit at `widthM/2 − 1.15 m` on `parkingSides` (2.3 m parking lane assumed).
11. **Signals** are pure: `signalAspect(program, tick, movement, blackout)`. No per-signal state is hashed; `blackout` is a hashed sim resource owned by `TrafficControl`.
12. **Render objects.** Per chunk at most six: `terrain`, `buildings`, `roads`, `vegetation` (one instanced mesh), `furniture` (one batch), `extras` (set dressing from tags). One `BundleGroup`, `static = true`; re-recorded only on a LOD swap or a landmark proxy swap. Landmark glTFs are not chunk objects: they live in a separate `LandmarkLayer` with their own budget (clarification P3).
13. **Upload.** At most one chunk upload per frame on every tier; on `mobile-low` and `xr-quest` at most 2 MB per frame (C13 `WorldLimits`). A chunk is uploaded whole.
14. **Spawn tables.** Keyed by `(cellKey, slot)`. Slot ranges are fixed: traffic 0–255, pedestrians 256–511, parked cars 512–767, transit vehicles 768–831, boats 832–863, aircraft 864–895. A tier runs the prefix `0 … activeSlots − 1` of each range (C01 rule 5). `capacity` in the table is the `desktop-ultra` peak.
15. **Tags** follow 06 §4.4: `hidingSpots`, `pursuitBreakers`, `chokePoints`, `jumpZones`, `portals`, `shoreNodes`, `teleportNodes`. The bake derives most of them from data; authored lists add the rest (`02-world-bake.md` §7).
16. **`worldBake`.** C05 `worldBake` equals `WorldIndex.bakeId`: the 64-hex SHA-256 of canonical JSON of `{sourceHashes, toolVersion, configHashes}`. A save from another bake snaps to the nearest safehouse (DL-057).
17. **Purity.** `packages/shared/src/world/**` and `packages/world/src/sim/**` obey the C02 lint: no `Math.random`, `Date`, transcendental `Math.*`, `three`, DOM. Trigonometry uses `detmath`.
18. **Pack decode.** `decodeP0(buf: ArrayBuffer): SimChunk[]` is pure and synchronous (`packages/shared/src/world/pack-codec.ts`, with the encoder in `tools/map`), so the sim worker, the headless host and tests use one codec. `l0` decoding and meshing run in `asset.worker`.
19. **Ids.** Landmarks `lm.<slug>` (AssetRef `building/lm.<slug>`), POIs `poi.<nhoodSlug>.<name>`, districts `d1…d10`, `outer`, `stage`, and 41 neighbourhood slugs (lower-case, `/` and spaces to `-`; `Financial District/South Beach` → `financial-district-south-beach`). All match `^[a-z0-9.-]{2,64}$`.
20. **Limits.** A chunk holds ≤ 1,500 buildings, ≤ 600 road edges, ≤ 1,500 ped edges, ≤ 24 tag records per type. The bake fails otherwise and splits nothing: the limits are gates.

## 2. C08 TypeScript

```ts
// packages/shared/src/world/c08.ts — C08 v1.0.0 (S02). Types, constants and pure functions only (C02 lint applies).
import type { AssetRef } from '../assets/c07';
import type { QualityTierId } from '../platform/c13';

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
export function parseChunkKey(k: string): { z: ChunkZ; x: number; y: number } | null {
  const m = /^(9|7|5|3)\/(\d{1,3})\/(\d{1,3})$/.exec(k);
  return m ? { z: Number(m[1]) as ChunkZ, x: Number(m[2]), y: Number(m[3]) } : null;
}
export function chunkBounds(k: ChunkKey): ChunkBounds {
  const p = parseChunkKey(k)!, e = CHUNK_EDGE_M[p.z];
  return { minX: GRID_MIN_M + p.x * e, minZ: GRID_MIN_M + p.y * e, maxX: GRID_MIN_M + (p.x + 1) * e, maxZ: GRID_MIN_M + (p.y + 1) * e };
}
export function ancestorKey(k: ChunkKey, z: ChunkZ): ChunkKey {          // z must be coarser than k
  const p = parseChunkKey(k)!, f = 2 ** (p.z - z);
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
/** Pure: active prefix length. Every factor is resolved by the caller from config/world/density.json and C13 CrowdLimits. */
export function activeSlots(capacity: number, tierFactor: number, hourFactor: number, weatherFactor: number, override: number): number {
  return Math.min(capacity, Math.floor(capacity * tierFactor * hourFactor * weatherFactor * override));
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
```

## 3. Service interfaces (`packages/shared/src/world/c08-api.ts`)

Implemented in `packages/world` (sim half in `src/sim/**`, client half in `src/client/**`). They reach modes as `ModeContext.world` under proposal P1; until C06 is bumped, `packages/engine/src/sim/world/` exposes the same object to S01-owned code (pursuit A*, clock) and to tests.

```ts
// packages/shared/src/world/c08-api.ts — service interfaces implemented in packages/world (sim half) and exposed as ModeContext.world (proposal P1).
import type { ChunkKey, EdgeId, NodeId, Aspect, LandmarkId, LandmarkRecord, PoiId, PoiRecord } from './c08';

export interface EdgePos { edge: EdgeId; s: number /* m along the directed edge */; lane: number }
export interface RouteRequest { from: EdgePos | { x: number; z: number }; to: EdgePos | { x: number; z: number };
  maxExpand: number; avoid?: ReadonlySet<EdgeId>; classMask?: number; allowWrongWay?: boolean; useTopology?: boolean }
export interface Route { edges: EdgeId[]; lengthM: number; etaS: number; complete: boolean }
export interface RoadGraphQuery {
  edge(id: EdgeId): Readonly<import('./c08').RoadEdge> | null;           // null when its chunk is not resident
  nearestEdge(x: number, z: number, y: number | undefined, maxM: number, classMask?: number): { edge: EdgeId; s: number; distM: number } | null;
  laneCentre(e: EdgePos, out: Float64Array): void;                       // x,y,z,yaw
  route(r: RouteRequest): Route | null;                                  // A*, binary heap, ties by edge id; lane-level inside resident chunks, topology graph beyond
  resolve(lat: number, lng: number): { edge: EdgeId; s: number } | null; // authoring tools and mission setup
  signal(node: NodeId, movement: number): Aspect;
  neighbours(node: NodeId): readonly EdgeId[];
}
export interface TrafficControl {
  setBlackout(on: boolean, by: string): void;                            // signals dark, robotaxis hold, lamps off; released by `by`
  setDensity(kind: 'traffic' | 'ped' | 'parked', mult: number, by: string): void;   // 0..1.5, mission or sandbox override
  closeEdges(edges: readonly EdgeId[], by: string): void;                // race closures, barrier props
  release(by: string): void;
  readonly blackout: boolean;
}
export type BlipKind = 'mission' | 'waypoint' | 'route' | 'police' | 'experience' | 'property' | 'shop' | 'transit' | 'landmark' | 'fasttravel' | 'player' | 'friend';
export type BlipShape = 'arrow' | 'diamond' | 'pin' | 'ring' | 'hex' | 'house' | 'bag' | 'dot' | 'star' | 'square' | 'triangle';
export interface MapBlip { id: string; kind: BlipKind; shape: BlipShape; colorToken: string; x: number; z: number; radiusM?: number; labelKey?: string; priority: number; minZoomMPerPx?: number }
export interface MapApi {
  setBlip(b: MapBlip): void; removeBlip(id: string): void; setWaypoint(x: number, z: number): void; clearWaypoint(): void;
  setRoute(to: { x: number; z: number } | null): void;                    // GPS polyline on the drivable graph
  blips(): readonly MapBlip[];
}
export type TeleportKind = 'sandbox' | 'fast-travel' | 'xr-comfort' | 'respawn' | 'debug';
export type TeleportTarget = { x: number; z: number; yaw?: number } | { landmark: string } | { node: string };
export type TeleportResult =
  | { ok: true; x: number; y: number; z: number; yaw: number }
  | { ok: false; reason: 'not-loaded' | 'blocked' | 'water' | 'forbidden-in-mode' | 'heat' | 'out-of-bounds' | 'cooldown'; messageKey: string };
export interface TeleportApi { request(kind: TeleportKind, to: TeleportTarget): Promise<TeleportResult>; candidates(kind: TeleportKind): readonly { id: string; nameKey: string; x: number; z: number }[] }
export interface WorldQuery {
  groundY(x: number, z: number, yHint?: number): number | null;           // heightfield, slabs and hoods; null when not resident
  isWater(x: number, z: number): boolean;
  nhoodAt(x: number, z: number): number;                                  // 0..40, 255 none (district-grid)
  districtAt(x: number, z: number): string | null;
  chunkReady(k: ChunkKey): boolean;
  nearestWalkable(x: number, z: number, maxM: number): { x: number; y: number; z: number } | null;
}
export interface PlaceIndex {
  landmarks(): readonly LandmarkRecord[]; landmark(id: LandmarkId): LandmarkRecord | null;
  poi(id: PoiId): PoiRecord | null; poisNear(x: number, z: number, radiusM: number, kind?: PoiRecord['kind']): readonly PoiRecord[];
  poiPos(id: PoiId): [number, number, number] | null;
  pedRoute(a: PoiId, b: PoiId): [number, number, number][];             // decimated commute polyline (≤ 64 points) on the topology graph; S04 whereIs()
  findPlace(text: string, limit: number): Promise<readonly { label: string; x: number; z: number; kind: string }[]>;   // lazy sf-geocode.v1
}
export interface LatLng { lat: number; lng: number }
export interface SnapRequest { at: LatLng | { landmark: LandmarkId }; snap: 'ground' | 'road' | 'sidewalk' | 'none'; y?: number; yawDeg?: number }
/** Load-time resolver used by S03/S06 compilers and tools; structurally what S03 calls WorldResolver (A-C08-1). */
export interface WorldResolver {
  readonly bake: string;
  toEnu(ll: LatLng): [number, number, number];
  landmark(id: LandmarkId): { enu: [number, number, number]; chunkKey: string } | null;
  snap(p: SnapRequest): { pos: [number, number, number]; yaw: number; distM: number } | null;   // null when > 25 m from a valid target
  route(via: LatLng[]): number[] | null;                                  // edge ids, A* between consecutive points
}
export interface WorldApi { readonly graph: RoadGraphQuery; readonly traffic: TrafficControl; readonly map: MapApi; readonly teleport: TeleportApi; readonly query: WorldQuery; readonly places: PlaceIndex; readonly resolver: WorldResolver }
```

## 4. Binary pack format (`DVWP` v1)

Little-endian. Coordinates inside a chunk are `i16` in 0.1 m relative to the chunk NW corner (range ±3,276 m, so a ring may overhang by metres). Heights, bases and heights of prisms are `i16`/`u16` in 0.1 m. Angles are `u8` in 1/256 turn. No timestamps and no random ordering: identical inputs give identical bytes.

**Header (64 B):** `magic u32 = 0x50575644`, `version u8 = 1`, `family u8` (0 p0, 1 l0, 2 l1, 3 l2), `tileX u16`, `tileY u16`, `hostZ u8`, `chunkCount u8`, `bakeId[32]` (raw SHA-256), `dirOffset u32`, 14 B reserved. **Chunk directory:** per chunk `cx u8, cy u8` (0–3 inside the host cell), `sectionCount u16`, `offset u32`. **Section entry:** `id u8, enc u8 (0 raw), count u16, offset u32, bytes u32`.

| Id | Section | Pack | Record layout |
|---|---|---|---|
| 1 | HEIGHT | p0, l1, l2 | `i16[65×65]`, z outer, x inner, 8,450 B |
| 2 | PRISM | p0 | `u8 n, i16 baseDm, u16 hDm, n × (i16 dx, i16 dz)` |
| 3 | SLAB | p0 | PRISM record + `i8 layer` |
| 4 | HOOD | p0 | PRISM record |
| 5 | SEGMENT | p0 | `u32 id, u16 nPts, u16 widthDm, u32 osmLo, u32 osmHi, u32 cnn, nPts × (i16 dx, i16 dz, i16 yDm)` |
| 6 | NODE | p0 | `u32 id, i16 dx, i16 dz, i16 yDm, i8 layer, u8 control, i16 junction` |
| 7 | EDGE | p0 | `u32 id, u32 seg, u32 from, u32 to, i32 twin, u8 cls, u8 lanes, u8 laneW (0.05 m), u8 speed (0.25 m/s), u16 flags, i8 layer, u8 medianDm, u8 parking, i8 gradePct, u8 nhood` (dir in bit 15 of flags) |
| 8 | JUNCTION | p0 | `u16 id, u8 control, u8 nodes, u32[nodes], u8 nMov, movements (u16 id, u32 in, u32 out, u8 turn, u16 lenDm, u8 nConf, u16[nConf]), signal (u16 cycleTicks, u16 offsetTicks, u8 nPhases, phases (u16 start, u16 green, u16 amber, u16 clear, u8 nMov, u16[nMov])), u8 nStop, u32[nStop]` |
| 9 | PED | p0 | `u16 nNodes, nodes (u32 id, i16 dx, i16 dz, i16 yDm, u8 flags), u16 nEdges, edges (u16 a, u16 b, u8 kind, u8 widthDm, i16 junction, i16 movement)` |
| 10 | TAGS | p0 | `u8 type, u8 count, records` (per type: id u16 string-table index, position triple, type fields) |
| 11 | SPAWN | p0 | `u8 profile, u16 trafficSlots, u16 pedSlots, u16 nParked, parked (u16 slot, u32 seg, u16 sDm, i8 side, i8 yawJitter)` |
| 12 | GROUND | p0 | `u8[64×64]` `GroundClass` per 4 m cell |
| 20 | BUILDING | l0 | `i16 baseDm, u16 hDm, u8 kind, u8 roof (2 bits) \| palette (6 bits), u16 seed, u8 proxyOf, u8 n, n × (i16 dx, i16 dz)` |
| 21 | LANDUSE | l0 | polygons: `u8 class, u8 n, n × (i16, i16)` (park, grass, sand, plaza, rock; water edges) |
| 22 | TREE | l0 | `i16 dx, i16 dz, u8 scale, u8 species` |
| 23 | LAMP | l0 | `i16 dx, i16 dz, u8 yaw` |
| 24 | FURNITURE | l0 | `i16 dx, i16 dz, u8 yaw, u8 type` |
| 25 | LMREF | l0 | `u8 landmarkIndex` per landmark touching the chunk |
| 30 | MASSING | l1, l2 | simplified building rings (DP 3 m at l1, 6 m at l2), same record as BUILDING without proxy |
| 31 | ROADLINE | l1, l2 | `u8 cls, u8 n, n × (i16, i16)` |
| 32 | LANDUSE | l1, l2 | as 21, simplified |

Size gates (bake): any pack > 2.5 MiB warns, > 4 MiB fails. Estimated worst tile (dense downtown) ≈ 1 MB per family (design estimate from the SF repo's ~50 B per building [research/repos-world.md §1.2]; measured in M02a1).

## 5. Files and schemas

`config/world.bounds.json` (committed, regenerated by `map:build`, checked by `check:unit`; read by C11 pose validation and the Worker):

```json
{ "schema": "world-bounds/1",
  "origin": { "lat": 37.7793, "lng": -122.4193 }, "mPerDegLat": 110992.06, "mPerDegLng": 88083.39,
  "play":   { "minX": -9400,  "maxX": 6200,  "minZ": -6300,  "maxZ": 8900, "minY": -80, "maxY": 600 },
  "stream": { "minX": -10500, "maxX": 9500,  "minZ": -11000, "maxZ": 9000 },
  "far":    { "minX": -12500, "maxX": 52000, "minZ": -23500, "maxZ": 53300 },
  "gridMinM": -65664, "gridEdgeM": 131072 }
```
`play` is the SF county box (lat 37.700–37.835, lng −122.525…−122.350, rounded out to 100 m) with a margin for bridge approaches; `stream` is the 20 km SF-repo box where L1/L2 packs exist [research/repos-world.md §1.1]; `far` is the backdrop rectangle (lat 37.30–37.99, lng −122.56…−121.83: the Atlas rectangle [research/repos-world.md §2.1] trimmed in the south to stay inside the grid). M15+ widens `play` by area (`AreaRecord`).

`WorldIndex` (`data/world-index`, JSON, ≤ 300 KB) validates against `tools/map/schemas/world-index.schema.json`. Required properties: `schema`, `c08`, `bakeId`, `worldSeed` (u32 = first 4 bytes of the bakeId), `areas` (one `sf` area with `status: "playable"` in v1; `ea-oakland` … `backdrop`), `tiles` (arrays of `"x-y"` host indices for which a pack exists), `landmarks` (≥ 25 in v1; 37 specified), `pois` (≥ 150), `districts` (10 + `outer` + `stage` + 41 neighbourhoods), `portals`, `transit`, `sources` (one stamp per dataset with URL, retrieval date, SHA-256, licence, attribution). Additional properties are rejected.

Config files (JSON Schema in `tools/map/schemas/`, validated by `check:unit`): `config/world/streaming.json` (ring radii and caps per tier), `density.json` (profiles, hour curves, tier factors), `mesher.json` (profiles per tier), `roadclass.json` (OSM → class, lane width, speed, lanes), `timecyc.json` (§5 of the living part), `transit.json` (fares in integer cents, counts), `sources.json` (dataset ids and URLs). Authored content: `content/world/landmarks.json`, `pois.json`, `districts.json`, `pursuit-breakers.json`, `cablecars.json`, `teleports.json`, `paths/*.json` (perf camera paths).

## 6. Who uses what

| Consumer | Uses | Notes |
|---|---|---|
| S01 | `decodeP0` → `StaticShapeSet`, `RoadGraphQuery.route` (pursuit A*), `TrafficControl.blackout`, tags, `ShoreNode` (swim respawn), clock → `EnvState` | `SimStage.Streaming` requests chunk keys; statics ≤ 1 chunk per tick |
| S03 | `WorldResolver` (A-C08-1), `ZoneShape 'edges'`, `MapApi` blips, `TeleportApi`, landmarks | snap distance > 25 m fails the mission reference |
| S04 | `PlaceIndex.poiPos`, `pedRoute`, `poisNear`, district ids | `content/world/pois.json` replaces `poi.stub.json` |
| S06 | edge attributes, `route`, `closeEdges`, tags, density `override` | event traffic `off|light|normal` = 0 / 0.35 / 1.0 |
| S09 | `config/world.bounds.json` | pose validation |
| S10 | `MinimapView`, `FullMapView`, attribution data | layout and controls are S10's |
| S11 | `WorldPackStore`, `PackRef.kind: 'chunk'`, budgets, `RenderBudgetMeter` | packs read whole |
| S12 | `anchor-mask.v1.bin`, `world.find_place`, `world.describe`, markers | anchors validated server-side |

## 7. Versioning

`C08_VERSION` follows 06 §4.1 rule 2. Additive fields (new tag types, new section ids, new `AreaRecord`s) bump the minor version and old loaders skip unknown sections. A change to the grid, slot ranges, `EdgeId` assignment or section layouts is breaking: major bump, an ADR, and one release in which the loader accepts both pack versions. `DVWP` `version` and `C08_VERSION` change together.
