/**
 * The steering every ground tactic shares (M03c): a tactic only picks a target point and a target speed; this turns them into the
 * `DriveInput` that goes to `stepHandling` through the vehicle system. Police drive through the same vehicle model as the player
 * and never get an impulse of their own (Risks & fallbacks).
 *
 * Sim code under the C02 lint.
 */
import { datan2, dsin, dcos, dsqrt } from '@dv/shared';
import type { DriveInput, PlayerView, UnitView, Vec3 } from '../ports.ts';

/** Forward unit vector in (x, z) of a heading (0 faces -Z; -pi/2 faces +X). */
export const forwardOf = (yaw: number): [number, number] => [-dsin(yaw), -dcos(yaw)];
/** Right-hand unit vector in (x, z) of a heading. */
export const rightOf = (yaw: number): [number, number] => [dcos(yaw), -dsin(yaw)];

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The fastest a cruiser asks of itself, m/s. */
export const UNIT_MAX_SPEED = 38;
/** Steering gain: full lock at this bearing error, radians. */
const FULL_LOCK_RAD = 0.7;

export interface SteerTarget {
  x: number;
  z: number;
  /** Speed the unit should hold, m/s. */
  speed: number;
  /** Stop at the target: the speed falls off with the remaining distance. */
  arrive?: boolean;
}

/** Distance in the ground plane. */
export const dist2 = (ax: number, az: number, bx: number, bz: number): number => dsqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));

/** The input that drives `u` to `t`. Writes into and returns `out`. */
export function driveToward(u: UnitView, t: SteerTarget, out: DriveInput): DriveInput {
  const dx = t.x - u.pos[0], dz = t.z - u.pos[2];
  const [fx, fz] = forwardOf(u.yaw);
  const [rx, rz] = rightOf(u.yaw);
  const lon = dx * fx + dz * fz;
  const lat = dx * rx + dz * rz;
  const angle = datan2(lat, lon);
  const d = dsqrt(dx * dx + dz * dz);
  out.steer = clamp(angle / FULL_LOCK_RAD, -1, 1);
  // speed falls with the sharpness of the turn and, when asked, with the distance still to go
  const sharp = Math.min(1, Math.abs(angle) / 1.2);
  let want = t.speed * (1 - 0.65 * sharp);
  if (t.arrive) want = Math.min(want, Math.max(0, (d - 2) * 0.9));
  const err = want - u.speed;
  out.throttle = clamp(err * 0.4, 0, 1);
  out.brake = clamp(-err * 0.3, 0, 1);
  out.handbrake = t.arrive === true && d < 2.5 && u.speed < 1.5;
  return out;
}

/** A unit that holds still. */
export function hold(out: DriveInput): DriveInput {
  out.throttle = 0;
  out.brake = 1;
  out.steer = 0;
  out.handbrake = true;
  return out;
}

/** The point at (`ahead`, `side`) metres from the player in the player's frame (`side` positive to the right). */
export function inPlayerFrame(p: PlayerView, ahead: number, side: number): Vec3 {
  const [fx, fz] = forwardOf(p.yaw);
  const [rx, rz] = rightOf(p.yaw);
  return [p.pos[0] + fx * ahead + rx * side, p.pos[1], p.pos[2] + fz * ahead + rz * side];
}

/** Follow: stay on the player's tail. The speed matches the player's plus a margin so the unit closes, and eases off inside 8 m. */
export function followSpeed(u: UnitView, p: PlayerView): number {
  const gap = dist2(u.pos[0], u.pos[2], p.pos[0], p.pos[2]);
  const closing = gap > 12 ? 6 : gap > 8 ? 1 : -2;
  return clamp(p.speed + closing + (gap > 80 ? 8 : 0), 0, UNIT_MAX_SPEED);
}
