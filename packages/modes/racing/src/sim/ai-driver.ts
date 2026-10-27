/**
 * AI drivers (06-racing-content.md C.12, 06-racing.md 2.2 and 2.9; M07a2).
 *
 * `RivalField` runs the rivals of one race as M2 point masses: each rival has a route position, a speed and a lateral offset, its
 * target speed is the racing-line speed profile (`speed-profile.ts`) times `skillFactor`, scaled by the capped rubber-band, and
 * the speed follows that target within the class power curve and the brake margin. Rivals think at 30 Hz; the integration runs at
 * the sim rate. Seeded mistakes (a wide line through a corner), overtakes (the freer side for 1.5 s) and the pose come from the
 * same state, so a run is a function of the seed and the player's progress.
 *
 * `driveCommand` is the M1 half of the same algorithm: pure pursuit with a lookahead of `6 m + 0.25 v` on the line, a PI speed
 * controller, and the stuck and off-route recovery. The engine port of M07a2 drives one car (the player's), so rivals are not
 * promoted to M1 yet (BD-M07a2-03); `driveCommand` is what the promotion will call, and the tests run it against a bicycle model.
 *
 * Sim code under the C02 lint: detmath only, the seeded stream `racing.ai`, no clock.
 */
import {
  datan2, dcos, dsin, dsqrt, PI, routePoint, SIM_DT, streams,
  type Difficulty, type HandlingProfile, type RaceDef, type RaceKind, type Rng,
} from '@dv/shared';
import type { RacingConfig } from '../config.ts';
import { routePose, type Pose } from './pose.ts';
import { bandStrength, newBand, rubberMult, type BandState } from './rubber-band.ts';
import { accelAt, brakeDecel, buildSpeedProfile, classTopMps, profileAt, type SpeedProfile } from './speed-profile.ts';
import { decideTier, type VehicleTier } from './lod.ts';

export const AI_STREAM = 'racing.ai';
/** Sim ticks per AI think (60 Hz sim, 30 Hz think). */
export const AI_DIVISOR = 2;

export const skillFactor = (cfg: RacingConfig['ai'], skill: number): number => cfg.speedFactorMin + (cfg.speedFactorMax - cfg.speedFactorMin) * clamp01(skill);
export const brakeMargin = (cfg: RacingConfig['ai'], skill: number): number => cfg.brakeMarginMax - (cfg.brakeMarginMax - 1) * clamp01(skill);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export interface RivalSpec { driverId: string; vehicleDef: string; skill: number; profile: HandlingProfile }

export interface Rival {
  index: number;
  driverId: string;
  vehicleDef: string;
  skill: number;
  profile: HandlingProfile;
  plan: SpeedProfile;
  lap: number;
  s: number;
  v: number;
  lat: number;
  latTarget: number;
  /** Metres since the start: (lap - 1) * routeLenM + s. */
  totalM: number;
  finishTick: number;
  targetV: number;
  powerMult: number;
  mistakeTicks: number;
  mistakeLat: number;
  overtakeTicks: number;
  overtakeSide: number;
  inCorner: boolean;
  band: BandState;
  tier: VehicleTier;
  pose: Pose;
}

export interface PlayerRef {
  totalM: number;
  /** Lateral offset from the centreline, metres (positive left). */
  lat: number;
  speedMps: number;
}

export interface HashSink { u8(v: number): unknown; u32(v: number): unknown; f32(v: number): unknown }

export interface RivalFieldDeps {
  def: RaceDef;
  cfg: RacingConfig;
  specs: readonly RivalSpec[];
  difficulty: Difficulty;
  seed: number;
  /** A time trial or any run without a band. */
  timeTrial?: boolean;
  qualityTier?: 'desktop-ultra' | 'desktop' | 'mobile' | 'mobile-low' | 'xr-quest' | 'xr-visionpro';
  /** The host can run an M1 body for a rival (false in M07a2). */
  engineHasM1?: boolean;
}

export class RivalField {
  readonly rivals: Rival[] = [];
  private readonly rng: Rng;
  private readonly laps: number;
  private readonly rb: number;
  private readonly raceM: number;
  private readonly lineOffsetM: Float64Array;
  private readonly plans = new Map<string, SpeedProfile>();
  private goTick = -1;

