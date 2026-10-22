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
import type { MissionObs } from './observe.ts';

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
const WAYPOINT_DRIVE_M = 9;
const STICK = { walk: 51, run: 127, sprint: 127 } as const;
const DRIVE_VMAX_MPS = 13;
const DRIVE_ACCEL_MPS2 = 3.2;
const ENTER_RANGE_M = 1.9;
const EXIT_SPEED_MPS = 3;
const PULSE_EVERY = 24;
/** Within this distance of a goal that needs the character on foot, the bot gets out of its vehicle. */
const FOOT_NEAR_M = 40;
const STUCK_CHECK_TICKS = 90;
const STUCK_MIN_MOVE_M = 0.5;
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
}

export function newMem(): Mem {
  return {
    path: null, pathIdx: 0, pathKey: '', replanAt: 0, avoidOff: 0, avoidUntil: 0, avoidSide: 1, pulseAt: 0, lastPos: [0, 0, 0], lastPosTick: 0,
    unstickUntil: 0, unstickKind: 'sidestep', unstickSide: 1, vantageKey: '', vantage: null, shutterAt: 0, patternStart: -1, patternPhase: 0, pathPt: 0,
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
  const probe = (d: [number, number]): number | null => obs.ray([from[0] + d[0] * start, from[1] + 0.9, from[2] + d[1] * start], [d[0], 0, d[1]], look);
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

/** The next point to head for: the C08 route to `target` when there is one, else `target`. */
function nextPoint(obs: MissionObs, mem: Mem, t: Tools, target: Vec3, arriveM: number): Vec3 {
  const key = `${Math.round(target[0] / 8)}:${Math.round(target[2] / 8)}`;
  if (key !== mem.pathKey || t.tick >= mem.replanAt) {
    mem.pathKey = key;
    mem.replanAt = t.tick + REPLAN_TICKS;
    mem.path = obs.route(obs.me.pos, target);
    mem.pathIdx = 0;
  }
  const p = mem.path;
  if (!p) return target;
  while (mem.pathIdx < p.length - 1 && dist(obs.me.pos, p[mem.pathIdx] as Vec3) < arriveM) mem.pathIdx++;
  return p[mem.pathIdx] as Vec3;
}

/** Un-sticking: a body that has barely moved for 1.5 s while it was asked to move sidesteps (on foot) or reverses (in a vehicle). */
function stuckCheck(obs: MissionObs, mem: Mem, t: Tools, moving: boolean): void {
  const here = obs.me.vehicle?.pos ?? obs.me.pos;
  if (t.tick - mem.lastPosTick < STUCK_CHECK_TICKS) return;
  const moved = dist(here, mem.lastPos);
  mem.lastPos = [here[0], here[1], here[2]];
  mem.lastPosTick = t.tick;
  if (moving && moved < STUCK_MIN_MOVE_M && t.tick >= mem.unstickUntil) {
    mem.unstickUntil = t.tick + 70;
    mem.unstickKind = obs.me.vehicle ? 'reverse' : 'sidestep';
    mem.unstickSide = t.rng() < 0.5 ? 1 : -1;
    mem.avoidSide = mem.unstickSide;
  }
}

export function walkTo(obs: MissionObs, mem: Mem, t: Tools, target: Vec3, pace: Pace, stopR: number): Control {
  const me = obs.me.pos;
  const d = dist(me, target);
  if (d <= stopR) return { ...NEUTRAL_CONTROL, camYaw: camYawOf(obs.me.yaw) };
  const wp = nextPoint(obs, mem, t, target, WAYPOINT_FOOT_M);
  const wd = dist(me, wp);
  let dir: [number, number] = wd > 1e-6 ? [(wp[0] - me[0]) / wd, (wp[2] - me[2]) / wd] : [0, 0];
  stuckCheck(obs, mem, t, true);
  if (t.tick < mem.unstickUntil && mem.unstickKind === 'sidestep') dir = rotate(dir, 1.5 * mem.unstickSide);
  else dir = steerClear(obs, mem, t, me, dir, 5, 0.7);
  // slow down for the last metres so the arrival does not overshoot a small radius
  const p: Pace = d < 3 && pace !== 'walk' ? 'run' : pace;
  return footControl(dir, p);
}

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
  const wp = nextPoint(obs, mem, t, target, WAYPOINT_DRIVE_M);
  const wd = dist(v.pos, wp);
  let dir: [number, number] = wd > 1e-6 ? [(wp[0] - v.pos[0]) / wd, (wp[2] - v.pos[2]) / wd] : [0, 0];
  dir = steerClear(obs, mem, t, v.pos, dir, 14, 3.4);
  const fx = -dsin(v.yaw);
  const fz = -dcos(v.yaw);
  const lat = dir[0] * -fz + dir[1] * fx;
  const lon = dir[0] * fx + dir[1] * fz;
  const alpha = datan2(lat, lon);
  const steer = Math.round(clamp(alpha * 1.6, -1, 1) * 127);
  // speed plan: the faster of nothing, bounded by the braking distance to the stop point and by the corner
  const left = Math.max(0, d - (stop ? stopR * 0.5 : 0));
  const vBrake = dsqrt(2 * DRIVE_ACCEL_MPS2 * left) + 1.5;
  const vCorner = Math.abs(alpha) > 0.9 ? 4 : Math.abs(alpha) > 0.45 ? 7 : vmax;
  const want = Math.min(vmax, vBrake, vCorner);
  const err = want - v.speed;
  const throttle = err > 0 ? clamp(0.3 + err * 0.3, 0, 1) : 0;
  const brake = err < -1.2 ? clamp(-err * 0.2, 0, 1) : 0;
  return { ...base, steer, throttle: Math.round(throttle * 127), brake: Math.round(brake * 127) };
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

function followPolicy(obs: MissionObs, mem: Mem, t: Tools, g: Extract<Goal, { k: 'follow' }>): Control {
  const c = obs.cast[g.target];
  if (!c || !c.pos) return NEUTRAL_CONTROL;
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
  if (obs.me.vehicle) return driveTo(obs, mem, t, lead, 6, false, 16);
  return walkTo(obs, mem, t, lead, 'sprint', 1.5);
}

function pathPolicy(obs: MissionObs, mem: Mem, t: Tools, points: Vec3[], r: number): Control {
  const p = points[Math.min(mem.pathPt, points.length - 1)] as Vec3;
  if (obs.me.vehicle) return leaveForFoot(obs, mem, t, p);
  if (dist(obs.me.pos, p) < r && mem.pathPt < points.length - 1) mem.pathPt++;
  return walkTo(obs, mem, t, points[Math.min(mem.pathPt, points.length - 1)] as Vec3, 'walk', 0.6);
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
