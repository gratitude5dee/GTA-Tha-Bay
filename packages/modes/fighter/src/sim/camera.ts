/**
 * The fight camera (FC8.4): a fixed side view that frames the midpoint of the two fighters. The distance is
 * `clamp(minD, maxD, a + b x separation / 1000)` with the integer coefficients of the stage; a super dollies in over 20 frames while
 * the 45-frame freeze runs. Reduced motion has no dolly and no shake (C04 rule 6). The plan is presentation: it reads the buffer and
 * never feeds back into it. Sim code under the C02 lint (integers; the metre conversion is a division by 1000).
 */
import type { CameraDirective, Vec3 } from '@dv/shared';
import { FF, FIGHTER_BASE, St } from '@dv/shared/fight';
import type { StageCameraDef } from '../types.ts';

/** Frames of the dolly-in of a super (FC8.4) and the length of the super freeze (`SUPER_FREEZE`). */
export const DOLLY_FRAMES = 20;
export const SUPER_FREEZE_FRAMES = 45;
/** The closest the dolly gets, per mille of the framing distance. */
export const DOLLY_MIN_PERMILLE = 700;
/** Where the arena sits in ENU metres: high above the city, so no street or building is behind the fighters (`world: 'stage'`). */
export const ARENA_ORIGIN: Vec3 = [0, 3000, 0];

export interface CamState {
  /** Ticks since a fighter entered `Super` (0 = none). */
  superT: number;
  /** Heaviest hitstop seen on the last tick (drives the shake). */
  shake: number;
}

export const newCamState = (): CamState => ({ superT: 0, shake: 0 });

export interface CamPlan {
  /** Framing centre along the stage, fight units. */
  cx: number;
  /** Camera distance from the fighters' plane, fight units. */
  dist: number;
  /** The distance before the dolly (the stage clamp), fight units. */
  baseDist: number;
  /** 0 to DOLLY_FRAMES; 0 under reduced motion. */
  dollyFrames: number;
  dollyPermille: number;
  /** Shake amplitude in 1/1000 m (0 under reduced motion). */
  shakeMilli: number;
  height: number;
  fovDeg: number;
  damping: number;
}

const w = (buf: Int32Array, slot: 0 | 1, word: number): number => buf[(FIGHTER_BASE[slot] as number) + word] as number;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Once per tick: tracks the super and the heaviest hitstop. */
export function advanceCam(buf: Int32Array, st: CamState): void {
  const sup = w(buf, 0, FF.State) === St.Super || w(buf, 1, FF.State) === St.Super;
  st.superT = sup ? Math.min(st.superT + 1, 255) : 0;
  st.shake = Math.max(w(buf, 0, FF.Hitstop), w(buf, 1, FF.Hitstop));
}

/** The dolly step for `superT` ticks after the super began: in over 20 frames, held through the freeze, out over 10 frames. */
export function dollyStep(superT: number): number {
  if (superT <= 0) return 0;
  if (superT <= SUPER_FREEZE_FRAMES) return Math.min(superT, DOLLY_FRAMES);
  return Math.max(0, DOLLY_FRAMES - (superT - SUPER_FREEZE_FRAMES) * 2);
}

export function planCamera(buf: Int32Array, cam: StageCameraDef, st: CamState, reducedMotion: boolean): CamPlan {
  const x0 = w(buf, 0, FF.X), x1 = w(buf, 1, FF.X);
  const sep = Math.abs(x1 - x0);
  const baseDist = clamp(cam.a + Math.trunc((sep * cam.b) / 1000), cam.minD, cam.maxD);
  const dollyFrames = reducedMotion ? 0 : dollyStep(st.superT);
  const dollyPermille = 1000 - Math.trunc(((1000 - DOLLY_MIN_PERMILLE) * dollyFrames) / DOLLY_FRAMES);
  const dist = Math.trunc((baseDist * dollyPermille) / 1000);
  const shakeMilli = reducedMotion || st.shake < 10 ? 0 : (st.shake - 8) * 6;
  return { cx: Math.trunc((x0 + x1) / 2), dist, baseDist, dollyFrames, dollyPermille, shakeMilli, height: cam.height, fovDeg: cam.fovDeg, damping: cam.damping };
}

/** The C04 directive of a plan: `cinematic` mode, a `side` shot placed in ENU metres, the player's toggle locked (reason `mode`). */
export function toDirective(plan: CamPlan, origin: Vec3 = ARENA_ORIGIN): CameraDirective {
  const pos: Vec3 = [origin[0] + plan.cx / 1000, origin[1] + plan.height / 1000, origin[2] + plan.dist / 1000];
  const lookAt: Vec3 = [origin[0] + plan.cx / 1000, origin[1] + 0.95, origin[2]];
  const d: CameraDirective = {
    mode: 'cinematic',
    shot: { kind: 'side', subject: 0, pos, lookAt, fovDeg: plan.fovDeg, damping: plan.damping, durationTicks: 1, seed: 0 },
    lockPlayerToggle: true,
    reason: 'mode',
  };
  if (plan.shakeMilli > 0) d.shake = { amp: plan.shakeMilli / 1000, decayPerSec: 8 };
  return d;
}
