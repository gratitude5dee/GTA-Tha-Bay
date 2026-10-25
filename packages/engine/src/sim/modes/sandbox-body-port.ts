/**
 * The engine side of the sandbox's body tools (M04e4): which session car the player means, repairing and uprighting it, patching the
 * player up, and the three session flags. The sandbox mode (`builtin/sandbox-body.ts`) never touches the ECS; it is handed this port.
 * Everything here acts on cars the caller names in `owned` (the `veh:sbx<n>` cars of M04e3), never on any other vehicle.
 * Sim code under the C02 lint: no wall time, no randomness.
 */
import { datan2, dcos, dsin, dsqrt, type EntityHandle, type PhysicsQueries } from '@dv/shared';
import { Control, Health, LocalPlayer, Transform, Vehicle, VehicleDamage, BodyRef } from '../ecs/components.ts';
import type { EcsWorld } from '../ecs/world.ts';
import { CONTROL_OWNER } from '../control/states.ts';
import type { VehiclePhysics } from '../physics/backend.ts';
import type { VehicleStore } from '../vehicle/components.ts';
import { anyFlag, sandboxFlagsResource, SANDBOX_FLAGS_RESOURCE, type SandboxFlags } from '../sandbox-flags.ts';
import type { EngineServices } from '../services.ts';

/** A car is "beside" the player within this distance of its centre, metres. */
export const NEAR_CAR_M = 6;
/** Above this speed `upright` refuses, m/s. */
export const UPRIGHT_MAX_SPEED_MPS = 2;
/** The car is set this far above the ground when righted, metres. */
export const UPRIGHT_LIFT_M = 0.6;
/** A forward axis shorter than this on the ground plane means the car stands on its nose or tail. */
const MIN_FORWARD_PROJECTION = 0.2;

export type UprightResult = 'ok' | 'moving' | 'noGround';

export interface SandboxBodyPort {
  /** The owned car the local player drives, else the nearest owned car within 6 m of the player (lower handle on a tie), else null. */
  target(owned: readonly EntityHandle[]): EntityHandle | null;
  /** True while the local player is at the wheel of owned car `h`. */
  driving(h: EntityHandle): boolean;
  /** Body, engine and all four tires back to 1; the water stall cleared. */
  repair(h: EntityHandle): void;
  /** Stands the car on its wheels where it is, keeping its heading; refuses while it is moving or has no ground under it. */
  upright(h: EntityHandle): UprightResult;
  /** The local player's health to full and any knockout cleared. */
  restorePlayer(): void;
  /** Writes the flags; the `sandbox-flags` resource is registered on the first write that sets one. */
  setFlags(f: SandboxFlags): void;
  flags(): SandboxFlags;
}

export interface SandboxBodyDeps {
  ecs: EcsWorld;
  services: Pick<EngineServices, 'sandboxFlags'>;
  backend: Pick<VehiclePhysics, 'setBodyPose' | 'setBodyVelocity'>;
  store: Pick<VehicleStore, 'rt'>;
  physics: Pick<PhysicsQueries, 'groundY'>;
  /** Registers and drops the hashed `sandbox-flags` resource on the running sim core; absent in tests that need no hashing. */
  resources?: { add(r: ReturnType<typeof sandboxFlagsResource>): void; remove(name: string): void };
}

