// packages/shared/src/contracts/c04-camera.ts
// C04 1.1.0 (1.0 body with the 1.1 additions merged in place). Copied from spec/domains/01-engine-contracts.md.
// Owner: S01. Types only; the rig itself is packages/engine/src/client/camera/rig.ts.
export const C04_VERSION = '1.1.0' as const;   // 1.1: XRRigParams.vantage, origin 'diorama', AnimStateId mode blocks
export type CameraMode = 'fp' | 'tp' | 'cinematic' | 'xr';
export type VehicleView = 'chase-near' | 'chase-mid' | 'chase-far' | 'hood' | 'cockpit';
export type Vec3 = [number, number, number];

export interface CollisionParams {
  probeRadius: number;     // default 0.25 m sphere cast, run in sim (Publish stage)
  pullInSec: number;       // default 0 (instant)
  easeOutSec: number;      // default 0.3
  fadeOccludersM: number;  // fade the player mesh when camera < this from it (default 0.6)
}
export interface FollowParams {
  target: number;          // EntityHandle
  anchor: 'head' | 'chest' | 'seat' | 'root';
  shoulder: 'right' | 'left';
  offset: Vec3;            // right, up, back in target space; tp on foot default [0.6, 0.35, 2.8]
  fovDeg: number;          // default fp 75, tp 65 (user setting overrides)
  lag: { pos: number; rot: number }; // smoothing g in k = 1 − e^(−dt·g); default 9 / 12
  pitchLimitsDeg: [number, number];  // default [−70, 70]
  autoRecenterSec: number; // vehicles 1.5 s, on foot 0 (off)
  collision: CollisionParams;
}
export type ShotKind = 'chase' | 'flyby' | 'side' | 'front' | 'heli' | 'rearlow' | 'enemy' | 'shoulder' | 'wide' | 'fixed' | 'spline';
export interface CinematicShot {
  kind: ShotKind; subject: number;   // EntityHandle
  pos?: Vec3; lookAt?: Vec3;          // ENU metres (f64) for fixed/spline
  spline?: { pts: Vec3[]; durationTicks: number };
  fovDeg: number; damping: number; durationTicks: number; seed: number;
}
export interface XRRigParams {
  origin: 'feet' | 'seat' | 'arena' | 'desk' | 'diorama';  // 1.1: diorama = tabletop third-person chase view (XrComfortSettings.chaseView, S06)
  vantage?: { pos: Vec3; yaw: number };                    // 1.1: fixed XR viewpoint for in-engine cutscene fallbacks (S03), no cuts (rule 5)
  turn: { snapDeg: 30 | 45; smooth: boolean };
  vignette: number;                   // 0..1 strength while moving or yawing
  seated: boolean; heightCalibM: number;
  session: 'immersive-vr' | 'immersive-ar'; // v1: 'immersive-vr' only; 'immersive-ar' reserved for a post-M11b ADR (visionOS support UNVERIFIED)
}
/** Published by the sim each tick (snapshot side block). The main-thread rig obeys it. */
export interface CameraDirective {
  mode: CameraMode;
  follow?: FollowParams;
  vehicleView?: VehicleView;
  shot?: CinematicShot;               // when mode = 'cinematic'
  xr?: XRRigParams;                   // when mode = 'xr'
  allowedDistance?: number;           // collision result for follow (m)
  fade?: { to: 0 | 1; sec: number }; letterbox?: boolean;
  shake?: { amp: number; decayPerSec: number }; // ignored when reduced motion or XR
  lockPlayerToggle: boolean;          // true during cutscenes (R-PLAT-04)
  reason: 'player' | 'vehicle' | 'mission' | 'cutscene' | 'mode' | 'debug';
}
export interface CameraRig {
  readonly mode: CameraMode;
  readonly camera: unknown;           // three PerspectiveCamera (typed in packages/engine/client)
  /** User toggle; returns false if lockPlayerToggle or mode is cinematic/xr. */
  toggleFpTp(): boolean;
  /** 06 sketch compatibility: shorthand for apply({ mode: 'tp'|'fp', follow: { ...params, target } }). */
  follow(target: number, params: Partial<FollowParams>): void;
  setVehicleView(v: VehicleView): void;
  swapShoulder(): void;
  apply(d: CameraDirective): void;
  /** Per render frame after snapshot interpolation. */
  update(f: { alpha: number; dtSec: number; reducedMotion: boolean; drawDistanceM: number }): void;
  onModeChange(cb: (m: CameraMode) => void): () => void;
}
