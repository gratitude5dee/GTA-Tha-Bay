/**
 * Bot driver `racing.line` (M07a1; 13-qa.md 3.2): pure pursuit on the compiled racing line, no opponents. A bot acts only through
 * an `InputFrame`, reads only `observe()` and draws randomness only from the run's `bot` stream, so a run goes through the real
 * input path. QA builds and Node only: registered with `registerBot` from a QA-only import (production chunks must not contain
 * `registerBot`, M04d).
 *
 * Params: `raceId` (default the ferry sprint), `vehicle` (default the supercar), `noise` (an integer; adds a seeded steer offset in
 * [-noise, noise] each tick: a robustness run). Everything numeric here goes through `detmath`: the driver feeds the sim, so a
 * `Math.sin` that differs between Node and WebKit would break the equal-trace proof.
 *
 * Speed plan: curvature of the line (smoothed over +-20 m) gives the corner speed `sqrt(aLat / |k|)`; a backward pass over the 5 m
 * samples gives the braking distance; throttle and brake follow the plan at the point the car will reach in 0.4 s.
 */
import { centreline, datan2, dcos, dsin, dsqrt, PI, routeElevation, routePoint, type HandlingProfile, type InputFrame, type RaceDef } from '@dv/shared';
import { registerBot, registeredBots, type BotContext, type BotDriver } from '@dv/engine/qa';
import { raceCar } from '../cars.ts';
import { DEFAULT_RACE, raceDef } from '../races.ts';
import type { RacingObservation } from './scenario.ts';

export const RACING_LINE_DRIVER_ID = 'racing.line';

/** Lateral acceleration the plan asks of the tyres, as a share of `muLat * g`. */
const LAT_SHARE = 0.5;
const BRAKE_MPS2 = 6.5;
const G = 9.81;
/** Share of 1 g the plan allows over a crest. */
const CREST_SHARE = 0.35;
const VEHICLE_CONTEXT = 1;
const STEER_RATE = 25;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export interface SpeedPlan { v: Float64Array; stepM: number }

/** The speed plan along the line, m/s per 5 m sample. */
export function speedPlan(def: Pick<RaceDef, 'line' | 'routeLenM' | 'elevation'>, p: Pick<HandlingProfile, 'tire' | 'class'>, topMps: number, latShare: number = LAT_SHARE, gradeAware = false): SpeedPlan {
  const pts = centreline(def);
  const n = pts.length / 2;
  const step = def.line.stepM;
  // heading of each 5 m segment, then the turn over a +-15 m window (a sharp junction corner is one vertex of the line, so the
  // heading change over a window, not the vertex curvature, says how slow the corner is)
  const h = new Float64Array(Math.max(1, n - 1));
  for (let i = 0; i < n - 1; i++) h[i] = datan2((pts[2 * i + 3] as number) - (pts[2 * i + 1] as number), (pts[2 * i + 2] as number) - (pts[2 * i] as number));
  const w = 3;
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = h[Math.max(0, Math.min(h.length - 1, i - w))] as number;
    const b = h[Math.max(0, Math.min(h.length - 1, i + w - 1))] as number;
    let d = b - a;
    while (d > PI) d -= 2 * PI;
    while (d < -PI) d += 2 * PI;
    k[i] = Math.abs(d) / (2 * w * step);
  }
  const aLat = latShare * p.tire.muLat * G;
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const kk = k[i] as number;
    v[i] = Math.min(topMps, kk < 1e-4 ? topMps : dsqrt(aLat / kk));
  }
  // crests: the vertical curvature from the 25 m elevation samples; a car that is light over a crest leaves the road
  const el = def.elevation;
  for (let j = 1; j + 1 < el.length; j++) {
    const g1 = ((el[j] as { y: number }).y - (el[j - 1] as { y: number }).y) / 25;
    const g2 = ((el[j + 1] as { y: number }).y - (el[j] as { y: number }).y) / 25;
    const kv = (g2 - g1) / 25;
    if (kv >= -1e-4) continue;
    const vc = dsqrt((CREST_SHARE * G) / -kv);
    const c = Math.round(((el[j] as { s: number }).s) / step);
    for (let i = Math.max(0, c - 3); i <= Math.min(n - 1, c + 3); i++) v[i] = Math.min(v[i] as number, vc);
  }
  v[n - 1] = Math.min(v[n - 1] as number, 12);
  for (let i = n - 2; i >= 0; i--) {
    const next = v[i + 1] as number;
    // downhill the car brakes against its own weight: the braking distance grows with the grade (M07a2, par bot and pursuit bot)
    let brake = BRAKE_MPS2;
    if (gradeAware) {
      const drop = routeElevation(def, i * step) - routeElevation(def, (i + 1) * step);
      brake = Math.max(2.5, BRAKE_MPS2 - (G * drop) / step);
    }
    v[i] = Math.min(v[i] as number, dsqrt(next * next + 2 * brake * step));
  }
  return { v, stepM: step };
}

export function planAt(plan: SpeedPlan, s: number): number {
  const f = s / plan.stepM;
  const i = Math.max(0, Math.min(plan.v.length - 2, Math.floor(f)));
  const t = clamp(f - i, 0, 1);
  return (plan.v[i] as number) * (1 - t) + (plan.v[i + 1] as number) * t;
}

export interface LineMemory { prevSteer: number }
export interface LinePose { x: number; z: number; yaw: number; speed: number; s: number }
export interface LineOptions {
  /** Seeded steer noise: an integer amplitude and the bot stream (a robustness run). */
  noise?: { amplitude: number; rng: () => number };
  /** Arrive at this route metre and stop there (the pursuit bot at its hiding spot); the plan is capped by the braking distance. */
  stopAtS?: number;
}

