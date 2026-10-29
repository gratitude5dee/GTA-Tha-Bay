/**
 * The vehicle systems (M03a1): control input, the handling substep, and the bookkeeping after the physics step.
 *
 *  - `engine.vehicle.input` (PhysicsPre): the driver's quantized input becomes the vehicle's input; a parked car holds the handbrake.
 *  - `beforeSubstep` (called by the physics step system, once per substep): ray casts, `stepHandling`, impulses. The step
 *    system runs two substeps while a player vehicle is faster than 100 km/h, and handling then steps at SIM_DT / 2.
 *  - `engine.vehicle.post` (PhysicsPost): the `Vehicle` component, damage from impacts, flight bookkeeping and the water wall.
 *
 * Sim code under the C02 lint.
 */
import {
  applyImpact, DEFAULT_ASSIST, datan2, dcos, dsin, dsqrt, SimButton, SimStage, SIM_DT, waterWall,
  type EntityId, type HandlingInput, type Impact, type SystemDef,
} from '@dv/shared';
import { Control, PlayerControlled, Transform, Vehicle, VehicleDamage, Velocity, BodyRef } from '../ecs/components.ts';
import type { EcsWorld } from '../ecs/world.ts';
import type { VehiclePhysics } from '../physics/backend.ts';
import { PHYSICS_POST_ID, physicsStepSystem, PHYSICS_STEP_ID } from '../physics/systems.ts';
import type { SimCore } from '../loop/sim-core.ts';
import type { EngineServices } from '../services.ts';
import { isSessionCar } from '../sandbox-flags.ts';
import { CONTROL_OWNER, CONTROL_PHASE, CONTROL_REASON, CONTROL_STATE, phaseOf } from '../control/states.ts';
import { vehicleFallRecoverySystem } from '../control/fall.ts';
import { armMoveLatch, moveLatched, noteWaterRespawn } from '../control/latch.ts';
import { vehicleHasPlayer } from '../control/ownership.ts';
import { GROUP_BIT } from '../physics/groups.ts';
import type { Vec3 } from '../physics/backend.ts';
import { VehicleStore, vehicleResource, type VehicleInput, type VehicleRuntime } from './components.ts';
import { RaycastVehicleSim } from './raycast-vehicle.ts';
import type { WheelPath } from './wheel-path.ts';
import { unseatDriver } from './enter-exit.ts';

export const VEHICLE_INPUT_ID = 'engine.vehicle.input';
export const VEHICLE_POST_ID = 'engine.vehicle.post';

/** Above this speed (m/s, 100 km/h) a player vehicle makes the world step twice. */
export const SUBSTEP_SPEED_MPS = 100 / 3.6;
/** Ticks between the stall (water wall) and the respawn: the fade. */
export const RESPAWN_FADE_TICKS = 30;
/** Horizontal speed lost in one tick above which the tick counts as part of a collision, m/s. */
const IMPACT_TICK_DV = 1.5;
/** Metres the respawned vehicle is placed inland of its shore node. */
const SHORE_INLAND_M = 3;
const DEFAULT_DIFFICULTY = 'normal' as const;

export interface VehicleSystemOptions {
  backend: VehiclePhysics;
  services: EngineServices;
  ecs: EcsWorld;
  store?: VehicleStore;
  /** Replaces the selected wheel path (tests and the M03a2 spike harness only). */
  wheelPath?: WheelPath;
}

export interface VehicleSystems {
  readonly store: VehicleStore;
  readonly systems: SystemDef[];
  substeps(): 1 | 2;
  beforeSubstep(dt: number, index: number, count: 1 | 2): void;
}

const norm = (v: number): number => v / 127;

/** The vehicle's own input as the handling model reads it. */
function handlingInput(inp: VehicleInput, stalled: boolean, scratch: HandlingInput): HandlingInput {
  scratch.throttle = stalled ? 0 : norm(inp.throttle);
  scratch.brake = norm(inp.brake);
  scratch.steer = norm(inp.steer);
  scratch.handbrake = inp.handbrake;
  return scratch;
}

