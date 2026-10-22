/**
 * Shot presets of a DirectorScript compiled to C04 `ShotKind`s (03-story-cutscenes.md D6.1), and the camera pose each kind has
 * relative to its subject. The pose model is the director's own view of where the rig puts the camera, used to cast the occlusion
 * ray before the shot starts; the rig (main thread) places the real camera from the kind.
 *
 * | Preset | Compiles to |
 * |---|---|
 * | establish | `fixed` or `spline` from the `from` mark, push-in 3 % per second |
 * | two-shot | `fixed`, midpoint of both subjects, 3.5 m perpendicular, lens normal |
 * | over-shoulder | `shoulder` |
 * | single, insert, reaction | `fixed` at 2.2 m, 0.8 m, 1.6 m |
 * | tracking | `chase` |
 * | orbit | `heli` |
 * | auto | the auto-director |
 *
 * Sim code under the C02 lint.
 */
import { dcos, dsin, dsqrt, type CinematicShot, type ShotKind } from '@dv/shared';
import type { DirectorShot } from '@dv/shared/contracts/c09-cutscene';
import { TICKS_PER_SEC, type Vec3 } from './types.ts';

export const LENS_FOV_DEG = { wide: 75, normal: 50, tele: 28 } as const;
export const PUSH_IN_PER_SEC = 0.03;
export const TWO_SHOT_DISTANCE_M = 3.5;
export const FIXED_DISTANCE_M: Readonly<Record<string, number>> = { single: 2.2, insert: 0.8, reaction: 1.6 };
const HEAD_M = 1.6;

/** The `ShotKind` a preset compiles to; `null` for `auto`. */
export function kindOfPreset(preset: DirectorShot['preset']): ShotKind | null {
  switch (preset) {
    case 'establish':
      return 'fixed';
    case 'two-shot':
    case 'single':
    case 'insert':
    case 'reaction':
      return 'fixed';
    case 'over-shoulder':
      return 'shoulder';
    case 'tracking':
      return 'chase';
    case 'orbit':
      return 'heli';
    case 'auto':
      return null;
  }
}

/** The camera pose of a kind: where the camera stands and what it looks at. `yaw` is the subject's heading. */
export interface Pose {
  pos: Vec3;
  lookAt: Vec3;
}

const fwd = (yaw: number): [number, number] => [-dsin(yaw), -dcos(yaw)];
const right = (yaw: number): [number, number] => {
  const [fx, fz] = fwd(yaw);
  return [-fz, fx];
};

/** The subject's look-at point: its head. */
export const headOf = (p: Vec3): Vec3 => [p[0], p[1] + HEAD_M, p[2]];

/**
 * Camera pose of `kind` for a subject at `p` heading `yaw`. Distances follow the rig: chase 6 m behind and 2.5 up, flyby 14 m ahead
 * and to the left, side 7 m to the right, front 6 m ahead, heli 20 m up and 8 m back, rearlow 5 m behind and 0.8 up, enemy 8 m behind
 * and to the side, shoulder 2.8 m behind and 0.6 to the right, wide 10 m behind and 4 up.
 */
export function poseOfKind(kind: ShotKind, p: Vec3, yaw: number): Pose {
  const [fx, fz] = fwd(yaw);
  const [rx, rz] = right(yaw);
  const at = (back: number, side: number, up: number): Vec3 => [p[0] - fx * back + rx * side, p[1] + up, p[2] - fz * back + rz * side];
  const look = headOf(p);
  switch (kind) {
    case 'chase':
      return { pos: at(6, 0, 2.5), lookAt: look };
    case 'flyby':
      return { pos: at(-14, -6, 3), lookAt: look };
    case 'side':
      return { pos: at(0, 7, 1.6), lookAt: look };
    case 'front':
      return { pos: at(-6, 0, 1.8), lookAt: look };
    case 'heli':
      return { pos: at(8, 0, 20), lookAt: look };
    case 'rearlow':
      return { pos: at(5, 0, 0.8), lookAt: look };
    case 'enemy':
      return { pos: at(8, 3, 2), lookAt: look };
    case 'shoulder':
      return { pos: at(2.8, 0.6, 0.35 + HEAD_M), lookAt: look };
    case 'wide':
      return { pos: at(10, 0, 4), lookAt: look };
    case 'fixed':
    case 'spline':
      return { pos: at(-3, 0, HEAD_M), lookAt: look };
  }
}

export function distance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dsqrt(dx * dx + dy * dy + dz * dz);
}

/** `fixed` camera of `single`, `insert` and `reaction`: `m` metres in front of the subject, at head height, looking at the head. */
export function fixedInFront(p: Vec3, yaw: number, m: number): Pose {
  const [fx, fz] = fwd(yaw);
  return { pos: [p[0] + fx * m, p[1] + HEAD_M, p[2] + fz * m], lookAt: headOf(p) };
}

/** `two-shot`: the midpoint of both subjects, 3.5 m to the side of the line between them. */
export function twoShot(a: Vec3, b: Vec3): Pose {
  const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const len = dsqrt(dx * dx + dz * dz) || 1;
  // perpendicular to the line, to its right
  const px = -dz / len;
  const pz = dx / len;
  return { pos: [mid[0] + px * TWO_SHOT_DISTANCE_M, mid[1] + HEAD_M, mid[2] + pz * TWO_SHOT_DISTANCE_M], lookAt: [mid[0], mid[1] + HEAD_M, mid[2]] };
}

/** A push-in (or pull-out) of 3 % of the camera-to-target distance per second, as a two-point spline. */
export function pushSpline(pose: Pose, sec: number, out = false): NonNullable<CinematicShot['spline']> {
  const k = PUSH_IN_PER_SEC * sec * (out ? -1 : 1);
  const p1: Vec3 = [pose.pos[0] + (pose.lookAt[0] - pose.pos[0]) * k, pose.pos[1] + (pose.lookAt[1] - pose.pos[1]) * k, pose.pos[2] + (pose.lookAt[2] - pose.pos[2]) * k];
  return { pts: [pose.pos, p1], durationTicks: Math.max(1, Math.round(sec * TICKS_PER_SEC)) };
}

export const fovOf = (lens: DirectorShot['lens']): number => LENS_FOV_DEG[lens];

/** Rotates a horizontal offset by `a` radians about +Y. */
export function rotateXZ(x: number, z: number, a: number): [number, number] {
  const c = dcos(a);
  const s = dsin(a);
  return [x * c - z * s, x * s + z * c];
}
