// Builder edit (M01f): the inline `import('./c08').RoadEdge` type became a named type import (lint rule consistent-type-imports).
// packages/shared/src/world/c08-api.ts — service interfaces implemented in packages/world (sim half) and exposed as ModeContext.world (C06 1.1).
import type { ChunkKey, EdgeId, NodeId, Aspect, LandmarkId, LandmarkRecord, PoiId, PoiRecord, RoadEdge } from './c08.ts';

export interface EdgePos { edge: EdgeId; s: number /* m along the directed edge */; lane: number }
export interface RouteRequest { from: EdgePos | { x: number; z: number }; to: EdgePos | { x: number; z: number };
  maxExpand: number; avoid?: ReadonlySet<EdgeId>; classMask?: number; allowWrongWay?: boolean; useTopology?: boolean }
export interface Route { edges: EdgeId[]; lengthM: number; etaS: number; complete: boolean }
export interface RoadGraphQuery {
  edge(id: EdgeId): Readonly<RoadEdge> | null;           // null when its chunk is not resident
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
  landmark(id: LandmarkId): { enu: [number, number, number]; chunkKey: ChunkKey } | null;
  snap(p: SnapRequest): { pos: [number, number, number]; yaw: number; distM: number } | null;   // null when > 25 m from a valid target
  route(via: LatLng[]): number[] | null;                                  // edge ids, A* between consecutive points
}
export interface WorldApi { readonly graph: RoadGraphQuery; readonly traffic: TrafficControl; readonly map: MapApi; readonly teleport: TeleportApi; readonly query: WorldQuery; readonly places: PlaceIndex; readonly resolver: WorldResolver }
