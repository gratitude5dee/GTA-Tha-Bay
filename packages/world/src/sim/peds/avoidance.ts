/**
 * Local avoidance (living part 4.3; M03b2). Pedestrians within 60 m of the player (at most 48, the first 48 in `StableKey` order)
 * run a pairwise repulsion step every third AI tick (10 Hz). There is no navmesh. The step moves a pedestrian's offset from the graph
 * line (`ox`, `oz`), never its place on the graph, so the walk stays deterministic and the offset decays back when nothing pushes.
 *
 * XR rule: no pedestrian centre comes within 0.6 m of the head. `clearOfHead` is a hard projection applied after every move, not a
 * force; the repulsion step only widens the margin ahead of it.
 * Pure; C02 lint applies.
 */
import { dsqrt } from '@dv/shared';
import type { Ped } from './agent.ts';

export const AVOID_RADIUS_M = 60;
export const AVOID_MAX = 48;
/** One repulsion step every this many AI ticks. */
export const AVOID_EVERY = 3;
/** Two pedestrians closer than this push each other, metres. */
export const PERSONAL_M = 0.9;
/** The head keeps this clear, metres, and the projection puts a ped at `HEAD_CLEAR_M + HEAD_EASE_M`. */
export const HEAD_CLEAR_M = 0.6;
export const HEAD_EASE_M = 0.05;
/** The repulsion step starts to push a ped away from the head this far out, metres. */
export const HEAD_SOFT_M = 1.1;
/** The largest offset from the graph line, metres. */
export const MAX_OFFSET_M = 2.5;
/** Offset decay toward the graph line, m/s. */
export const OFFSET_DECAY = 0.9;

export interface Head {
  x: number;
  z: number;
}

/** The pedestrians the avoidance step visits: within `AVOID_RADIUS_M` of the focus, first `AVOID_MAX` in ascending key order. */
export function avoidSet(list: readonly Ped[], fx: number, fz: number, out: Ped[]): Ped[] {
  out.length = 0;
  const r2 = AVOID_RADIUS_M * AVOID_RADIUS_M;
  for (let i = 0; i < list.length && out.length < AVOID_MAX; i++) {
    const p = list[i] as Ped;
    const dx = p.x - fx, dz = p.z - fz;
    if (dx * dx + dz * dz <= r2) out.push(p);
  }
  return out;
}

const clampOff = (p: Ped): void => {
  const d2 = p.ox * p.ox + p.oz * p.oz;
  if (d2 > MAX_OFFSET_M * MAX_OFFSET_M) {
    const k = MAX_OFFSET_M / dsqrt(d2);
    p.ox *= k;
    p.oz *= k;
  }
};

/**
 * One pairwise step over `set` (already in key order): each pair closer than `PERSONAL_M` is pushed apart along the line between
 * them, half each, and each pedestrian near the head is pushed out of `HEAD_SOFT_M`. Returns the number of pairs pushed.
 */
export function repulse(set: readonly Ped[], head: Head | null): number {
  let pushed = 0;
  for (let i = 0; i < set.length; i++) {
    const a = set[i] as Ped;
    for (let j = i + 1; j < set.length; j++) {
      const b = set[j] as Ped;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= PERSONAL_M * PERSONAL_M) continue;
      const d = dsqrt(d2);
      let nx: number, nz: number;
      if (d < 1e-4) {
        // exactly on top of each other: split along a fixed axis by key order so the result does not depend on float noise
        nx = 1;
        nz = 0;
      } else {
        nx = dx / d;
        nz = dz / d;
      }
      const push = (PERSONAL_M - d) * 0.25;
      a.ox -= nx * push;
      a.oz -= nz * push;
      b.ox += nx * push;
      b.oz += nz * push;
      pushed++;
    }
    if (head) {
      const dx = a.x - head.x, dz = a.z - head.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < HEAD_SOFT_M * HEAD_SOFT_M) {
        const d = dsqrt(d2);
        const nx = d < 1e-4 ? 1 : dx / d;
        const nz = d < 1e-4 ? 0 : dz / d;
        const push = (HEAD_SOFT_M - d) * 0.5;
        a.ox += nx * push;
        a.oz += nz * push;
      }
    }
    clampOff(a);
  }
  return pushed;
}

/** Decays an offset toward the graph line by `OFFSET_DECAY * dt`. */
export function decayOffset(p: Ped, dt: number): void {
  const d2 = p.ox * p.ox + p.oz * p.oz;
  if (d2 === 0) return;
  const d = dsqrt(d2);
  const k = OFFSET_DECAY * dt;
  if (d <= k) {
    p.ox = 0;
    p.oz = 0;
  } else {
    p.ox -= (p.ox / d) * k;
    p.oz -= (p.oz / d) * k;
  }
}

/**
 * Hard rule: puts the pedestrian at `HEAD_CLEAR_M + HEAD_EASE_M` from the head when it is closer than `HEAD_CLEAR_M` (in the ground
 * plane). Works on the offset, so the walk itself continues. Returns true when it moved the ped.
 */
export function clearOfHead(p: Ped, head: Head, gx: number, gz: number): boolean {
  const dx = gx + p.ox - head.x, dz = gz + p.oz - head.z;
  const d2 = dx * dx + dz * dz;
  if (d2 >= HEAD_CLEAR_M * HEAD_CLEAR_M) return false;
  const want = HEAD_CLEAR_M + HEAD_EASE_M;
  let nx: number, nz: number;
  if (d2 < 1e-8) {
    nx = 1;
    nz = 0;
  } else {
    const d = dsqrt(d2);
    nx = dx / d;
    nz = dz / d;
  }
  p.ox = head.x + nx * want - gx;
  p.oz = head.z + nz * want - gz;
  return true;
}
