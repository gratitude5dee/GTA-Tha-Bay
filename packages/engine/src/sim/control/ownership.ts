import { SimStage, type EcsApi, type EntityHandle, type EntityId, type SystemDef } from '@dv/shared';
import { Anim, BodyRef, CharacterBody, Control, PlayerControlled, Transform, Velocity } from '../ecs/components.ts';
import type { PhysicsSystemsBackend, Vec3 } from '../physics/backend.ts';
import { PHYSICS_CONFIG, type CharacterConfig } from '../physics/config.ts';
import { GROUP_BIT } from '../physics/groups.ts';
import type { EngineServices } from '../services.ts';
import { capsuleCentreOffset } from './onfoot.ts';
import {
  animStateOf, CONTROL_OWNER, CONTROL_PHASE, CONTROL_REASON, CONTROL_STATE, OWNER_NAMES, PHASE_NAMES, packPending, phaseOf,
  requestedOf, type ControlOwnerId, type ControlPhaseId,
} from './states.ts';

export const OWNERSHIP_ID = 'engine.control.ownership';

export interface OwnershipOptions {
  backend: PhysicsSystemsBackend;
  services: Pick<EngineServices, 'events' | 'control'>;
  config?: CharacterConfig;
}

/** Answer to a request. `reason` is a localisation key (CONTROL_REASON) when `ok` is false. */
export type RequestResult = { ok: true } | { ok: false; reason: string };

const identity: [number, number, number, number] = [0, 0, 0, 1];

/**
 * Asks for the ragdoll owner. Accepted only while the entity is idle in the machine (phase Ready, owner OnFoot);
 * the next Control stage runs it. Called between ticks (debug command) or from a system.
 */
export function requestRagdoll(ecs: EcsApi, h: EntityHandle): RequestResult {
  const id = ecs.resolve(h);
  if (id === null) return { ok: false, reason: CONTROL_REASON.wrongOwner };
  const co = ecs.store(Control);
  if (co.owner[id] !== CONTROL_OWNER.OnFoot) return { ok: false, reason: CONTROL_REASON.wrongOwner };
  if (phaseOf(co.pending[id] as number) !== CONTROL_PHASE.Ready) return { ok: false, reason: CONTROL_REASON.busy };
  co.pending[id] = packPending(CONTROL_PHASE.Ready, CONTROL_OWNER.Ragdoll);
  return { ok: true };
}

/**
 * Asks to move the entity to `pos` (ENU metres; `pos[1]` is where the ground search starts from, so any height works).
 * State goes 700 (pending) to 701 (waiting for a static collider under the target); see `ownershipSystem`.
 * `tick` is the number of the next tick to run.
 */
export function requestTeleport(ecs: EcsApi, services: Pick<EngineServices, 'control'>, h: EntityHandle, pos: Vec3, tick: number): RequestResult {
  const id = ecs.resolve(h);
  if (id === null) return { ok: false, reason: CONTROL_REASON.wrongOwner };
  const co = ecs.store(Control);
  if (co.owner[id] !== CONTROL_OWNER.OnFoot) return { ok: false, reason: CONTROL_REASON.wrongOwner };
  if (phaseOf(co.pending[id] as number) !== CONTROL_PHASE.Ready || services.control.teleportActive) {
    return { ok: false, reason: CONTROL_REASON.busy };
  }
  services.control.teleportActive = true;
  services.control.teleportX = pos[0];
  services.control.teleportY = pos[1];
  services.control.teleportZ = pos[2];
  co.state[id] = CONTROL_STATE.teleportPending;
  co.sinceTick[id] = tick;
  co.pending[id] = packPending(CONTROL_PHASE.Waiting, CONTROL_OWNER.OnFoot);
  return { ok: true };
}

