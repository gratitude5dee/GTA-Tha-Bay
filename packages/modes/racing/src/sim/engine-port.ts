/**
 * The engine side of `RaceWorldPort` (M07a1): the player's car as a real vehicle of the M03a1 module. The racing mode itself
 * (`mode.ts`) never touches the engine; it is handed one of these by the racing sim module (`module.ts`), and the headless QA
 * scenario (`qa/scenario.ts`) builds one over its own sim. Sim code under the C02 lint (`datan2`, `dsqrt`, no clock).
 *
 * How the car is driven: the race car is `external` for the vehicle module, so `rt.input` is whatever `drive()` wrote and the
 * player's frame is not read by the handling step. The local player is seated in it with `seatDriver` (camera and ownership
 * follow). Damage is the race model's: `setDamage` overwrites the `VehicleDamage` component the handling step reads.
 */
import {
  BodyRef, Control, LocalPlayer, packPending, CONTROL_OWNER, CONTROL_PHASE, GROUP_BIT, seatDriver, Transform, Vehicle, VehicleDamage, Velocity,
  type EngineServices, type PrefabRegistry, type RapierBackend, type VehicleStore, type EcsWorld,
} from '@dv/engine/sim';
import { datan2, dcos, dsin, dsqrt, PI, type DamageState, type EntityHandle } from '@dv/shared';
import type { CarCommand, CarImpact, CarReadout, RaceWorldPort } from './port.ts';

export interface EnginePortDeps {
  ecs: EcsWorld;
  backend: RapierBackend;
  services: EngineServices;
  store: VehicleStore;
  prefabs: PrefabRegistry;
  tick(): number;
}

const NO_HANDLE = 0 as EntityHandle;

