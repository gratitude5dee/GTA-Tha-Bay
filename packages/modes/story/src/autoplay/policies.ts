/**
 * Movement policies of the story autoplayer (M05a2; 03-story-missions.md C9): a goal becomes the control values of one tick. On foot
 * the bot sets `camYaw` to the heading it wants and pushes the stick forward; in a vehicle it steers by pure pursuit and holds a
 * speed plan; to change between the two it walks to the door and presses `sim.Enter`. Waypoints come from a C08 route when the world
 * has one (re-planned every 2.5 s) and otherwise from the straight line, bent around colliders by a short ray fan. Everything
 * numeric goes through `detmath`: the bot feeds the sim, so a `Math.sin` that differs between Node and WebKit would split the
 * traces. Randomness comes only from the run's `bot` stream and is used for nothing but un-sticking. Sim code under the C02 lint.
 */
import { PI, SimButton, datan2, dcos, dsin, dsqrt } from '@dv/shared';
import scoreConfig from '../../../../../config/autoplay/score.json';
import type { Vec3 } from '../vm/actors.ts';
import { DRIVE_MIN_M, VEHICLE_REACH_M, nearestUsableVehicle, type Goal, type Pace } from './goals.ts';
import type { CastView, MissionObs } from './observe.ts';

export const CONTEXT_ON_FOOT = 0;
export const CONTEXT_VEHICLE = 1;
export const CONTEXT_PHOTO = 7;

/** The values of one tick's `InputFrame` that a policy decides (the driver adds `tick`, `pressed`, `released`, `device`). */
export interface Control {
  buttons: number;
  moveX: number;
  moveY: number;
  throttle: number;
  brake: number;
  steer: number;
  camYaw: number;
  context: number;
}

export const NEUTRAL_CONTROL: Control = { buttons: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, context: CONTEXT_ON_FOOT };

const TWO_PI = 2 * PI;
const REPLAN_TICKS = 150;
const WAYPOINT_FOOT_M = 3;
/** On foot, a target within this distance with nothing solid on the straight line is walked to straight, whatever the lane route says (M05c2): the route follows car lanes, a one-way street can send a walker round the block. */
const LOS_DIRECT_MAX_M = 320;
/** A clear straight line is looked at again after this many ticks. */
const LOS_EVERY = 20;
/** On foot, a target this close is walked to in a straight line (bent by the ray fan): a C08 route follows the lanes and may circle a block to reach a car a few metres away (M05c1). */
const FOOT_DIRECT_M = 40;
/** How far along a route (metres) the start looks for the point nearest the body: the first edge of a route can be long, and a route can come back past its own start. */
const NEAREST_ARC_M = 250;
const WAYPOINT_DRIVE_M = 9;
/** How far ahead a driving bot looks for a collider to steer around; short, so the walls beyond a bend are not obstacles (M05c1). */
const DRIVE_LOOK_M = 7;
const DRIVE_DIRECT_M = 35;
/** How far ahead along the route the speed plan looks for a bend. */
const CURVE_LOOK_M = 45;
/** The shortest stretch of route that counts as a heading for `curveSpeed`. */
const CURVE_CHORD_M = 5;
const STICK = { walk: 51, run: 127, sprint: 127 } as const;
const DRIVE_VMAX_MPS = 24;
/** A waypoint more than this far off the nose (radians) with the car nearly at rest starts a three-point turn; each half lasts this many ticks (M05c2). */
const TURN_ALPHA = 1.9;
const TURN_MAX_MPS = 3;
const TURN_FORWARD_TICKS = 50;
const TURN_REVERSE_TICKS = 70;
const CORNER_SHARP_MPS = 5;
/** The deceleration the bot plans for when it brakes for an obstacle ahead. */
const OBSTACLE_BRAKE_MPS2 = 5;
/** Metres between the crumbs of a followed car's trail, and how far ahead of itself the bot aims along them. */
const TRAIL_STEP_M = 5;
const DRIVE_ACCEL_MPS2 = 3.2;
const ENTER_RANGE_M = 1.9;
const EXIT_SPEED_MPS = 3;
const PULSE_EVERY = 24;
/** Within this distance of a goal that needs the character on foot, the bot gets out of its vehicle. */
const FOOT_NEAR_M = 40;
const STUCK_CHECK_TICKS = 90;
const STUCK_CHECK_HEAT_TICKS = 30;
const STUCK_STILL_MPS = 1;
const STUCK_MIN_MOVE_M = 0.5;
const STUCK_AVOID_AFTER = 3;
const REGRESS_M = 14;
const FAN = [0.6, -0.6, 1.2, -1.2, 1.9, -1.9] as const;

export interface PatternConfig {
  approachSpeedMps: number;
  throttle: number;
  steer: number;
  handbrakeTicks: number;
  turnTicks: number;
  straightTicks: number;
}
const DRIFT = (scoreConfig as { drift: PatternConfig }).drift;

/** The bot's memory between ticks (a driver instance owns one). */
export interface Mem {
  path: Vec3[] | null;
  pathIdx: number;
  pathKey: string;
  replanAt: number;
  avoidOff: number;
  avoidUntil: number;
  avoidSide: 1 | -1;
  pulseAt: number;
  lastPos: Vec3;
  lastPosTick: number;
  unstickUntil: number;
  unstickKind: 'sidestep' | 'reverse';
  unstickSide: 1 | -1;
  vantageKey: string;
  vantage: Vec3 | null;
  shutterAt: number;
  patternStart: number;
  patternPhase: number;
  pathPt: number;
  losAt: number;
  losKey: string;
  losClear: boolean;
  /** Where a car that the bot follows has been (M05c2): crumbs every `TRAIL_STEP_M` metres, and how far along them the bot is. */
  trail: Vec3[];
  trailKey: string;
  trailIdx: number;
  /** A three-point turn in progress: the tick it ends and whether it is the reversing half. */
  turnUntil: number;
  turnReverse: boolean;
  /** Road edges the bot got stuck on (a building across a street in the bake); routes avoid them. `pathEdges` is the edge of each waypoint of `path`. */
  avoid: Set<number>;
  pathEdges: number[];
  stuckN: number;
  /** The waypoint a walker is heading for and the nearest it has come to it: a walker that drifts away from it is blocked. */
  progIdx: number;
  progBest: number;
  /** The goal (rounded to 40 m) that `avoid` was collected for: a new goal starts with an empty set. */
  avoidGoal: string;
}

