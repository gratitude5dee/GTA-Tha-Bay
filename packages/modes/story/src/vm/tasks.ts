/**
 * NPC tasks (C09 section C3 `NpcTask`): `goto`, `driveTo`, `follow`, `enterVehicle`, `leaveVehicle`, `anim`, `look`, `idle`, `flee`.
 * A task is a small controller stepped once per tick for each cast entry that has one; a new task replaces the old. Walkers are
 * kinematic: the task writes the `Transform` and the physics body follows. Vehicles are driven through a `VehicleDriver` (the
 * engine's external vehicle input) with a pure-pursuit steering law over the C08 route; without a driver, or without a route, a
 * vehicle is moved along the straight line like a walker. Sim code under the C02 lint.
 */
import { routeWaypoints } from '../autoplay/observe.ts';
import { datan2, dsqrt, type EntityHandle, type ModeContext, type NpcTask } from '@dv/shared';
import type { Actors, Vec3 } from './actors.ts';
import { distXZ } from './actors.ts';
import { byStr } from './util.ts';

/** The engine's way to set a vehicle's input from a script (it marks the vehicle `external`). */
export interface VehicleDriver {
  drive(h: EntityHandle, input: { throttle: number; brake: number; steer: number; handbrake: boolean }): boolean;
}

export const WALK_MPS = 1.4;
export const RUN_MPS = 4.5;
const DRIVE_MPS = { normal: 11, fast: 18, flee: 22 } as const;
const ARRIVE_M = 1.2;
const SEAT_REACH_M = 3;
const LOOKAHEAD_M = 8;

export interface TaskEnv {
  ctx(): ModeContext;
  actors: Actors;
  /** The centre of a zone in ENU metres, or null when the zone has none (an unknown name, an edge zone). */
  zoneCenter(zone: string): Vec3 | null;
  zoneInside(zone: string, h: EntityHandle): boolean;
  driver(): VehicleDriver | null;
}

interface Active {
  task: NpcTask;
  since: number;
  /** A `driveTo` route as a polyline of ENU points, once planned. */
  path: Vec3[] | null;
  pathIdx: number;
  planned: boolean;
  done: boolean;
}

/** Steering for a vehicle at `pos` heading `yaw` that wants to reach `target` at `speedWant`; inputs in -1..1 and 0..1. Pure. */
export function pursuit(pos: Vec3, yaw: number, speed: number, target: Vec3, speedWant: number): { throttle: number; brake: number; steer: number } {
  // forward is (-sin yaw, -cos yaw), so -Z at yaw 0: the heading that points at the target is atan2(-dx, -dz), and a target to the
  // right (a smaller yaw) wants a positive steer (positive is right)
  const dx = target[0] - pos[0];
  const dz = target[2] - pos[2];
  const want = datan2(-dx, -dz);
  let err = want - yaw;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  const steer = Math.max(-1, Math.min(1, -err * 1.4));
  const slow = Math.abs(err) > 0.9 ? 0.35 : 1;
  const want2 = speedWant * slow;
  const throttle = speed < want2 ? Math.min(1, (want2 - speed) / 4 + 0.2) : 0;
  const brake = speed > want2 + 2 ? Math.min(1, (speed - want2) / 10) : 0;
  return { throttle, brake, steer };
}

/** Moves `from` toward `to` by `step` metres on the ground plane; returns the new point and the heading. */
export function stepToward(from: Vec3, to: Vec3, step: number): { pos: Vec3; yaw: number; arrived: boolean } {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const d = dsqrt(dx * dx + dz * dz);
  const yaw = d > 1e-6 ? datan2(-dx, -dz) : 0;
  if (d <= step) return { pos: [to[0], from[1], to[2]], yaw, arrived: true };
  return { pos: [from[0] + (dx / d) * step, from[1], from[2] + (dz / d) * step], yaw, arrived: false };
}

export class TaskRunner {
  private readonly active = new Map<string, Active>();

  constructor(private readonly env: TaskEnv) {}

  assign(cast: string, task: NpcTask, tick: number): void {
    this.active.set(cast, { task, since: tick, path: null, pathIdx: 0, planned: false, done: false });
  }

  clear(cast?: string): void {
    if (cast === undefined) this.active.clear();
    else this.active.delete(cast);
  }

  /** The kind of task a cast entry runs, for the debugger; '' when none. */
  kindOf(cast: string): string {
    const a = this.active.get(cast);
    return a && !a.done ? a.task.t : '';
  }

  names(): string[] {
    return [...this.active.keys()].sort(byStr);
  }

  tick(): void {
    const ctx = this.env.ctx();
    const dt = ctx.dt;
    for (const name of this.names()) {
      const a = this.active.get(name) as Active;
      const h = this.env.actors.cast(name);
      if (h === null) {
        this.active.delete(name);
        continue;
      }
      if (a.done) continue;
      this.step(h, a, dt);
    }
  }

  private move(h: EntityHandle, from: Vec3, to: Vec3, mps: number, dt: number): boolean {
    const ctx = this.env.ctx();
    const r = stepToward(from, to, mps * dt);
    const gy = ctx.physics.groundY(r.pos[0], r.pos[2]);
    this.env.actors.place(h, [r.pos[0], gy ?? r.pos[1], r.pos[2]], r.yaw);
    return r.arrived;
  }

