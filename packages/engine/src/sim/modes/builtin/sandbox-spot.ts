/**
 * The short-range spot search of the sandbox's car spawner (M04e3). `findCallSpot` (garage) looks 120 to 400 m away and outside the
 * camera view; a car the player asks for in the sandbox has to appear close by and in front. This search scans a fixed pattern of
 * distances and bearings from the camera's heading, takes the nearest lane centre to each target point, and returns the first one
 * that is 5 to 13 m away, inside the view cone, on the ground and free. No randomness and no wall time (C02 lint scope).
 */
import { dcos, dsin, dsqrt, type PhysicsQueries, type RoadGraphQuery } from '@dv/shared';
import { inView } from '../../garage/garage.ts';

/** Distances tried, nearest-preferred order (design values; metres). */
export const NEAR_DISTANCES_M: readonly number[] = [8, 10, 6, 12];
/** Bearings tried at each distance, in degrees from the camera's forward direction. */
export const NEAR_BEARINGS_DEG: readonly number[] = [0, 15, -15, 30, -30];
/** A candidate lane point must be this far from the player at least, and at most the second value (metres). */
export const NEAR_MIN_M = 5;
export const NEAR_MAX_M = 13;
/** How far from a target point the road search looks, and how far the ground may sit from the lane's height (metres). */
export const NEAR_EDGE_RADIUS_M = 6;
export const NEAR_GROUND_TOLERANCE_M = 1.5;

const DEG = Math.PI / 180;

export interface NearSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface NearOrigin {
  x: number;
  y: number;
  z: number;
  camYaw: number;
}

/** The first free lane point 5 to 13 m from `p`, in front of the camera; null when the pattern finds none. */
export function findNearSpot(
  graph: Pick<RoadGraphQuery, 'nearestEdge' | 'laneCentre'>,
  physics: Pick<PhysicsQueries, 'groundY'>,
  p: NearOrigin,
  blocked: (x: number, z: number) => boolean,
): NearSpot | null {
  const out = new Float64Array(4);
  for (const r of NEAR_DISTANCES_M) {
    for (const deg of NEAR_BEARINGS_DEG) {
      const a = p.camYaw + deg * DEG;
      const tx = p.x - dsin(a) * r;
      const tz = p.z - dcos(a) * r;
      const hit = graph.nearestEdge(tx, tz, p.y, NEAR_EDGE_RADIUS_M);
      if (!hit) continue;
      graph.laneCentre({ edge: hit.edge, s: hit.s, lane: 0 }, out);
      const x = out[0] as number;
      const laneY = out[1] as number;
      const z = out[2] as number;
      const dx = x - p.x;
      const dz = z - p.z;
      const d = dsqrt(dx * dx + dz * dz);
      if (d < NEAR_MIN_M || d > NEAR_MAX_M) continue;
      if (!inView(dx, dz, p.camYaw)) continue;
      const g = physics.groundY(x, z);
      if (g === null || g - laneY > NEAR_GROUND_TOLERANCE_M || laneY - g > NEAR_GROUND_TOLERANCE_M) continue;
      if (blocked(x, z)) continue;
      return { x, y: g, z, yaw: out[3] as number };
    }
  }
  return null;
}