export function newMem(): Mem {
  return {
    path: null, pathIdx: 0, pathKey: '', replanAt: 0, avoidOff: 0, avoidUntil: 0, avoidSide: 1, pulseAt: 0, lastPos: [0, 0, 0], lastPosTick: -1,
    unstickUntil: 0, unstickKind: 'sidestep', unstickSide: 1, vantageKey: '', vantage: null, shutterAt: 0, patternStart: -1, patternPhase: 0, pathPt: 0,
    losAt: -1, losKey: '', losClear: false, trail: [], trailKey: '', trailIdx: 0, turnUntil: 0, turnReverse: false, avoid: new Set(), pathEdges: [], stuckN: 0, progIdx: -1, progBest: Infinity, avoidGoal: '',
  };
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const dist = (a: Vec3, b: Vec3): number => {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return dsqrt(dx * dx + dz * dz);
};
const camYawOf = (yaw: number): number => Math.round((yaw / TWO_PI) * 65536) & 0xffff;
/** The heading (forward is `(-sin yaw, -cos yaw)`) of a direction on the ground plane. */
const headingOf = (dx: number, dz: number): number => datan2(-dx, -dz);
const wrap = (a: number): number => {
  let x = a;
  while (x > PI) x -= TWO_PI;
  while (x < -PI) x += TWO_PI;
  return x;
};

/** A control with the stick set: walk toward `dir` (unit) at `pace`. */
function footControl(dir: [number, number], pace: Pace): Control {
  return { ...NEUTRAL_CONTROL, camYaw: camYawOf(headingOf(dir[0], dir[1])), moveY: -STICK[pace], buttons: pace === 'sprint' ? 1 << SimButton.Sprint : 0 };
}

function faceControl(from: Vec3, to: Vec3): Control {
  return { ...NEUTRAL_CONTROL, camYaw: camYawOf(headingOf(to[0] - from[0], to[2] - from[2])) };
}

function rotate(d: [number, number], a: number): [number, number] {
  const c = dcos(a);
  const s = dsin(a);
  return [d[0] * c - d[1] * s, d[0] * s + d[1] * c];
}

export interface Tools {
  tick: number;
  rng: () => number;
}

/** The pulse of a button: true on the tick it should be pressed, at most once per `every` ticks. */
function pulse(mem: Mem, tick: number, every = PULSE_EVERY): boolean {
  if (tick < mem.pulseAt) return false;
  mem.pulseAt = tick + every;
  return true;
}

/**
 * Bends the heading `dir` around a collider ahead: a ray `look` metres long from `start` metres in front of the body; when it hits,
 * the fan of ±35°, ±70°, ±110° is tried (the side that worked last first). The result holds for 12 ticks.
 */
function steerClear(obs: MissionObs, mem: Mem, t: Tools, from: Vec3, dir: [number, number], look: number, start: number): [number, number] {
  if (t.tick < mem.avoidUntil) return mem.avoidOff === 0 ? dir : rotate(dir, mem.avoidOff);
  mem.avoidUntil = t.tick + 12;
  // the ray follows the ground: on a street with a grade a level ray would hit the road itself a few metres ahead (M05c1)
  const probe = (d: [number, number]): number | null => {
    const sx = from[0] + d[0] * start;
    const sz = from[2] + d[1] * start;
    const g0 = obs.groundY(sx, sz);
    const g1 = obs.groundY(sx + d[0] * look, sz + d[1] * look);
    const slope = g0 !== null && g1 !== null ? clamp((g1 - g0) / look, -0.35, 0.35) : 0;
    const n = dsqrt(1 + slope * slope);
    return obs.ray([sx, from[1] + 0.9, sz], [d[0] / n, slope / n, d[1] / n], look * n);
  };
  const direct = probe(dir);
  if (direct === null) {
    mem.avoidOff = 0;
    return dir;
  }
  for (const a of FAN) {
    const off = a * mem.avoidSide;
    const d = rotate(dir, off);
    if (probe(d) === null) {
      mem.avoidOff = off;
      return d;
    }
  }
  mem.avoidSide = mem.avoidSide === 1 ? -1 : 1;
  mem.avoidOff = 1.9 * mem.avoidSide;
  return rotate(dir, mem.avoidOff);
}

const vehiclePos = (obs: MissionObs): Vec3 => obs.me.vehicle?.pos ?? obs.me.pos;
/** A waypoint further than this behind the body is not skipped as passed (the body may have left the route; it replans). */
const PASSED_MAX_M = 30;

/** Within this distance of the rest of its route the body counts as on it, metres. */
const ON_PATH_M = 18;

/** Whether `me` is within `ON_PATH_M` of a waypoint of the route not yet passed. */
function onPath(mem: Mem, me: Vec3): boolean {
  const p = mem.path;
  if (!p) return false;
  for (let i = Math.max(0, mem.pathIdx - 1); i < p.length; i++) if (dist(me, p[i] as Vec3) <= ON_PATH_M) return true;
  return false;
}

/** The next point to head for: the C08 route to `target` when there is one, else `target`. */
function nextPoint(obs: MissionObs, mem: Mem, t: Tools, target: Vec3, arriveM: number, yaw?: number): Vec3 {
  const key = `${Math.round(target[0] / 8)}:${Math.round(target[2] / 8)}`;
  const goal = `${Math.round(target[0] / 40)}:${Math.round(target[2] / 40)}`;
  if (goal !== mem.avoidGoal) {
    mem.avoidGoal = goal;
    mem.avoid.clear();
  }
  // a route that still lies under the body is kept (M05c2): a new route from here can start on the other lane of the street and send a walker back and forth
  if (key === mem.pathKey && t.tick >= mem.replanAt && mem.path !== null && onPath(mem, vehiclePos(obs))) mem.replanAt = t.tick + REPLAN_TICKS;
  if (key !== mem.pathKey || t.tick >= mem.replanAt) {
    mem.pathKey = key;
    mem.replanAt = t.tick + REPLAN_TICKS;
    const edges: number[] = [];
    mem.path = obs.route(yaw === undefined ? obs.me.pos : (obs.me.vehicle?.pos ?? obs.me.pos), target, yaw, mem.avoid, edges);
    mem.pathEdges = edges;
    mem.pathIdx = 0;
    // a route starts at the beginning of the edge the body stands on: begin at the route point nearest to it, not at one behind it (M05c1)
    const first = mem.path;
    if (first) {
      let best = Infinity;
      let arc = 0;
      for (let i = 0; i < first.length && arc <= NEAREST_ARC_M; i++) {
        const q = first[i] as Vec3;
        const dd = dist(vehiclePos(obs), q);
        if (dd < best) {
          best = dd;
          mem.pathIdx = i;
        }
        if (i > 0) arc += dist(first[i - 1] as Vec3, q);
      }
    }
  }
  const p = mem.path;
  if (!p) return target;
  // a waypoint is done when the body is near it or has passed it along the path: a waypoint left behind makes a pure-pursuit driver orbit it (M05c1)
  const me = vehiclePos(obs);
  while (mem.pathIdx < p.length - 1) {
    const cur = p[mem.pathIdx] as Vec3;
    const nxt = p[mem.pathIdx + 1] as Vec3;
    const passed = (me[0] - cur[0]) * (nxt[0] - cur[0]) + (me[2] - cur[2]) * (nxt[2] - cur[2]) > 0;
    if (dist(me, cur) < arriveM || (passed && dist(me, cur) < PASSED_MAX_M)) mem.pathIdx++;
    else break;
  }
  return p[mem.pathIdx] as Vec3;
}

/** Un-sticking: a body that has barely moved for 1.5 s while it was asked to move sidesteps (on foot) or reverses (in a vehicle). */
function stuckCheck(obs: MissionObs, mem: Mem, t: Tools, moving: boolean): void {
  const here = obs.me.vehicle?.pos ?? obs.me.pos;
  if (mem.lastPosTick < 0) {
    mem.lastPos = [here[0], here[1], here[2]];
    mem.lastPosTick = t.tick;
    return;
  }
  // under a pursuit a car that does not move is busted within three seconds: it looks again sooner (M05c2)
  if (t.tick - mem.lastPosTick < (obs.heat > 0 && obs.me.vehicle ? STUCK_CHECK_HEAT_TICKS : STUCK_CHECK_TICKS)) return;
  const moved = dist(here, mem.lastPos);
  mem.lastPos = [here[0], here[1], here[2]];
  mem.lastPosTick = t.tick;
  if (moved >= STUCK_MIN_MOVE_M) mem.stuckN = 0;
  // a car that is picking up speed from rest has moved little in a short look but is not stuck: it must also be still (M05c2)
  const still = !obs.me.vehicle || obs.me.vehicle.speed < STUCK_STILL_MPS;
  if (moving && moved < STUCK_MIN_MOVE_M && still && t.tick >= mem.unstickUntil) {
    mem.stuckN++;
    // stuck again and again on one route: the edge under the waypoint ahead is closed to the bot, and the route is planned again (M05c2)
    if (mem.stuckN >= STUCK_AVOID_AFTER && mem.path !== null) {
      for (let i = Math.max(0, mem.pathIdx - 1); i <= Math.min(mem.pathEdges.length - 1, mem.pathIdx + 1); i++) mem.avoid.add(mem.pathEdges[i] as number);
      mem.pathKey = '';
      mem.stuckN = 0;
    }
    mem.unstickUntil = t.tick + (obs.heat > 0 && obs.me.vehicle ? 45 : 70);
    mem.unstickKind = obs.me.vehicle ? 'reverse' : 'sidestep';
    mem.unstickSide = t.rng() < 0.5 ? 1 : -1;
    mem.avoidSide = mem.unstickSide;
  }
}

/**
 * Whether the straight line from `from` to `to` has nothing solid on it (M05c2): a ray along the ground in legs of 40 m, each leg
 * following the slope, so a hill is not a wall. Looked at again every `LOS_EVERY` ticks; false beyond `LOS_DIRECT_MAX_M`, where the
 * chunks may not be resident.
 */
function lineClear(obs: MissionObs, mem: Mem, t: Tools, from: Vec3, to: Vec3): boolean {
  const key = `${Math.round(to[0] / 4)}:${Math.round(to[2] / 4)}`;
  if (key === mem.losKey && t.tick < mem.losAt) return mem.losClear;
  mem.losKey = key;
  mem.losAt = t.tick + LOS_EVERY;
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const d = dsqrt(dx * dx + dz * dz);
  let clear = d > 1e-6 && d <= LOS_DIRECT_MAX_M;
  if (clear) {
    const ux = dx / d;
    const uz = dz / d;
    const legs = Math.ceil(d / 40);
    const leg = d / legs;
    for (let i = 0; i < legs && clear; i++) {
      const sx = from[0] + ux * leg * i;
      const sz = from[2] + uz * leg * i;
      const g0 = obs.groundY(sx, sz);
      const g1 = obs.groundY(sx + ux * leg, sz + uz * leg);
      if (g0 === null || g1 === null) {
        clear = false;
        break;
      }
      const slope = clamp((g1 - g0) / leg, -0.5, 0.5);
      const n = dsqrt(1 + slope * slope);
      if (obs.ray([sx, g0 + 0.9, sz], [ux / n, slope / n, uz / n], leg * n) !== null) clear = false;
    }
  }
  mem.losClear = clear;
  return clear;
}

export function walkTo(obs: MissionObs, mem: Mem, t: Tools, target: Vec3, pace: Pace, stopR: number, direct = false): Control {
  const me = obs.me.pos;
  const d = dist(me, target);
  if (d <= stopR) return { ...NEUTRAL_CONTROL, camYaw: camYawOf(obs.me.yaw) };
  let wp: Vec3;
  // `direct`: the author's own waypoints (a stealth path) are walked point to point, bent around colliders only
  if (d < FOOT_DIRECT_M || direct) wp = target;
  else {
    const next = nextPoint(obs, mem, t, target, WAYPOINT_FOOT_M);
    // a real world answers with a lane route; a clear straight line beats it on foot (the route may go round a block)
    wp = mem.path !== null && lineClear(obs, mem, t, me, target) ? target : next;
  }
  const wd = dist(me, wp);
  // a walker that is getting away from its waypoint (a building across the street keeps the ray fan turning it round) closes that edge and is routed again (M05c2)
  if (mem.path !== null && wp !== target && !direct) {
    if (mem.pathIdx !== mem.progIdx) {
      mem.progIdx = mem.pathIdx;
      mem.progBest = wd;
    } else if (wd < mem.progBest) mem.progBest = wd;
    else if (wd - mem.progBest > REGRESS_M) {
      for (let i = Math.max(0, mem.pathIdx - 1); i <= Math.min(mem.pathEdges.length - 1, mem.pathIdx + 1); i++) mem.avoid.add(mem.pathEdges[i] as number);
      mem.pathKey = '';
      mem.progBest = Infinity;
      mem.progIdx = -1;
    }
  }
  let dir: [number, number] = wd > 1e-6 ? [(wp[0] - me[0]) / wd, (wp[2] - me[2]) / wd] : [0, 0];
  if (DBG.sink) DBG.sink({ tick: t.tick, foot: true, d, wd, wp: wp.map(Math.round), me: me.map(Math.round), np: mem.path?.length ?? 0, idx: mem.pathIdx, unstick: t.tick < mem.unstickUntil, avoid: mem.avoid.size, stuckN: mem.stuckN, edge: mem.pathEdges[mem.pathIdx] });
  stuckCheck(obs, mem, t, true);
  if (t.tick < mem.unstickUntil && mem.unstickKind === 'sidestep') dir = rotate(dir, 1.5 * mem.unstickSide);
  else dir = steerClear(obs, mem, t, me, dir, 5, 0.7);
  // slow down for the last metres so the arrival does not overshoot a small radius
  const p: Pace = d < 3 && pace !== 'walk' ? 'run' : pace;
  return footControl(dir, p);
}

export const DBG: { sink: ((o: Record<string, unknown>) => void) | null } = { sink: null };

export function driveTo(obs: MissionObs, mem: Mem, t: Tools, target: Vec3, stopR: number, stop: boolean, vmax = DRIVE_VMAX_MPS): Control {
  const v = obs.me.vehicle;
  if (!v) return { ...NEUTRAL_CONTROL, context: CONTEXT_VEHICLE };
  const d = dist(v.pos, target);
  const base: Control = { ...NEUTRAL_CONTROL, context: CONTEXT_VEHICLE };
  if (d <= stopR && !stop) return { ...base, throttle: 0, brake: 0 };
  if (stop && d <= stopR) return { ...base, ...holdStill(v.speed) };
  stuckCheck(obs, mem, t, true);
  // a brake pressed at rest reverses (handling.ts pedals)
  if (t.tick < mem.unstickUntil && mem.unstickKind === 'reverse') return { ...base, brake: 127, steer: 100 * mem.unstickSide };
  // the last metres go straight at the goal: the end of a route can loop through a dead-end stub or a turnaround (M05c1)
  const wp = d < DRIVE_DIRECT_M ? target : nextPoint(obs, mem, t, target, WAYPOINT_DRIVE_M, v.yaw);
  // speed plan: the faster of nothing, bounded by the braking distance to the stop point and by the corner
  const left = Math.max(0, d - (stop ? stopR * 0.5 : 0));
  const vBrake = dsqrt(2 * DRIVE_ACCEL_MPS2 * left) + 1.5;
  return pursue(obs, mem, t, wp, Math.min(vmax, vBrake), curveSpeed(mem, v.pos, v.speed));
}

/** Within this distance of a zone the bot drives at it in a straight line (bent round colliders): a lane route can circle a long way to a point on the far side of the street (M05c2). */
const ZONE_DIRECT_M = 140;

/** Drives straight at `target` (no route) and stops inside `stopR`. */
function driveAt(obs: MissionObs, mem: Mem, t: Tools, target: Vec3, stopR: number, vmax: number): Control {
  const v = obs.me.vehicle as NonNullable<MissionObs['me']['vehicle']>;
  const base: Control = { ...NEUTRAL_CONTROL, context: CONTEXT_VEHICLE };
  const d = dist(v.pos, target);
  if (d <= stopR) return { ...base, ...holdStill(v.speed) };
  stuckCheck(obs, mem, t, true);
  if (t.tick < mem.unstickUntil && mem.unstickKind === 'reverse') return { ...base, brake: 127, steer: 100 * mem.unstickSide };
  return pursue(obs, mem, t, target, Math.min(vmax, dsqrt(2 * DRIVE_ACCEL_MPS2 * Math.max(0, d - stopR * 0.5)) + 1.5), 99);
}

/** Steers a vehicle at the waypoint `wp` and works the pedals for a speed of at most `vcap` (and `curveCap`, the bend of the path ahead). */
function pursue(obs: MissionObs, mem: Mem, t: Tools, wp: Vec3, vcap: number, curveCap: number): Control {
  const v = obs.me.vehicle as NonNullable<MissionObs['me']['vehicle']>;
  const base: Control = { ...NEUTRAL_CONTROL, context: CONTEXT_VEHICLE };
  const wd = dist(v.pos, wp);
  let dir: [number, number] = wd > 1e-6 ? [(wp[0] - v.pos[0]) / wd, (wp[2] - v.pos[2]) / wd] : [0, 0];
  dir = steerClear(obs, mem, t, v.pos, dir, DRIVE_LOOK_M, 3.4);
  const fx = -dsin(v.yaw);
  const fz = -dcos(v.yaw);
  const lat = dir[0] * -fz + dir[1] * fx;
  const lon = dir[0] * fx + dir[1] * fz;
  const alpha = datan2(lat, lon);
  // a waypoint behind the car: a three-point turn (forward on full lock toward it, then back on the opposite lock), M05c2
  if (t.tick < mem.turnUntil) {
    return mem.turnReverse ? { ...base, brake: 127, steer: Math.round(-Math.sign(alpha) * 127) } : { ...base, throttle: 70, steer: Math.round(Math.sign(alpha) * 127) };
  }
  if (Math.abs(alpha) > TURN_ALPHA && v.speed < TURN_MAX_MPS) {
    mem.turnReverse = !mem.turnReverse;
    mem.turnUntil = t.tick + (mem.turnReverse ? TURN_REVERSE_TICKS : TURN_FORWARD_TICKS);
  }
  // the lock the car can hold without spinning narrows with speed: full below 6 m/s, a quarter at 20 m/s (M05c2)
  const lock = clamp(1 - (v.speed - 6) / 14, 0.25, 1);
  const steer = Math.round(clamp(alpha * 1.6, -lock, lock) * 127);
  const vCorner = Math.abs(alpha) > 0.9 ? CORNER_SHARP_MPS : Math.abs(alpha) > 0.45 ? 7 : DRIVE_VMAX_MPS;
  // something solid dead ahead inside the braking distance: slow down for it, whatever the route says (a parked or stopped car, a barrier; M05c2)
  const lookM = Math.min(45, v.speed * 1.8 + 8);
  const hit = obs.ray([v.pos[0] + fx * 3.4, v.pos[1] + 0.9, v.pos[2] + fz * 3.4], [fx, 0, fz], lookM);
  const vObstacle = hit === null ? 99 : Math.max(0, dsqrt(2 * OBSTACLE_BRAKE_MPS2 * Math.max(0, hit - 2)));
  const want = Math.min(vcap, vCorner, curveCap, vObstacle);
  const err = want - v.speed;
  const throttle = err > 0 ? clamp(0.3 + err * 0.3, 0, 1) : 0;
  const brake = err < -1.2 ? clamp(-err * 0.3, 0, 1) : 0;
  if (DBG.sink) DBG.sink({ tick: t.tick, wd, alpha, steer, want, vcap, vCorner, cc: curveCap, speed: v.speed, throttle, brake, idx: mem.pathIdx, np: mem.path?.length ?? 0, wp: wp.map(Math.round), vdbg: v.dbg, prof: Array.from({ length: 12 }, (_, i) => (obs.groundY(v.pos[0] - 3 * i, v.pos[2] + 0.1 * i) ?? -99).toFixed(1)).join(" "), vy: v.pos[1], gy: obs.groundY(v.pos[0], v.pos[2]), oth: obs.others.slice(0, 4).map((u) => `${u.police ? 'P' : 'c'}${Math.round(dist(u.pos, v.pos))}@${Math.round(u.pos[0] - v.pos[0])},${Math.round(u.pos[2] - v.pos[2])}v${Math.round(Math.hypot(u.vx, u.vz))}`).join(' '), cops: obs.units.slice(0, 5).map((u) => `${Math.round(dist(u.pos, v.pos))}@${Math.round(u.pos[0] - v.pos[0])},${Math.round(u.pos[2] - v.pos[2])}`).join(" "), ahead: (mem.path ?? []).slice(mem.pathIdx, mem.pathIdx + 14).map((q) => `${Math.round(q[0])},${Math.round(q[2])}`).join(" ") });
  return { ...base, steer, throttle: Math.round(throttle * 127), brake: Math.round(brake * 127) };
}

/**
 * The speed a bend of the route ahead allows (M05c1): the heading change over the next `CURVE_LOOK_M` metres of waypoints, against the
 * heading of the first segment. A sharp bend (a right angle at a block corner) takes the car to a crawl before the corner, not after it.
 */
function curveSpeed(mem: Mem, pos: Vec3, speed: number): number {
  const p = mem.path;
  if (!p || mem.pathIdx >= p.length - 1) return 99;
  let along = 0;
  let prev = pos;
  let h0: number | null = null;
  let worst = 0;
  const look = CURVE_LOOK_M + speed * 2.5;
  for (let i = mem.pathIdx; i < p.length && along < look; i++) {
    const q = p[i] as Vec3;
    const dx = q[0] - prev[0];
    const dz = q[2] - prev[2];
    const len = dsqrt(dx * dx + dz * dz);
    // a chord shorter than CURVE_CHORD_M is noise (the join of two lane samples), not a bend
    if (len < CURVE_CHORD_M) continue;
    const h = headingOf(dx, dz);
    if (h0 === null) h0 = h;
    else worst = Math.max(worst, Math.abs(wrap(h - h0)));
    along += len;
    prev = q;
  }
  return clamp(20 - 16 * worst, 4, 99);
}

/** Holds a vehicle still: the brake while it rolls, the handbrake once it is slow (a brake pressed at rest reverses). */
function holdStill(speed: number): Pick<Control, 'brake' | 'buttons'> {
  return speed > 1.5 ? { brake: 127, buttons: 0 } : { brake: 0, buttons: 1 << SimButton.Handbrake };
}

/** A goal that needs the character on foot: from a vehicle, drive close first when it is far, then get out. */
function leaveForFoot(obs: MissionObs, mem: Mem, t: Tools, target: Vec3): Control {
  const v = obs.me.vehicle;
  if (v && dist(v.pos, target) > FOOT_NEAR_M) return driveTo(obs, mem, t, target, FOOT_NEAR_M * 0.6, false);
  return exitVehicle(obs, mem, t);
}

function exitVehicle(obs: MissionObs, mem: Mem, t: Tools): Control {
  const v = obs.me.vehicle;
  const base: Control = { ...NEUTRAL_CONTROL, context: CONTEXT_VEHICLE };
  if (!v) return NEUTRAL_CONTROL;
  if (v.speed > EXIT_SPEED_MPS) return { ...base, ...holdStill(v.speed) };
  return { ...base, buttons: (1 << SimButton.Handbrake) | (pulse(mem, t.tick, 30) ? 1 << SimButton.Enter : 0) };
}

function enterVehicle(obs: MissionObs, mem: Mem, t: Tools, cast: string): Control {
  const c = obs.cast[cast];
  if (obs.me.vehicle && obs.me.vehicle.cast === cast) return NEUTRAL_CONTROL;
  if (obs.me.vehicle) return exitVehicle(obs, mem, t);
  if (!c || !c.pos) return NEUTRAL_CONTROL;
  const d = dist(obs.me.pos, c.pos);
  if (d > ENTER_RANGE_M + 0.6) return walkTo(obs, mem, t, c.pos, 'run', ENTER_RANGE_M);
  // at the door: face the car, ease toward it and press Enter
  const face = faceControl(obs.me.pos, c.pos);
  return { ...face, moveY: d > 1.3 ? -STICK.walk : 0, buttons: pulse(mem, t.tick) ? 1 << SimButton.Enter : 0 };
}

/** Candidate ring point around `subject` with a clear line to it, nearest the player first. */
function vantagePoint(obs: MissionObs, subject: Vec3, maxDistM: number): Vec3 {
  const r = Math.min(maxDistM * 0.55, 8);
  let best: Vec3 | null = null;
  let bestD = Infinity;
  for (let i = 0; i < 8; i++) {
    const a = (i * PI) / 4;
    const p: Vec3 = [subject[0] + dsin(a) * r, subject[1], subject[2] + dcos(a) * r];
    const gy = obs.groundY(p[0], p[2]);
    if (gy === null) continue;
    p[1] = gy;
    const from: Vec3 = [p[0], gy + 1.5, p[2]];
    const dx = subject[0] - p[0];
    const dz = subject[2] - p[2];
    const len = dsqrt(dx * dx + dz * dz);
    const hit = obs.ray(from, [dx / len, 0, dz / len], len);
    if (hit !== null && hit < len - 1) continue;
    const dd = dist(obs.me.pos, p);
    if (dd < bestD) {
      best = p;
      bestD = dd;
    }
  }
  return best ?? [subject[0] + r, subject[1], subject[2]];
}

function photoPolicy(obs: MissionObs, mem: Mem, t: Tools, subject: Vec3, maxDistM: number): Control {
  if (obs.me.vehicle) return leaveForFoot(obs, mem, t, subject);
  const key = `${Math.round(subject[0])}:${Math.round(subject[2])}`;
  if (mem.vantageKey !== key || !mem.vantage) {
    mem.vantageKey = key;
    mem.vantage = vantagePoint(obs, subject, maxDistM);
  }
  const v = mem.vantage;
  if (dist(obs.me.pos, v) > 1.4) return walkTo(obs, mem, t, v, 'run', 1.0);
  const face = faceControl(obs.me.pos, subject);
  const fire = t.tick >= mem.shutterAt;
  if (fire) mem.shutterAt = t.tick + 45;
  return { ...face, context: CONTEXT_PHOTO, buttons: fire ? 1 << SimButton.Interact : 0 };
}

/** The scripted drift pattern: approach, then repeated handbrake turns (`config/autoplay/score.json`). */
function patternPolicy(obs: MissionObs, mem: Mem, t: Tools): Control {
  const v = obs.me.vehicle;
  if (!v) {
    const near = nearestUsableVehicle(obs, 1e9);
    return near ? enterVehicle(obs, mem, t, near) : NEUTRAL_CONTROL;
  }
  const base: Control = { ...NEUTRAL_CONTROL, context: CONTEXT_VEHICLE };
  // a car pinned against a wall backs out first (a brake pressed at rest reverses)
  stuckCheck(obs, mem, t, true);
  if (t.tick < mem.unstickUntil && mem.unstickKind === 'reverse') return { ...base, brake: 127, steer: 100 * mem.unstickSide };
  if (mem.patternStart < 0) {
    mem.patternStart = t.tick;
    mem.patternPhase = 0;
  }
  const k = t.tick - mem.patternStart;
  const cycle = DRIFT.straightTicks + DRIFT.turnTicks;
  const at = k % cycle;
  // clear ground ahead matters more than the pattern: the ray fan turns the car away from a wall
  const fx = -dsin(v.yaw);
  const fz = -dcos(v.yaw);
  const wall = obs.ray([v.pos[0] + fx * 3.4, v.pos[1] + 0.9, v.pos[2] + fz * 3.4], [fx, 0, fz], 16);
  if (wall !== null && at >= DRIFT.straightTicks) return { ...base, throttle: 0, brake: 90, steer: 0 };
  if (at < DRIFT.straightTicks || v.speed < DRIFT.approachSpeedMps * 0.7) {
    return { ...base, throttle: DRIFT.throttle, steer: wall !== null ? 100 : 0 };
  }
  const side = Math.floor(k / cycle) % 2 === 0 ? 1 : -1;
  const hb = at - DRIFT.straightTicks < DRIFT.handbrakeTicks ? 1 << SimButton.Handbrake : 0;
  return { ...base, throttle: DRIFT.throttle, steer: DRIFT.steer * side, buttons: hb };
}

/**
 * Follows a car by the way it went (M05c2): the bot drops a crumb every `TRAIL_STEP_M` metres of the leader's travel and drives through
 * them in order, so it takes the leader's roads, lanes and turns without a route of its own, and holds a gap of about half the band's
 * middle. Null when the bot is too far from the trail for that (it then drives a routed course to the leader).
 */
function trailFollow(obs: MissionObs, mem: Mem, t: Tools, target: string, mid: number, c: CastView): Control | null {
  const v = obs.me.vehicle as NonNullable<MissionObs['me']['vehicle']>;
  const lp = c.pos as Vec3;
  if (mem.trailKey !== target) {
    mem.trailKey = target;
    mem.trail = [];
    mem.trailIdx = 0;
  }
  const last = mem.trail[mem.trail.length - 1];
  if (!last || dist(last, lp) >= TRAIL_STEP_M) mem.trail.push([lp[0], lp[1], lp[2]]);
  const tr = mem.trail;
  let best = Math.min(mem.trailIdx, tr.length - 1);
  let bd = dist(v.pos, tr[best] as Vec3);
  for (let i = best + 1; i < tr.length && i <= best + 30; i++) {
    const d = dist(v.pos, tr[i] as Vec3);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  if (bd > 45) return null;
  mem.trailIdx = best;
  const look = Math.max(8, v.speed * 1.3);
  // the aim lies beyond the nearest crumb, so that it is never behind the car
  let idx = Math.min(best + 1, tr.length - 1);
  let acc = dist(v.pos, tr[idx] as Vec3);
  while (idx < tr.length - 1 && acc < look) {
    acc += dist(tr[idx] as Vec3, tr[idx + 1] as Vec3);
    idx++;
  }
  const aim = idx >= tr.length - 1 && acc < look ? lp : (tr[idx] as Vec3);
  let gap = bd;
  for (let i = best; i < tr.length - 1; i++) gap += dist(tr[i] as Vec3, tr[i + 1] as Vec3);
  gap += dist(tr[tr.length - 1] as Vec3, lp);
  const gapWant = clamp(mid * 0.5, 18, 34);
  let want = c.speed + clamp((gap - gapWant) * 0.4, -c.speed, 8);
  if (gap > gapWant + 6) want = Math.max(want, 4);
  stuckCheck(obs, mem, t, want > 1);
  const base: Control = { ...NEUTRAL_CONTROL, context: CONTEXT_VEHICLE };
  if (t.tick < mem.unstickUntil && mem.unstickKind === 'reverse') return { ...base, brake: 127, steer: 100 * mem.unstickSide };
  if (want < 0.8 && v.speed < 2) return { ...base, ...holdStill(v.speed) };
  return pursue(obs, mem, t, aim, want, trailBend(tr, best, v.pos, v.speed));
}

/** The speed the bend of a trail ahead allows (the same rule as `curveSpeed`, on crumbs). */
function trailBend(tr: readonly Vec3[], from: number, pos: Vec3, speed: number): number {
  let along = 0;
  let prev = pos;
  let h0: number | null = null;
  let worst = 0;
  const look = 25 + speed * 2.5;
  for (let i = from; i < tr.length && along < look; i++) {
    const q = tr[i] as Vec3;
    const dx = q[0] - prev[0];
    const dz = q[2] - prev[2];
    const len = dsqrt(dx * dx + dz * dz);
    if (len < 0.5) continue;
    const h = headingOf(dx, dz);
    if (h0 === null) h0 = h;
    else worst = Math.max(worst, Math.abs(wrap(h - h0)));
    along += len;
    prev = q;
  }
  return clamp(20 - 16 * worst, 4.5, 99);
}

function followPolicy(obs: MissionObs, mem: Mem, t: Tools, g: Extract<Goal, { k: 'follow' }>): Control {
  const c = obs.cast[g.target];
  if (!c || !c.pos) return NEUTRAL_CONTROL;
  if (c.kind === 'vehicle') {
    // a car in front: take a car and drive after it, staying about `mid` metres behind (M05c1)
    if (!obs.me.vehicle) {
      const own = nearestUsableVehicle(obs, VEHICLE_REACH_M);
      return own ? enterVehicle(obs, mem, t, own) : walkTo(obs, mem, t, c.pos, 'run', g.mid);
    }
    const gap = dist(obs.me.vehicle.pos, c.pos);
    // the leader has stopped and the objective ends in a zone: go in (M05c2)
    if (g.zone && c.speed < 1) {
      const dz = dist(obs.me.vehicle.pos, g.zone);
      if (dz > g.zoneR) return dz < ZONE_DIRECT_M ? driveAt(obs, mem, t, g.zone, g.zoneR, 8) : driveTo(obs, mem, t, g.zone, g.zoneR, false, 8);
    }
    if (gap <= g.mid * 0.6 && c.speed < 1) return { ...NEUTRAL_CONTROL, context: CONTEXT_VEHICLE, ...holdStill(obs.me.vehicle.speed) };
    return trailFollow(obs, mem, t, g.target, g.mid, c) ?? driveTo(obs, mem, t, c.pos, Math.max(3, g.mid * 0.5), false, Math.max(6, c.speed + 3));
  }
  if (obs.me.vehicle) return leaveForFoot(obs, mem, t, c.pos);
  const d = dist(obs.me.pos, c.pos);
  if (d > g.mid) return walkTo(obs, mem, t, c.pos, 'run', g.mid);
  if (g.zone) return walkTo(obs, mem, t, g.zone, 'run', g.zoneR);
  return NEUTRAL_CONTROL;
}

function chasePolicy(obs: MissionObs, mem: Mem, t: Tools, target: string): Control {
  const c = obs.cast[target];
  if (!c || !c.pos) return NEUTRAL_CONTROL;
  // aim where the target will be in 1.5 s along its heading
  const lead: Vec3 = [c.pos[0] - dsin(c.yaw) * c.speed * 1.5, c.pos[1], c.pos[2] - dcos(c.yaw) * c.speed * 1.5];
  if (obs.me.vehicle) {
    const gap = dist(obs.me.vehicle.pos, c.pos);
    // far behind a car: by its trail (as in a follow); close behind it: straight at it, as fast as it goes plus a little (M05c2)
    if (gap > 30 && c.kind === 'vehicle') {
      const tf = trailFollow(obs, mem, t, target, 36, c);
      if (tf) return tf;
    }
    if (gap <= 30 && c.kind === 'vehicle') return driveAt(obs, mem, t, c.pos, 3.5, Math.max(5, c.speed + 3));
    return driveTo(obs, mem, t, lead, 6, false, 16);
  }
  return walkTo(obs, mem, t, lead, 'sprint', 1.5);
}

function pathPolicy(obs: MissionObs, mem: Mem, t: Tools, points: Vec3[], r: number): Control {
  const p = points[Math.min(mem.pathPt, points.length - 1)] as Vec3;
  if (obs.me.vehicle) return leaveForFoot(obs, mem, t, p);
  if (dist(obs.me.pos, p) < r && mem.pathPt < points.length - 1) mem.pathPt++;
  return walkTo(obs, mem, t, points[Math.min(mem.pathPt, points.length - 1)] as Vec3, 'walk', 0.6, true);
}

function reachPolicy(obs: MissionObs, mem: Mem, t: Tools, g: Extract<Goal, { k: 'reach' }>): Control {
  const inV = obs.me.vehicle;
  if (g.mode === 'vehicle') {
    const want = g.vehicle ?? nearestUsableVehicle(obs, 1e9);
    if (!inV || (g.vehicle !== undefined && inV.cast !== g.vehicle)) return want ? enterVehicle(obs, mem, t, want) : NEUTRAL_CONTROL;
    return driveTo(obs, mem, t, g.at, g.r, g.stop === true);
  }
  if (g.mode === 'foot') {
    if (inV) return leaveForFoot(obs, mem, t, g.at);
    return walkTo(obs, mem, t, g.at, g.pace ?? 'run', g.r);
  }
  // free: keep the vehicle you are in; on foot, take a usable one when the goal is far
  if (inV) return driveTo(obs, mem, t, g.at, g.r, g.stop === true);
  const d = dist(obs.me.pos, g.at);
  if (d > DRIVE_MIN_M) {
    const veh = nearestUsableVehicle(obs, VEHICLE_REACH_M);
    if (veh) return enterVehicle(obs, mem, t, veh);
  }
  return walkTo(obs, mem, t, g.at, g.pace ?? 'run', g.r);
}

function meleePolicy(obs: MissionObs, mem: Mem, t: Tools, target: string): Control {
  const c = obs.cast[target];
  if (!c || !c.pos) return NEUTRAL_CONTROL;
  if (obs.me.vehicle) return leaveForFoot(obs, mem, t, c.pos);
  const d = dist(obs.me.pos, c.pos);
  if (d > 1.8) return walkTo(obs, mem, t, c.pos, 'sprint', 1.4);
  return { ...faceControl(obs.me.pos, c.pos), buttons: pulse(mem, t.tick, 18) ? 1 << SimButton.Attack : 0 };
}

/** One tick of control for a goal. */
export function decide(obs: MissionObs, goal: Goal, mem: Mem, t: Tools): Control {
  switch (goal.k) {
    case 'idle':
      return obs.me.vehicle ? { ...NEUTRAL_CONTROL, context: CONTEXT_VEHICLE, ...holdStill(obs.me.vehicle.speed) } : NEUTRAL_CONTROL;
    case 'reach':
      return reachPolicy(obs, mem, t, goal);
    case 'enter':
      return enterVehicle(obs, mem, t, goal.vehicle);
    case 'follow':
      return followPolicy(obs, mem, t, goal);
    case 'chase':
      return chasePolicy(obs, mem, t, goal.target);
    case 'path':
      return pathPolicy(obs, mem, t, goal.points, goal.r);
    case 'photo':
      return photoPolicy(obs, mem, t, goal.subject, goal.maxDistM);
    case 'pattern':
      return patternPolicy(obs, mem, t);
    case 'melee':
      return meleePolicy(obs, mem, t, goal.target);
  }
}

export { wrap as wrapAngle };
