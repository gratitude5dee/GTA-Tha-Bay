import type { PhysicsQueries, RoadGraphQuery } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { inView } from '../src/sim/garage/garage.ts';
import { findNearSpot, NEAR_MAX_M, NEAR_MIN_M } from '../src/sim/modes/builtin/sandbox-spot.ts';

type Graph = Pick<RoadGraphQuery, 'nearestEdge' | 'laneCentre'>;

/** One straight road along the Z axis at x = 0: `nearestEdge` snaps a point to the axis when it is within `maxM`; the lane heading is 0.25. */
function straightRoad(laneY = 2): Graph {
  const pts: [number, number][] = [];
  return {
    nearestEdge: (x, z, _y, maxM) => {
      if (Math.abs(x) > maxM) return null;
      pts.push([0, z]);
      return { edge: pts.length - 1, s: 0, distM: Math.abs(x) };
    },
    laneCentre: (e, out) => {
      const p = pts[e.edge] as [number, number];
      out[0] = p[0];
      out[1] = laneY;
      out[2] = p[1];
      out[3] = 0.25;
    },
  };
}

const flat = (y: number | null): Pick<PhysicsQueries, 'groundY'> => ({ groundY: () => y });
// The player stands on the road axis; camYaw 0 looks along -Z.
const ORIGIN = { x: 0, y: 2, z: 0, camYaw: 0 };

describe('findNearSpot (M04e3 AC-3)', () => {
  it('finds a lane point 5 to 13 m away, inside the view, with the lane yaw, when the camera faces the road', () => {
    const spot = findNearSpot(straightRoad(), flat(2), ORIGIN, () => false);
    expect(spot).not.toBeNull();
    if (!spot) return;
    const dx = spot.x - ORIGIN.x;
    const dz = spot.z - ORIGIN.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    expect(d).toBeGreaterThanOrEqual(NEAR_MIN_M);
    expect(d).toBeLessThanOrEqual(NEAR_MAX_M);
    expect(inView(dx, dz, ORIGIN.camYaw)).toBe(true);
    expect(spot.yaw).toBe(0.25);
    expect(spot.y).toBe(2);
    // the first pattern entry wins: 8 m straight ahead
    expect(spot.z).toBeCloseTo(-8, 6);
  });

  it('returns null when the camera faces away from the road', () => {
    // the only road is a stub 9 m behind the camera
    const behind: Graph = {
      nearestEdge: (_x, z) => (z > 3 ? { edge: 0, s: 0, distM: 0 } : null),
      laneCentre: (_e, out) => {
        out[0] = 0;
        out[1] = 2;
        out[2] = 9;
        out[3] = 0;
      },
    };
    expect(findNearSpot(behind, flat(2), ORIGIN, () => false)).toBeNull();
  });

  it('returns null when every point is blocked', () => {
    expect(findNearSpot(straightRoad(), flat(2), ORIGIN, () => true)).toBeNull();
  });

  it('returns null when the ground is missing or too far from the lane', () => {
    expect(findNearSpot(straightRoad(), flat(null), ORIGIN, () => false)).toBeNull();
    expect(findNearSpot(straightRoad(2), flat(3.6), ORIGIN, () => false)).toBeNull();
    expect(findNearSpot(straightRoad(2), flat(0.4), ORIGIN, () => false)).toBeNull();
    expect(findNearSpot(straightRoad(2), flat(3.4), ORIGIN, () => false)).not.toBeNull();
  });

  it('tries the next point when the first is blocked, and gives the same answer twice', () => {
    const blockNear = (_x: number, z: number): boolean => z > -8.5 && z < -6.5;
    const a = findNearSpot(straightRoad(), flat(2), ORIGIN, blockNear);
    const b = findNearSpot(straightRoad(), flat(2), ORIGIN, blockNear);
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    expect(a?.z).toBeCloseTo(-10, 6);
  });

  it('skips a lane point nearer than 5 m', () => {
    const near: Graph = {
      nearestEdge: () => ({ edge: 0, s: 0, distM: 0 }),
      laneCentre: (_e, out) => {
        out[0] = 0;
        out[1] = 2;
        out[2] = -3;
        out[3] = 0;
      },
    };
    expect(findNearSpot(near, flat(2), ORIGIN, () => false)).toBeNull();
  });
});
