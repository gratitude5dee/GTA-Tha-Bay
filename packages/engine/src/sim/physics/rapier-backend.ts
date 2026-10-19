import type { Collider, KinematicCharacterController, RigidBody, RigidBodyDesc, World } from '@dimforge/rapier3d-deterministic-compat';
import { dsqrt, PI } from '@dv/shared';
import { ByteReader, ByteWriter } from '../bytes.ts';
import {
  NotImplementedError, PhysicsInitError,
  type BodyDesc, type BodyKind, type CharMoveOpts, type CharMoveResult, type PhysicsBuild,
  type RayHit, type StaticShapeSet, type VehicleDrive, type VehiclePhysics, type Vec3, type WheelDesc,
} from './backend.ts';
import { PHYSICS_CONFIG, type PhysicsConfig } from './config.ts';
import { GROUPS, interactionGroups } from './groups.ts';
import { loadRapierBuild, type RapierModule } from './load-build.ts';
import { heightfieldLayout, prismPieces } from './static-shapes.ts';

export interface RetryEnv {
  /** Retries after the first attempt. The spec says three, so four attempts in all. */
  retries: number;
  baseMs: number;
  /** Resolves after `ms`. The sim has no timers; the host injects one. Default: resolves at once. */
  sleep: (ms: number) => Promise<void>;
  /** A value in [0, 1) used to jitter the backoff. Default: 0.5. */
  jitter: () => number;
}

export interface RapierBackendOptions {
  /** Loads and initializes one Rapier build. Default: the dynamic imports in load-build.ts. */
  load?: (build: PhysicsBuild) => Promise<RapierModule>;
  retry?: Partial<RetryEnv>;
  config?: PhysicsConfig;
  /** Passed to the default loader: refuse a second, different build in this realm. */
  exclusive?: boolean;
}

interface BodyEntry {
  /** Rapier flat handles (opaque f64 values). */
  handle: number;
  collider: number;
  kind: BodyKind;
  /** The shape the body was made with, for the QA physics wireframe (not part of a snapshot; null after a restore). */
  shape?: { shape: BodyDesc['shape']; dims: number[] };
}

interface StaticEntry {
  set: StaticShapeSet;
  colliders: number[];
}

const SNAPSHOT_MAGIC = 0x31505644; // 'DVP1'
const KIND_CODE: Record<BodyKind, number> = { dynamic: 0, kinematic: 1, fixed: 2 };
const KIND_BY_CODE: BodyKind[] = ['dynamic', 'kinematic', 'fixed'];

/**
 * PhysicsBackend over Rapier 0.21.0. Rapier works in f32 around `origin` (floating origin); this class converts at
 * the boundary: ENU f64 in and out, f32 local inside.
 *
 * Body ids are the backend's own sequential integers (never reused), because Rapier's handles are opaque f64 values
 * that do not fit the ECS `BodyRef.body` u32.
 */
export class RapierBackend implements VehiclePhysics {
  readonly origin: Vec3 = [0, 0, 0];
  /** Times `rebase` ran. */
  rebases = 0;
  /** Steps run. */
  steps = 0;

  private rapier: RapierModule | null = null;
  private world: World | null = null;
  private nextId = 1;
  private readonly bodies = new Map<number, BodyEntry>();
  private readonly bodyObjs = new Map<number, RigidBody>();
  private readonly statics = new Map<string, StaticEntry>();
  private readonly cfg: PhysicsConfig;
  private readonly load: (build: PhysicsBuild) => Promise<RapierModule>;
  private readonly retry: RetryEnv;
  /** The one character controller, created on first use and rebuilt whenever the wasm world is replaced. */
  private kcc: KinematicCharacterController | null = null;
  /** Reused for `computedCollision`. */
  private kccHit: ReturnType<KinematicCharacterController['computedCollision']> = null;
  /** Builds this instance asked its loader for. At most one entry, equal to `build`. */
  readonly loadedBuilds: PhysicsBuild[] = [];

