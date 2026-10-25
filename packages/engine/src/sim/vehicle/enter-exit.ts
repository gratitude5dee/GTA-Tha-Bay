/**
 * Entering and leaving vehicles through the control ownership machine (01-engine.md 2.5; M03a1).
 *
 *   OnFoot Ready ──request──> Waiting ──> Entering (200, enterSettleTicks) ──> Active (201, owner Vehicle, input context 'vehicle')
 *   Active ──Enter pressed──> Leaving (203, leaveSettleTicks) ──> OnFoot Ready (100)
 *
 * A refusal is a localisation key (`CONTROL_REASON.vehicle*`), appended to the event log as `control.refused`; nothing
 * changes. While the player is in a vehicle its capsule body takes the `sensor` collision group (it collides with nothing),
 * follows the seat, and its mesh is hidden.
 *
 * Sim code under the C02 lint.
 */
import {
  datan2, dcos, dsin, dsqrt, PI, SimButton, SimStage, type EcsApi, type EntityHandle, type EntityId, type SystemDef,
} from '@dv/shared';
import {
  Anim, BodyRef, CharacterBody, Control, PlayerControlled, RenderKey, Transform, Vehicle, Velocity,
} from '../ecs/components.ts';
import type { EcsWorld } from '../ecs/world.ts';
import { capsuleCentreOffset } from '../control/onfoot.ts';
import {
  animStateOf, CONTROL_OWNER, CONTROL_PHASE, CONTROL_REASON, CONTROL_STATE, OWNER_NAMES, PHASE_NAMES, packPending, phaseOf, requestedOf,
  type ControlOwnerId, type ControlPhaseId,
} from '../control/states.ts';
import type { RequestResult } from '../control/ownership.ts';
import { PHYSICS_CONFIG, type CharacterConfig } from '../physics/config.ts';
import { GROUP_BIT, GROUPS } from '../physics/groups.ts';
import type { Vec3, VehiclePhysics } from '../physics/backend.ts';
import type { EngineServices } from '../services.ts';
import type { VehicleStore, VehicleRuntime } from './components.ts';
import { loadPose, newPose, type BodyPose } from './raycast-vehicle.ts';

export const ENTER_EXIT_ID = 'engine.vehicle.enter-exit';
export const DRIVER_SYNC_ID = 'engine.vehicle.driver-sync';

/** Driver seat in the body frame: left of centre (x < 0), slightly behind it. */
export const SEAT_LOCAL: Readonly<Vec3> = [-0.4, -0.35, 0.15];
/** The front passenger seat in the body frame: the driver seat mirrored to the right of centre (BD-FIX-SPAWN-09). */
export const PASSENGER_SEAT_LOCAL: Readonly<Vec3> = [0.4, -0.35, 0.15];
/** The player must be within this distance of a door point to enter, metres. */
export const ENTER_REACH_M = 3.6;
/** Exit is refused above this speed, m/s. */
export const EXIT_MAX_SPEED_MPS = 6;
/** Rings searched when the doors are blocked, metres from the vehicle centre. */
const EXIT_RINGS_M: readonly number[] = [2.2, 3];
const RING_STEPS = 8;

export interface EnterExitOptions {
  backend: VehiclePhysics;
  services: Pick<EngineServices, 'events' | 'input' | 'camera'>;
  store: VehicleStore;
  config?: CharacterConfig;
}

const identity: [number, number, number, number] = [0, 0, 0, 1];

/** World position of local point `l` of the vehicle with pose `b`. */
function toWorld(b: BodyPose, l: Readonly<Vec3>, out: Vec3): Vec3 {
  out[0] = b.px + b.rx * l[0] + b.ux * l[1] - b.fx * l[2];
  out[1] = b.py + b.ry * l[0] + b.uy * l[1] - b.fy * l[2];
  out[2] = b.pz + b.rz * l[0] + b.uz * l[1] - b.fz * l[2];
  return out;
}

function poseOf(backend: VehiclePhysics, body: number, buf: Float64Array, pose: BodyPose): BodyPose {
  backend.readBody(body, buf);
  loadPose(pose, buf);
  return pose;
}

/**
 * Asks to put `driver` (on foot, idle in the machine) into `vehicle`. The next Control stage runs the transition.
 * Refusals: `engine.vehicle.unknown`, `.locked`, `.occupied`, `.tooFar`, and the machine's `busy` / `wrongOwner`.
 */