export function createVehicleSystems(opts: VehicleSystemOptions): VehicleSystems {
  const { backend, services, ecs } = opts;
  const store = opts.store ?? new VehicleStore();
  const sim = new RaycastVehicleSim(backend, opts.wheelPath);
  const scratch: HandlingInput = {
    throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, ability: false, assist: { ...DEFAULT_ASSIST },
  };

  /** The runtime of the vehicle with dense id `id`, created on first sight. */
  const runtimeOf = (id: number): VehicleRuntime => {
    const handling = ecs.strings.get(ecs.store(Vehicle).handling[id] as number);
    return store.ensure(id, handling);
  };

  const input: SystemDef = {
    id: VEHICLE_INPUT_ID, owner: 'S01', stage: SimStage.PhysicsPre, order: -30,
    run: ({ ecs: w }) => {
      const ids = w.query([Vehicle]);
      if (ids.length === 0) return;
      const co = w.store(Control);
      const pc = w.store(PlayerControlled).player;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i] as number;
        const rt = runtimeOf(id);
        if (rt.external) continue;
        const d = rt.driver;
        const driving = d !== 0 && co.owner[d] === CONTROL_OWNER.Vehicle && phaseOf(co.pending[d] as number) === CONTROL_PHASE.Active;
        const cmd = rt.input;
        const frame = driving && pc[d] === 0 ? services.input : null;
        if (frame && !rt.wet.stalled && moveLatched(services.control, frame)) {
          // after a water respawn the pedals and the wheel are ignored until every one is released (DL-753, latch.ts)
          cmd.throttle = 0; cmd.brake = 0; cmd.steer = 0;
          cmd.handbrake = (frame.buttons & (1 << SimButton.Handbrake)) !== 0;
        } else if (frame) {
          cmd.throttle = frame.throttle < 0 ? 0 : frame.throttle;
          cmd.brake = frame.brake < 0 ? 0 : frame.brake;
          cmd.steer = frame.steer;
          cmd.handbrake = (frame.buttons & (1 << SimButton.Handbrake)) !== 0;
        } else if (driving) {
          cmd.throttle = 0; cmd.brake = 0; cmd.steer = 0; cmd.handbrake = false;
        } else {
          cmd.throttle = 0; cmd.brake = 0; cmd.steer = 0; cmd.handbrake = true;
        }
      }
    },
  };

  /** Applies one impact to the damage component of vehicle `id`. */
  const hurt = (id: number, rt: VehicleRuntime, impact: Impact): void => {
    // the sandbox's dent-proof cars (M04e4): only session cars, and only while the flag is on
    if (services.sandboxFlags.carNoDamage && isSessionCar(ecs.keyOf(ecs.handle(id as EntityId)))) return;
    const dmg = ecs.store(VehicleDamage);
    const next = applyImpact(
      rt.profile,
      { body: dmg.body[id] as number, engine: dmg.engine[id] as number, tires: [0, 1, 2, 3].map((k) => (dmg.tires[k] as Float32Array)[id] as number) as [number, number, number, number] },
      impact,
      DEFAULT_DIFFICULTY,
    );
    dmg.body[id] = next.body;
    dmg.engine[id] = next.engine;
    for (let k = 0; k < 4; k++) (dmg.tires[k] as Float32Array)[id] = next.tires[k] as number;
  };

  const beforeSubstep = (dt: number): void => {
    const ids = ecs.query([Vehicle, BodyRef, Transform]);
    if (ids.length === 0) return;
    const bodies = ecs.store(BodyRef).body;
    const dmg = ecs.store(VehicleDamage);
    const tires: number[] = [0, 0, 0, 0];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as number;
      const rt = runtimeOf(id);
      for (let k = 0; k < 4; k++) tires[k] = (dmg.tires[k] as Float32Array)[id] as number;
      const info = sim.step(rt, bodies[id] as number, handlingInput(rt.input, rt.wet.stalled, scratch), dt, dmg.engine[id] as number, tires);
      rt.contacts = info.contacts;
      // a hard landing: the suspension hit its bump stop at speed
      if (info.bumpSpeed > 6) hurt(id, rt, { kind: 'landing', vNormal: info.bumpSpeed, vTangent: 0, local: [0, 0, 0], otherMassKg: 0 });
    }
  };

  const substeps = (): 1 | 2 => {
    const ids = ecs.query([Vehicle]);
    const v = ecs.store(Vehicle).speed;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as number;
      const rt = store.rt.get(id);
      if (!rt || rt.driver === 0) continue;
      const s = v[id] as number;
      if ((s < 0 ? -s : s) > SUBSTEP_SPEED_MPS) return 2;
    }
    return 1;
  };

  const post: SystemDef = {
    id: VEHICLE_POST_ID, owner: 'S01', stage: SimStage.PhysicsPost, order: 5,
    run: ({ ecs: w, tick }) => {
      const ids = w.query([Vehicle, BodyRef, Transform, Velocity]);
      if (ids.length === 0) return;
      const veh = w.store(Vehicle);
      const tr = w.store(Transform);
      const ve = w.store(Velocity);
      const bounds = services.world.bounds;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i] as number;
        const rt = runtimeOf(id);
        const handle = w.handle(id as EntityId);
        const vx = ve.vx[id] as number;
        const vz = ve.vz[id] as number;

        // flight bookkeeping
        if (rt.contacts > 0) {
          rt.airTicks = 0;
          if (rt.landTicks > 0) rt.landTicks--;
        } else if (rt.airTicks < 65535) rt.airTicks++;

        // collisions: the horizontal speed lost over a run of ticks, reported once the run ends
        const dvx = vx - rt.lastVx;
        const dvz = vz - rt.lastVz;
        const dv = dsqrt(dvx * dvx + dvz * dvz);
        if (dv > IMPACT_TICK_DV) rt.impactAcc += dv;
        else if (rt.impactAcc > 0) {
          const hit = rt.impactAcc;
          rt.impactAcc = 0;
          const qx = tr.qx[id] as number;
          const qy = tr.qy[id] as number;
          const qz = tr.qz[id] as number;
          const qw = tr.qw[id] as number;
          const fx = -2 * (qx * qz + qw * qy);
          const fz = -(1 - 2 * (qx * qx + qy * qy));
          // the speed was lost against the direction of travel; a loss against the heading while rolling forward is a frontal hit
          const forward = vx * fx + vz * fz;
          const lostAlong = (rt.lastVx * fx + rt.lastVz * fz) > 0 ? dvx * fx + dvz * fz : -(dvx * fx + dvz * fz);
          void forward;
          hurt(id, rt, { kind: 'static', vNormal: hit, vTangent: 0, local: [0, 0, lostAlong < 0 ? -2 : 2], otherMassKg: 0 });
          services.events.push({ t: 'vehicle.impact', tick, a: handle, n: hit, s: lostAlong < 0 ? 'front' : 'rear' });
        }
        rt.lastVx = vx;
        rt.lastVz = vz;

        // component readout
        const qx = tr.qx[id] as number;
        const qy = tr.qy[id] as number;
        const qz = tr.qz[id] as number;
        const qw = tr.qw[id] as number;
        const hx = -2 * (qx * qz + qw * qy);
        const hz = -(1 - 2 * (qx * qx + qy * qy));
        veh.speed[id] = vx * hx + vz * hz;
        veh.gear[id] = rt.hs.gear;
        veh.rpm[id] = rt.hs.rpm;
        veh.throttle[id] = rt.input.throttle;
        veh.brake[id] = rt.input.brake;
        veh.steer[id] = rt.input.steer;
        veh.handbrake[id] = rt.input.handbrake ? 1 : 0;

        // water wall (02-world-maps.md 4.1 a): depth at the wheels
        if (bounds) {
          const depth = wheelWaterDepth(bounds, rt, tr.px[id] as number, tr.py[id] as number, tr.pz[id] as number, tr.qy[id] as number, tr.qw[id] as number);
          if (!rt.wet.stalled) {
            const r = waterWall(rt.wet, depth, 1);
            rt.wet = r.state;
            if (r.verdict === 'stall') {
              rt.respawnFade = 0;
              // with the player aboard, the pedals held through the fade are latched (DL-753)
              if (vehicleHasPlayer(w, id)) armMoveLatch(services.control);
              services.events.push({ t: 'world.teleport', tick, a: handle, s: 'out' });
            }
          } else {
            rt.respawnFade++;
            if (rt.respawnFade >= RESPAWN_FADE_TICKS) {
              const yaw = respawnAtShore(backend, bounds, rt, w, id);
              if (yaw !== null && vehicleHasPlayer(w, id)) noteWaterRespawn(services.control, yaw);
              rt.wet = { wetTicks: 0, stalled: false };
              rt.respawnFade = 0;
              services.events.push({ t: 'world.teleport', tick, a: handle, s: 'in' });
            }
          }
        }
      }
    },
  };

  return {
    store,
    systems: [input, post],
    substeps,
    beforeSubstep: (dt) => beforeSubstep(dt),
  };
}

