/**
 * The observation surface of the story autoplayer (M05a2; 03-story-missions.md C9). A bot reads this and nothing else: the active
 * objectives as the IR defines them, the places they point at (resolved zone centres, cast positions), the player's own pose and
 * the vehicle it sits in, and three read-only world queries (a ray, the ground height, a route on the road graph). It carries no
 * handle that can change the world; the bot's only way to act is the `InputFrame` it returns. Sim code under the C02 lint.
 */
import type { ModeContext, ObjectiveDef, WorldApi } from '@dv/shared';
import { dsqrt } from '@dv/shared';
import { Transform, Velocity } from '@dv/engine/sim';
import type { Vec3 } from '../vm/actors.ts';
import { quatYaw } from '../vm/actors.ts';
import type { MissionRuntime } from '../vm/runtime.ts';
import { byStr } from '../vm/util.ts';

export interface ObjView {
  id: string;
  def: ObjectiveDef;
  optional: boolean;
  /** Mission-clock ticks since the objective became active. */
  ageTicks: number;
}

export interface ZoneView {
  /** Centre in ENU metres; null for an edge zone. */
  c: Vec3 | null;
  /** Radius in metres (the bounding radius of a polygon). */
  r: number;
}

export interface CastView {
  pos: Vec3 | null;
  speed: number;
  yaw: number;
  carried: boolean;
  kind: 'npc' | 'vehicle' | 'prop' | 'pickup' | 'unit';
  /** A vehicle the player may drive (`playerUsable`). */
  usable: boolean;
  /** Someone sits in it (a vehicle) or it sits in a vehicle (an NPC). */
  occupied: boolean;
}

export interface MissionObs {
  tick: number;
  phase: string;
  stage: number;
  stageId: string;
  sec: number;
  heat: number;
  me: {
    pos: Vec3;
    yaw: number;
    /** Horizontal speed of the character, or of the vehicle it drives. */
    speed: number;
    vehicle: null | { cast: string | null; pos: Vec3; yaw: number; speed: number };
  };
  objectives: ObjView[];
  zones: Record<string, ZoneView>;
  cast: Record<string, CastView>;
  /** Positions of the landmarks that active `photo` objectives name. */
  landmarks: Record<string, Vec3>;
  /** Distance along `dir` (unit, ENU) to the first collider within `maxM`, or null. */
  ray(from: Vec3, dir: Vec3, maxM: number): number | null;
  groundY(x: number, z: number): number | null;
  /** Waypoints on the C08 road graph from `a` to `b`, or null when the world has no route (a gray-box build, an unreachable point). */
  route(a: Vec3, b: Vec3): Vec3[] | null;
}

function soft<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Error && e.name === 'NotYetAvailable') return undefined;
    throw e;
  }
}

function polyRadius(ring: readonly [number, number][], c: Vec3): number {
  let r = 0;
  for (const [x, z] of ring) {
    const d = dsqrt((x - c[0]) * (x - c[0]) + (z - c[2]) * (z - c[2]));
    if (d > r) r = d;
  }
  return r;
}

/** Route waypoints from a C08 route: the start of each edge's lane, then the end point. */
export function routeWaypoints(world: WorldApi, a: Vec3, b: Vec3): Vec3[] | null {
  const r = soft(() => world.graph.route({ from: { x: a[0], z: a[2] }, to: { x: b[0], z: b[2] }, maxExpand: 6000 }));
  if (!r || r.edges.length === 0) return null;
  const out: Vec3[] = [];
  const buf = new Float64Array(4);
  for (const e of r.edges) {
    soft(() => world.graph.laneCentre({ edge: e, s: 0, lane: 0 }, buf));
    out.push([buf[0] as number, buf[1] as number, buf[2] as number]);
  }
  out.push([b[0], b[1], b[2]]);
  return out;
}