  constructor(private readonly d: RivalFieldDeps) {
    this.rng = streams(d.seed).get(AI_STREAM);
    this.laps = Math.max(1, d.def.laps ?? 1);
    this.raceM = this.laps * d.def.routeLenM;
    this.rb = bandStrength(d.cfg.rubberBand, d.def.rubberBand, d.difficulty, d.def.kind as RaceKind, d.timeTrial === true);
    this.lineOffsetM = Float64Array.from(d.def.line.offsetCm, (c) => c / 100);
    d.specs.forEach((sp, i) => this.rivals.push(this.make(sp, i)));
  }

  get size(): number {
    return this.rivals.length;
  }

  /** The grid slot of rival `k` (0-based): slot k + 1 of the compiled grid (6 m rows), 1.6 m off the line, alternating sides. */
  private slot(k: number): { s: number; lat: number } {
    const g = this.d.def.grid[k + 1];
    if (g) return { s: g.s, lat: (k % 2 === 0 ? 1 : -1) * 1.6 };
    const g0 = this.d.def.grid[0];
    return { s: (g0 ? g0.s : 0) - 6 * (k + 1), lat: (k % 2 === 0 ? 1 : -1) * 1.6 };
  }

  private make(sp: RivalSpec, index: number): Rival {
    const margin = brakeMargin(this.d.cfg.ai, sp.skill);
    const key = `${sp.profile.id}:${margin.toFixed(3)}`;
    let plan = this.plans.get(key);
    if (!plan) {
      plan = buildSpeedProfile(this.d.def, sp.profile, { brakeMargin: margin });
      this.plans.set(key, plan);
    }
    const slot = this.slot(index);
    const r: Rival = {
      index, driverId: sp.driverId, vehicleDef: sp.vehicleDef, skill: sp.skill, profile: sp.profile, plan,
      lap: 1, s: slot.s, v: 0, lat: slot.lat, latTarget: slot.lat, totalM: slot.s, finishTick: -1, targetV: 0, powerMult: 1,
      mistakeTicks: 0, mistakeLat: 0, overtakeTicks: 0, overtakeSide: 0, inCorner: false, band: newBand(), tier: 'M2',
      pose: routePose(this.d.def, slot.s, slot.lat),
    };
    return r;
  }

  /** Back to the grid (a retry). The stream restarts, so the seed of the attempt decides the mistakes. */
  reset(seed: number): void {
    (this as unknown as { rng: Rng }).rng = streams(seed).get(AI_STREAM);
    this.goTick = -1;
    for (let i = 0; i < this.rivals.length; i++) {
      const old = this.rivals[i] as Rival;
      this.rivals[i] = this.make({ driverId: old.driverId, vehicleDef: old.vehicleDef, skill: old.skill, profile: old.profile }, i);
    }
  }

  /** `tick` is the sim tick; `goTick` the tick of GO (-1 while the grid or the countdown run, then the rivals stand). */
  step(tick: number, goTick: number, player: PlayerRef, playerPos?: readonly [number, number, number]): void {
    if (goTick < 0 || tick < goTick) return;
    const { d } = this;
    if (this.goTick < 0) this.goTick = goTick;
    const think = (tick - this.goTick) % AI_DIVISOR === 0;
    for (const r of this.rivals) {
      if (r.finishTick >= 0) {
        // after the line: roll out
        r.v *= 0.985;
        r.s = Math.min(d.def.routeLenM, r.s + r.v * SIM_DT);
        r.pose = routePose(d.def, r.s, r.lat);
        continue;
      }
      if (think) this.think(r, player);
      this.integrate(r, tick);
      void playerPos;
    }
  }

