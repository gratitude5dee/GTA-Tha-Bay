/**
 * Reactions of ambient agents to what is not traffic (02-world-living.md section 2.4; M03b1):
 *
 *  - an entity (the player's vehicle, a promoted wreck, the player on foot, a dummy in a test) that intrudes into the agent's lane
 *    within 30 m is a leader;
 *  - braking hard for it makes the agent honk (an audio cue);
 *  - a police vehicle with its siren on within 40 m behind makes the agent pull right and stop until it has passed (pursuit units are
 *    not offered by the caller).
 *
 * Pure; C02 lint applies.
 */
import { dsqrt } from '@dv/shared';
import type { Agent } from './agent.ts';

/** Metres ahead within which an intruder becomes a leader. */
export const INTRUDER_RANGE_M = 30;
/** Braking harder than this (m/s^2) for an intruder is a honk. */
export const HONK_DECEL = 4;
/** Ticks between two honks of one agent. */
export const HONK_COOLDOWN_TICKS = 180;
/** A siren pulls agents over within this distance behind, metres. */
export const SIREN_RANGE_M = 40;

export type ObstacleKind = 'vehicle' | 'ped' | 'prop' | 'player';

/** Something in the world that agents must not drive through: a position, a velocity and a box. */
export interface Obstacle {
  id: string;
  kind: ObstacleKind;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Half width and half length of the box, metres (a pedestrian: both its radius). */
  halfW: number;
  halfL: number;
}

export interface Siren {
  x: number;
  z: number;
  /** Unit heading. */
  hx: number;
  hz: number;
}

export interface Intruder {
  /** Bumper to bumper, metres. */
  gap: number;
  /** Speed of the obstacle along the agent's heading, floored at 0, m/s. */
  vLead: number;
  /** Relative approach speed (positive when closing), m/s. */
  closing: number;
  obstacle: Obstacle;
}

/**
 * The nearest obstacle in front of the agent that overlaps its path: ahead of it within `range` metres (bumper to bumper) and
 * within `halfPath` metres of its centreline sideways. `halfPath` is the agent's half width plus a margin; a robotaxi widens it to
 * the pedestrian rule (3 m from the lane). Null when none.
 */
export function nearestIntruder(a: Agent, halfLen: number, halfWidth: number, list: readonly Obstacle[], range: number, margin: number, out: Intruder): boolean {
  let best = Infinity;
  let found = false;
  const fx = a.fx, fz = a.fz;
  // right of travel is (-fz, fx)
  for (let i = 0; i < list.length; i++) {
    const o = list[i] as Obstacle;
    const rx = o.x - a.x, rz = o.z - a.z;
    const ahead = rx * fx + rz * fz;
    if (ahead <= 0) continue;
    const side = rx * -fz + rz * fx;
    const lateral = side < 0 ? -side : side;
    // the obstacle's own half extent across the path
    const oAcross = o.halfW > o.halfL ? o.halfW : o.halfL;
    if (lateral > halfWidth + oAcross * 0.7 + margin) continue;
    const gap = ahead - halfLen - o.halfL;
    if (gap > range || gap < -2 * halfLen) continue;
    if (gap < best) {
      best = gap;
      found = true;
      const vAlong = o.vx * fx + o.vz * fz;
      out.gap = gap < 0 ? 0 : gap;
      out.vLead = vAlong > 0 ? vAlong : 0;
      out.closing = a.speed - vAlong;
      out.obstacle = o;
    }
  }
  return found;
}

/** The closest siren within range that is behind the agent and heads the same way, or null. */
export function sirenBehind(a: Agent, sirens: readonly Siren[]): Siren | null {
  for (const s of sirens) {
    const rx = s.x - a.x, rz = s.z - a.z;
    const d2 = rx * rx + rz * rz;
    if (d2 > SIREN_RANGE_M * SIREN_RANGE_M) continue;
    const behind = rx * a.fx + rz * a.fz < 0;
    const same = s.hx * a.fx + s.hz * a.fz > 0.3;
    if (behind && same) return s;
  }
  return null;
}

/** Whether any siren is within range on any side (a pulled-over agent waits until none is). */
export function sirenNear(a: Agent, sirens: readonly Siren[]): boolean {
  for (const s of sirens) {
    const rx = s.x - a.x, rz = s.z - a.z;
    if (rx * rx + rz * rz <= SIREN_RANGE_M * SIREN_RANGE_M) return true;
  }
  return false;
}

/** Euclidean distance on the ground plane. */
export function dist2d(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  return dsqrt(dx * dx + dz * dz);
}
