/**
 * The helicopter (M03c): it flies a circle over the player (or over the last known position while the player is unseen) at
 * `HELI_ALTITUDE_M` above the ground, and its spotlight sees the player when a ray from the helicopter to the player meets no
 * static collider (line of sight from altitude, range `HELI_SIGHT_M`).
 *
 * Sim code under the C02 lint.
 */
import { datan2, dcos, dsin, dsqrt } from '@dv/shared';
import type { PursuitHost, PlayerView, Vec3 } from '../ports.ts';

export const HELI_ALTITUDE_M = 55;
export const HELI_ORBIT_M = 38;
export const HELI_SIGHT_M = 320;
export const HELI_MAX_SPEED = 42;
/** Orbit rate, radians per second. */
const ORBIT_RATE = 0.4;

export interface HeliPose {
  pos: Vec3;
  yaw: number;
}

/** The orbit point for tick `tick` around `centre`. */
export function heliOrbit(tick: number, centre: Vec3, groundY: number): Vec3 {
  const a = (tick / 60) * ORBIT_RATE;
  return [centre[0] + dcos(a) * HELI_ORBIT_M, groundY + HELI_ALTITUDE_M, centre[2] + dsin(a) * HELI_ORBIT_M];
}

/** One step of `dtTicks` toward `target`; the helicopter faces its travel direction, or the centre when it hovers. */
export function heliStep(cur: HeliPose, target: Vec3, centre: Vec3, dtTicks: number): HeliPose {
  const dt = dtTicks / 60;
  const dx = target[0] - cur.pos[0], dy = target[1] - cur.pos[1], dz = target[2] - cur.pos[2];
  const d = dsqrt(dx * dx + dy * dy + dz * dz);
  const maxStep = HELI_MAX_SPEED * dt;
  const k = d <= maxStep || d === 0 ? 1 : maxStep / d;
  const pos: Vec3 = [cur.pos[0] + dx * k, cur.pos[1] + dy * k, cur.pos[2] + dz * k];
  const fx = d > 3 ? dx : centre[0] - pos[0];
  const fz = d > 3 ? dz : centre[2] - pos[2];
  // yaw 0 faces -Z, -pi/2 faces +X: yaw = atan2(-fx, -fz)
  const yaw = fx === 0 && fz === 0 ? cur.yaw : datan2(-fx, -fz);
  return { pos, yaw };
}

/** The spotlight sees the player: within range and a clear ray. */
export function heliSees(host: Pick<PursuitHost, 'los'>, heli: Vec3, player: PlayerView): boolean {
  const dx = player.pos[0] - heli[0], dz = player.pos[2] - heli[2];
  if (dsqrt(dx * dx + dz * dz) > HELI_SIGHT_M) return false;
  return host.los(heli, [player.pos[0], player.pos[1] + 1.2, player.pos[2]]);
}
