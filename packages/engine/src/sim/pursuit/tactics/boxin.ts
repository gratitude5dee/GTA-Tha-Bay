/**
 * Box-in, rolling block and SUV ram (M03c): positions in the player's frame and the speed rule that goes with them.
 *
 *  - `boxIn`: three units take the front, left and right slots. Once they hold them, the shared target speed falls from the player's
 *    speed to a stop over about 6 s, which brings the player down with them.
 *  - `rollingBlock`: one unit takes the slot 14 m ahead in the player's lane and slows gently.
 *  - `suvRam`: an SUV aims at the point where the player will be in 0.6 s, at the player's speed plus 6 m/s.
 *
 * Sim code under the C02 lint.
 */
import type { PlayerView, UnitView } from '../ports.ts';
import { clamp, dist2, inPlayerFrame, UNIT_MAX_SPEED, type SteerTarget } from './follow.ts';

export const BOX_SLOTS: readonly { ahead: number; side: number }[] = [
  { ahead: 9, side: 0 },
  { ahead: 0.5, side: -3.4 },
  { ahead: 0.5, side: 3.4 },
];

/**
 * The target of box-in slot `slot` (0 front, 1 left, 2 right). `holdTicks` is how long the box has held; the target speed ramps down
 * over 360 ticks once it has formed.
 */
export function boxInTarget(u: UnitView, p: PlayerView, slot: number, holdTicks: number): SteerTarget {
  const s = BOX_SLOTS[slot % BOX_SLOTS.length] as { ahead: number; side: number };
  const [x, , z] = inPlayerFrame(p, s.ahead, s.side);
  const gap = dist2(u.pos[0], u.pos[2], x, z);
  const formed = gap < 5;
  const ramp = formed ? clamp(1 - holdTicks / 360, 0, 1) : 1;
  const speed = clamp(p.speed * ramp + (formed ? 0 : 6 + gap * 0.25), 0, UNIT_MAX_SPEED);
  return { x, z, speed };
}

/** The unit has reached its box slot. */
export function boxHeld(u: UnitView, p: PlayerView, slot: number): boolean {
  const s = BOX_SLOTS[slot % BOX_SLOTS.length] as { ahead: number; side: number };
  const [x, , z] = inPlayerFrame(p, s.ahead, s.side);
  return dist2(u.pos[0], u.pos[2], x, z) < 5;
}

export function rollingBlockTarget(u: UnitView, p: PlayerView): SteerTarget {
  const [x, , z] = inPlayerFrame(p, 14, 0);
  const gap = dist2(u.pos[0], u.pos[2], x, z);
  const speed = clamp(p.speed - (gap < 6 ? 3 : -4 - gap * 0.2), 0, UNIT_MAX_SPEED);
  return { x, z, speed };
}

export function suvRamTarget(_u: UnitView, p: PlayerView): SteerTarget {
  return { x: p.pos[0] + p.vel[0] * 0.6, z: p.pos[2] + p.vel[2] * 0.6, speed: clamp(p.speed + 6, 8, UNIT_MAX_SPEED) };
}