/**
 * Asks to move the vehicle `h` rides in, at its wheel or as a passenger, with `h` aboard, onto the ground at `pos` facing `yaw` (DL-734;
 * 02-world-maps.md 5 step 4: a driver keeps the vehicle when the target lies on a drivable edge, which the caller checks; DL-735 c: a
 * passenger is moved with the car like a driver). Accepted only while `h` rides (owner Vehicle, phase Active) and no on-foot teleport
 * runs; the vehicle module makes the move at once (`EngineServices.vehicleMove`), or refuses with `engine.control.groundNotLoaded` where
 * no static collider is under the target yet.
 */
export function requestDriverTeleport(
  ecs: EcsApi, services: Pick<EngineServices, 'control' | 'vehicleMove'>, h: EntityHandle, pos: Vec3, yaw: number,
): RequestResult {
  if (ecs.resolve(h) === null) return { ok: false, reason: CONTROL_REASON.wrongOwner };
  if (ridingVehicle(ecs, h) === 0) return { ok: false, reason: CONTROL_REASON.wrongOwner };
  if (services.control.teleportActive) return { ok: false, reason: CONTROL_REASON.busy };
  const move = services.vehicleMove;
  if (!move) return { ok: false, reason: CONTROL_REASON.wrongOwner };
  return move(h, pos, yaw);
}

/**
 * Asks to move the player `h` to `pos` facing `yaw` through the ownership machine (02-world-maps.md 5 step 4; DL-734, DL-735): on foot,
 * the ownership machine's teleport (`requestTeleport`); aboard a vehicle (at the wheel or as a passenger) with `onRoad` (the target lies
 * on a drivable edge), the vehicle with the player (`requestDriverTeleport`); aboard with a target off the drivable edges (a marker on a
 * plaza or a pavement), the player gets out at once (`EngineServices.vehicleUnseat`) and is moved on foot, so such a move is never
 * refused for riding. A move refused for another reason (`busy`, no seat service) changes nothing. The world's teleport calls it after its
 * own checks; the below-the-world nets call it (or `requestTeleport`) directly, because a rescue must never be refused by mode rules,
 * heat or a cooldown (DL-735 a).
 */
export function requestPlayerMove(
  ecs: EcsApi, services: Pick<EngineServices, 'control' | 'vehicleMove' | 'vehicleUnseat'>, h: EntityHandle, pos: Vec3, yaw: number, tick: number, onRoad: boolean,
): RequestResult {
  if (ridingVehicle(ecs, h) === 0) return requestTeleport(ecs, services, h, pos, tick);
  if (onRoad) return requestDriverTeleport(ecs, services, h, pos, yaw);
  if (services.control.teleportActive) return { ok: false, reason: CONTROL_REASON.busy };
  const unseat = services.vehicleUnseat;
  if (!unseat || !unseat(h, tick)) return { ok: false, reason: CONTROL_REASON.wrongOwner };
  return requestTeleport(ecs, services, h, pos, tick);
}

/** The vehicle (dense id) `h` rides in, at the wheel or as a passenger (owner Vehicle, phase Active), or 0. */
export function ridingVehicle(ecs: EcsApi, h: EntityHandle): number {
  const id = ecs.resolve(h);
  if (id === null) return 0;
  const co = ecs.store(Control);
  if (co.owner[id] !== CONTROL_OWNER.Vehicle || phaseOf(co.pending[id] as number) !== CONTROL_PHASE.Active) return 0;
  return co.target[id] as number;
}

/** True while `h` drives a vehicle (owner Vehicle, phase Active, not riding as a passenger). */
export function isDriving(ecs: EcsApi, h: EntityHandle): boolean {
  const id = ecs.resolve(h);
  if (id === null || ridingVehicle(ecs, h) === 0) return false;
  return ecs.store(Control).state[id] !== CONTROL_STATE.passenger;
}

/**
 * True when a player is aboard vehicle `vid` (dense id): a player-controlled entity whose `Control` owner is Vehicle with that target, at
 * the wheel or as a passenger, entering or leaving. The traffic's despawn of an ambient vehicle under the world (02-world-maps.md 4.1 d,
 * DL-735 c) leaves such a vehicle to the vehicle net.
 */