  private think(r: Rival, player: PlayerRef): void {
    const { d } = this;
    const ai = d.cfg.ai;
    const look = ai.lookaheadBaseM + ai.lookaheadPerMps * r.v;
    const idx = Math.max(0, Math.min(r.plan.v.length - 1, Math.round((r.s + look) / r.plan.stepM)));
    const top = classTopMps(r.profile);

    // the band: gap = player progress - rival progress
    const m = rubberMult(d.cfg.rubberBand, r.band, player.totalM - r.totalM, this.rb, r.totalM / this.raceM);
    r.powerMult = m;
    let vt = profileAt(r.plan, r.s + look) * skillFactor(ai, r.skill) * m;

    // a corner: draw once per entry whether this lap goes wide
    const corner = (r.plan.grip[idx] as number) < top * 0.6;
    if (corner && !r.inCorner) {
      const roll = this.rng.nextFloat();
      if (roll < (1 - r.skill) * ai.mistakePerCorner) {
        r.mistakeTicks = Math.round(2 / SIM_DT);
        const k = d.def.line.curvature[idx] as number;
        r.mistakeLat = k >= 0 ? -2.4 : 2.4;
      }
    }
    r.inCorner = corner;
    if (r.mistakeTicks > 0) vt *= 0.94;

    // overtake: a car within `overtakeGapM` ahead, in my lane, slower than me
    if (r.overtakeTicks <= 0) {
      const ahead = this.nearestAhead(r, player, ai.overtakeGapM);
      if (ahead) {
        r.overtakeTicks = Math.round(ai.overtakeHoldSec / SIM_DT);
        r.overtakeSide = ahead.lat >= 0 ? -1 : 1;
      }
    }
    r.targetV = vt;
    const lineLat = this.lineOffsetM[Math.max(0, Math.min(this.lineOffsetM.length - 1, Math.round(r.s / r.plan.stepM)))] ?? 0;
    r.latTarget = lineLat + (r.mistakeTicks > 0 ? r.mistakeLat : 0) + (r.overtakeTicks > 0 ? r.overtakeSide * 2.6 : 0);
  }

  private nearestAhead(r: Rival, player: PlayerRef, gap: number): { lat: number; speed: number } | null {
    let best: { lat: number; speed: number; dist: number } | null = null;
    const consider = (total: number, lat: number, speed: number): void => {
      const dist = total - r.totalM;
      const dl = lat - r.lat;
      if (dist > 0 && dist < gap && (dl < 2.2 && dl > -2.2) && r.v > speed - 0.5 && (!best || dist < best.dist)) best = { lat, speed, dist };
    };
    consider(player.totalM, player.lat, player.speedMps);
    for (const o of this.rivals) if (o !== r && o.finishTick < 0) consider(o.totalM, o.lat, o.v);
    return best;
  }

  private integrate(r: Rival, tick: number): void {
    const { d } = this;
    const err = r.targetV - r.v;
    let a: number;
    if (err > 0) {
      const cap = accelAt(r.profile, r.v) * r.powerMult;
      a = Math.min(err * 3, cap);
    } else {
      a = Math.max(err * 3, -brakeDecel(r.profile, brakeMargin(d.cfg.ai, r.skill)));
    }
    r.v += a * SIM_DT;
    if (r.v < 0) r.v = 0;
    r.s += r.v * SIM_DT;
    if (r.mistakeTicks > 0) r.mistakeTicks--;
    if (r.overtakeTicks > 0) r.overtakeTicks--;
    // lateral: at most 2.5 m/s toward the target
    const dl = r.latTarget - r.lat;
    const step = 2.5 * SIM_DT;
    r.lat += dl > step ? step : dl < -step ? -step : dl;
    if (r.s >= d.def.routeLenM) {
      if (r.lap < this.laps) {
        r.lap++;
        r.s -= d.def.routeLenM;
      } else {
        r.s = d.def.routeLenM;
        r.finishTick = tick;
      }
    }
    r.totalM = (r.lap - 1) * d.def.routeLenM + r.s;
    r.pose = routePose(d.def, r.s, r.lat);
    // tier: the engine cannot draw an M1 rival yet, so this stays M2 (see the header)
    r.tier = decideTier(d.cfg.models, d.qualityTier ?? 'desktop', r.tier, 0, 0, d.engineHasM1 === true).tier;
  }

  /** Place of the player among all cars from progress: 1 + rivals that finished before the tick or are further along. */
  placeOf(playerTotalM: number, playerFinishTick: number): number {
    let ahead = 0;
    for (const r of this.rivals) {
      if (playerFinishTick >= 0) {
        if (r.finishTick >= 0 && r.finishTick <= playerFinishTick) ahead++;
      } else if (r.totalM > playerTotalM) ahead++;
    }
    return 1 + ahead;
  }

