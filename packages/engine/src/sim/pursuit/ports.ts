/**
 * The ports of the pursuit director (M03c). The director is pure logic over four ports, so the engine suites run it on fakes and
 * the bake-backed suites of `@dv/world` run it on the real ECS, Rapier and road graph (DL-692):
 *
 *  - `PursuitWorld`: the road graph and the chunk tags (hiding spots, choke points) and the portals. Built from the C08 `WorldApi`
 *    the world module registers on `services.world` (`pursuitWorldFromApi`); the engine never imports `@dv/world`.
 *  - `PursuitHost`: the bodies. The player, the police units, props, line of sight, tires. `EcsPursuitHost` is the real one.
 *  - `WalletPort`: the player's cash. M04a2 binds `EconomyApi`; until then an in-memory wallet (`MemoryWallet`).
 *  - `VehicleDamagePort`: tire health of any vehicle (the spikes). `EcsPursuitHost` writes the `VehicleDamage` component.
 *
 * Positions are ENU metres, `[x, y, z]`; yaw is about +Y and 0 faces -Z (the vehicle prefab convention: forward is `(-sin yaw, -cos yaw)`).
 * Sim code under the C02 lint.
 */
import type { EdgeId, HidingSpot, ChokePoint, Portal, StableKey } from '@dv/shared';
import type { SimEvent } from '../events.ts';

export type Vec3 = [number, number, number];

/** What the director needs to know of the local player each tick. */
export interface PlayerView {
  pos: Vec3;
  /** World velocity, m/s. */
  vel: Vec3;
  /** Horizontal speed, m/s. */
  speed: number;
  /** Heading, radians about +Y (the vehicle's while driving, the body's on foot). */
  yaw: number;
  onFoot: boolean;
  /** StableKey of the vehicle the player drives (or last drove); null on foot with none. */
  vehicleKey: string | null;
  /** On foot and held by an officer (the grapple bust). */
  grappled: boolean;
  /** M07a2: top speed of the car the player drives, m/s (the race rules cap police units at a share of it); absent on foot. */
  topMps?: number;
}

export type UnitRole = 'cruiser' | 'suv' | 'heli' | 'named';

/** A police unit as the tactics see it. */
export interface UnitView {
  /** The id the host gave at spawn (an entity handle); stable for the unit's life. */
  id: number;
  role: UnitRole;
  pos: Vec3;
  yaw: number;
  /** Signed forward speed, m/s. */
  speed: number;
  vel: Vec3;
  /** False until the entity exists in the ECS (spawn commands apply at the start of the next tick). */
  ready: boolean;
  /** The tire health of the four wheels, 0..1. */
  tires: [number, number, number, number];
}

/** A vehicle the strips and the bust rule look at. */
export interface VehicleView {
  id: number;
  key: string;
  pos: Vec3;
  yaw: number;
  speed: number;
  police: boolean;
}

/** The input a unit's driver gives: throttle and brake 0..1, steer -1..1 (positive to the right). */
export interface DriveInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
}

export interface PursuitHost {
  player(): PlayerView | null;
  /** Spawns a unit; returns its id, or 0 when it could not be placed. */
  spawnUnit(prefab: string, role: UnitRole, pos: Vec3, yaw: number, key: StableKey): number;
  despawnUnit(id: number): void;
  unit(id: number): UnitView | null;
  /** Gives a ground unit its input for the coming tick. */
  drive(id: number, input: DriveInput): void;
  /** Moves the helicopter (kinematic) to the pose. */
  fly(id: number, pos: Vec3, yaw: number): void;
  /** Static-collider line of sight between two points. */
  los(a: Vec3, b: Vec3): boolean;
  /** Static ground below `pos` (within 60 m): false where no collider is loaded, so a body placed there would fall. */
  solid(pos: Vec3): boolean;
  /** Ground height at (x, z), or null when the ground is not loaded. */
  groundY(x: number, z: number): number | null;
  /** Places a prop (a barrier, a strip); returns its id, or 0. */
  placeProp(prefab: string, pos: Vec3, yaw: number, key: StableKey): number;
  removeProp(id: number): void;
  /** Vehicles within `r` metres of (x, z), ascending id. */
  vehiclesNear(x: number, z: number, r: number): VehicleView[];
  /** Impound mark on a vehicle (3 strikes): the host takes it off the street. */
  impound(vehicleKey: string): void;
  emit(e: SimEvent): void;
}

export interface VehicleDamagePort {
  /** Sets tire `tire` (0..3) of the vehicle with `vehicleKey` or entity id `id` to `health` (0..1). */
  setTireHealth(vehicleId: number, tire: 0 | 1 | 2 | 3, health: number): void;
}

export interface WalletPort {
  cash(): number;
  /** Debits `cents`; false when the wallet cannot pay (the fine is then taken down to what it holds by the director). */
  debit(cents: number, reason: string, idemKey: string): boolean;
}

/** An in-memory wallet until M04a2 binds `EconomyApi`. */
export class MemoryWallet implements WalletPort {
  readonly log: { cents: number; reason: string; idemKey: string }[] = [];
  constructor(public balance = 0) {}
  cash(): number {
    return this.balance;
  }
  debit(cents: number, reason: string, idemKey: string): boolean {
    if (this.log.some((l) => l.idemKey === idemKey)) return true;
    if (cents > this.balance) return false;
    this.balance -= cents;
    this.log.push({ cents, reason, idemKey });
    return true;
  }
}

/** A point on a lane with its heading. */
export interface LanePoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface RoadHit {
  edge: EdgeId;
  s: number;
  distM: number;
}

export interface RoutePath {
  edges: EdgeId[];
  lengthM: number;
  complete: boolean;
}

export interface PursuitWorld {
  nearestRoad(x: number, z: number, maxM: number): RoadHit | null;
  /** A* over the road graph between two points, or null. */
  route(from: { x: number; z: number }, to: { x: number; z: number }): RoutePath | null;
  /** The centre of lane 0 of `edge` at `s` metres; null when the edge has no geometry in memory. */
  lanePoint(edge: EdgeId, s: number): LanePoint | null;
  /** Length of the edge in metres, 0 when unknown. */
  edgeLength(edge: EdgeId): number;
  /** The road class width hint: lanes * lane width, metres. */
  edgeWidth(edge: EdgeId): number;
  hidingSpotAt(x: number, z: number): HidingSpot | null;
  chokePointsNear(x: number, z: number, r: number): ChokePoint[];
  portals(): readonly Portal[];
  setPortalState(id: string, state: Portal['state'], by: string): boolean;
  releasePortals(by: string): void;
  sealedPortals(): readonly string[];
}

/** The chunk tags the world module provides (the engine hub carries it, `WorldHub.tags`). */
export interface WorldTagsPort {
  hidingSpotAt(x: number, z: number): HidingSpot | null;
  chokePointsNear(x: number, z: number, r: number): ChokePoint[];
}
