/**
 * Promotion of near agents (02-world-living.md section 2.3; M03b1). A near agent is a kinematic body. When a vehicle hits it at a
 * speed difference of 3 m/s or more, or the player enters it, it becomes a dynamic vehicle (its prefab with the `civilian`
 * handling preset) for at most 8 s and then a stationary wreck, which is removed after 10 s without being seen. At most 8 agents are
 * promoted at once on desktop, 4 on mobile and 3 on mobile-low and Quest.
 *
 * This file holds the pure parts: the hit test between oriented boxes, the velocity the hit gives the agent and the book of
 * promotions in force. The ECS layer (`system.ts`) swaps the body for a dynamic one.
 *
 * Pure; C02 lint applies.
 */
import { dsqrt } from '@dv/shared';
import type { Agent } from './agent.ts';

/** Speed difference at which a contact promotes an agent, m/s. */
export const PROMOTE_DV_MPS = 3;
/** A promoted vehicle stays dynamic this many ticks (8 s). */
export const PROMOTED_TICKS = 480;
/** A wreck nobody sees is removed after this many ticks (10 s). */
export const WRECK_UNSEEN_TICKS = 600;
/** Contact margin added to both boxes, metres. */
const MARGIN_M = 0.15;

/** A moving vehicle (or the player on foot) that can hit an agent: the player's car, another promoted car. */
export interface Mover {
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Unit heading. */
  hx: number;
  hz: number;
  halfW: number;
  halfL: number;
  massKg: number;
}

/**
 * Separating-axis test of two boxes on the ground plane: centre, unit heading and half extents of each (the heading axis is the
 * length axis). `margin` grows both boxes.
 */
export function boxesOverlap(
  ax: number, az: number, ahx: number, ahz: number, aHalfW: number, aHalfL: number,
  bx: number, bz: number, bhx: number, bhz: number, bHalfW: number, bHalfL: number,
  margin: number = MARGIN_M,
): boolean {
  const dx = bx - ax, dz = bz - az;
  // axes: a's heading and right, b's heading and right
  const axes: [number, number][] = [[ahx, ahz], [-ahz, ahx], [bhx, bhz], [-bhz, bhx]];
  for (let i = 0; i < 4; i++) {
    const [ux, uz] = axes[i] as [number, number];
    const dist = dx * ux + dz * uz;
    const ra = aHalfL * abs(ahx * ux + ahz * uz) + aHalfW * abs(-ahz * ux + ahx * uz);
    const rb = bHalfL * abs(bhx * ux + bhz * uz) + bHalfW * abs(-bhz * ux + bhx * uz);
    if (abs(dist) > ra + rb + 2 * margin) return false;
  }
  return true;
}

const abs = (v: number): number => (v < 0 ? -v : v);

export interface Hit {
  mover: Mover;
  /** Speed difference between the two, m/s. */
  dv: number;
}

/** The first mover (in the order given) that overlaps the agent at a speed difference of `PROMOTE_DV_MPS` or more, else null. */
export function findHit(a: Agent, halfW: number, halfL: number, movers: readonly Mover[]): Hit | null {
  const vx = a.fx * a.speed, vz = a.fz * a.speed;
  for (const m of movers) {
    const rx = m.x - a.x, rz = m.z - a.z;
    const reach = halfL + m.halfL + 1;
    if (rx * rx + rz * rz > reach * reach) continue;
    if (!boxesOverlap(a.x, a.z, a.fx, a.fz, halfW, halfL, m.x, m.z, m.hx, m.hz, m.halfW, m.halfL)) continue;
    const dx = m.vx - vx, dz = m.vz - vz;
    const dv = dsqrt(dx * dx + dz * dz);
    if (dv >= PROMOTE_DV_MPS) return { mover: m, dv };
  }
  return null;
}

/**
 * The velocity an agent leaves a hit with: a partly elastic exchange of momentum with the mover (restitution 0.3), floored at the
 * agent's own velocity direction not reversing past the mover's. Returns [vx, vz].
 */
export function velocityAfterHit(a: Agent, massKg: number, m: Mover): [number, number] {
  const e = 0.3;
  const va = [a.fx * a.speed, a.fz * a.speed];
  const total = massKg + m.massKg;
  const vx = (massKg * (va[0] as number) + m.massKg * m.vx + m.massKg * e * (m.vx - (va[0] as number))) / total;
  const vz = (massKg * (va[1] as number) + m.massKg * m.vz + m.massKg * e * (m.vz - (va[1] as number))) / total;
  return [vx, vz];
}

export interface Promotion {
  key: string;
  tick: number;
}

/** The promotions in force: capped, expiring after 8 s. */
export class PromotionBook {
  private list: Promotion[] = [];

  constructor(public cap: number) {}

  get count(): number {
    return this.list.length;
  }

  has(key: string): boolean {
    return this.list.some((p) => p.key === key);
  }

  canPromote(): boolean {
    return this.list.length < this.cap;
  }

  add(key: string, tick: number): boolean {
    if (!this.canPromote() || this.has(key)) return false;
    this.list.push({ key, tick });
    return true;
  }

  /** Removes the promotion of `key` before it runs out (its car is gone: DL-736); false when there is none. */
  remove(key: string): boolean {
    const i = this.list.findIndex((p) => p.key === key);
    if (i < 0) return false;
    this.list.splice(i, 1);
    return true;
  }

  /** Removes and returns the promotions that ran out at `tick` (oldest first). */
  expire(tick: number): Promotion[] {
    const out: Promotion[] = [];
    const keep: Promotion[] = [];
    for (const p of this.list) (tick - p.tick >= PROMOTED_TICKS ? out : keep).push(p);
    this.list = keep;
    return out;
  }

  entries(): readonly Promotion[] {
    return this.list;
  }

  load(list: readonly Promotion[]): void {
    this.list = [...list];
  }
}