/**
 * One tick of the line driver: pure pursuit on the compiled line, the speed plan at the point reached in 0.4 s. Returns throttle and
 * brake 0..1 and the steer byte. Shared by `racing.line` and the pursuit bot (`pursuit-bot.ts`); the arithmetic is the line driver's.
 */
export function driveLine(def: RaceDef, prof: HandlingProfile, plan: SpeedPlan, o: LinePose, mem: LineMemory, opt: LineOptions = {}): { throttle: number; brake: number; steer: number } {
  const v = o.speed < 0 ? 0 : o.speed;
  const fx = -dsin(o.yaw);
  const fz = -dcos(o.yaw);

  // pure pursuit: the point Ld ahead on the line
  const ld = Math.max(8, 5 + 0.8 * v);
  const tp = routePoint(def, o.s + ld);
  const dx = tp.x - o.x;
  const dz = tp.z - o.z;
  const lat = dx * -fz + dz * fx;
  const lon = dx * fx + dz * fz;
  const alpha = datan2(lat, lon);
  const delta = (prof.wheelbaseM * 2 * dsin(alpha)) / Math.max(1, ld);
  const lockRad = (prof.steer.lockDeg * PI) / 180 / (1 + (v / prof.steer.speedRefMps) * (v / prof.steer.speedRefMps));
  let steer = Math.round(clamp(delta / Math.max(lockRad, (prof.steer.minLockPct / 100) * ((prof.steer.lockDeg * PI) / 180)), -1, 1) * 127);
  // the steering moves at most 25 of 127 per tick: a quick correction at 180 kph is a spin
  steer = clamp(steer, mem.prevSteer - STEER_RATE, mem.prevSteer + STEER_RATE);
  mem.prevSteer = steer;
  if (opt.noise) steer = clamp(steer + Math.round((opt.noise.rng() * 2 - 1) * opt.noise.amplitude), -127, 127);

  // speed plan at the point reached in 0.4 s
  let vt = planAt(plan, o.s + v * 0.4);
  if (opt.stopAtS !== undefined) {
    const left = opt.stopAtS - (o.s + v * 0.4);
    vt = Math.min(vt, left <= 0 ? 0 : dsqrt(2 * BRAKE_MPS2 * 0.8 * left));
  }
  const err = vt - v;
  let throttle = 0;
  let brake = 0;
  if (err > 0) throttle = clamp(0.25 + err * 0.4, 0, 1);
  else if (err < -0.5) brake = clamp(-err * 0.25, 0, 1);
  if (opt.stopAtS !== undefined && vt <= 0.01) brake = Math.max(brake, 0.6);
  // a hard steer lifts the throttle
  if (Math.abs(steer) > 90) throttle = Math.min(throttle, 0.5);
  return { throttle, brake, steer };
}

export function createRacingLineDriver(): BotDriver {
  let def: RaceDef | null = null;
  let prof: HandlingProfile | null = null;
  let plan: SpeedPlan | null = null;
  let noise = 0;
  let rng: (() => number) | null = null;
  let observe: (() => Readonly<Record<string, unknown>>) | null = null;
  let last: RacingObservation | null = null;
  const mem: LineMemory = { prevSteer: 0 };

  return {
    id: RACING_LINE_DRIVER_ID,
    device: 'bot',
    init(ctx: BotContext, params?: Record<string, unknown>): void {
      const id = typeof params?.['raceId'] === 'string' ? params['raceId'] : DEFAULT_RACE;
      def = raceDef(id);
      if (!def) throw new Error(`driver '${RACING_LINE_DRIVER_ID}': unknown race ${id}`);
      const car = raceCar(typeof params?.['vehicle'] === 'string' ? params['vehicle'] : 'vehicle.aurelian-sorrel');
      if (!car) throw new Error(`driver '${RACING_LINE_DRIVER_ID}': unknown vehicle`);
      prof = car.profile;
      plan = speedPlan(def, prof, 48, LAT_SHARE, params?.['gradeAware'] === true);
      const nz = params?.['noise'];
      noise = typeof nz === 'number' && Number.isInteger(nz) && nz > 0 ? nz : 0;
      rng = noise > 0 ? ctx.rng('bot') : null;
      observe = ctx.observe;
    },

    frame(tick: number): InputFrame {
      if (!def || !prof || !plan || !observe) throw new Error(`driver '${RACING_LINE_DRIVER_ID}' used before init`);
      const o = observe() as unknown as RacingObservation;
      last = o;
      const base: InputFrame = { tick, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: VEHICLE_CONTEXT, device: 7 };
      if (o.phase !== 'Running') return base;
      const c = driveLine(def, prof, plan, { x: o.x, z: o.z, yaw: o.yaw, speed: o.speed, s: o.s }, mem, noise > 0 && rng ? { noise: { amplitude: noise, rng } } : {});
      return { ...base, throttle: Math.round(c.throttle * 127), brake: Math.round(c.brake * 127), steer: c.steer };
    },

    done(): { done: boolean; outcome?: string } {
      const o = last;
      if (!o) return { done: false };
      if (o.phase === 'Results' || o.phase === 'Finished' || o.phase === 'Failed') return { done: true, outcome: o.outcome ?? 'end' };
      return { done: false };
    },
  };
}

/** Registers the driver once (QA entry points call this). */
export function ensureRacingBot(): void {
  if (!registeredBots().includes(RACING_LINE_DRIVER_ID)) registerBot(RACING_LINE_DRIVER_ID, createRacingLineDriver);
}