  constructor(readonly build: PhysicsBuild, opts: RapierBackendOptions = {}) {
    this.cfg = opts.config ?? PHYSICS_CONFIG;
    const exclusive = opts.exclusive === true;
    this.load = opts.load ?? ((b) => loadRapierBuild(b, { exclusive }));
    this.retry = {
      retries: opts.retry?.retries ?? 3,
      baseMs: opts.retry?.baseMs ?? 200,
      sleep: opts.retry?.sleep ?? (() => Promise.resolve()),
      jitter: opts.retry?.jitter ?? (() => 0.5),
    };
  }

  // ------------------------------------------------------------------ lifecycle

  async init(): Promise<void> {
    if (this.world) return;
    const attempts = this.retry.retries + 1;
    let last: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        if (this.loadedBuilds.length === 0) this.loadedBuilds.push(this.build);
        this.rapier = await this.load(this.build);
        break;
      } catch (e) {
        last = e;
        if (attempt === attempts) throw new PhysicsInitError(attempt, this.build, last);
        const wait = this.retry.baseMs * (1 << (attempt - 1)) * (0.5 + this.retry.jitter());
        await this.retry.sleep(wait);
      }
    }
    this.world = this.newWorld();
  }

  private newWorld(): World {
    const R = this.R;
    const g = this.cfg.gravity;
    const w = new R.World({ x: g[0], y: g[1], z: g[2] });
    this.applyParameters(w);
    return w;
  }

  private applyParameters(w: World): void {
    const g = this.cfg.gravity;
    w.gravity = { x: g[0], y: g[1], z: g[2] };
    w.integrationParameters.numSolverIterations = this.cfg.solverIterations;
  }

  private get R(): RapierModule {
    if (!this.rapier) throw new Error('RapierBackend: init() has not completed');
    return this.rapier;
  }

  private get W(): World {
    if (!this.world) throw new Error('RapierBackend: init() has not completed');
    return this.world;
  }

  /** Frees the wasm world. */
  dispose(): void {
    this.kcc?.free();
    this.kcc = null;
    this.world?.free();
    this.world = null;
    this.bodies.clear();
    this.bodyObjs.clear();
    this.statics.clear();
  }

  get bodyCount(): number {
    return this.bodies.size;
  }

  bodyKind(id: number): BodyKind | null {
    return this.bodies.get(id)?.kind ?? null;
  }

  /** The shape and dimensions a body was created with (QA physics wireframe); null for an unknown body or after a restore. */
  bodyShape(id: number): { shape: BodyDesc['shape']; dims: number[] } | null {
    return this.bodies.get(id)?.shape ?? null;
  }

  // ------------------------------------------------------------------ coordinates

  private local(p: Readonly<Vec3>): { x: number; y: number; z: number } {
    return { x: p[0] - this.origin[0], y: p[1] - this.origin[1], z: p[2] - this.origin[2] };
  }

  private body(id: number): RigidBody {
    const cached = this.bodyObjs.get(id);
    if (cached) return cached;
    const e = this.bodies.get(id);
    if (!e) throw new RangeError(`unknown physics body ${id}`);
    const rb = this.W.getRigidBody(e.handle);
    this.bodyObjs.set(id, rb);
    return rb;
  }

  // ------------------------------------------------------------------ floating origin

  rebase(o: [number, number, number]): void {
    const w = this.W;
    const ox = this.origin[0];
    const oy = this.origin[1];
    const oz = this.origin[2];
    if (o[0] === ox && o[1] === oy && o[2] === oz) return;
    for (const id of this.bodies.keys()) {
      const rb = this.body(id);
      const t = rb.translation();
      rb.setTranslation({ x: ox + t.x - o[0], y: oy + t.y - o[1], z: oz + t.z - o[2] }, false);
    }
    this.origin[0] = o[0];
    this.origin[1] = o[1];
    this.origin[2] = o[2];
    // Statics are rebuilt in the new frame from the shape sets we kept.
    for (const entry of this.statics.values()) {
      this.removeColliders(w, entry.colliders);
      entry.colliders = this.buildStatics(entry.set);
    }
    this.rebases++;
  }

  // ------------------------------------------------------------------ stepping

  step(dt: number, substeps: 1 | 2): void {
    const w = this.W;
    w.integrationParameters.dt = dt / substeps;
    for (let i = 0; i < substeps; i++) w.step();
    this.steps++;
  }

  // ------------------------------------------------------------------ statics

  addChunkStatics(chunkKey: string, shapes: StaticShapeSet): void {
    if (this.statics.has(chunkKey)) this.removeChunkStatics(chunkKey);
    this.statics.set(chunkKey, { set: shapes, colliders: this.buildStatics(shapes) });
  }

  removeChunkStatics(chunkKey: string): void {
    const e = this.statics.get(chunkKey);
    if (!e) return;
    this.removeColliders(this.W, e.colliders);
    this.statics.delete(chunkKey);
  }

  private removeColliders(w: World, handles: readonly number[]): void {
    for (const h of handles) {
      const c = w.getCollider(h);
      if (c) w.removeCollider(c, true);
    }
  }

  private buildStatics(set: StaticShapeSet): number[] {
    const R = this.R;
    const w = this.W;
    const handles: number[] = [];
    if (set.heightfield) {
      const l = heightfieldLayout(set.heightfield);
      const c = this.local(l.centre);
      const desc = R.ColliderDesc.heightfield(l.nrows, l.ncols, l.heights, l.scale)
        .setTranslation(c.x, c.y, c.z)
        .setCollisionGroups(GROUPS.static)
        .setFriction(this.cfg.defaultFriction)
        .setRestitution(this.cfg.defaultRestitution);
      handles.push(w.createCollider(desc).handle);
    }
    for (const piece of prismPieces(set.prisms)) {
      const pts = new Float32Array(piece.length);
      for (let i = 0; i < piece.length; i += 3) {
        pts[i] = (piece[i] as number) - this.origin[0];
        pts[i + 1] = (piece[i + 1] as number) - this.origin[1];
        pts[i + 2] = (piece[i + 2] as number) - this.origin[2];
      }
      const desc = R.ColliderDesc.convexHull(pts);
      if (!desc) continue;
      desc.setCollisionGroups(GROUPS.static).setFriction(this.cfg.defaultFriction).setRestitution(this.cfg.defaultRestitution);
      handles.push(w.createCollider(desc).handle);
    }
    return handles;
  }

  // ------------------------------------------------------------------ bodies

  createBody(d: BodyDesc): number {
    const R = this.R;
    const w = this.W;
    const at = this.local(d.at);
    let rbDesc: RigidBodyDesc;
    switch (d.kind) {
      case 'dynamic': rbDesc = R.RigidBodyDesc.dynamic(); break;
      case 'kinematic': rbDesc = R.RigidBodyDesc.kinematicPositionBased(); break;
      default: rbDesc = R.RigidBodyDesc.fixed(); break;
    }
    rbDesc.setTranslation(at.x, at.y, at.z);
    if (d.rot) rbDesc.setRotation({ x: d.rot[0], y: d.rot[1], z: d.rot[2], w: d.rot[3] });
    if (d.linearDamping !== undefined) rbDesc.setLinearDamping(d.linearDamping);
    if (d.angularDamping !== undefined) rbDesc.setAngularDamping(d.angularDamping);
    if (d.ccd) rbDesc.setCcdEnabled(true);
    const rb = w.createRigidBody(rbDesc);
    const cd = this.colliderDesc(d);
    cd.setCollisionGroups(d.groups)
      .setFriction(d.friction ?? this.cfg.defaultFriction)
      .setRestitution(d.restitution ?? this.cfg.defaultRestitution);
    if (d.mass !== undefined && d.kind === 'dynamic') cd.setMass(d.mass);
    const collider: Collider = w.createCollider(cd, rb);
    const id = this.nextId++;
    this.bodies.set(id, { handle: rb.handle, collider: collider.handle, kind: d.kind, shape: { shape: d.shape, dims: [...d.dims] } });
    this.bodyObjs.set(id, rb);
    return id;
  }

  private colliderDesc(d: BodyDesc): ReturnType<RapierModule['ColliderDesc']['ball']> {
    const R = this.R;
    const a = d.dims;
    switch (d.shape) {
      case 'box': return R.ColliderDesc.cuboid(a[0] as number, a[1] as number, a[2] as number);
      case 'sphere': return R.ColliderDesc.ball(a[0] as number);
      case 'capsule': return R.ColliderDesc.capsule(a[0] as number, a[1] as number);
      default: {
        const desc = R.ColliderDesc.convexHull(new Float32Array(a));
        if (!desc) throw new RangeError('convex body: the points do not span a volume');
        return desc;
      }
    }
  }

  removeBody(id: number): void {
    const e = this.bodies.get(id);
    if (!e) return;
    this.W.removeRigidBody(this.body(id));
    this.bodies.delete(id);
    this.bodyObjs.delete(id);
  }

  readBody(id: number, out: Float64Array): void {
    const rb = this.body(id);
    const t = rb.translation();
    const q = rb.rotation();
    const v = rb.linvel();
    const a = rb.angvel();
    // f32 widened to f64 by adding the f64 origin: the same operation on every engine.
    out[0] = this.origin[0] + t.x;
    out[1] = this.origin[1] + t.y;
    out[2] = this.origin[2] + t.z;
    out[3] = q.x;
    out[4] = q.y;
    out[5] = q.z;
    out[6] = q.w;
    out[7] = v.x;
    out[8] = v.y;
    out[9] = v.z;
    out[10] = a.x;
    out[11] = a.y;
    out[12] = a.z;
  }

  setKinematicTarget(id: number, p: [number, number, number], q: [number, number, number, number]): void {
    const rb = this.body(id);
    const l = this.local(p);
    rb.setNextKinematicTranslation(l);
    rb.setNextKinematicRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
  }

  setBodyPose(id: number, p: Vec3, q: [number, number, number, number]): void {
    const rb = this.body(id);
    rb.setTranslation(this.local(p), true);
    rb.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
  }

  setBodyVelocity(id: number, lin: Vec3, ang: Vec3): void {
    const rb = this.body(id);
    rb.setLinvel({ x: lin[0], y: lin[1], z: lin[2] }, true);
    rb.setAngvel({ x: ang[0], y: ang[1], z: ang[2] }, true);
  }

  applyTorqueImpulse(id: number, t: Vec3): void {
    this.body(id).applyTorqueImpulse({ x: t[0], y: t[1], z: t[2] }, true);
  }

  setBodyGroups(id: number, groups: number): void {
    const e = this.bodies.get(id);
    if (!e) throw new RangeError(`unknown physics body ${id}`);
    this.W.getCollider(e.collider).setCollisionGroups(groups);
  }

  setBodyKind(id: number, kind: 'dynamic' | 'kinematic'): void {
    const e = this.bodies.get(id);
    if (!e) throw new RangeError(`unknown physics body ${id}`);
    const R = this.R;
    this.body(id).setBodyType(kind === 'dynamic' ? R.RigidBodyType.Dynamic : R.RigidBodyType.KinematicPositionBased, true);
    e.kind = kind;
  }

  applyImpulse(id: number, j: [number, number, number], at?: [number, number, number]): void {
    const rb = this.body(id);
    const impulse = { x: j[0], y: j[1], z: j[2] };
    if (at) rb.applyImpulseAtPoint(impulse, this.local(at), true);
    else rb.applyImpulse(impulse, true);
  }

  // ------------------------------------------------------------------ character controller and queries

  /**
   * Rapier `KinematicCharacterController` (M01b1). The collider moves with the body's last stepped position, so a
   * caller sets the next kinematic target to `position + moved` and the step carries the body there. Rapier's
   * broad phase learns about new colliders at the next `step`, so queries made before the first step see no statics.
   */
  readonly character = {
    move: (id: number, desired: [number, number, number], o: CharMoveOpts): CharMoveResult => {
      const entry = this.bodies.get(id);
      if (!entry) throw new RangeError(`unknown physics body ${id}`);
      const collider = this.W.getCollider(entry.collider);
      const kcc = this.controller();
      kcc.enableAutostep(o.autostepM, this.cfg.character.autostepMinWidthM, false);
      kcc.enableSnapToGround(o.snapToGroundM);
      const maxSlope = (o.maxSlopeDeg * PI) / 180;
      kcc.setMaxSlopeClimbAngle(maxSlope);
      // A slope the character may climb is also one it may stand on.
      kcc.setMinSlopeSlideAngle(maxSlope);
      kcc.setSlideEnabled(o.slide);
      kcc.computeColliderMovement(collider, { x: desired[0], y: desired[1], z: desired[2] }, undefined, GROUPS.character);
      const m = kcc.computedMovement();
      const grounded = kcc.computedGrounded();
      let groundNormalY = grounded ? 1 : 0;
      if (grounded) {
        // The steepest-facing contact normal that points up is the floor the character stands on.
        let best = 0;
        for (let i = 0, n = kcc.numComputedCollisions(); i < n; i++) {
          const hit = kcc.computedCollision(i, this.kccHit ?? undefined);
          if (!hit) continue;
          this.kccHit = hit;
          const ny = hit.normal1.y;
          if (ny > best) best = ny;
        }
        if (best > 0) groundNormalY = best;
      }
      return { moved: [m.x, m.y, m.z], grounded, groundNormalY };
    },
  };

  private controller(): KinematicCharacterController {
    if (!this.kcc) this.kcc = this.W.createCharacterController(this.cfg.character.skinM);
    return this.kcc;
  }

  readonly vehicle = {
    create: (_body: number, _wheels: WheelDesc[]): number => {
      throw new NotImplementedError('vehicle.create', 'M03a1');
    },
    drive: (_v: number, _i: VehicleDrive): void => {
      throw new NotImplementedError('vehicle.drive', 'M03a1');
    },
    read: (_v: number, _out: Float32Array): void => {
      throw new NotImplementedError('vehicle.read', 'M03a1');
    },
  };

  /**
   * First hit along a ray against solid colliders. `d` need not be unit length; `toi` is in metres. `mask` is the OR
   * of the `config/physics.json` group bits the ray may hit. `entity` is the NULL handle: statics have none.
   */
  castRay(o: [number, number, number], d: [number, number, number], max: number, mask: number): RayHit | null {
    const len = dsqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    if (!(len > 0)) return null;
    const dir = { x: d[0] / len, y: d[1] / len, z: d[2] / len };
    const R = this.R;
    const hit = this.W.castRayAndGetNormal(new R.Ray(this.local(o), dir), max, true, undefined, interactionGroups(0xffff, mask));
    if (!hit) return null;
    return { toi: hit.timeOfImpact, normal: [hit.normal.x, hit.normal.y, hit.normal.z], collider: hit.collider.handle, entity: 0 };
  }

  /**
   * First hit of a sphere of radius `r` swept from `o` along `d` (unit length after normalizing). A sphere that starts
   * inside a collider hits at `toi` 0. `normal` is the surface normal at the contact on the hit collider.
   */
  castSphere(o: [number, number, number], d: [number, number, number], r: number, max: number, mask: number): RayHit | null {
    const len = dsqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    if (!(len > 0)) return null;
    const R = this.R;
    const vel = { x: d[0] / len, y: d[1] / len, z: d[2] / len };
    const hit = this.W.castShape(
      this.local(o), { x: 0, y: 0, z: 0, w: 1 }, vel, new R.Ball(r), 0, max, true, undefined, interactionGroups(0xffff, mask),
    );
    if (!hit) return null;
    return { toi: hit.time_of_impact, normal: [hit.normal1.x, hit.normal1.y, hit.normal1.z], collider: hit.collider.handle, entity: 0 };
  }

  // ------------------------------------------------------------------ snapshot

  /**
   * Bytes of: this backend's tables (origin, body ids and handles, the shape sets of every chunk) followed by Rapier's
   * own `takeSnapshot`. `restore` rebuilds the wasm world from them.
   */
  snapshot(): Uint8Array {
    const w = new ByteWriter();
    w.u32(SNAPSHOT_MAGIC);
    w.u8(this.build === 'simd-compat' ? 0 : 1);
    for (const c of this.origin) w.f64(c);
    w.u32(this.nextId);
    w.u32(this.rebases);
    w.u32(this.steps);
    w.u32(this.bodies.size);
    for (const [id, e] of this.bodies) {
      w.u32(id);
      w.u8(KIND_CODE[e.kind]);
      w.f64(e.handle);
      w.f64(e.collider);
    }
    w.u32(this.statics.size);
    for (const [key, e] of this.statics) {
      w.str(key);
      const hf = e.set.heightfield;
      w.u8(hf ? 1 : 0);
      if (hf) {
        w.u32(hf.nx);
        w.u32(hf.nz);
        w.f64(hf.cell);
        for (const c of hf.at) w.f64(c);
        for (const v of hf.heights) w.f32(v);
      }
      w.u32(e.set.prisms.length);
      for (const v of e.set.prisms) w.f32(v);
      w.u32(e.colliders.length);
      for (const h of e.colliders) w.f64(h);
    }
    const rapier = this.W.takeSnapshot();
    w.u32(rapier.length);
    w.bytes(rapier);
    return w.toBytes();
  }

  restore(b: Uint8Array): void {
    const r = new ByteReader(b);
    if (r.u32() !== SNAPSHOT_MAGIC) throw new Error('RapierBackend.restore: bad snapshot');
    const build: PhysicsBuild = r.u8() === 0 ? 'simd-compat' : 'deterministic-compat';
    if (build !== this.build) throw new Error(`RapierBackend.restore: snapshot is from ${build}, this backend is ${this.build}`);
    this.origin[0] = r.f64();
    this.origin[1] = r.f64();
    this.origin[2] = r.f64();
    this.nextId = r.u32();
    this.rebases = r.u32();
    this.steps = r.u32();
    this.bodies.clear();
    this.bodyObjs.clear();
    for (let n = r.u32(); n > 0; n--) {
      const id = r.u32();
      const kind = KIND_BY_CODE[r.u8()] as BodyKind;
      this.bodies.set(id, { kind, handle: r.f64(), collider: r.f64() });
    }
    this.statics.clear();
    for (let n = r.u32(); n > 0; n--) {
      const key = r.str();
      let heightfield: StaticShapeSet['heightfield'];
      if (r.u8() === 1) {
        const nx = r.u32();
        const nz = r.u32();
        const cell = r.f64();
        const at: [number, number, number] = [r.f64(), r.f64(), r.f64()];
        const heights = new Float32Array(nx * nz);
        for (let i = 0; i < heights.length; i++) heights[i] = r.f32();
        heightfield = { nx, nz, cell, at, heights };
      }
      const prisms = new Float32Array(r.u32());
      for (let i = 0; i < prisms.length; i++) prisms[i] = r.f32();
      const colliders: number[] = [];
      for (let m = r.u32(); m > 0; m--) colliders.push(r.f64());
      this.statics.set(key, { set: heightfield ? { heightfield, prisms } : { prisms }, colliders });
    }
    const len = r.u32();
    const rapierBytes = r.bytes(len);
    this.kcc?.free();
    this.kcc = null;
    this.world?.free();
    this.world = this.R.World.restoreSnapshot(rapierBytes);
    this.applyParameters(this.world);
  }
}