export function requestEnterVehicle(
  ecs: EcsApi, backend: VehiclePhysics, store: VehicleStore, driver: EntityHandle, vehicle: EntityHandle,
): RequestResult {
  const did = ecs.resolve(driver);
  if (did === null) return { ok: false, reason: CONTROL_REASON.wrongOwner };
  const vid = ecs.resolve(vehicle);
  if (vid === null || !ecs.has(vehicle, Vehicle)) return { ok: false, reason: CONTROL_REASON.vehicleUnknown };
  const co = ecs.store(Control);
  if (co.owner[did] !== CONTROL_OWNER.OnFoot) return { ok: false, reason: CONTROL_REASON.wrongOwner };
  if (phaseOf(co.pending[did] as number) !== CONTROL_PHASE.Ready) return { ok: false, reason: CONTROL_REASON.busy };
  const rt = store.rt.get(vid) ?? store.ensure(vid, ecs.strings.get(ecs.store(Vehicle).handling[vid] as number));
  if (rt.locked) return { ok: false, reason: CONTROL_REASON.vehicleLocked };
  if (rt.driver !== 0) return { ok: false, reason: CONTROL_REASON.vehicleOccupied };
  // reach: the nearer of the two door points
  const pose = poseOf(backend, ecs.store(BodyRef).body[vid] as number, new Float64Array(13), newPose());
  const tr = ecs.store(Transform);
  const half = rt.profile.trackM / 2 + 0.5;
  const px = tr.px[did] as number;
  const pz = tr.pz[did] as number;
  let best = Infinity;
  for (const side of [-half, half]) {
    const dx = px - (pose.px + pose.rx * side);
    const dz = pz - (pose.pz + pose.rz * side);
    const d = dsqrt(dx * dx + dz * dz);
    if (d < best) best = d;
  }
  if (best > ENTER_REACH_M) return { ok: false, reason: CONTROL_REASON.vehicleTooFar };
  rt.driver = did;
  co.target[did] = vid;
  co.pending[did] = packPending(CONTROL_PHASE.Waiting, CONTROL_OWNER.Vehicle);
  return { ok: true };
}

/** Asks the driver to get out. Takes effect in the next Control stage; refused above `EXIT_MAX_SPEED_MPS`. */
export function requestExitVehicle(ecs: EcsApi, store: VehicleStore, driver: EntityHandle): RequestResult {
  const did = ecs.resolve(driver);
  if (did === null) return { ok: false, reason: CONTROL_REASON.wrongOwner };
  const co = ecs.store(Control);
  if (co.owner[did] !== CONTROL_OWNER.Vehicle || phaseOf(co.pending[did] as number) !== CONTROL_PHASE.Active) {
    return { ok: false, reason: CONTROL_REASON.wrongOwner };
  }
  const vid = co.target[did] as number;
  const speed = ecs.store(Vehicle).speed[vid] as number;
  if ((speed < 0 ? -speed : speed) > EXIT_MAX_SPEED_MPS) return { ok: false, reason: CONTROL_REASON.vehicleTooFast };
  if (!store.rt.has(vid)) return { ok: false, reason: CONTROL_REASON.vehicleUnknown };
  co.pending[did] = packPending(CONTROL_PHASE.Active, CONTROL_OWNER.OnFoot);   // 'leave' request, taken by the machine
  return { ok: true };
}

/** Exit candidates in the order the spec gives: driver side, passenger side, then rings of 2.2 m and 3 m. */
function exitCandidates(b: BodyPose, p: VehicleRuntime['profile'], i: number, out: Vec3): Vec3 | null {
  const side = p.trackM / 2 + 0.9;
  if (i === 0) { out[0] = b.px - b.rx * side; out[1] = b.py; out[2] = b.pz - b.rz * side; return out; }
  if (i === 1) { out[0] = b.px + b.rx * side; out[1] = b.py; out[2] = b.pz + b.rz * side; return out; }
  const j = i - 2;
  const ring = EXIT_RINGS_M[Math.floor(j / RING_STEPS)];
  if (ring === undefined) return null;
  // eight bearings around the car, starting behind the driver door; sine and cosine from detmath
  const ang = ((j % RING_STEPS) * 2 * PI) / RING_STEPS + datan2(-b.rx, -b.rz);
  out[0] = b.px + dsin(ang) * ring;
  out[1] = b.py;
  out[2] = b.pz + dcos(ang) * ring;
  return out;
}

const EXIT_PROBES = 2 + EXIT_RINGS_M.length * RING_STEPS;

