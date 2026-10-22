import { datan2, dcos, dsin, dsqrt, type EntityHandle, type ModeContext } from '@dv/shared';
import { CONTROL_OWNER, Control, Health, LocalPlayer, Seat, Transform, Vehicle, VehicleDamage, Velocity } from '@dv/engine/sim';

export type Vec3 = [number, number, number];

/** Reads and moves the entities a mission talks about: the player, its vehicle and the cast (`mis:<id>:<name>`). Sim code under the C02 lint. */
export class Actors {
  constructor(
    private readonly get: () => ModeContext,
    private readonly missionId: () => string,
  ) {}

  keyOf(cast: string): `mis:${string}:${string}` {
    return `mis:${this.missionId()}:${cast}`;
  }

  player(): EntityHandle | null {
    const h = this.get().ecs.byKey('player:0');
    return h === 0 ? null : h;
  }

  cast(name: string): EntityHandle | null {
    const ecs = this.get().ecs;
    const h = ecs.byKey(this.keyOf(name));
    return h === 0 || ecs.resolve(h) === null ? null : h;
  }

  /** The vehicle the local player is driving, or null on foot. */
  playerVehicle(): EntityHandle | null {
    const p = this.player();
    if (p === null) return null;
    const ecs = this.get().ecs;
    const id = ecs.resolve(p);
    if (id === null || !ecs.has(p, Control)) return null;
    const co = ecs.store(Control);
    if (co.owner[id] !== CONTROL_OWNER.Vehicle) return null;
    const vid = co.target[id] as number;
    return vid === 0 ? null : ecs.handle(vid as never);
  }

  /** `player`, `playerVehicle` or a cast name. */
  handleOf(who: string): EntityHandle | null {
    if (who === 'player') return this.player();
    if (who === 'playerVehicle') return this.playerVehicle();
    return this.cast(who);
  }

  pos(who: string): Vec3 | null {
    const h = this.handleOf(who);
    return h === null ? null : this.posOf(h);
  }

  posOf(h: EntityHandle): Vec3 | null {
    const ecs = this.get().ecs;
    const id = ecs.resolve(h);
    if (id === null || !ecs.has(h, Transform)) return null;
    const tr = ecs.store(Transform);
    return [tr.px[id] as number, tr.py[id] as number, tr.pz[id] as number];
  }

  yawOf(h: EntityHandle): number {
    const ecs = this.get().ecs;
    const id = ecs.resolve(h);
    if (id === null) return 0;
    const tr = ecs.store(Transform);
    // the rotation is about +Y only: yaw = 2 * atan2(qy, qw), written without a transcendental
    return quatYaw(tr.qy[id] as number, tr.qw[id] as number);
  }

  /** Moves an entity to a point and heading, and stops it. */
  place(h: EntityHandle, pos: Vec3, yaw: number): void {
    const ecs = this.get().ecs;
    const id = ecs.resolve(h);
    if (id === null || !ecs.has(h, Transform)) return;
    const tr = ecs.store(Transform);
    tr.px[id] = pos[0];
    tr.py[id] = pos[1];
    tr.pz[id] = pos[2];
    const [qy, qw] = yawQuat(yaw);
    tr.qx[id] = 0;
    tr.qy[id] = qy;
    tr.qz[id] = 0;
    tr.qw[id] = qw;
    if (ecs.has(h, Velocity)) {
      const v = ecs.store(Velocity);
      v.vx[id] = 0;
      v.vy[id] = 0;
      v.vz[id] = 0;
    }
  }

  /** Health as a fraction 0..1, or null for an entity without `Health`. */
  healthFrac(who: string): number | null {
    const h = this.handleOf(who);
    if (h === null) return null;
    const ecs = this.get().ecs;
    const id = ecs.resolve(h);
    if (id === null || !ecs.has(h, Health)) return null;
    const hp = ecs.store(Health);
    const max = hp.max[id] as number;
    return max > 0 ? (hp.hp[id] as number) / max : 0;
  }