export function createSandboxBodyPort(d: SandboxBodyDeps): SandboxBodyPort {
  const { ecs, services, backend, store } = d;
  let registered = false;

  const playerId = (): number | null => {
    const ids = ecs.query([LocalPlayer, Control, Transform]);
    return ids.length > 0 ? (ids[0] as number) : null;
  };

  return {
    target(owned) {
      const pid = playerId();
      if (pid === null) return null;
      const co = ecs.store(Control);
      const tr = ecs.store(Transform);
      if (co.owner[pid] === CONTROL_OWNER.Vehicle) {
        const vid = co.target[pid] as number;
        for (const h of owned) if (ecs.resolve(h) === vid) return h;
      }
      const px = tr.px[pid] as number;
      const py = tr.py[pid] as number;
      const pz = tr.pz[pid] as number;
      let best: EntityHandle | null = null;
      let bestD = NEAR_CAR_M * NEAR_CAR_M;
      for (const h of owned) {
        const vid = ecs.resolve(h);
        if (vid === null || !ecs.hasId(vid, Vehicle)) continue;
        const dx = (tr.px[vid] as number) - px;
        const dy = (tr.py[vid] as number) - py;
        const dz = (tr.pz[vid] as number) - pz;
        const dist = dx * dx + dy * dy + dz * dz;
        if (dist < bestD || (dist === bestD && best !== null && (h as number) < (best as number))) {
          best = h;
          bestD = dist;
        }
      }
      return best;
    },

    driving(h) {
      const pid = playerId();
      const vid = ecs.resolve(h);
      if (pid === null || vid === null) return false;
      const co = ecs.store(Control);
      return co.owner[pid] === CONTROL_OWNER.Vehicle && co.target[pid] === vid;
    },

    repair(h) {
      const vid = ecs.resolve(h);
      if (vid === null || !ecs.hasId(vid, VehicleDamage)) return;
      const dmg = ecs.store(VehicleDamage);
      dmg.body[vid] = 1;
      dmg.engine[vid] = 1;
      for (let k = 0; k < 4; k++) (dmg.tires[k] as Float32Array)[vid] = 1;
      const rt = store.rt.get(vid);
      if (rt !== undefined) rt.wet = { wetTicks: 0, stalled: false };
    },

    upright(h) {
      const vid = ecs.resolve(h);
      if (vid === null || !ecs.hasId(vid, Vehicle)) return 'noGround';
      if (Math.abs(ecs.store(Vehicle).speed[vid] as number) > UPRIGHT_MAX_SPEED_MPS) return 'moving';
      const tr = ecs.store(Transform);
      const x = tr.px[vid] as number;
      const z = tr.pz[vid] as number;
      const gy = d.physics.groundY(x, z);
      if (gy === null) return 'noGround';
      const qx = tr.qx[vid] as number;
      const qy = tr.qy[vid] as number;
      const qz = tr.qz[vid] as number;
      const qw = tr.qw[vid] as number;
      // forward is -Z in the body frame; fall back to the up axis when the car stands on its nose or tail
      let fx = -2 * (qx * qz + qw * qy);
      let fz = -(1 - 2 * (qx * qx + qy * qy));
      if (dsqrt(fx * fx + fz * fz) < MIN_FORWARD_PROJECTION) {
        fx = 2 * (qx * qy - qw * qz);
        fz = 2 * (qy * qz + qw * qx);
      }
      const heading = datan2(-fx, -fz);
      const body = ecs.store(BodyRef).body[vid] as number;
      backend.setBodyPose(body, [x, gy + UPRIGHT_LIFT_M, z], [0, dsin(heading * 0.5), 0, dcos(heading * 0.5)]);
      backend.setBodyVelocity(body, [0, 0, 0], [0, 0, 0]);
      tr.py[vid] = gy + UPRIGHT_LIFT_M;
      tr.qx[vid] = 0;
      tr.qy[vid] = dsin(heading * 0.5);
      tr.qz[vid] = 0;
      tr.qw[vid] = dcos(heading * 0.5);
      return 'ok';
    },

    restorePlayer() {
      const pid = playerId();
      if (pid === null || !ecs.hasId(pid, Health)) return;
      const hp = ecs.store(Health);
      hp.hp[pid] = hp.max[pid] as number;
      hp.ko[pid] = 0;
      hp.koUntilTick[pid] = 0;
    },

    setFlags(f) {
      const cur = services.sandboxFlags;
      cur.godMode = f.godMode;
      cur.superJump = f.superJump;
      cur.carNoDamage = f.carNoDamage;
      if (anyFlag(cur)) {
        if (!registered) {
          d.resources?.add(sandboxFlagsResource(() => services.sandboxFlags));
          registered = true;
        }
      } else if (registered) {
        // all off: the resource goes, so the hash is the never-set hash again
        d.resources?.remove(SANDBOX_FLAGS_RESOURCE);
        registered = false;
      }
    },

    flags: () => ({ ...services.sandboxFlags }),
  };
}
