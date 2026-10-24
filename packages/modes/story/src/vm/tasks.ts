/**
 * NPC tasks (C09 section C3 `NpcTask`): `goto`, `driveTo`, `follow`, `enterVehicle`, `leaveVehicle`, `anim`, `look`, `idle`, `flee`.
 * A task is a small controller stepped once per tick for each cast entry that has one; a new task replaces the old. Walkers are
 * kinematic: the task writes the `Transform` and the physics body follows. Vehicles are driven through a `VehicleDriver` (the
 * engine's external vehicle input) with a pure-pursuit steering law over the C08 route; without a driver, or without a route, a
 * vehicle is moved along the straight line like a walker. Sim code under the C02 lint.
 */
import { datan2, dsin, dcos, dsqrt, type EntityHandle, type ModeContext, type NpcTask } from '@dv/shared';
import type { Actors, Vec3 } from './actors.ts';
import { distXZ } from './actors.ts';
import { routeWaypoints } from './route.ts';
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
/** A scripted car (`glideStep`): the waypoint it has reached, its acceleration and braking, and how fast it can turn. */
const GLIDE_REACH_M = 3;
const GLIDE_ACCEL_MPS2 = 3;
const GLIDE_BRAKE_MPS2 = 6;
const GLIDE_TURN_RAD_S = 3;

export interface TaskEnv {
  ctx(): ModeContext;
  actors: Actors;
  /** The centre of a zone in ENU metres, or null when the zone has none (an unknown name, an edge zone). */
  zoneCenter(zone: string): Vec3 | null;
  zoneInside(zone: string, h: EntityHandle): boolean;
  driver(): VehicleDriver | null;
  /** The distances between which a car that the player follows or chases eases off to wait for the player (M05c2); null for any other car. */
  pace?(cast: string): { slowAboveM: number; floorAtM: number; floor?: number } | null;
}

/** The share of its speed a leader keeps when the player is `d` metres behind: all of it up to `slowAboveM`, `PACE_FLOOR` of it from `floorAtM`. */
export const PACE_FLOOR = 0.35;
export function paceFactor(d: number, slowAboveM: number, floorAtM: number, floor = PACE_FLOOR): number {
  if (d <= slowAboveM) return 1;
  if (d >= floorAtM) return floor;
  return 1 - ((1 - floor) * (d - slowAboveM)) / (floorAtM - slowAboveM);
}

/** The speed a bend of the route ahead allows: the heading change over the next 40 m of waypoints against the first leg. */
export function cornerCap(path: readonly Vec3[], idx: number, here: Vec3, speed: number): number {
  let along = 0;
  let prev = here;
  let h0: number | null = null;
  let worst = 0;
  const look = 30 + speed * 2;
  for (let i = idx; i < path.length && along < look; i++) {
    const q = path[i] as Vec3;
    const dx = q[0] - prev[0];
    const dz = q[2] - prev[2];
    const len = dsqrt(dx * dx + dz * dz);
    if (len < 0.5) continue;
    const h = datan2(-dx, -dz);
    if (h0 === null) h0 = h;
    else {
      let dh = Math.abs(h - h0);
      if (dh > Math.PI) dh = 2 * Math.PI - dh;
      worst = Math.max(worst, dh);
    }
    along += len;
    prev = q;
  }
  return Math.max(4.5, Math.min(99, 18 - 11 * worst));
}

interface Active {
  task: NpcTask;
  since: number;
  /** A `driveTo` route as a polyline of ENU points, once planned. */
  path: Vec3[] | null;
  pathIdx: number;
  planned: boolean;
  done: boolean;
  /** A scripted car's speed, m/s, and the height of its centre above the ground (`glideStep`). */
  v: number;
  lift: number;
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
    this.active.set(cast, { task, since: tick, path: null, pathIdx: 0, planned: false, done: false, v: 0, lift: 0 });
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
          if (actors.isGlider(h)) actors.glide(h, here, actors.yawOf(h), 0);
          else this.env.driver()?.drive(h, { throttle: 0, brake: 1, steer: 0, handbrake: true });
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

