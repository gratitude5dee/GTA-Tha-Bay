/**
 * Crossings (living part 1.5 and 4.4; M03b2). A pedestrian enters a signalled crosswalk only while the parallel vehicle movement
 * shows green and more than 5 s of the green remain. At a dark or unsignalled crossing it yields to traffic: it steps out only when
 * no moving vehicle is within `YIELD_M` of the crosswalk.
 * Pure; C02 lint applies.
 */
import { dsqrt, type Junction } from '@dv/shared';

/** Ticks of the parallel green that must remain when a ped steps onto a crosswalk (5 s). */
export const CROSS_MARGIN_TICKS = 300;
/** A moving vehicle this close to a crosswalk without a signal stops a pedestrian stepping out, metres. */
export const YIELD_M = 16;
/** Speed below which a vehicle is not moving for the yield rule, m/s. */
export const YIELD_SPEED = 0.5;

export type Gate =
  /** Signalled: `go` when green with more than the margin left; `left` is the ticks of green remaining (0 when not green). */
  | { mode: 'signal'; go: boolean; left: number }
  /** No program, or dark: traffic decides. */
  | { mode: 'yield' };

/**
 * The state of the crossing of `movement` at junction `j` at `tick`. `j` is undefined for a mid-block crossing or a junction that
 * is not resident.
 */
export function crossingGate(j: Junction | undefined, movement: number, tick: number, blackout: boolean): Gate {
  if (!j || !j.program || blackout || movement < 0) return { mode: 'yield' };
  const p = j.program;
  const t = (tick + p.offsetTicks) % p.cycleTicks;
  for (const ph of p.phases) {
    if (ph.movements.indexOf(movement) < 0) continue;
    const u = t - ph.startTick;
    if (u >= 0 && u < ph.greenTicks) {
      const left = ph.greenTicks - u;
      return { mode: 'signal', go: left > CROSS_MARGIN_TICKS, left };
    }
    return { mode: 'signal', go: false, left: 0 };
  }
  return { mode: 'signal', go: false, left: 0 };
}

export interface Moving {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** Whether a moving vehicle is within `YIELD_M` of the crosswalk segment (ax, az) to (bx, bz). */
export function trafficOnCrosswalk(ax: number, az: number, bx: number, bz: number, vehicles: readonly Moving[]): boolean {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i] as Moving;
    if (v.vx * v.vx + v.vz * v.vz < YIELD_SPEED * YIELD_SPEED) continue;
    let u = l2 > 0 ? ((v.x - ax) * dx + (v.z - az) * dz) / l2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const px = ax + dx * u - v.x, pz = az + dz * u - v.z;
    if (dsqrt(px * px + pz * pz) <= YIELD_M) return true;
  }
  return false;
}
