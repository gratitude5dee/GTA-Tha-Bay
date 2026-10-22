/**
 * The observation surface of the story autoplayer (M05a2; 03-story-missions.md C9). A bot reads this and nothing else: the active
 * objectives as the IR defines them, the places they point at (resolved zone centres, cast positions), the player's own pose and
 * the vehicle it sits in, and three read-only world queries (a ray, the ground height, a route on the road graph). It carries no
 * handle that can change the world; the bot's only way to act is the `InputFrame` it returns. Sim code under the C02 lint.
 */
import type { ModeContext, ObjectiveDef, WorldApi } from '@dv/shared';
import { dcos, dsin, dsqrt } from '@dv/shared';
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
  /** The stub objective of each mode hook, by hook id: the bot plays a hook through its stub (M05c1). */
  hookStubs: Record<string, ObjectiveDef>;
  /** Positions of the landmarks that active `photo` objectives name. */
  landmarks: Record<string, Vec3>;
  /** Distance along `dir` (unit, ENU) to the first collider within `maxM`, or null. */
  ray(from: Vec3, dir: Vec3, maxM: number): number | null;
  groundY(x: number, z: number): number | null;
  /** Waypoints on the C08 road graph from `a` to `b`, or null when the world has no route (a gray-box build, an unreachable point). */
  route(a: Vec3, b: Vec3, yaw?: number): Vec3[] | null;
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

/** Metres between the waypoints sampled along an edge (M05c1: an edge of a real bake can be hundreds of metres long and bend). */
const ROUTE_STEP_M = 12;
const ROUTE_MAX_POINTS = 600;
const ROUTE_LANE_OFFSET_M = 3;

/** Route waypoints from a C08 route: the lane centre of each edge every `ROUTE_STEP_M` metres, then the end point. */
export function routeWaypoints(world: WorldApi, a: Vec3, b: Vec3, yaw?: number): Vec3[] | null {
  // A router snaps a point to the edge whose right-hand side it lies on. A driver that faces a heading starts 3 m to the right of it, so
  // that it gets the lane it points along, not the twin lane that would need a U-turn (M05c1).
  const fromX = yaw === undefined ? a[0] : a[0] + dcos(yaw) * ROUTE_LANE_OFFSET_M;
  const fromZ = yaw === undefined ? a[2] : a[2] - dsin(yaw) * ROUTE_LANE_OFFSET_M;
  const r = soft(() => world.graph.route({ from: { x: fromX, z: fromZ }, to: { x: b[0], z: b[2] }, maxExpand: 6000 }));
  if (!r || r.edges.length === 0) return null;
  const out: Vec3[] = [];
  const buf = new Float64Array(4);
  const d2 = (x: number, z: number, q: Vec3): number => (x - q[0]) * (x - q[0]) + (z - q[2]) * (z - q[2]);
  for (let k = 0; k < r.edges.length; k++) {
    const e = r.edges[k] as number;
    // the last edge is only entered: the goal (appended below) lies somewhere along it, so its samples stop at the one nearest the goal
    const lastEdge = k === r.edges.length - 1;
    const edgePts: Vec3[] = [];
    for (let at = 0; at < 4000 && out.length + edgePts.length < ROUTE_MAX_POINTS; at += ROUTE_STEP_M) {
      soft(() => world.graph.laneCentre({ edge: e, s: at, lane: 0 }, buf));
      // NaN: the edge is not resident; a sample that did not move: past the end of the edge (the lane point clamps)
      if (Number.isNaN(buf[0] as number)) break;
      const last = edgePts[edgePts.length - 1] ?? out[out.length - 1];
      if (at > 0 && last && d2(buf[0] as number, buf[2] as number, last) < 0.25) break;
      edgePts.push([buf[0] as number, buf[1] as number, buf[2] as number]);
    }
    // the first edge starts wherever the edge starts, maybe far behind the driver: drop the samples before the one nearest to it
    if (k === 0 && edgePts.length > 1) {
      let first = 0;
      for (let i = 1; i < edgePts.length; i++) if (d2((edgePts[i] as Vec3)[0], (edgePts[i] as Vec3)[2], a) < d2((edgePts[first] as Vec3)[0], (edgePts[first] as Vec3)[2], a)) first = i;
      edgePts.splice(0, first);
    }
    if (lastEdge && edgePts.length > 1) {
      let best = 0;
      for (let i = 1; i < edgePts.length; i++) if (d2((edgePts[i] as Vec3)[0], (edgePts[i] as Vec3)[2], b) < d2((edgePts[best] as Vec3)[0], (edgePts[best] as Vec3)[2], b)) best = i;
      edgePts.length = best + 1;
    }
    out.push(...edgePts);
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
    hookStubs: Object.fromEntries((rt.ir?.modeHooks ?? []).map((h) => [h.id, h.stub])),
    landmarks,
    ray: (from, dir, maxM) => {
      const hit = ctx.physics.castRay(from, dir, maxM);
      return hit ? hit.toi : null;
    },
    groundY: (x, z) => ctx.physics.groundY(x, z),
    route: (a, b, yaw) => routeWaypoints(ctx.world, a, b, yaw),
  };
}