/**
 * The first free place to stand next to the vehicle: ground under it within 2.5 m of the car's height, and a clear
 * horizontal ray from the car's centre to the spot. Writes `out` (feet) and returns true, or false when nothing is free.
 */
export function findExitPoint(backend: VehiclePhysics, b: BodyPose, rt: VehicleRuntime, out: Vec3): boolean {
  const cand: Vec3 = [0, 0, 0];
  const from: Vec3 = [0, 0, 0];
  const dir: Vec3 = [0, 0, 0];
  const down: Vec3 = [0, -1, 0];
  for (let i = 0; i < EXIT_PROBES; i++) {
    const c = exitCandidates(b, rt.profile, i, cand);
    if (!c) break;
    const dx = c[0] - b.px;
    const dz = c[2] - b.pz;
    const dist = dsqrt(dx * dx + dz * dz);
    if (dist < 0.5) continue;
    from[0] = b.px; from[1] = b.py + 0.4; from[2] = b.pz;
    dir[0] = dx; dir[1] = 0; dir[2] = dz;
    if (backend.castRay(from, dir, dist + 0.45, GROUP_BIT.static)) continue;      // a wall between the car and the spot
    from[0] = c[0]; from[1] = b.py + 2.5; from[2] = c[2];
    const g = backend.castRay(from, down, 6, GROUP_BIT.static);
    if (!g) continue;                                                            // no ground there
    const groundY = from[1] - g.toi;
    if (groundY < b.py - 2.5 || groundY > b.py + 1.2) continue;                  // a drop or a step too high
    out[0] = c[0]; out[1] = groundY; out[2] = c[2];
    return true;
  }
  return false;
}