export function vehicleHasPlayer(ecs: EcsApi, vid: number): boolean {
  const ids = ecs.query([PlayerControlled, Control]);
  const co = ecs.store(Control);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as number;
    if (co.owner[id] === CONTROL_OWNER.Vehicle && co.target[id] === vid) return true;
  }
  return false;
}

/**
 * The ownership state machine (stage Control; spec/domains/01-engine.md section 2.5).
 *
 *   Ready, Waiting, Entering, Active, Leaving (Delegated is reserved for swim and climb).
 *
 * `Ready` is the settled phase of the base owner (`OnFoot`): the entity is under normal control and nothing is
 * pending. Every other owner is entered through Waiting and Entering and left through Leaving.
 *
 * Owners in this milestone: `OnFoot`, and a `Ragdoll` stub (300 for `ragdollTicks`, then 301 for `getUpTicks`, then 100)
 * with no physics body of its own. A teleport is a transition of the base owner: 700 (pending), 701 (waiting for a
 * static collider under the target, up to `groundWaitTicks`), a settle of `enterSettleTicks`, then 100. When the
 * wait runs out the entity returns to Ready with reason `engine.control.groundNotLoaded` and its position is unchanged.
 *
 * Every transition is appended to `services.events` as `control.transition`; a refusal is `control.refused`.
 */
