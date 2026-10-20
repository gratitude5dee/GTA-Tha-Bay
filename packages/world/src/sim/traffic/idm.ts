/**
 * The car-following model of ambient traffic (02-world-living.md section 2.1.1; M03b1): an IDM-style law with the spec's constants.
 *
 *   a = A (1 - (v / v0)^4 - (s* / gap)^2),   s* = s0 + max(0, v T + v dv / (2 sqrt(A B)))
 *
 * `v0` is the desired speed: the lower of the edge limit and the curve limit, scaled by the agent's personality and, on a steep
 * grade, by the grade factor. Curve limit `v <= dsqrt(2 / kappa)`. Pure; C02 lint applies (square roots through `detmath`).
 */
import { dsqrt } from '@dv/shared';

/** Time headway, s. */
export const IDM_T = 1.4;
/** Minimum gap, m. */
export const IDM_S0 = 2.0;
/** Comfortable acceleration, m/s^2. */
export const IDM_A = 2.5;
/** Comfortable braking, m/s^2 (also the braking a stop decision is judged against). */
export const IDM_B = 3.5;
/** Hardest braking the model asks of a car, m/s^2. */
export const IDM_MAX_BRAKE = 9;
/** Personality range from the agent stream (living part 2.1.1). */
export const PERSONALITY_MIN = 0.92;
export const PERSONALITY_MAX = 1.08;

const SQRT_AB = dsqrt(IDM_A * IDM_B);

/**
 * Acceleration of a car at speed `v` that wants `v0`, with a leader `gap` metres ahead (bumper to bumper) at speed `vLead`.
 * Pass `gap = Infinity` for a free road. The result is clamped to [-IDM_MAX_BRAKE, IDM_A].
 */
export function idmAccel(v: number, v0: number, gap: number, vLead: number): number {
  const r = v0 > 0.01 ? v / v0 : 2;
  const r2 = r * r;
  let a = 1 - r2 * r2;
  if (gap < Infinity) {
    const g = gap < 0.1 ? 0.1 : gap;
    const dv = v - vLead;
    let sStar = IDM_S0 + v * IDM_T + (v * dv) / (2 * SQRT_AB);
    if (sStar < IDM_S0) sStar = IDM_S0;
    const q = sStar / g;
    a -= q * q;
  }
  a *= IDM_A;
  return a < -IDM_MAX_BRAKE ? -IDM_MAX_BRAKE : a > IDM_A ? IDM_A : a;
}

/** The speed an edge's curvature allows (`dsqrt(2 / kappa)`, kappa in 1/m); Infinity on a straight line. */
export function curveLimit(kappa: number): number {
  return kappa > 0.002 ? dsqrt(2 / kappa) : Infinity;
}

/** Grade above 10 % scales the desired speed by `1 - (grade - 10) / 40`, floor 0.6. */
export function gradeScale(gradePct: number): number {
  const g = gradePct < 0 ? -gradePct : gradePct;
  if (g <= 10) return 1;
  const f = 1 - (g - 10) / 40;
  return f < 0.6 ? 0.6 : f;
}

/** The distance a car needs to stop from `v` at `decel` m/s^2. */
export function stopDistance(v: number, decel: number = IDM_B): number {
  return (v * v) / (2 * decel);
}

/**
 * Advances one car by `dt`: new speed and distance for the acceleration `a`. A car never reverses: when the speed would go
 * negative it stops after `v^2 / (2 |a|)` metres.
 */
export function advance(v: number, a: number, dt: number, out: { v: number; ds: number }): void {
  const nv = v + a * dt;
  if (nv <= 0) {
    out.ds = a < 0 ? (v * v) / (2 * -a) : 0;
    out.v = 0;
  } else {
    out.ds = v * dt + 0.5 * a * dt * dt;
    out.v = nv;
  }
}