/** Deepest water over any of the four wheel positions, metres. */
function wheelWaterDepth(
  bounds: NonNullable<EngineServices['world']['bounds']>, rt: VehicleRuntime, px: number, py: number, pz: number, qy: number, qw: number,
): number {
  const p = rt.profile;
  const yaw = 2 * datan2(qy, qw);
  const s = dsin(yaw);
  const c = dcos(yaw);
  const front = p.wheelbaseM * (1 - p.frontWeightPct / 100);
  const rear = p.wheelbaseM * (p.frontWeightPct / 100);
  const half = p.trackM / 2;
  let deepest = 0;
  for (let k = 0; k < 4; k++) {
    const lx = k % 2 === 0 ? -half : half;
    const lz = k < 2 ? -front : rear;
    // local (lx, lz) with forward -Z: world = pos + (lx * c + lz * s, -lx * s + lz * c)
    const x = px + lx * c + lz * s;
    const z = pz - lx * s + lz * c;
    // the car's height lets the world tell a bridge deck from the water under it (M05c2)
    const d = bounds.waterDepth(x, z, py);
    if (d > deepest) deepest = d;
  }
  return deepest;
}

/** Puts vehicle `id` at the nearest road-adjacent shore node, facing inland; returns that yaw, or null when no shore node is known. */
function respawnAtShore(
  backend: VehiclePhysics, bounds: NonNullable<EngineServices['world']['bounds']>, rt: VehicleRuntime,
  w: { store: EcsWorld['store'] }, id: number,
): number | null {
  const tr = w.store(Transform);
  const shore = bounds.nearestShore(tr.px[id] as number, tr.pz[id] as number, true);
  if (!shore) return null;
  const yaw = datan2(shore.nx, shore.nz);
  placeVehicle(backend, rt, w, id, shore.x - shore.nx * SHORE_INLAND_M, shore.y, shore.z - shore.nz * SHORE_INLAND_M, yaw);
  return yaw;
}