export function observeMission(rt: MissionRuntime, ctx: ModeContext): MissionObs {
  const actors = rt.actors;
  const ecs = ctx.ecs;
  const tr = ecs.store(Transform);
  const ve = ecs.store(Velocity);

  const playerH = actors.player();
  const pid = playerH === null ? null : ecs.resolve(playerH);
  const pos: Vec3 = pid === null ? [0, 0, 0] : [tr.px[pid] as number, tr.py[pid] as number, tr.pz[pid] as number];
  const yaw = pid === null ? 0 : quatYaw(tr.qy[pid] as number, tr.qw[pid] as number);

  const vh = actors.playerVehicle();
  let vehicle: MissionObs['me']['vehicle'] = null;
  if (vh !== null) {
    const vid = ecs.resolve(vh);
    if (vid !== null) {
      const vp: Vec3 = [tr.px[vid] as number, tr.py[vid] as number, tr.pz[vid] as number];
      const vx = ve.vx[vid] as number;
      const vz = ve.vz[vid] as number;
      let cast: string | null = null;
      for (const name of rt.castRt.keys()) if (actors.cast(name) === vh) cast = name;
      vehicle = { cast, pos: vp, yaw: quatYaw(tr.qy[vid] as number, tr.qw[vid] as number), speed: dsqrt(vx * vx + vz * vz) };
    }
  }

  const objectives: ObjView[] = [];
  for (const o of rt.objectives.values()) {
    if (o.state === 'active') objectives.push({ id: o.def.id, def: o.def, optional: o.def.optional === true, ageTicks: rt.clock - o.since });
  }
  objectives.sort((a, b) => byStr(a.id, b.id));

  const zones: Record<string, ZoneView> = {};
  if (rt.rm) {
    for (const name of Object.keys(rt.rm.zones).sort(byStr)) {
      const z = rt.rm.zones[name];
      if (!z) continue;
      const c = rt.zoneCenter(name);
      zones[name] = { c, r: z.k === 'circle' || z.k === 'cast' ? z.r : z.k === 'poly' && c ? polyRadius(z.ring, c) : 0 };
    }
  }

  const cast: Record<string, CastView> = {};
  if (rt.ir) {
    for (const name of Object.keys(rt.ir.cast).sort(byStr)) {
      const def = rt.ir.cast[name];
      if (!def) continue;
      const h = actors.cast(name);
      const id = h === null ? null : ecs.resolve(h);
      const p = h === null ? null : actors.posOf(h);
      let speed = 0;
      let cy = 0;
      if (id !== null) {
        const vx = ve.vx[id] as number;
        const vz = ve.vz[id] as number;
        speed = dsqrt(vx * vx + vz * vz);
        cy = quatYaw(tr.qy[id] as number, tr.qw[id] as number);
      }
      const occupied = def.k === 'vehicle' ? actors.playerVehicle() === h && h !== null : actors.inVehicle(name);
      cast[name] = {
        pos: p,
        speed,
        yaw: cy,
        carried: rt.isCarried(name),
        kind: def.k,
        usable: def.k === 'vehicle' && def.playerUsable === true,
        occupied,
      };
    }
  }

  const landmarks: Record<string, Vec3> = {};
  for (const o of objectives) {
    if (o.def.k === 'photo' && o.def.subject.startsWith('lm.')) {
      const p = rt.landmarkPos(o.def.subject);
      if (p) landmarks[o.def.subject] = p;
    }
  }

  return {
    tick: ctx.tick,
    phase: rt.phase,
    stage: rt.stageIndex,
    stageId: rt.stage?.id ?? '',
    sec: rt.clock / 60,
    heat: rt.heat().level,
    me: { pos, yaw, speed: actors.speed('player'), vehicle },
    objectives,
    zones,
    cast,
    landmarks,
    ray: (from, dir, maxM) => {
      const hit = ctx.physics.castRay(from, dir, maxM);
      return hit ? hit.toi : null;
    },
    groundY: (x, z) => ctx.physics.groundY(x, z),
    route: (a, b) => routeWaypoints(ctx.world, a, b),
  };
}