export function createEnginePort(d: EnginePortDeps): RaceWorldPort & { carHandle(): EntityHandle } {
  const { ecs, backend, services, store, prefabs } = d;
  let car: EntityHandle = NO_HANDLE;
  let seated = false;
  let impacts: CarImpact[] = [];
  const buf = new Float64Array(13);
  const groundRay = (x: number, z: number): number | null => {
    const hit = backend.castRay([x, 500, z], [0, -1, 0], 1000, GROUP_BIT.static);
    return hit ? 500 - hit.toi : null;
  };

  // contacts of the player's car, taken from the event log as the vehicle module pushes them
  const log = services.events;
  const push = log.push.bind(log);
  log.push = (e): void => {
    push(e);
    if (e.t === 'vehicle.impact' && car !== NO_HANDLE && e.a === car) impacts.push({ vNormal: e.n ?? 0, frontal: e.s !== 'rear' });
  };

  const carId = (): number | null => (car === NO_HANDLE ? null : ecs.resolve(car));

  return {
    carHandle: () => car,
    collidersReady: (x, z) => groundRay(x, z) !== null,
    groundY: groundRay,

    spawnCar(prefabId, pos, yaw) {
      if (car === NO_HANDLE) {
        car = prefabs.spawn(prefabId, { pos, yaw }, 'veh:race0');
        seated = false;
        return false;
      }
      if (seated) return true;
      const vid = carId();
      const player = ecs.byKey('player:0');
      if (vid === null || ecs.resolve(player) === null) return false;
      const rt = store.rt.get(vid) ?? store.ensure(vid, ecs.strings.get(ecs.store(Vehicle).handling[vid] as number));
      rt.external = true;
      rt.input.handbrake = true;
      seated = seatDriver(ecs, backend, store, services, player, car, d.tick());
      return seated;
    },

    read(): CarReadout | null {
      const vid = carId();
      if (vid === null || !seated) return null;
      const rt = store.rt.get(vid);
      if (!rt) return null;
      const body = ecs.store(BodyRef).body[vid] as number;
      backend.readBody(body, buf);
      const [px, py, pz, qx, qy, qz, qw] = [buf[0], buf[1], buf[2], buf[3], buf[4], buf[5], buf[6]] as [number, number, number, number, number, number, number];
      const fx = -2 * (qx * qz + qw * qy);
      const fz = -(1 - 2 * (qx * qx + qy * qy));
      const upY = 1 - 2 * (qx * qx + qz * qz);
      const vx = buf[7] as number;
      const vy = buf[8] as number;
      const vz = buf[9] as number;
      const speed = ecs.store(Vehicle).speed[vid] as number;
      const hl = dsqrt(fx * fx + fz * fz) || 1;
      const hx = fx / hl;
      const hz = fz / hl;
      const frontM = rt.profile.wheelbaseM * (1 - rt.profile.frontWeightPct / 100);
      const lat = vx * -hz + vz * hx;
      const lon = vx * hx + vz * hz;
      return {
        pos: [px, py, pz],
        front: [px + hx * frontM, py, pz + hz * frontM],
        yaw: datan2(-hx, -hz),
        speedMps: speed,
        vel: [vx, vy, vz],
        upY,
        airTicks: rt.airTicks,
        gear: rt.hs.gear,
        rpm: rt.hs.rpm,
        slipDeg: (datan2(lat, lon < 0 ? -lon : lon) * 180) / PI,
      };
    },

    place(pos, yaw) {
      const vid = carId();
      if (vid === null) return;
      const body = ecs.store(BodyRef).body[vid] as number;
      const q: [number, number, number, number] = [0, dsin(yaw / 2), 0, dcos(yaw / 2)];
      backend.setBodyPose(body, pos, q);
      backend.setBodyVelocity(body, [0, 0, 0], [0, 0, 0]);
      const tr = ecs.store(Transform);
      tr.px[vid] = pos[0]; tr.py[vid] = pos[1]; tr.pz[vid] = pos[2];
      tr.qx[vid] = 0; tr.qy[vid] = q[1]; tr.qz[vid] = 0; tr.qw[vid] = q[3];
      const ve = ecs.store(Velocity);
      ve.vx[vid] = 0; ve.vy[vid] = 0; ve.vz[vid] = 0; ve.wx[vid] = 0; ve.wy[vid] = 0; ve.wz[vid] = 0;
      const rt = store.rt.get(vid);
      if (rt) {
        for (let k = 0; k < 4; k++) rt.susp[k] = Number.NaN;
        rt.lastVx = 0;
        rt.lastVz = 0;
        rt.impactAcc = 0;
        rt.hs.gear = 0;
        rt.hs.shiftTicks = 0;
        rt.hs.nitroOn = false;
      }
      impacts = [];
    },

    drive(c: CarCommand) {
      const vid = carId();
      if (vid === null) return;
      const rt = store.rt.get(vid);
      if (!rt) return;
      rt.input.throttle = c.throttle < 0 ? 0 : c.throttle > 127 ? 127 : c.throttle;
      rt.input.brake = c.brake < 0 ? 0 : c.brake > 127 ? 127 : c.brake;
      rt.input.steer = c.steer < -127 ? -127 : c.steer > 127 ? 127 : c.steer;
      rt.input.handbrake = c.handbrake;
    },

    setNitro(on, charge) {
      const vid = carId();
      if (vid === null) return;
      const rt = store.rt.get(vid);
      if (!rt) return;
      rt.hs.nitroOn = on;
      rt.hs.nitro = charge;
    },

    setDamage(s: DamageState) {
      const vid = carId();
      if (vid === null) return;
      const dmg = ecs.store(VehicleDamage);
      dmg.body[vid] = s.body;
      dmg.engine[vid] = s.engine;
      for (let k = 0; k < 4; k++) (dmg.tires[k] as Float32Array)[vid] = s.tires[k] as number;
    },

    takeImpacts() {
      const out = impacts;
      impacts = [];
      return out;
    },

    release() {
      const vid = carId();
      const player = ecs.byKey('player:0');
      const pid = ecs.resolve(player);
      if (vid !== null) {
        const rt = store.rt.get(vid);
        if (rt) {
          rt.external = false;
          rt.input.throttle = 0;
          rt.input.brake = 0;
          rt.input.steer = 0;
          rt.input.handbrake = true;
          rt.hs.nitroOn = false;
        }
      }
      if (seated && pid !== null && ecs.has(player, LocalPlayer)) {
        // ask the ownership machine to let the driver out; it finds a free spot beside the car
        const co = ecs.store(Control);
        if (co.owner[pid] === CONTROL_OWNER.Vehicle) co.pending[pid] = packPending(CONTROL_PHASE.Active, CONTROL_OWNER.OnFoot);
      }
      seated = false;
      car = NO_HANDLE;
    },
  };
}
