/**
 * The racing-line speed profile of an AI driver (06-racing-content.md C.12; M07a2). Over the 5 m samples of the line:
 *
 *   1. grip limit   v_i <= sqrt(mu_eff * g / |k_i|), k from the baked curvature (1e-4 1/m), widened to the larger of a sample and
 *                   its two neighbours (a corner belongs to the span around its vertex) and capped at 1/6 m (`MAX_CURVATURE`);
 *   2. braking pass backward, v_i^2 <= v_{i+1}^2 + 2 a_brake ds;
 *   3. power pass forward, v_{i+1}^2 <= v_i^2 + 2 a_acc(v_i) ds, a_acc from the engine power and the drag, capped by traction.
 *
 * The grip limit only ever goes down in passes 2 and 3, so no sample exceeds it. Sim code under the C02 lint (detmath only).
 */
import { CLASS_ENVELOPE, dsqrt, GRAVITY, type HandlingProfile, type RaceDef } from '@dv/shared';

export const MAX_CURVATURE = 1 / 6;
/** Share of the tyres' lateral grip an AI driver asks for (the rest is the margin for mistakes). */
export const GRIP_SHARE = 0.92;
const AIR_RHO = 1.2;
const DRIVETRAIN_EFF = 0.85;
/** Share of the declared top speed the profile allows (the car is still pulling at the class top). */
const TOP_SHARE = 0.97;

export interface SpeedProfile {
  stepM: number;
  /** Target speed per sample, m/s. */
  v: Float64Array;
  /** Grip limit per sample, m/s (the first pass only). */
  grip: Float64Array;
}

export function classTopMps(p: Pick<HandlingProfile, 'class'>): number {
  return (CLASS_ENVELOPE[p.class].topKph[1] / 3.6) * TOP_SHARE;
}

/** Longitudinal acceleration available at speed `v`, m/s^2. */
export function accelAt(p: HandlingProfile, v: number): number {
  const vv = v < 3 ? 3 : v;
  const drive = (p.engine.powerKw * 1000 * DRIVETRAIN_EFF) / (p.massKg * vv);
  const drag = (0.5 * AIR_RHO * p.aero.cdA * v * v) / p.massKg;
  const traction = p.tire.muLong * GRAVITY * 0.85;
  const a = (drive < traction ? drive : traction) - drag;
  return a < 0.2 ? 0.2 : a;
}

/** Braking deceleration the profile plans with, m/s^2 (a share of the car's brake g, divided by the driver's margin). */
export function brakeDecel(p: HandlingProfile, margin = 1): number {
  return (p.brake.maxDecelG * GRAVITY * 0.8) / margin;
}

/** The grip-limited speed of a curvature `k1e4` (1e-4 1/m), m/s. */
export function gripLimit(k1e4: number, mu: number, topMps: number): number {
  let k = (k1e4 < 0 ? -k1e4 : k1e4) * 1e-4;
  if (k > MAX_CURVATURE) k = MAX_CURVATURE;
  if (k < 1e-5) return topMps;
  const v = dsqrt((mu * GRAVITY) / k);
  return v < topMps ? v : topMps;
}

export function buildSpeedProfile(def: Pick<RaceDef, 'line'>, p: HandlingProfile, o: { brakeMargin?: number } = {}): SpeedProfile {
  const kv = def.line.curvature;
  const n = kv.length;
  const step = def.line.stepM;
  const top = classTopMps(p);
  const mu = p.tire.muLat * GRIP_SHARE;
  const grip = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let k = Math.abs(kv[i] as number);
    if (i > 0) k = Math.max(k, Math.abs(kv[i - 1] as number));
    if (i + 1 < n) k = Math.max(k, Math.abs(kv[i + 1] as number));
    grip[i] = gripLimit(k, mu, top);
  }
  const v = Float64Array.from(grip);
  const b = brakeDecel(p, o.brakeMargin ?? 1);
  for (let i = n - 2; i >= 0; i--) {
    const next = v[i + 1] as number;
    const lim = dsqrt(next * next + 2 * b * step);
    if ((v[i] as number) > lim) v[i] = lim;
  }
  for (let i = 0; i + 1 < n; i++) {
    const cur = v[i] as number;
    const lim = dsqrt(cur * cur + 2 * accelAt(p, cur) * step);
    if ((v[i + 1] as number) > lim) v[i + 1] = lim;
  }
  return { stepM: step, v, grip };
}

/** Linear interpolation of the profile at route metre `s` (clamped). */
export function profileAt(sp: SpeedProfile, s: number): number {
  const n = sp.v.length;
  const f = s / sp.stepM;
  if (f <= 0) return sp.v[0] as number;
  if (f >= n - 1) return sp.v[n - 1] as number;
  const i = Math.floor(f);
  const t = f - i;
  return (sp.v[i] as number) * (1 - t) + (sp.v[i + 1] as number) * t;
}
