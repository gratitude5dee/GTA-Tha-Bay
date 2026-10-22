/**
 * Shot validation of the in-engine director (M05a2; 03-story-cutscenes.md D6.3). Three checks, all through `DirWorld.castRay` and
 * all inside one budget of 8 rays per tick:
 *
 *  1. SF hills. A second ray goes 10 m forward of the subject and straight down; on a grade above 15 % the `rearlow` and `front`
 *     shots are replaced by `side`, so the camera never clips into the hill.
 *  2. Clearance. A ray along the subject's up vector must find 12 m free for `flyby`, `side` and `heli`, and 29 m for `heli`;
 *     otherwise the shot is demoted to `chase` (`rearlow` for a `heli` with 12 m) in a vehicle, or `shoulder` on foot.
 *  3. Occlusion. A ray from the camera to the subject's head. A blocked shot tries 6 alternates in order (mirror, pull-in high,
 *     top-down, front-left, front-right, overhead); `OcclusionTracker` counts the blocked ticks and says when the shot is cut (48).
 *
 * Sim code under the C02 lint.
 */
import { dcos, dsin, dsqrt, type ShotKind } from '@dv/shared';
import { distance, headOf, rotateXZ, type Pose } from './presets.ts';
import { MAX_RAYS_PER_TICK, OCCLUSION_CUT_TICKS, type DirWorld, type Vec3 } from './types.ts';

export const GRADE_LIMIT = 0.15;
export const GRADE_PROBE_M = 10;
export const CLEARANCE_M = { default: 12, heli: 29 } as const;

export const ALTERNATES = ['mirror', 'pull-in-high', 'top-down', 'front-left', 'front-right', 'overhead'] as const;
export type Alternate = (typeof ALTERNATES)[number];

/** The rays of one tick. A check that finds the budget spent gets `null` and treats the way as clear for this tick. */
export class RayBudget {
  used = 0;
  /** Every ray of the current tick, for the tests. */
  readonly log: { from: Vec3; maxM: number }[] = [];
  private tick = -1;

  constructor(private readonly world: DirWorld) {}

  begin(tick: number): void {
    if (tick !== this.tick) {
      this.tick = tick;
      this.used = 0;
      this.log.length = 0;
    }
  }

  get left(): number {
    return MAX_RAYS_PER_TICK - this.used;
  }

  /** Casts one ray; `undefined` when the tick's budget is spent. */
  cast(from: Vec3, dir: Vec3, maxM: number): number | null | undefined {
    if (this.used >= MAX_RAYS_PER_TICK) return undefined;
    this.used++;
    this.log.push({ from, maxM });
    return this.world.castRay(from, dir, maxM);
  }
}

/** Grade (rise over run, absolute) from the subject to 10 m ahead of it; `null` when there is no ground or no budget. */
export function gradeAhead(b: RayBudget, p: Vec3, fwdX: number, fwdZ: number): number | null {
  const o: Vec3 = [p[0] + fwdX * GRADE_PROBE_M, p[1] + 10, p[2] + fwdZ * GRADE_PROBE_M];
  const toi = b.cast(o, [0, -1, 0], 40);
  if (toi === undefined || toi === null) return null;
  const rise = o[1] - toi - p[1];
  return (rise < 0 ? -rise : rise) / GRADE_PROBE_M;
}

export interface KindDecision {
  kind: ShotKind;
  /** What changed, for the log: `hill` or `clearance <m>`; empty when the kind stands. */
  why: string;
}

/** Applies the hill rule and the clearance rule to a wanted kind. */
export function adjustKind(b: RayBudget, world: DirWorld, who: string, kind: ShotKind, inVehicle: boolean): KindDecision {
  const p = world.pos(who);
  if (!p) return { kind, why: '' };
  const yaw = world.yaw(who);
  let k = kind;
  let why = '';
  if (k === 'rearlow' || k === 'front') {
    const g = gradeAhead(b, p, -dsin(yaw), -dcos(yaw));
    if (g !== null && g > GRADE_LIMIT) {
      k = 'side';
      why = `hill ${(g * 100).toFixed(0)}%`;
    }
  }
  if (k === 'flyby' || k === 'side' || k === 'heli') {
    const need = k === 'heli' ? CLEARANCE_M.heli : CLEARANCE_M.default;
    const up = world.up(who);
    const free = b.cast(headOf(p), up, need);
    // free === undefined: no budget left, the way is taken as clear; null: nothing within `need`
    if (free !== undefined && free !== null) {
      const room = free;
      if (k === 'heli' && room >= CLEARANCE_M.default) k = 'rearlow';
      else k = inVehicle ? 'chase' : 'shoulder';
      why = `clearance ${room.toFixed(1)} m`;
    }
  }
  return { kind: k, why };
}

/** The camera pose of an alternate, relative to the blocked pose and the subject. */
export function alternatePose(alt: Alternate, pose: Pose, p: Vec3, yaw: number): Pose {
  const look = headOf(p);
  const dx = pose.pos[0] - p[0];
  const dz = pose.pos[2] - p[2];
  const h = dsqrt(dx * dx + dz * dz) || 1;
  const dy = pose.pos[1] - p[1];
  switch (alt) {
    case 'mirror': {
      // the lateral part of the offset flips: mirror across the subject's forward axis
      const fx = -dsin(yaw);
      const fz = -dcos(yaw);
      const along = dx * fx + dz * fz;
      const ax = fx * along;
      const az = fz * along;
      return { pos: [p[0] + ax - (dx - ax), pose.pos[1], p[2] + az - (dz - az)], lookAt: look };
    }
    case 'pull-in-high':
      return { pos: [p[0] + dx * 0.6, p[1] + dy + 2.5, p[2] + dz * 0.6], lookAt: look };
    case 'top-down':
      return { pos: [p[0] + (dx / h) * 1, p[1] + 16, p[2] + (dz / h) * 1], lookAt: look };
    case 'front-left': {
      const [x, z] = rotateXZ(-dsin(yaw) * h, -dcos(yaw) * h, 0.7854);
      return { pos: [p[0] + x, pose.pos[1], p[2] + z], lookAt: look };
    }
    case 'front-right': {
      const [x, z] = rotateXZ(-dsin(yaw) * h, -dcos(yaw) * h, -0.7854);
      return { pos: [p[0] + x, pose.pos[1], p[2] + z], lookAt: look };
    }
    case 'overhead':
      return { pos: [p[0] + (dx / h) * 4, p[1] + 28, p[2] + (dz / h) * 4], lookAt: look };
  }
}

/** True when a ray from the camera to the subject's head hits something short of it. `undefined`: the budget is spent. */
export function occluded(b: RayBudget, pose: Pose): boolean | undefined {
  const dx = pose.lookAt[0] - pose.pos[0];
  const dy = pose.lookAt[1] - pose.pos[1];
  const dz = pose.lookAt[2] - pose.pos[2];
  const len = dsqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return false;
  const hit = b.cast(pose.pos, [dx / len, dy / len, dz / len], len);
  if (hit === undefined) return undefined;
  return hit !== null && hit < len - 0.3;
}

/** Counts consecutive blocked ticks; `cut` is true on the 48th. */
export class OcclusionTracker {
  blocked = 0;

  step(isBlocked: boolean): { blocked: number; cut: boolean } {
    this.blocked = isBlocked ? this.blocked + 1 : 0;
    return { blocked: this.blocked, cut: this.blocked >= OCCLUSION_CUT_TICKS };
  }

  reset(): void {
    this.blocked = 0;
  }
}

export { distance };