/** The Control-stage system that runs the vehicle transitions. Registered after the ownership system (order 5). */
export function enterExitSystem(opts: EnterExitOptions): SystemDef {
  const { backend, store } = opts;
  const cfg = opts.config ?? PHYSICS_CONFIG.character;
  const centre = capsuleCentreOffset(cfg);
  const buf = new Float64Array(13);
  const pose = newPose();
  const spot: Vec3 = [0, 0, 0];
  const target: Vec3 = [0, 0, 0];

  return {
    id: ENTER_EXIT_ID, owner: 'S01', stage: SimStage.Control, order: 5,
    run: ({ ecs, tick }) => {
      const ids = ecs.query([Control, Transform, BodyRef]);
      if (ids.length === 0) return;
      const world = ecs as unknown as EcsWorld;
      const co = ecs.store(Control);
      const tr = ecs.store(Transform);
      const ve = ecs.store(Velocity);
      const pc = ecs.store(PlayerControlled).player;
      for (let n = 0; n < ids.length; n++) {
        const id = ids[n] as number;
        const owner = co.owner[id] as number;
        const pending = co.pending[id] as number;
        const phase = phaseOf(pending);
        const requested = requestedOf(pending);
        const handle = ecs.handle(id as EntityId);
        const since = co.sinceTick[id] as number;

        const go = (to: ControlPhaseId, own: ControlOwnerId, state: number, req: ControlOwnerId, why: string): void => {
          const from = phaseOf(co.pending[id] as number);
          co.pending[id] = packPending(to, req);
          co.owner[id] = own;
          co.sinceTick[id] = tick;
          co.state[id] = state;
          opts.services.events.push({ t: 'control.transition', tick, a: handle, n: state, s: `${OWNER_NAMES[own]} ${PHASE_NAMES[from]}>${PHASE_NAMES[to]} ${why}` });
          if (world.hasId(id, Anim)) {
            const an = ecs.store(Anim);
            an.state[id] = animStateOf(state);
            an.sinceTick[id] = tick;
          }
        };

        // --- OnFoot, Waiting for a vehicle
        if (owner === CONTROL_OWNER.OnFoot && phase === CONTROL_PHASE.Waiting && requested === CONTROL_OWNER.Vehicle) {
          const vid = co.target[id] as number;
          const rt = store.rt.get(vid);
          if (!rt || rt.driver !== id) {
            go(CONTROL_PHASE.Ready, CONTROL_OWNER.OnFoot, CONTROL_STATE.idle, CONTROL_OWNER.None, CONTROL_REASON.vehicleUnknown);
            opts.services.events.push({ t: 'control.refused', tick, a: handle, s: CONTROL_REASON.vehicleUnknown });
            continue;
          }
          // the capsule stops colliding and its mesh is hidden; the driver-sync system carries it to the seat
          backend.setBodyGroups(ecs.store(BodyRef).body[id] as number, GROUPS.sensor);
          if (world.hasId(id, RenderKey)) ecs.store(RenderKey).visible[id] = 0;
          if (world.hasId(id, CharacterBody)) {
            ecs.store(CharacterBody).grounded[id] = 0;
          }
          opts.services.camera.reason = 'vehicle';
          opts.services.camera.target = ecs.handle(vid as EntityId);
          go(CONTROL_PHASE.Entering, CONTROL_OWNER.Vehicle, CONTROL_STATE.vehicleEntering, CONTROL_OWNER.Vehicle, 'request vehicle');
          continue;
        }
        if (owner !== CONTROL_OWNER.Vehicle) continue;

        // --- Vehicle owner
        const vid = co.target[id] as number;
        if (phase === CONTROL_PHASE.Entering) {
          if (tick - since >= cfg.enterSettleTicks) go(CONTROL_PHASE.Active, CONTROL_OWNER.Vehicle, CONTROL_STATE.driving, CONTROL_OWNER.None, 'settled');
          continue;
        }
        if (phase === CONTROL_PHASE.Active) {
          let leave = requested === CONTROL_OWNER.OnFoot;
          if (!leave && pc[id] === 0) {
            const f = opts.services.input;
            if (f && (f.pressed & (1 << SimButton.Enter)) !== 0) {
              const r = requestExitVehicle(ecs, store, handle);
              if (r.ok) leave = true;
              else opts.services.events.push({ t: 'control.refused', tick, a: handle, s: r.reason });
            }
          }
          if (leave) {
            const rt = store.rt.get(vid);
            if (rt) {
              poseOf(backend, ecs.store(BodyRef).body[vid] as number, buf, pose);
              if (!findExitPoint(backend, pose, rt, spot)) {
                co.pending[id] = packPending(CONTROL_PHASE.Active, CONTROL_OWNER.None);
                opts.services.events.push({ t: 'control.refused', tick, a: handle, s: CONTROL_REASON.vehicleNoExit });
                continue;
              }
              co.pending[id] = packPending(CONTROL_PHASE.Leaving, CONTROL_OWNER.OnFoot);
              go(CONTROL_PHASE.Leaving, CONTROL_OWNER.Vehicle, CONTROL_STATE.vehicleExiting, CONTROL_OWNER.OnFoot, 'exit request');
              // The capsule is placed now: Rapier's character controller reads the collider position the physics step
              // propagates, and the leave settle (3 ticks, with at least one step) gives it that step before the on-foot owner moves it.
              const body = ecs.store(BodyRef).body[id] as number;
              const yaw = datan2(-pose.fx, -pose.fz);
              tr.px[id] = spot[0]; tr.py[id] = spot[1]; tr.pz[id] = spot[2];
              tr.qx[id] = 0; tr.qy[id] = dsin(yaw / 2); tr.qz[id] = 0; tr.qw[id] = dcos(yaw / 2);
              ve.vx[id] = 0; ve.vy[id] = 0; ve.vz[id] = 0; ve.wx[id] = 0; ve.wy[id] = 0; ve.wz[id] = 0;
              target[0] = spot[0]; target[1] = spot[1] + centre; target[2] = spot[2];
              backend.setBodyPose(body, target, identity);
              backend.setKinematicTarget(body, target, identity);
              backend.setBodyGroups(body, GROUPS.character);
              if (world.hasId(id, CharacterBody)) {
                const cb = ecs.store(CharacterBody);
                cb.grounded[id] = 1; cb.groundNormalY[id] = 1; cb.airTicks[id] = 0;
              }
              if (world.hasId(id, RenderKey)) ecs.store(RenderKey).visible[id] = 1;
            }
          }
          continue;
        }
        if (phase === CONTROL_PHASE.Leaving) {
          if (tick - since < cfg.leaveSettleTicks) continue;
          const rt = store.rt.get(vid);
          if (rt && rt.driver === id) rt.driver = 0;   // a passenger leaving keeps the driver at the wheel
          co.target[id] = 0;
          opts.services.camera.reason = 'player';
          opts.services.camera.target = 0;
          go(CONTROL_PHASE.Ready, CONTROL_OWNER.OnFoot, CONTROL_STATE.idle, CONTROL_OWNER.None, 'settled');
        }
      }
    },
  };
}

