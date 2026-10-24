/**
 * `EcsPursuitHost` (M03c): the director's `PursuitHost` and `VehicleDamagePort` on the real sim. Units are the `police.*` prefabs
 * (M03a1): cruisers and SUVs are ordinary vehicles whose `VehicleRuntime` is `external`, so their input is the director's and the
 * handling model does the rest; the helicopter is a kinematic body moved through its `Transform`.
 *
 * Structural changes (spawn, despawn) are queued commands applied at the end of the AI stage, so a unit spawned this step is
 * `ready` from the next stage on.
 *
 * Sim code under the C02 lint.
 */
import { NULL_HANDLE, datan2, dsqrt, dsin, dcos, type EntityHandle, type EntityId, type StableKey } from '@dv/shared';
import { Control, LocalPlayer, Police, Transform, Vehicle, VehicleDamage, Velocity } from '../ecs/components.ts';
import type { EcsWorld } from '../ecs/world.ts';
import { CONTROL_OWNER } from '../control/states.ts';
import type { SimEvent } from '../events.ts';
import { GROUP_BIT } from '../physics/groups.ts';
import type { VehiclePhysics } from '../physics/backend.ts';
import type { PrefabService } from '../prefabs/registry.ts';
import type { EngineServices } from '../services.ts';
import type { VehicleStore } from '../vehicle/components.ts';
import type { DriveInput, PlayerView, PursuitHost, UnitRole, UnitView, Vec3, VehicleDamagePort, VehicleView } from './ports.ts';

export interface EcsHostDeps {
  ecs: EcsWorld;
  backend: VehiclePhysics;
  services: EngineServices;
  prefabs: Pick<PrefabService, 'spawn' | 'despawn'>;
  store: VehicleStore;
  /** The tick to stamp events with. */
  tick: () => number;
}

interface UnitRecord {
  role: UnitRole;
  spawn: Vec3;
  yaw: number;
  /** Tick the spawn was issued. */
  since: number;
}

/** Heading of a body from its quaternion: 0 faces -Z, -pi/2 faces +X. */
export function yawOf(qx: number, qy: number, qz: number, qw: number): number {
  const hx = -2 * (qx * qz + qw * qy);
  const hz = -(1 - 2 * (qx * qx + qy * qy));
  return datan2(-hx, -hz);
}

export class EcsPursuitHost implements PursuitHost, VehicleDamagePort {
  private readonly units = new Map<number, UnitRecord>();
  private readonly eye: [number, number, number] = [0, 0, 0];

  constructor(private readonly d: EcsHostDeps) {}

  private dense(h: number): number | null {
    return this.d.ecs.resolve(h as EntityHandle);
  }

  // ---- the player ------------------------------------------------------------------------------------------------------------

  player(): PlayerView | null {
    const ecs = this.d.ecs;
    const ids = ecs.query([LocalPlayer, Transform, Control]);
    if (ids.length === 0) return null;
    const pid = ids[0] as number;
    const tr = ecs.store(Transform);
    const ve = ecs.store(Velocity);
    const co = ecs.store(Control);
    let id = pid;
    let onFoot = true;
    let vehicleKey: string | null = null;
    if (co.owner[pid] === CONTROL_OWNER.Vehicle) {
      const vid = co.target[pid] as number;
      if (ecs.hasId(vid, Vehicle)) {
        id = vid;
        onFoot = false;
        vehicleKey = ecs.keyOf(ecs.handle(vid as EntityId));
      }
    }
    const vx = ve.vx[id] as number, vy = ve.vy[id] as number, vz = ve.vz[id] as number;
    return {
      pos: [tr.px[id] as number, tr.py[id] as number, tr.pz[id] as number],
      vel: [vx, vy, vz],
      speed: dsqrt(vx * vx + vz * vz),
      yaw: yawOf(tr.qx[id] as number, tr.qy[id] as number, tr.qz[id] as number, tr.qw[id] as number),
      onFoot,
      vehicleKey,
      grappled: false,
    };
  }

  // ---- units -----------------------------------------------------------------------------------------------------------------

  spawnUnit(prefab: string, role: UnitRole, pos: Vec3, yaw: number, key: StableKey): number {
    try {
      const h = this.d.prefabs.spawn(prefab, { pos, yaw }, key);
      if (h === NULL_HANDLE) return 0;
      this.units.set(h, { role, spawn: [pos[0], pos[1], pos[2]], yaw, since: this.d.tick() });
      return h;
    } catch {
      return 0;
    }
  }

  despawnUnit(id: number): void {
    if (this.units.delete(id)) this.d.prefabs.despawn(id as EntityHandle);
  }