/**
 * Puts vehicle `id` upright on the ground at (x, groundY, z), facing `yaw` (forward is (-sin yaw, -cos yaw)), at rest: the water wall's
 * respawn (02-world-maps.md 4.1 a) and the ownership machine's vehicle move (`EngineServices.vehicleMove`: the world teleport's move of a
 * driver, 5 step 4, and the below-the-world rescue, 4.1 d) both place it this way; only the placement is shared, each keeps its own fade
 * (DL-735 b). The driver follows the seat in the same tick's PhysicsPost (`engine.vehicle.driver-sync`).
 */
export function placeVehicle(
  backend: Pick<VehiclePhysics, 'setBodyPose' | 'setBodyVelocity'>, rt: VehicleRuntime, w: { store: EcsWorld['store'] }, id: number,
  x: number, groundY: number, z: number, yaw: number,
): void {
  const tr = w.store(Transform);
  const y = groundY + rt.profile.cgHeightM + 0.4;
  const body = w.store(BodyRef).body[id] as number;
  backend.setBodyPose(body, [x, y, z], [0, dsin(yaw / 2), 0, dcos(yaw / 2)]);
  backend.setBodyVelocity(body, [0, 0, 0], [0, 0, 0]);
  tr.px[id] = x; tr.py[id] = y; tr.pz[id] = z;
  tr.qx[id] = 0; tr.qy[id] = dsin(yaw / 2); tr.qz[id] = 0; tr.qw[id] = dcos(yaw / 2);
  for (let k = 0; k < 4; k++) rt.susp[k] = Number.NaN;
  rt.lastVx = 0;
  rt.lastVz = 0;
  rt.impactAcc = 0;
}