/**
 * Puts the driver's capsule at the seat of the vehicle it drives, after the physics step (stage PhysicsPost), and a player riding as a
 * passenger (owner Vehicle, state 202) at the passenger seat (`PASSENGER_SEAT_LOCAL`), so a passenger moves with the car like a driver
 * (DL-735 c).
 */
export function driverSyncSystem(opts: Pick<EnterExitOptions, 'backend' | 'store' | 'config'>): SystemDef {
  const { backend, store } = opts;
  const cfg = opts.config ?? PHYSICS_CONFIG.character;
  const centre = capsuleCentreOffset(cfg);
  const buf = new Float64Array(13);
  const pose = newPose();
  const seat: Vec3 = [0, 0, 0];
  const target: Vec3 = [0, 0, 0];
  return {
    id: DRIVER_SYNC_ID, owner: 'S01', stage: SimStage.PhysicsPost, order: 20,
    run: ({ ecs }) => {
      const ids = ecs.query([Vehicle, BodyRef]);
      if (ids.length === 0) return;
      const tr = ecs.store(Transform);
      const ve = ecs.store(Velocity);
      const co = ecs.store(Control);
      const bodies = ecs.store(BodyRef).body;
      for (let i = 0; i < ids.length; i++) {
        const vid = ids[i] as number;
        const rt = store.rt.get(vid);
        if (!rt || rt.driver === 0) continue;
        const d = rt.driver;
        const phase = phaseOf(co.pending[d] as number);
        if (co.owner[d] !== CONTROL_OWNER.Vehicle || phase === CONTROL_PHASE.Leaving) continue;
        poseOf(backend, bodies[vid] as number, buf, pose);
        toWorld(pose, SEAT_LOCAL, seat);
        tr.px[d] = seat[0]; tr.py[d] = seat[1]; tr.pz[d] = seat[2];
        const yaw = datan2(-pose.fx, -pose.fz);
        tr.qx[d] = 0; tr.qy[d] = dsin(yaw / 2); tr.qz[d] = 0; tr.qw[d] = dcos(yaw / 2);
        ve.vx[d] = pose.vx; ve.vy[d] = pose.vy; ve.vz[d] = pose.vz;
        target[0] = seat[0]; target[1] = seat[1] + centre; target[2] = seat[2];
        backend.setBodyPose(bodies[d] as number, target, identity);
        backend.setKinematicTarget(bodies[d] as number, target, identity);
      }
      const riders = ecs.query([PlayerControlled, Control, BodyRef]);
      for (let i = 0; i < riders.length; i++) {
        const p = riders[i] as number;
        if (co.owner[p] !== CONTROL_OWNER.Vehicle || co.state[p] !== CONTROL_STATE.passenger) continue;
        if (phaseOf(co.pending[p] as number) === CONTROL_PHASE.Leaving) continue;
        const vid = co.target[p] as number;
        if (vid === 0 || !(ecs as unknown as EcsWorld).hasId(vid, BodyRef)) continue;
        carryToSeat(ecs, backend, vid, p, PASSENGER_SEAT_LOCAL, cfg);
      }
    },
  };
}

/**
 * Puts the capsule of `rider` at the local point `local` of vehicle `vid` (dense ids), facing the vehicle's way, moving with it: what the
 * driver-sync system does for the driver, for a player riding as a passenger (DL-735 c; no engine path seats a passenger yet, state 202
 * is set by whoever makes one).
 */
export function carryToSeat(
  ecs: EcsApi, backend: VehiclePhysics, vid: number, rider: number, local: Readonly<Vec3>, config: CharacterConfig = PHYSICS_CONFIG.character,
): void {
  const bodies = ecs.store(BodyRef).body;
  const pose = poseOf(backend, bodies[vid] as number, new Float64Array(13), newPose());
  const seat = toWorld(pose, local, [0, 0, 0]);
  const tr = ecs.store(Transform);
  const ve = ecs.store(Velocity);
  tr.px[rider] = seat[0]; tr.py[rider] = seat[1]; tr.pz[rider] = seat[2];
  const yaw = datan2(-pose.fx, -pose.fz);
  tr.qx[rider] = 0; tr.qy[rider] = dsin(yaw / 2); tr.qz[rider] = 0; tr.qw[rider] = dcos(yaw / 2);
  ve.vx[rider] = pose.vx; ve.vy[rider] = pose.vy; ve.vz[rider] = pose.vz;
  if (!(ecs as unknown as EcsWorld).hasId(rider, BodyRef)) return;
  const target: Vec3 = [seat[0], seat[1] + capsuleCentreOffset(config), seat[2]];
  backend.setBodyPose(bodies[rider] as number, target, identity);
  backend.setKinematicTarget(bodies[rider] as number, target, identity);
}

