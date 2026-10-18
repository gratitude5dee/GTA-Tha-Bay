import type { Vec3 } from './backend.ts';

/** Distance from the physics origin beyond which the followed entity triggers a rebase (spec 01-engine.md section 2.4). */
export const DEFAULT_REBASE_DISTANCE_M = 1000;

/**
 * True when the horizontal distance between `pos` (ENU) and `origin` exceeds `limitM`. Only X and Z count: the world
 * is a few hundred metres tall at most, and comparing squares avoids a square root in sim code.
 */
export function needsRebase(pos: Readonly<Vec3>, origin: Readonly<Vec3>, limitM: number = DEFAULT_REBASE_DISTANCE_M): boolean {
  const dx = pos[0] - origin[0];
  const dz = pos[2] - origin[2];
  return dx * dx + dz * dz > limitM * limitM;
}

/**
 * The origin to rebase to for a followed position: whole metres horizontally (so f32 offsets stay exact for nearby
 * integers), the old height kept. Deterministic: a pure function of the sim state.
 */
export function snapOrigin(pos: Readonly<Vec3>, current: Readonly<Vec3>): Vec3 {
  return [Math.round(pos[0]), current[1], Math.round(pos[2])];
}