/** The ground probe of a driven-vehicle move starts this far above the target height and reaches this far below it, metres. */
const MOVE_PROBE_UP_M = 3;
const MOVE_PROBE_DOWN_M = 6;
const DOWN: Vec3 = [0, -1, 0];

/**
 * `EngineServices.vehicleMove` (DL-734, DL-735 c): moves the vehicle `rider` rides in, at its wheel or as a passenger, onto the static
 * ground near (x, y, z) at once, with everybody aboard, and clears its flight and water counters. The driver and a passenger follow
 * their seats in the same tick's PhysicsPost (`engine.vehicle.driver-sync`). Refused
 * (`engine.control.groundNotLoaded`) when no static collider lies under the target yet, so a car is never put down over ground whose
 * colliders are still on their way.
 */
function vehicleMover(backend: VehiclePhysics, store: VehicleStore, ecs: EcsWorld): NonNullable<EngineServices['vehicleMove']> {
  const from: Vec3 = [0, 0, 0];
  return (rider, pos, yaw) => {
    const did = ecs.resolve(rider);
    if (did === null) return { ok: false, reason: CONTROL_REASON.wrongOwner };
    const co = ecs.store(Control);
    const vid = co.target[did] as number;
    const rt = store.rt.get(vid);
    const passenger = co.state[did] === CONTROL_STATE.passenger;
    if (!rt || (rt.driver !== did && !passenger) || !ecs.has(ecs.handle(vid as EntityId), BodyRef)) return { ok: false, reason: CONTROL_REASON.wrongOwner };
    from[0] = pos[0]; from[1] = pos[1] + MOVE_PROBE_UP_M; from[2] = pos[2];
    const hit = backend.castRay(from, DOWN, MOVE_PROBE_UP_M + MOVE_PROBE_DOWN_M, GROUP_BIT.static);
    if (!hit) return { ok: false, reason: CONTROL_REASON.groundNotLoaded };
    placeVehicle(backend, rt, ecs, vid, pos[0], from[1] - hit.toi, pos[2], yaw);
    rt.airTicks = 0;
    rt.wet = { wetTicks: 0, stalled: false };
    rt.respawnFade = 0;
    return { ok: true };
  };
}

/**
 * Registers the vehicle systems: replaces the default physics step with one that steps handling per substep, adds the
 * input and post systems and the `vehicles` resource. Call after `registerPhysicsSystems` and `registerControlSystems`.
 */
export function registerVehicleSystems(core: SimCore, backend: VehiclePhysics, store?: VehicleStore, wheelPath?: WheelPath): VehicleSystems {
  const sys = createVehicleSystems({ backend, services: core.services, ecs: core.ecs, ...(store ? { store } : {}), ...(wheelPath ? { wheelPath } : {}) });
  core.removeSystem(PHYSICS_STEP_ID);
  core.addSystem(physicsStepSystem(backend, { substeps: sys.substeps, beforeSubstep: sys.beforeSubstep }));
  for (const s of sys.systems) core.addSystem(s);
  core.addResource(vehicleResource(sys.store));
  // the below-the-world net for a vehicle with the player aboard and the ownership machine's vehicle move it calls (02-world-maps.md 4.1 d,
  // DL-734, DL-735), which the world's teleport also uses for a driver
  core.services.vehicleMove = vehicleMover(backend, sys.store, core.ecs);
  core.services.vehicleUnseat = (driver, tick) => unseatDriver(core.ecs, backend, sys.store, core.services, driver, tick);
  core.addSystem(vehicleFallRecoverySystem({ services: core.services, store: sys.store }));
  return sys;
}

export { PHYSICS_POST_ID, SIM_DT };