export function ownershipSystem(opts: OwnershipOptions): SystemDef {
  const backend = opts.backend;
  const cfg = opts.config ?? PHYSICS_CONFIG.character;
  const centre = capsuleCentreOffset(cfg);
  const probeFrom: Vec3 = [0, 0, 0];
  const down: Vec3 = [0, -1, 0];
  const target: Vec3 = [0, 0, 0];

  return {
    id: OWNERSHIP_ID, owner: 'S01', stage: SimStage.Control, order: 0,
    run: ({ ecs, tick }) => {
      const services = opts.services;
      const ids = ecs.query([Control]);
      if (ids.length === 0) return;
      const co = ecs.store(Control);
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i] as number;
        const handle = ecs.handle(id as EntityId);

        const go = (phase: ControlPhaseId, owner: ControlOwnerId, state: number, requested: ControlOwnerId, why: string): void => {
          const from = phaseOf(co.pending[id] as number);
          co.pending[id] = packPending(phase, requested);
          co.owner[id] = owner;
          co.sinceTick[id] = tick;
          co.state[id] = state;
          services.events.push({ t: 'control.transition', tick, a: handle, n: state, s: `${OWNER_NAMES[owner]} ${PHASE_NAMES[from]}>${PHASE_NAMES[phase]} ${why}` });
        };

        // A few transitions can chain in one tick (Ready, Waiting, Entering, Active for a ragdoll).
        for (let guard = 0; guard < 8; guard++) {
          const pending = co.pending[id] as number;
          const phase = phaseOf(pending);
          const requested = requestedOf(pending);
          const owner = co.owner[id] as number;
          const state = co.state[id] as number;
          const since = co.sinceTick[id] as number;

          if (owner === CONTROL_OWNER.OnFoot && phase === CONTROL_PHASE.Ready) {
            if (requested === CONTROL_OWNER.Ragdoll) {
              go(CONTROL_PHASE.Waiting, owner, state, requested, 'request ragdoll');
              continue;
            }
            break;
          }

          if (phase === CONTROL_PHASE.Waiting && requested === CONTROL_OWNER.Ragdoll) {
            // A ragdoll needs no colliders and no assets: nothing to wait for.
            go(CONTROL_PHASE.Entering, CONTROL_OWNER.Ragdoll, CONTROL_STATE.ragdoll, requested, 'ready');
            continue;
          }
          if (phase === CONTROL_PHASE.Entering && owner === CONTROL_OWNER.Ragdoll) {
            go(CONTROL_PHASE.Active, CONTROL_OWNER.Ragdoll, CONTROL_STATE.ragdoll, CONTROL_OWNER.None, 'settled');
            continue;
          }
          if (phase === CONTROL_PHASE.Active && owner === CONTROL_OWNER.Ragdoll) {
            if (tick - since >= cfg.ragdollTicks) {
              go(CONTROL_PHASE.Leaving, owner, CONTROL_STATE.gettingUp, CONTROL_OWNER.None, 'get up');
              continue;
            }
            break;
          }
          if (phase === CONTROL_PHASE.Leaving && owner === CONTROL_OWNER.Ragdoll) {
            if (tick - since >= cfg.getUpTicks) {
              go(CONTROL_PHASE.Ready, CONTROL_OWNER.OnFoot, CONTROL_STATE.idle, CONTROL_OWNER.None, 'settled');
              continue;
            }
            break;
          }

          // --- teleport (base owner, phases Waiting then Entering)
          if (owner === CONTROL_OWNER.OnFoot && phase === CONTROL_PHASE.Waiting && state === CONTROL_STATE.teleportPending) {
            go(CONTROL_PHASE.Waiting, owner, CONTROL_STATE.teleportWaiting, CONTROL_OWNER.OnFoot, 'waiting for colliders');
            continue;
          }
          if (owner === CONTROL_OWNER.OnFoot && phase === CONTROL_PHASE.Waiting && state === CONTROL_STATE.teleportWaiting) {
            const c = services.control;
            probeFrom[0] = c.teleportX;
            probeFrom[1] = c.teleportY + cfg.groundProbeM;
            probeFrom[2] = c.teleportZ;
            const hit = backend.castRay(probeFrom, down, cfg.groundProbeM * 2, GROUP_BIT.static);
            if (hit) {
              const groundY = probeFrom[1] - hit.toi;
              const tr = ecs.store(Transform);
              const ve = ecs.store(Velocity);
              const cb = ecs.store(CharacterBody);
              tr.px[id] = c.teleportX;
              tr.py[id] = groundY;
              tr.pz[id] = c.teleportZ;
              ve.vx[id] = 0;
              ve.vy[id] = 0;
              ve.vz[id] = 0;
              cb.grounded[id] = 1;
              cb.groundNormalY[id] = hit.normal[1];
              cb.airTicks[id] = 0;
              if (ecs.has(handle, BodyRef)) {
                target[0] = c.teleportX;
                target[1] = groundY + centre;
                target[2] = c.teleportZ;
                backend.setKinematicTarget(ecs.store(BodyRef).body[id] as number, target, identity);
              }
              go(CONTROL_PHASE.Entering, owner, CONTROL_STATE.teleportWaiting, CONTROL_OWNER.OnFoot, 'ground found');
              continue;
            }
            if (tick - since + 1 >= cfg.groundWaitTicks) {
              services.control.teleportActive = false;
              go(CONTROL_PHASE.Ready, owner, CONTROL_STATE.idle, CONTROL_OWNER.None, CONTROL_REASON.groundNotLoaded);
              services.events.push({ t: 'control.refused', tick, a: handle, s: CONTROL_REASON.groundNotLoaded });
              continue;
            }
            break;
          }
          if (owner === CONTROL_OWNER.OnFoot && phase === CONTROL_PHASE.Entering) {
            if (tick - since >= cfg.enterSettleTicks) {
              services.control.teleportActive = false;
              go(CONTROL_PHASE.Ready, owner, CONTROL_STATE.idle, CONTROL_OWNER.None, 'settled');
              continue;
            }
            break;
          }
          break;
        }

        // Anim follows the control state for the states owned here (the on-foot controller writes it while walking).
        if (co.owner[id] !== CONTROL_OWNER.OnFoot || co.state[id] === CONTROL_STATE.teleportPending || co.state[id] === CONTROL_STATE.teleportWaiting) {
          if (ecs.has(handle, Anim)) {
            const an = ecs.store(Anim);
            const animState = animStateOf(co.state[id] as number);
            if (an.state[id] !== animState) {
              an.state[id] = animState;
              an.sinceTick[id] = tick;
            }
          }
        }
      }
    },
  };
}
