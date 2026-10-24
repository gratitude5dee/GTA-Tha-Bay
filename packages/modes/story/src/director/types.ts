/**
 * Shared types of the in-engine cinematic director (M05a2; 03-story-cutscenes.md D6). The director reads the world through
 * `DirWorld`, a small read-only view the story runtime builds from the `ModeContext` and the tests build from fixtures, and
 * answers with C04 `CameraDirective`s. Sim code under the C02 lint.
 */
import type { CameraDirective } from '@dv/shared';

export type Vec3 = [number, number, number];

export const TICKS_PER_SEC = 60;
/** Rays the director may cast in one tick, shared with the pursuit line-of-sight budget (D6.3). */
export const MAX_RAYS_PER_TICK = 8;
/** A shot that stays blocked this long (0.8 s) is cut. */
export const OCCLUSION_CUT_TICKS = 48;
/** With reduced motion no two cuts are closer than this (2 s). */
export const REDUCED_MOTION_MIN_CUT_TICKS = 120;
/** XR and reduced-motion transitions are fades of this length. */
export const XR_FADE_SEC = 0.3;
export const REDUCED_FADE_SEC = 0.4;

/** What the director may look at. All positions are ENU metres. */
export interface DirWorld {
  /** Position of a subject (`player`, a cast name, `soul:<id>`), or null when it is not in the world. */
  pos(who: string): Vec3 | null;
  /** Heading of a subject, radians; forward is `(-sin yaw, -cos yaw)`. */
  yaw(who: string): number;
  /** The subject's up vector (the ground normal for a body on a slope); `(0, 1, 0)` when unknown. */
  up(who: string): Vec3;
  /** Handle of the subject for `CinematicShot.subject`; 0 when there is none. */
  handle(who: string): number;
  inVehicle(who: string): boolean;
  /** True while a pursuer exists (the `enemy` shot is allowed). */
  hasPursuer(): boolean;
  /** Distance along `dir` (unit) to the first static collider within `maxM`, or null when the way is clear. */
  castRay(from: Vec3, dir: Vec3, maxM: number): number | null;
}

export interface Comfort {
  /** `ProfileSettings.accessibility.reducedMotion`: cuts at least 2 s apart, no shake, fades instead of whip pans. */
  reducedMotion: boolean;
  /** The XR camera mode: no cuts, a fixed vantage, 300 ms fades. */
  xr: boolean;
}

export type Publish = (d: CameraDirective) => void;

/** One entry of the director's log: tests and the debugger read it. */
export interface DirEvent {
  tick: number;
  /** `shot` (a new shot starts), `cut` (a blocked shot was replaced), `alt` (an alternate was tried), `demote`, `hill`. */
  t: 'shot' | 'cut' | 'alt' | 'demote' | 'hill' | 'fade';
  detail: string;
}
