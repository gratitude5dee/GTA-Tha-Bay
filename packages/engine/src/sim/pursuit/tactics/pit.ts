/**
 * PIT (M03c): the unit comes up beside the player's rear quarter and steers into it. The tactic only chooses where to aim; the
 * contact is the vehicle model's, never an impulse. A PIT is tried only above `PIT_MIN_SPEED` and below `PIT_MAX_SPEED`, the
 * speeds where a nudge turns a car without destroying the unit (BD-M03c-04).
 *
 * Sim code under the C02 lint.
 */
import type { PlayerView, UnitView } from '../ports.ts';
import { clamp, dist2, forwardOf, rightOf, UNIT_MAX_SPEED, type SteerTarget } from './follow.ts';

export const PIT_MIN_SPEED = 8;
export const PIT_MAX_SPEED = 32;
/** The unit commits to the push inside this lateral and longitudinal gap, metres. */
const COMMIT_M = 4.5;

export const pitAllowed = (p: PlayerView): boolean => !p.onFoot && p.speed >= PIT_MIN_SPEED && p.speed <= PIT_MAX_SPEED;

/**
 * The target for a PIT from the side the unit is already on: the rear quarter 2.6 m behind the player's centre and 1.2 m to that
 * side while closing, and the player's centre line (the push) once the unit is alongside.
 */
export function pitTarget(u: UnitView, p: PlayerView): SteerTarget {
  const [fx, fz] = forwardOf(p.yaw);
  const [rx, rz] = rightOf(p.yaw);
  const rel = [u.pos[0] - p.pos[0], u.pos[2] - p.pos[2]] as const;
  const along = rel[0] * fx + rel[1] * fz;
  const lat = rel[0] * rx + rel[1] * rz;
  const side = lat >= 0 ? 1 : -1;
  const alongside = Math.abs(along + 2.6) < COMMIT_M && Math.abs(lat) < COMMIT_M;
  const aimSide = alongside ? 0.15 * side : 1.2 * side;
  const aimAhead = alongside ? -2.0 : -2.6;
  const speed = clamp(p.speed + (alongside ? 2 : dist2(u.pos[0], u.pos[2], p.pos[0], p.pos[2]) > 30 ? 8 : 4), 0, UNIT_MAX_SPEED);
  return { x: p.pos[0] + fx * aimAhead + rx * aimSide, z: p.pos[2] + fz * aimAhead + rz * aimSide, speed };
}