  unit(id: number): UnitView | null {
    const rec = this.units.get(id);
    if (!rec) return null;
    const dense = this.dense(id);
    if (dense === null) {
      // the spawn command applies at the end of the stage that issued it; later than that the entity is gone
      return this.d.tick() - rec.since <= 2
        ? { id, role: rec.role, pos: rec.spawn, yaw: rec.yaw, speed: 0, vel: [0, 0, 0], ready: false, tires: [1, 1, 1, 1] }
        : null;
    }
    const ecs = this.d.ecs;
    const tr = ecs.store(Transform);
    const ve = ecs.store(Velocity);
    const yaw = yawOf(tr.qx[dense] as number, tr.qy[dense] as number, tr.qz[dense] as number, tr.qw[dense] as number);
    const vx = ve.vx[dense] as number, vy = ve.vy[dense] as number, vz = ve.vz[dense] as number;
    const fx = -dsin(yaw), fz = -dcos(yaw);
    const dmg = ecs.hasId(dense, VehicleDamage) ? ecs.store(VehicleDamage) : null;
    return {
      id,
      role: rec.role,
      pos: [tr.px[dense] as number, tr.py[dense] as number, tr.pz[dense] as number],
      yaw,
      speed: vx * fx + vz * fz,
      vel: [vx, vy, vz],
      ready: true,
      tires: dmg
        ? [(dmg.tires[0] as Float32Array)[dense] as number, (dmg.tires[1] as Float32Array)[dense] as number, (dmg.tires[2] as Float32Array)[dense] as number, (dmg.tires[3] as Float32Array)[dense] as number]
        : [1, 1, 1, 1],
    };
  }

  drive(id: number, input: DriveInput): void {
    const dense = this.dense(id);
    if (dense === null || !this.d.ecs.hasId(dense, Vehicle)) return;
    const ecs = this.d.ecs;
    const handling = ecs.strings.get(ecs.store(Vehicle).handling[dense] as number);
    const rt = this.d.store.ensure(dense, handling);
    rt.external = true;
    rt.input.throttle = Math.round(Math.min(1, Math.max(0, input.throttle)) * 127);
    rt.input.brake = Math.round(Math.min(1, Math.max(0, input.brake)) * 127);
    rt.input.steer = Math.round(Math.min(1, Math.max(-1, input.steer)) * 127);
    rt.input.handbrake = input.handbrake;
  }

  fly(id: number, pos: Vec3, yaw: number): void {
    const dense = this.dense(id);
    if (dense === null) return;
    const tr = this.d.ecs.store(Transform);
    tr.px[dense] = pos[0];
    tr.py[dense] = pos[1];
    tr.pz[dense] = pos[2];
    tr.qx[dense] = 0;
    tr.qy[dense] = dsin(yaw / 2);
    tr.qz[dense] = 0;
    tr.qw[dense] = dcos(yaw / 2);
  }

  // ---- the world -------------------------------------------------------------------------------------------------------------

  los(a: Vec3, b: Vec3): boolean {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const d = dsqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.5) return true;
    return this.d.backend.castRay([a[0], a[1], a[2]], [dx / d, dy / d, dz / d], d - 0.4, GROUP_BIT.static) === null;
  }

  solid(pos: Vec3): boolean {
    return this.d.backend.castRay([pos[0], pos[1] + 3, pos[2]], [0, -1, 0], 60, GROUP_BIT.static) !== null;
  }

  groundY(x: number, z: number): number | null {
    const api = this.d.services.world.api;
    return api ? api.query.groundY(x, z) : null;
  }

  placeProp(prefab: string, pos: Vec3, yaw: number, key: StableKey): number {
    try {
      const h = this.d.prefabs.spawn(prefab, { pos, yaw }, key);
      return h === NULL_HANDLE ? 0 : h;
    } catch {
      return 0;
    }
  }

  removeProp(id: number): void {
    this.d.prefabs.despawn(id as EntityHandle);
  }

  vehiclesNear(x: number, z: number, r: number): VehicleView[] {
    const ecs = this.d.ecs;
    const ids = ecs.query([Vehicle, Transform]);
    const tr = ecs.store(Transform);
    const ve = ecs.store(Velocity);
    const out: VehicleView[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as number;
      const dx = (tr.px[id] as number) - x, dz = (tr.pz[id] as number) - z;
      if (dx * dx + dz * dz > r * r) continue;
      const yaw = yawOf(tr.qx[id] as number, tr.qy[id] as number, tr.qz[id] as number, tr.qw[id] as number);
      const h = ecs.handle(id as EntityId);
      this.eye[0] = ve.vx[id] as number;
      this.eye[2] = ve.vz[id] as number;
      out.push({
        id: h,
        key: ecs.keyOf(h) ?? '',
        pos: [tr.px[id] as number, tr.py[id] as number, tr.pz[id] as number],
        yaw,
        speed: this.eye[0] * -dsin(yaw) + this.eye[2] * -dcos(yaw),
        police: ecs.hasId(id, Police),
      });
    }
    return out;
  }

  impound(_vehicleKey: string): void {
    // the economy and the garage give the impound its meaning (M04a2, M05c1); the director's event is the fact
  }

  emit(e: SimEvent): void {
    this.d.services.events.push(e);
  }

  // ---- VehicleDamagePort ---------------------------------------------------------------------------------------------------------

  setTireHealth(vehicleId: number, tire: 0 | 1 | 2 | 3, health: number): void {
    const dense = this.dense(vehicleId);
    if (dense === null || !this.d.ecs.hasId(dense, VehicleDamage)) return;
    (this.d.ecs.store(VehicleDamage).tires[tire] as Float32Array)[dense] = health;
  }
}