  private step(h: EntityHandle, a: Active, dt: number): void {
    const actors = this.env.actors;
    const here = actors.posOf(h);
    if (!here) return;
    const t = a.task;
    switch (t.t) {
      case 'idle':
      case 'anim':
        a.done = true;
        return;
      case 'goto': {
        const c = this.env.zoneCenter(t.zone);
        if (!c || this.env.zoneInside(t.zone, h)) {
          a.done = true;
          return;
        }
        const isVeh = actors.isVehicle(h);
        if (isVeh || t.mode === 'drive') {
          this.driveStep(h, a, here, c, DRIVE_MPS.normal, dt);
          return;
        }
        if (this.move(h, here, c, t.mode === 'run' ? RUN_MPS : WALK_MPS, dt)) a.done = true;
        return;
      }
      case 'driveTo': {
        const c = this.env.zoneCenter(t.zone);
        if (!c || this.env.zoneInside(t.zone, h)) {
          a.done = true;
          this.env.driver()?.drive(h, { throttle: 0, brake: 1, steer: 0, handbrake: true });
          return;
        }
        this.driveStep(h, a, here, c, DRIVE_MPS[t.style], dt);
        return;
      }
      case 'follow': {
        const target = actors.pos(t.who);
        if (!target) return;
        const gap = distXZ(here, target);
        const driver = actors.isVehicle(h) ? this.env.driver() : null;
        if (driver) {
          // a car follows like a driver (M05c1, the tow of m.a1.01): hold `distM` metres behind the leader, at its speed plus what closes the gap
          if (gap <= t.distM) {
            driver.drive(h, { throttle: 0, brake: 0.5, steer: 0, handbrake: false });
            return;
          }
          const me = this.nameOf(h);
          const want = Math.min(DRIVE_MPS.normal, actors.speed(t.who) + 2 + (gap - t.distM) * 0.6);
          const u = pursuit(here, actors.yawOf(h), actors.speed(me), target, want);
          driver.drive(h, { ...u, handbrake: false });
          return;
        }
        if (gap > t.distM) this.move(h, here, target, gap > 12 ? RUN_MPS : WALK_MPS, dt);
        return;
      }
      case 'flee': {
        const from = actors.pos(t.from);
        if (!from) return;
        const dx = here[0] - from[0];
        const dz = here[2] - from[2];
        const d = dsqrt(dx * dx + dz * dz) || 1;
        this.move(h, here, [here[0] + (dx / d) * 30, here[1], here[2] + (dz / d) * 30], RUN_MPS, dt);
        return;
      }
      case 'look': {
        const target = actors.pos(t.who);
        if (!target) return;
        const dx = target[0] - here[0];
        const dz = target[2] - here[2];
        actors.place(h, here, datan2(-dx, -dz));
        return;
      }
      case 'enterVehicle': {
        const v = actors.cast(t.vehicle);
        const vp = v ? actors.posOf(v) : null;
        if (!v || !vp) {
          a.done = true;
          return;
        }
        if (distXZ(here, vp) > SEAT_REACH_M) {
          this.move(h, here, vp, WALK_MPS * 2, dt);
          return;
        }
        actors.seat(h, v, t.seat);
        actors.place(h, vp, actors.yawOf(v));
        a.done = true;
        return;
      }
      case 'leaveVehicle': {
        actors.seat(h, null, -1);
        actors.place(h, [here[0] + 2.2, here[1], here[2]], actors.yawOf(h));
        a.done = true;
        return;
      }
    }
  }

  private driveStep(h: EntityHandle, a: Active, here: Vec3, goal: Vec3, mps: number, dt: number): void {
    const ctx = this.env.ctx();
    const driver = this.env.driver();
    if (!driver) {
      if (this.move(h, here, goal, mps, dt)) a.done = true;
      return;
    }
    if (!a.planned) {
      a.planned = true;
      a.path = planRoute(ctx, here, goal, this.env.actors.yawOf(h));
    }
    const path = a.path;
    let target = goal;
    if (path && path.length > 0) {
      while (a.pathIdx < path.length - 1 && distXZ(here, path[a.pathIdx] as Vec3) < LOOKAHEAD_M) a.pathIdx++;
      target = path[a.pathIdx] as Vec3;
    }
    const speed = this.env.actors.speed(this.nameOf(h));
    const yaw = this.env.actors.yawOf(h);
    const u = pursuit(here, yaw, speed, target, mps);
    if (distXZ(here, goal) <= ARRIVE_M * 3) a.done = true;
    driver.drive(h, { ...u, handbrake: false });
  }

  private nameOf(h: EntityHandle): string {
    for (const n of this.active.keys()) if (this.env.actors.cast(n) === h) return n;
    return '';
  }
}

/**
 * A polyline along the C08 road graph from `from` to `to`, or null when there is no route. A driver that faces `yaw` gets the lane it
 * points along (the router starts 3 m to the right of the heading), and the route is sampled every 12 m, as the autoplayer's is (M05c1).
 */
export function planRoute(ctx: ModeContext, from: Vec3, to: Vec3, yaw?: number): Vec3[] | null {
  try {
    return routeWaypoints(ctx.world, from, to, yaw);
  } catch {
    return null;
  }
}
