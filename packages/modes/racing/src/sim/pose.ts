/**
 * Small pose helpers shared by the session, the rivals and the ghosts (M07a2). Sim code under the C02 lint.
 */
import { datan2, routePoint, type RaceDef } from '@dv/shared';

/** Engine yaw (0 faces -Z, positive turns left) of a travel direction in x, z. */
export function yawOf(tx: number, tz: number): number {
  // forward is (-sin yaw, -cos yaw) in x, z for the engine's quaternion convention (`fx = -2 (qx qz + qw qy)`)
  return datan2(-tx, -tz);
}

export interface Pose { x: number; y: number; z: number; yaw: number }

/**
 * The pose at route metres `s` with `lateralM` to the left of the travel direction (the same sign as the grid lanes). `s` below 0
 * extends the first tangent backwards, so a grid behind the start line has a place to stand.
 */
export function routePose(def: Pick<RaceDef, 'line' | 'elevation' | 'routeLenM'>, s: number, lateralM: number): Pose {
  const p = routePoint(def, s < 0 ? 0 : s);
  const back = s < 0 ? s : 0;
  return {
    x: p.x + p.tx * back + -p.tz * lateralM,
    y: p.y,
    z: p.z + p.tz * back + p.tx * lateralM,
    yaw: yawOf(p.tx, p.tz),
  };
}