  /**
   * A scripted car (a `convoy.*` kinematic prop) follows the route as a glider: it accelerates at 3 m/s2 toward the speed its bend and
   * the player's distance allow, brakes in time to stop on the goal, turns at most 3 rad/s and keeps its height over the ground. It
   * cannot stall on a curb or turn round at a junction, which a driven car does (BD-M05c1-04).
   */
  private glideStep(h: EntityHandle, a: Active, here: Vec3, goal: Vec3, mps: number, dt: number): void {
    const ctx = this.env.ctx();
    const actors = this.env.actors;
    if (!a.planned) {
      a.planned = true;
      a.path = planRoute(ctx, here, goal, actors.yawOf(h));
      a.pathIdx = 0;
      a.v = 0;
      const g = groundNear(ctx, here[0], here[2], here[1]);
      a.lift = g === null ? 0.6 : here[1] - g;
    }
    const path = a.path;
    if (path) while (a.pathIdx < path.length - 1 && distXZ(here, path[a.pathIdx] as Vec3) < GLIDE_REACH_M) a.pathIdx++;
    const target = path && path.length > 0 ? (path[a.pathIdx] as Vec3) : goal;
    const name = this.nameOf(h);
    let want = Math.min(mps, path ? cornerCap(path, a.pathIdx, here, a.v) : 99);
    const pace = this.env.pace?.(name) ?? null;
    const me = pace ? actors.pos('player') : null;
    if (pace && me) want *= paceFactor(distXZ(here, me), pace.slowAboveM, pace.floorAtM, pace.floor);
    const left = distXZ(here, goal);
    want = Math.min(want, dsqrt(2 * GLIDE_BRAKE_MPS2 * Math.max(0, left - ARRIVE_M)) + 0.5);
    a.v += Math.max(-GLIDE_BRAKE_MPS2 * dt, Math.min(GLIDE_ACCEL_MPS2 * dt, want - a.v));
    const yaw0 = actors.yawOf(h);
    const wantYaw = datan2(-(target[0] - here[0]), -(target[2] - here[2]));
    let dy = wantYaw - yaw0;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    const yaw = yaw0 + Math.max(-GLIDE_TURN_RAD_S * dt, Math.min(GLIDE_TURN_RAD_S * dt, dy));
    const x = here[0] - dsin(yaw) * a.v * dt;
    const z = here[2] - dcos(yaw) * a.v * dt;
    const gy = groundNear(ctx, x, z, here[1] - a.lift);
    actors.glide(h, [x, gy === null ? here[1] : gy + a.lift, z], yaw, a.v);
    if (left <= ARRIVE_M * 3) {
      a.done = true;
      a.v = 0;
      actors.glide(h, [x, gy === null ? here[1] : gy + a.lift, z], yaw, 0);
    }
  }

  private driveStep(h: EntityHandle, a: Active, here: Vec3, goal: Vec3, mps: number, dt: number): void {
    if (this.env.actors.isGlider(h)) return this.glideStep(h, a, here, goal, mps, dt);
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
    const name = this.nameOf(h);
    const speed = this.env.actors.speed(name);
    const yaw = this.env.actors.yawOf(h);
    // a car the player follows or chases waits for the player (M05c2), and every car slows for a bend of its route
    let want = Math.min(mps, path ? cornerCap(path, a.pathIdx, here, speed) : 99);
    const pace = this.env.pace?.(name) ?? null;
    const me = pace ? this.env.actors.pos('player') : null;
    if (pace && me) want *= paceFactor(distXZ(here, me), pace.slowAboveM, pace.floorAtM, pace.floor);
    const u = pursuit(here, yaw, speed, target, want);
    if (distXZ(here, goal) <= ARRIVE_M * 3) a.done = true;
    driver.drive(h, { ...u, handbrake: false });
  }

  private nameOf(h: EntityHandle): string {
    for (const n of this.active.keys()) if (this.env.actors.cast(n) === h) return n;
    return '';
  }
}

/** The ground height at (x, z) nearest to the height `y`: a road under an overpass, not the overpass (the world's query); the ray cast without a world. */
function groundNear(ctx: ModeContext, x: number, z: number, y: number): number | null {
  try {
    const g = ctx.world.query.groundY(x, z, y);
    if (g !== null && Number.isFinite(g)) return g;
  } catch {
    // no world service in this session: the ray below
  }
  return ctx.physics.groundY(x, z);
}

/**
 * A polyline along the C08 road graph from `from` to `to`, or null when there is no route. A driver that faces `yaw` is routed from a
 * point 3 m to the right of its heading, so it gets the lane it points along, and the samples of the first edge before the one nearest
 * to it are dropped (an edge can start far behind the car), M05c1.
 */
export function planRoute(ctx: ModeContext, from: Vec3, to: Vec3, yaw?: number): Vec3[] | null {
  try {
    return routeWaypoints(ctx.world, from, to, yaw);
  } catch {
    return null;
  }
}
