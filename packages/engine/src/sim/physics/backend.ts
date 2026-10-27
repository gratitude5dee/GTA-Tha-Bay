/**
 * PhysicsBackend: the engine's physics seam (spec/domains/01-engine-contracts.md, "Engine service interfaces").
 * Not a numbered contract; consumed by S02 (statics), S06 (vehicles) and S11. Implemented verbatim. The bodies of
 * `character`, `vehicle`, `castRay` and `castSphere` arrive in M01b1 and M03a1.
 */
export type PhysicsBuild = 'simd-compat' | 'deterministic-compat';
export type BodyKind = 'dynamic' | 'kinematic' | 'fixed';
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface CharMoveOpts { autostepM: number; snapToGroundM: number; maxSlopeDeg: number; slide: boolean }
export interface CharMoveResult { moved: [number, number, number]; grounded: boolean; groundNormalY: number }
export interface StaticShapeSet {
  heightfield?: { nx: number; nz: number; cell: number; heights: Float32Array; at: [number, number, number] };
  /** Packed prisms (C08 PrismPack): repeat [nVerts, baseY, heightM, x0, z0, ... x(n-1), z(n-1)], ENU metres, CCW. */
  prisms: Float32Array;
}
export interface BodyDesc {
  kind: BodyKind;
  shape: 'capsule' | 'box' | 'sphere' | 'convex';
  /** box: half extents [hx, hy, hz]; sphere: [radius]; capsule: [halfHeight, radius]; convex: flat xyz points. */
  dims: number[];
  mass?: number;
  /** ENU position (f64). */
  at: [number, number, number];
  /** Orientation as x, y, z, w. Default: identity. (Builder addition to the spec'd BodyDesc: optional, see the decision log.) */
  rot?: [number, number, number, number];
  /** Rapier interaction groups: membership in the high 16 bits, filter in the low 16 (see groups.ts). */
  groups: number;
  /** Optional collider and body tuning (M03a1; Builder addition, BD-M03a1-02). Defaults: `config/physics.json` friction and restitution, no damping, no CCD. */
  friction?: number;
  restitution?: number;
  linearDamping?: number;
  angularDamping?: number;
  ccd?: boolean;
}
export interface WheelDesc { pos: [number, number, number]; radius: number; restM: number; axle: 'front' | 'rear' }
export interface VehicleDrive { engineForce: number; brake: number; steerRad: number; handbrake: boolean }
/** Floats per wheel in the `PhysicsBackend.vehicle.read` buffer (layout documented on `RapierBackend.vehicle`). */
export const VEHICLE_READ_STRIDE = 11;
/** Suspension and friction settings of a Rapier vehicle controller, per wheel (Rapier scales spring and damper by chassis mass). */
export interface VehicleSuspensionTune {
  stiffness: readonly number[]; compression: readonly number[]; relaxation: readonly number[];
  maxTravelM: number; maxForceN: number; sideFriction: number; frictionSlip: number;
}
export interface RayHit { toi: number; normal: [number, number, number]; collider: number; entity: number /* handle */ }

export interface PhysicsBackend {
  readonly build: PhysicsBuild;
  /** Loads the one wasm build for this session. */
  init(): Promise<void>;
  /** ENU f64 of the physics-local frame. */
  readonly origin: [number, number, number];
  /** Floating origin; called when the followed entity is more than 1,000 m away. */
  rebase(o: [number, number, number]): void;
  /** `substeps` is 2 when any player vehicle goes faster than 100 km/h. */
  step(dt: number, substeps: 1 | 2): void;
  addChunkStatics(chunkKey: string, shapes: StaticShapeSet): void;
  removeChunkStatics(chunkKey: string): void;
  createBody(d: BodyDesc): number;
  removeBody(id: number): void;
  /** Writes position (ENU, 3), quaternion (4), linear velocity (3) and angular velocity (3). */
  readBody(id: number, out: Float64Array): void;
  setKinematicTarget(id: number, p: [number, number, number], q: [number, number, number, number]): void;
  applyImpulse(id: number, j: [number, number, number], at?: [number, number, number]): void;
  character: { move(id: number, desired: [number, number, number], o: CharMoveOpts): CharMoveResult };
  vehicle: {
    create(body: number, wheels: WheelDesc[]): number;
    drive(v: number, i: VehicleDrive): void;
    /**
     * Per wheel, in `wheels` order, `VEHICLE_READ_STRIDE` (11) floats at `out[11 * i + slot]`: 0 inContact (1 or 0),
     * 1..3 contact point (ENU), 4..6 normal, 7 suspLenM, 8 vLong, 9 vLat, 10 loadN. A slot the backend cannot provide is NaN
     * (Rapier's controller gives no wheel-point velocity: 8 and 9). Engine-internal layout, not a contract (M03a2).
     */
    read(v: number, out: Float32Array): void;
  };
  castRay(o: [number, number, number], d: [number, number, number], max: number, mask: number): RayHit | null;
  castSphere(o: [number, number, number], d: [number, number, number], r: number, max: number, mask: number): RayHit | null;
  /** Rapier takeSnapshot, plus the backend's own tables. */
  snapshot(): Uint8Array;
  restore(b: Uint8Array): void;
}

/** What the physics systems need beyond the C-level interface. */
export interface PhysicsSystemsBackend extends PhysicsBackend {
  bodyKind(id: number): BodyKind | null;
  readonly bodyCount: number;
  /** The shape a body was created with (box: half extents). Optional: a backend without it makes the vehicle camera use its default distance (M02g1). */
  bodyShape?(id: number): { shape: BodyDesc['shape']; dims: number[] } | null;
}

/**
 * Body operations of the ray-cast vehicle, the vehicle ownership machine and ragdoll-lite (M03a1; engine-internal, not a
 * numbered contract). `RapierBackend` implements them; the vehicle systems ask for this wider type.
 */
export interface VehiclePhysics extends PhysicsSystemsBackend {
  /** Moves a body and sets its orientation (x, y, z, w) without touching its velocity. */
  setBodyPose(id: number, p: Vec3, q: [number, number, number, number]): void;
  setBodyVelocity(id: number, lin: Vec3, ang: Vec3): void;
  /** Adds an angular impulse (N*m*s) in world axes. */
  applyTorqueImpulse(id: number, t: Vec3): void;
  /** Replaces the collision groups of the body's collider (membership high 16 bits, filter low 16). */
  setBodyGroups(id: number, groups: number): void;
  /** Switches a body between kinematic and dynamic (ragdoll-lite). */
  setBodyKind(id: number, kind: 'dynamic' | 'kinematic'): void;
  /** Suspension settings of a controller made by `vehicle.create` (M03a2 spike; see ADR-0031). */
  tuneVehicle(v: number, t: VehicleSuspensionTune): void;
}

/** A feature the spec assigns to a later milestone. */
export class NotImplementedError extends Error {
  constructor(readonly feature: string, readonly milestone: string) {
    super(`${feature} is not implemented yet: it lands in ${milestone}`);
    this.name = 'NotImplementedError';
  }
}

/** `init()` failed on every attempt. */
export class PhysicsInitError extends Error {
  constructor(readonly attempts: number, readonly build: PhysicsBuild, readonly lastError: unknown) {
    super(`Rapier ${build} failed to load after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    this.name = 'PhysicsInitError';
  }
}