  setHealth(h: EntityHandle, frac: number): void {
    const ecs = this.get().ecs;
    const id = ecs.resolve(h);
    if (id === null || !ecs.has(h, Health)) return;
    const hp = ecs.store(Health);
    hp.hp[id] = (hp.max[id] as number) * frac;
    hp.ko[id] = frac <= 0 ? 1 : 0;
  }

  isKo(who: string): boolean {
    const h = this.handleOf(who);
    if (h === null) return false;
    const ecs = this.get().ecs;
    const id = ecs.resolve(h);
    if (id === null || !ecs.has(h, Health)) return false;
    const hp = ecs.store(Health);
    return (hp.ko[id] as number) !== 0 || (hp.hp[id] as number) <= 0;
  }

  /** Vehicle damage 0..1 (`VehicleDamage.body`), 0 for an entity without it. */
  damage(who: string): number {
    const h = this.handleOf(who);
    if (h === null) return 0;
    const ecs = this.get().ecs;
    const id = ecs.resolve(h);
    if (id === null || !ecs.has(h, VehicleDamage)) return 0;
    return ecs.store(VehicleDamage).body[id] as number;
  }

  isVehicle(h: EntityHandle): boolean {
    return this.get().ecs.has(h, Vehicle);
  }

  /** Horizontal speed in m/s; a player in a vehicle moves with it. */
  speed(who: string): number {
    const h = who === 'player' ? (this.playerVehicle() ?? this.player()) : this.handleOf(who);
    if (h === null) return 0;
    const ecs = this.get().ecs;
    const id = ecs.resolve(h);
    if (id === null || !ecs.has(h, Velocity)) return 0;
    const v = ecs.store(Velocity);
    const vx = v.vx[id] as number;
    const vz = v.vz[id] as number;
    return dsqrt(vx * vx + vz * vz);
  }

  /** True when `who` sits in a vehicle: for `vehicle` 'any' or undefined any vehicle, else the cast vehicle of that name. */
  inVehicle(who: string, vehicle?: string): boolean {
    const ecs = this.get().ecs;
    let vh: EntityHandle | null = null;
    if (who === 'player') vh = this.playerVehicle();
    else {
      const h = this.cast(who);
      if (h !== null && ecs.has(h, Seat)) {
        const id = ecs.resolve(h) as number;
        const v = ecs.store(Seat).vehicle[id] as number;
        vh = v === 0 ? null : ecs.handle(v as never);
      }
    }
    if (vh === null) return false;
    if (vehicle === undefined || vehicle === 'any') return true;
    return vh === this.cast(vehicle);
  }

  /** Whether the local player is the entity `h` or the player's own vehicle is. */
  isPlayerSide(h: EntityHandle): boolean {
    return h === this.player() || h === this.playerVehicle();
  }

  distance(a: string, b: string): number {
    const pa = this.pos(a);
    const pb = this.pos(b);
    if (!pa || !pb) return Infinity;
    return dist3(pa, pb);
  }

  /** Marks an entity as seated in `vehicle` (NPC cast), or clears the seat. */
  seat(h: EntityHandle, vehicle: EntityHandle | null, seat: number): void {
    const ecs = this.get().ecs;
    const id = ecs.resolve(h);
    if (id === null || !ecs.has(h, Seat)) return;
    const s = ecs.store(Seat);
    const v = vehicle === null ? null : ecs.resolve(vehicle);
    s.vehicle[id] = v ?? 0;
    s.seat[id] = v === null ? -1 : seat;
  }

  /** Whether an entity has a `LocalPlayer` tag (the player of this session). */
  isLocalPlayer(h: EntityHandle): boolean {
    return this.get().ecs.has(h, LocalPlayer);
  }
}

export const dist3 = (a: Vec3, b: Vec3): number => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dsqrt(dx * dx + dy * dy + dz * dz);
};
export const distXZ = (a: Vec3, b: Vec3): number => {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return dsqrt(dx * dx + dz * dz);
};

/** Heading from the Y-rotation quaternion `(0, qy, 0, qw)`. */
export const quatYaw = (qy: number, qw: number): number => 2 * datan2(qy, qw);
/** `[qy, qw]` of a heading about +Y. */
export const yawQuat = (yaw: number): [number, number] => [dsin(yaw / 2), dcos(yaw / 2)];