/**
 * Seats `driver` in `vehicle` at once, in the Active state, without the entering sequence (QA, lines that start in a car,
 * scenarios that begin with the player at the wheel).
 */
export function seatDriver(
  ecs: EcsApi, backend: VehiclePhysics, store: VehicleStore, services: Pick<EngineServices, 'camera'>, driver: EntityHandle, vehicle: EntityHandle, tick: number,
): boolean {
  const did = ecs.resolve(driver);
  const vid = ecs.resolve(vehicle);
  if (did === null || vid === null) return false;
  const rt = store.rt.get(vid) ?? store.ensure(vid, ecs.strings.get(ecs.store(Vehicle).handling[vid] as number));
  if (rt.driver !== 0 && rt.driver !== did) return false;
  rt.driver = did;
  const co = ecs.store(Control);
  co.target[did] = vid;
  co.owner[did] = CONTROL_OWNER.Vehicle;
  co.state[did] = CONTROL_STATE.driving;
  co.sinceTick[did] = tick;
  co.pending[did] = packPending(CONTROL_PHASE.Active, CONTROL_OWNER.None);
  backend.setBodyGroups(ecs.store(BodyRef).body[did] as number, GROUPS.sensor);
  if ((ecs as unknown as EcsWorld).hasId(did, RenderKey)) ecs.store(RenderKey).visible[did] = 0;
  services.camera.reason = 'vehicle';
  services.camera.target = vehicle;
  return true;
}

/**
 * Takes `driver` out of the vehicle it drives at once, without the leaving sequence (DL-734; 02-world-maps.md 5 step 4: a driver keeps
 * the vehicle only when the teleport's target lies on a drivable edge, so for any other target the player is moved on foot; and the
 * below-the-world net's last resort for a car it cannot place). The opposite of `seatDriver`: the driver is the on-foot owner, idle and
 * ready for the ownership machine's teleport, its capsule collides again, is shown, stands still where the seat was, and the camera follows
 * it. The vehicle stays where it is, with nobody at the wheel. A player riding as a passenger (owner Vehicle, state 202) is taken out the
 * same way and the vehicle keeps its driver (DL-735 c). False when `driver` is not aboard a vehicle.
 */
export function unseatDriver(
  ecs: EcsApi, backend: VehiclePhysics, store: VehicleStore, services: Pick<EngineServices, 'camera' | 'events'>, driver: EntityHandle, tick: number,
): boolean {
  const did = ecs.resolve(driver);
  if (did === null) return false;
  const co = ecs.store(Control);
  if (co.owner[did] !== CONTROL_OWNER.Vehicle) return false;
  const vid = co.target[did] as number;
  const rt = store.rt.get(vid);
  if (rt && rt.driver === did) rt.driver = 0;
  const from = phaseOf(co.pending[did] as number);
  co.target[did] = 0;
  co.owner[did] = CONTROL_OWNER.OnFoot;
  co.state[did] = CONTROL_STATE.idle;
  co.sinceTick[did] = tick;
  co.pending[did] = packPending(CONTROL_PHASE.Ready, CONTROL_OWNER.None);
  const world = ecs as unknown as EcsWorld;
  const ve = ecs.store(Velocity);
  ve.vx[did] = 0; ve.vy[did] = 0; ve.vz[did] = 0; ve.wx[did] = 0; ve.wy[did] = 0; ve.wz[did] = 0;
  if (world.hasId(did, BodyRef)) backend.setBodyGroups(ecs.store(BodyRef).body[did] as number, GROUPS.character);
  if (world.hasId(did, RenderKey)) ecs.store(RenderKey).visible[did] = 1;
  if (world.hasId(did, CharacterBody)) ecs.store(CharacterBody).grounded[did] = 0;
  if (world.hasId(did, Anim)) {
    const an = ecs.store(Anim);
    an.state[did] = animStateOf(CONTROL_STATE.idle);
    an.sinceTick[did] = tick;
  }
  services.camera.reason = 'player';
  services.camera.target = 0;
  services.events.push({
    t: 'control.transition', tick, a: driver, n: CONTROL_STATE.idle,
    s: `${OWNER_NAMES[CONTROL_OWNER.OnFoot]} ${PHASE_NAMES[from]}>${PHASE_NAMES[CONTROL_PHASE.Ready]} unseat`,
  });
  return true;
}
