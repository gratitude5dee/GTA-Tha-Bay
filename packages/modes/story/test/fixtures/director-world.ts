/** A fake `DirWorld` for the director tests: one subject, rays answered by a function, and a count of the rays of each tick. */
import type { DirWorld, Vec3 } from '../../src/director/types.ts';

export interface FakeWorldOptions {
  subject?: Vec3;
  yaw?: number;
  vehicle?: boolean;
  pursuer?: boolean;
  up?: Vec3;
  /** Distance to the first hit along `dir` from `from`, or null when the way is clear. */
  ray?: (from: Vec3, dir: Vec3, maxM: number) => number | null;
  /** Other subjects by name. */
  others?: Record<string, Vec3>;
}

export interface FakeWorld extends DirWorld {
  /** Every ray cast so far. */
  rays: { from: Vec3; dir: Vec3; maxM: number }[];
  /** Subject position, settable. */
  at: Vec3;
}

export function fakeWorld(o: FakeWorldOptions = {}): FakeWorld {
  const w: FakeWorld = {
    rays: [],
    at: o.subject ?? [0, 0, 0],
    pos: (who) => (who === 'player' ? w.at : (o.others?.[who] ?? null)),
    yaw: () => o.yaw ?? 0,
    up: () => o.up ?? [0, 1, 0],
    handle: (who) => (who === 'player' ? 1 : who === 'buddy' ? 2 : 0),
    inVehicle: () => o.vehicle === true,
    hasPursuer: () => o.pursuer === true,
    castRay: (from, dir, maxM) => {
      w.rays.push({ from, dir, maxM });
      return o.ray ? o.ray(from, dir, maxM) : null;
    },
  };
  return w;
}