  allFinished(): boolean {
    return this.rivals.every((r) => r.finishTick >= 0);
  }

  hashInto(h: HashSink): void {
    h.u32(this.rivals.length);
    for (const r of this.rivals) {
      h.u8(r.lap);
      h.f32(r.s);
      h.f32(r.v);
      h.f32(r.lat);
      h.u32(r.finishTick < 0 ? 0xffffffff : r.finishTick);
      h.u32(r.mistakeTicks);
      h.u32(r.overtakeTicks);
    }
    const st = this.rng.getState();
    for (const w of st) h.u32(w);
  }
}

// ------------------------------------------------------------------ M1: the command for a car with a body

export interface DriveState {
  x: number;
  z: number;
  yaw: number;
  speedMps: number;
  /** Route metres of the car (the referee's projection). */
  s: number;
}

export interface DriveMemory {
  /** Integral of the speed error. */
  integral: number;
  stuckTicks: number;
  prevSteer: number;
}
export const newDriveMemory = (): DriveMemory => ({ integral: 0, stuckTicks: 0, prevSteer: 0 });

export interface DriveOut {
  throttle: number;
  brake: number;
  steer: number;
  /** Reverse for the stuck recovery (the caller maps it to a reverse gear or a back-up). */
  reverse: boolean;
  /** The car is further than `offRouteTeleportM` from the line: place it on the nearest line point, out of sight. */
  teleport: boolean;
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Pure pursuit + PI speed control (C.12). Steering moves at most 25 of 127 per tick. */
export function driveCommand(
  def: RaceDef, p: HandlingProfile, plan: SpeedProfile, cfg: RacingConfig['ai'], skill: number, mem: DriveMemory, st: DriveState, rbMult = 1,
): DriveOut {
  const v = st.speedMps < 0 ? 0 : st.speedMps;
  const ld = cfg.lookaheadBaseM + cfg.lookaheadPerMps * v;
  const tp = routePoint(def, st.s + ld);
  const fx = -dsin(st.yaw);
  const fz = -dcos(st.yaw);
  const dx = tp.x - st.x;
  const dz = tp.z - st.z;
  const lat = dx * -fz + dz * fx;
  const lon = dx * fx + dz * fz;
  const alpha = datan2(lat, lon);
  const delta = (p.wheelbaseM * 2 * dsin(alpha)) / Math.max(1, dsqrt(dx * dx + dz * dz));
  const lockRad = (p.steer.lockDeg * PI) / 180 / (1 + (v / p.steer.speedRefMps) * (v / p.steer.speedRefMps));
  const rawSteer = Math.round(clamp(delta / Math.max(lockRad, 0.05), -1, 1) * 127);
  const steer = clamp(rawSteer, mem.prevSteer - 25, mem.prevSteer + 25);
  mem.prevSteer = steer;

  const vt = profileAt(plan, st.s + v * 0.4) * skillFactor(cfg, skill) * rbMult;
  const err = vt - v;
  mem.integral = clamp(mem.integral + err * SIM_DT, -4, 4);
  const u = 0.35 * err + 0.2 * mem.integral;
  let throttle = 0;
  let brake = 0;
  if (u > 0) throttle = clamp(0.2 + u, 0, 1);
  else if (err < -0.5) brake = clamp(-u * 0.5, 0, 1);
  if (Math.abs(steer) > 90) throttle = Math.min(throttle, 0.5);

  // recover: stuck for `recoverStuckSec` with the throttle open -> reverse; off the line beyond the teleport radius -> place
  mem.stuckTicks = v < 0.5 && throttle > 0.3 ? mem.stuckTicks + 1 : 0;
  const reverse = mem.stuckTicks >= Math.round(cfg.recoverStuckSec / SIM_DT);
  const cp = routePoint(def, st.s);
  const off = dsqrt((st.x - cp.x) * (st.x - cp.x) + (st.z - cp.z) * (st.z - cp.z));
  return { throttle: Math.round(throttle * 127), brake: Math.round(brake * 127), steer, reverse, teleport: off > cfg.offRouteTeleportM };
}
