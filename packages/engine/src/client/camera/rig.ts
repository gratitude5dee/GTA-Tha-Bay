import type { CameraDirective, CameraMode, CameraRig, FollowParams, VehicleView } from '@dv/shared';
import { DEFAULT_TP_FOLLOW, tpOffsetWorld, type PublishedCamera } from '../../sim/camera/collision.ts';
import { PHYSICS_CONFIG } from '../../sim/physics/config.ts';

/** The part of a three `PerspectiveCamera` the rig drives. Structural, so the rig runs and is tested without three. */
export interface CameraLike {
  position: { set(x: number, y: number, z: number): unknown };
  quaternion: { set(x: number, y: number, z: number, w: number): unknown };
  fov: number;
  near: number;
  far: number;
  updateProjectionMatrix(): void;
}

export interface CameraRigOptions {
  camera: CameraLike;
  /** Feet of the followed entity after snapshot interpolation, ENU metres; null when it is not in the snapshot. */
  targetPose: (handle: number) => { x: number; y: number; z: number } | null;
  /** The player's current view angles in radians (applied every frame, so look has no tick latency). */
  look: () => { yaw: number; pitch: number };
  /** Eye and chest heights above the feet. Default: config/physics.json. */
  headY?: number;
  chestY?: number;
}

/** First person: FOV 75 and near plane 0.05 m; third person: FOV from the follow params (65) and near 0.1 m (C04 rule 3). */
export const FP_FOV_DEG = 75;
export const FP_NEAR_M = 0.05;
export const TP_NEAR_M = 0.1;
/** A target farther than this from where the camera last looked is a teleport: the camera snaps instead of lagging. */
const SNAP_DISTANCE_M = 8;
/** Distances within this of the target count as reached (floating point after 18 frames of 1/60 s). */
const REACHED_EPS = 1e-6;
/** The player mesh is fully transparent when the camera is within this distance of the head (C04, 01-engine.md section 2.6). */
export const FADE_NEAR_M = 0.6;
/** ... and fully opaque beyond FADE_NEAR_M + this. */
export const FADE_RANGE_M = 0.4;
/** A shoulder swap takes this long (R-PLAT-04). */
export const SHOULDER_SWAP_SEC = 0.25;
/** With a standard (non-reversed) depth buffer the near plane is at least far / this (C04 rule 3). */
export const STANDARD_DEPTH_NEAR_DIVISOR = 20000;
/** Shake: peak positional offset per unit of directive amplitude, metres, and the two wobble rates, rad/s (presentation). */
const SHAKE_METRES = 0.05;
const SHAKE_RATE_A = 47;
const SHAKE_RATE_B = 61;

const HALF = 0.5;

/**
 * The main-thread camera rig (C04). It obeys the `CameraDirective` the sim publishes and draws the player's choice
 * between first and third person, which is presentation only and never reaches the sim.
 *
 * Third person: the camera sits `distance` from the chest anchor along the offset direction, where the distance is the
 * smaller of the offset length and the sim's `allowedDistance`. It pulls in at once and eases back out over
 * `collision.easeOutSec` (0.3 s), and the anchor and view angles follow the player with the lag smoothing
 * k = 1 - e^(-dt g), g = 9 for position and 12 for rotation. First person: the eye at the head anchor, no lag.
 */
export class CameraRigImpl implements CameraRig {
  readonly camera: CameraLike;
  /** True when the last `toggleFpTp()` was refused (lock, cinematic or XR). The QA bridge reads it. */
  lastToggleRefused = false;
  /** True while the player capsule should be hidden (first person). */
  get playerHidden(): boolean {
    return this._mode === 'fp' || this._mode === 'xr';
  }

  private readonly opts: CameraRigOptions;
  private readonly headY: number;
  private readonly chestY: number;
  private _mode: CameraMode = 'tp';
  private userMode: 'fp' | 'tp' = 'tp';
  private directive: PublishedCamera | null = null;
  private shoulder: 'right' | 'left' = 'right';
  /** +1 right ... -1 left; eases to the shoulder over SHOULDER_SWAP_SEC. */
  private blend = 1;
  private blendFrom = 1;
  private swapT = 1;
  private _opacity = 1;
  private shakeAmp = 0;
  private shakeDecay = 0;
  private clock = 0;
  private vehicleView: VehicleView = 'chase-mid';
  private readonly listeners = new Set<(m: CameraMode) => void>();
  private xrActive = false;

  private smoothed = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private initialized = false;
  private snapNext = true;
  private distance = 0;
  /** Metres per second while easing out; 0 when not easing. */
  private easeRate = 0;
  private readonly offset: [number, number, number] = [0, 0, 0];

  constructor(opts: CameraRigOptions) {
    this.opts = opts;
    this.camera = opts.camera;
    this.headY = opts.headY ?? PHYSICS_CONFIG.character.headY;
    this.chestY = opts.chestY ?? PHYSICS_CONFIG.character.chestY;
  }

  get mode(): CameraMode {
    return this._mode;
  }

  /** Distance from the anchor to the camera in third person, metres. */
  get currentDistance(): number {
    return this.distance;
  }

  /** Which shoulder the camera is on. */
  get currentShoulder(): 'right' | 'left' {
    return this.shoulder;
  }

  /** Shoulder side as a number: 1 right, -1 left, between while a swap eases. */
  get shoulderBlend(): number {
    return this.blend;
  }

  /**
   * Opacity for the followed player's mesh: 0 when the camera is within 0.6 m of the head (and in first person), rising to 1
   * at 1.0 m. The page applies it to the mesh (`ObjectPool.setFade`).
   */
  get playerOpacity(): number {
    return this._opacity;
  }

  get locked(): boolean {
    return this.xrActive || this.directive?.lockPlayerToggle === true;
  }

  /**
   * An XR session started (M01b2 smoke): `mode: 'xr'`, origin `feet`, the player toggle locked, and no push, shake or
   * locomotion from the rig. The headset drives the camera; sim directives keep arriving but cannot change the mode until
   * `exitXr`.
   */
  enterXr(): void {
    this.xrActive = true;
    this.lastToggleRefused = false;
    this.setMode('xr');
  }

  /** The session ended: back to the player's own first or third person. */
  exitXr(): void {
    this.xrActive = false;
    this.setMode(this.userMode);
  }

  get inXr(): boolean {
    return this.xrActive;
  }

  toggleFpTp(): boolean {
    if (this.xrActive || this.locked || this._mode === 'cinematic' || this._mode === 'xr') {
      this.lastToggleRefused = true;
      return false;
    }
    this.lastToggleRefused = false;
    this.userMode = this.userMode === 'tp' ? 'fp' : 'tp';
    this.setMode(this.userMode);
    return true;
  }

  follow(target: number, params: Partial<FollowParams>): void {
    const follow: FollowParams = { ...DEFAULT_TP_FOLLOW, ...params, target } as FollowParams;
    this.apply({
      mode: this.userMode,
      follow,
      lockPlayerToggle: this.locked,
      reason: 'player',
      ...(this.directive?.allowedDistance !== undefined ? { allowedDistance: this.directive.allowedDistance } : {}),
    });
  }

  setVehicleView(v: VehicleView): void {
    this.vehicleView = v;
  }

  get currentVehicleView(): VehicleView {
    return this.vehicleView;
  }

  swapShoulder(): void {
    this.shoulder = this.shoulder === 'right' ? 'left' : 'right';
    this.blendFrom = this.blend;
    this.swapT = 0;
    // The sim's distance for the other side is a different cast; the pull-in logic picks it up on the next update.
  }

  apply(d: CameraDirective): void {
    this.directive = d as PublishedCamera;
    if (this.xrActive) return;
    if (d.shake && d.shake.amp > this.shakeAmp) {
      this.shakeAmp = d.shake.amp;
      this.shakeDecay = d.shake.decayPerSec;
    }
    // Cinematic and XR shots replace the player's view; otherwise the player's fp/tp choice stands.
    if (d.mode === 'cinematic' || d.mode === 'xr') this.setMode(d.mode);
    else this.setMode(this.userMode);
  }

  update(f: { alpha: number; dtSec: number; reducedMotion: boolean; drawDistanceM: number; depthPolicy?: 'standard' | 'reversed' }): void {
    this.advanceBlend(Math.max(0, f.dtSec));
    const d = this.directive;
    // A cinematic shot that the sim has placed (`pos` and `lookAt`, ENU metres; the story director re-places it every tick) is obeyed as it is.
    if (this._mode === 'cinematic' && d?.shot?.pos && d.shot.lookAt) {
      this.placeCinematic(d.shot.pos, d.shot.lookAt, d.shot.fovDeg, f.drawDistanceM, f.depthPolicy ?? 'standard');
      return;
    }
    const follow = d?.follow;
    if (!d || !follow || (this._mode !== 'fp' && this._mode !== 'tp')) return;
    const pose = this.opts.targetPose(follow.target);
    if (!pose) return;
    const look = this.opts.look();
    const dt = Math.max(0, f.dtSec);
    const fp = this._mode === 'fp';
    const anchorY = fp || follow.anchor === 'head' ? this.headY : this.chestY;
    const ax = pose.x;
    const ay = pose.y + anchorY;
    const az = pose.z;
    const s = this.smoothed;

    const jump = Math.hypot(ax - s.x, ay - s.y, az - s.z);
    if (!this.initialized || this.snapNext || jump > SNAP_DISTANCE_M || fp) {
      s.x = ax;
      s.y = ay;
      s.z = az;
      s.yaw = look.yaw;
      s.pitch = look.pitch;
      this.snapNext = false;
    } else {
      const kPos = 1 - Math.exp(-dt * follow.lag.pos);
      const kRot = 1 - Math.exp(-dt * follow.lag.rot);
      s.x += (ax - s.x) * kPos;
      s.y += (ay - s.y) * kPos;
      s.z += (az - s.z) * kPos;
      s.yaw += wrapAngle(look.yaw - s.yaw) * kRot;
      s.pitch += (look.pitch - s.pitch) * kRot;
    }

    let px = s.x;
    let py = s.y;
    let pz = s.z;
    if (!fp) {
      tpOffsetWorld(s.yaw, s.pitch, this.blend, this.offset, follow.offset);
      const len = Math.hypot(this.offset[0], this.offset[1], this.offset[2]);
      const target = Math.min(len, this.allowedFor(d, follow));
      this.moveDistance(target, dt, follow.collision.easeOutSec, !this.initialized);
      const k = len > 0 ? this.distance / len : 0;
      px += this.offset[0] * k;
      py += this.offset[1] * k;
      pz += this.offset[2] * k;
    } else {
      // Coming back to third person starts from where the camera is, not from an old distance.
      this.distance = 0;
      this.easeRate = 0;
    }
    this.initialized = true;

    // Shake is presentation: ignored under reduced motion, in XR and in cinematic modes, and it decays by itself.
    this.clock += dt;
    if (f.reducedMotion) this.shakeAmp = 0;
    if (this.shakeAmp > 0) {
      const a = this.shakeAmp * SHAKE_METRES;
      px += Math.sin(this.clock * SHAKE_RATE_A) * a;
      py += Math.sin(this.clock * SHAKE_RATE_B + 1.3) * a;
      this.shakeAmp *= Math.exp(-this.shakeDecay * dt);
      if (this.shakeAmp < 1e-4) this.shakeAmp = 0;
    }

    // The mesh fades out as the camera comes within 0.6 m of the head.
    const hx = pose.x;
    const hy = pose.y + this.headY;
    const hz = pose.z;
    const headDist = Math.hypot(px - hx, py - hy, pz - hz);
    this._opacity = fp ? 0 : Math.min(1, Math.max(0, (headDist - FADE_NEAR_M) / FADE_RANGE_M));

    const yaw = fp ? look.yaw : s.yaw;
    const pitch = fp ? look.pitch : s.pitch;
    const sy = Math.sin(yaw * HALF);
    const cy = Math.cos(yaw * HALF);
    const sp = Math.sin(pitch * HALF);
    const cp = Math.cos(pitch * HALF);
    // q = qyaw (about +Y) * qpitch (about +X)
    const cam = this.camera;
    cam.position.set(px, py, pz);
    cam.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);

    const fov = fp ? FP_FOV_DEG : follow.fovDeg;
    // A standard depth buffer loses precision at range: near = max(near, far / 20000) (C04 rule 3). Reversed depth keeps it.
    const baseNear = fp ? FP_NEAR_M : TP_NEAR_M;
    const near = (f.depthPolicy ?? 'standard') === 'standard' ? Math.max(baseNear, f.drawDistanceM / STANDARD_DEPTH_NEAR_DIVISOR) : baseNear;
    if (cam.fov !== fov || cam.near !== near || cam.far !== f.drawDistanceM) {
      cam.fov = fov;
      cam.near = near;
      cam.far = f.drawDistanceM;
      cam.updateProjectionMatrix();
    }
  }

  private placeCinematic(pos: readonly number[], lookAt: readonly number[], fovDeg: number, drawDistanceM: number, depthPolicy: 'standard' | 'reversed'): void {
    const fx = (lookAt[0] as number) - (pos[0] as number);
    const fy = (lookAt[1] as number) - (pos[1] as number);
    const fz = (lookAt[2] as number) - (pos[2] as number);
    const yaw = Math.atan2(-fx, -fz);
    const pitch = Math.atan2(fy, Math.hypot(fx, fz));
    const sy = Math.sin(yaw * HALF);
    const cy = Math.cos(yaw * HALF);
    const sp = Math.sin(pitch * HALF);
    const cp = Math.cos(pitch * HALF);
    const cam = this.camera;
    cam.position.set(pos[0] as number, pos[1] as number, pos[2] as number);
    cam.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    this._opacity = 1;
    this.initialized = false;
    const baseNear = TP_NEAR_M;
    const near = depthPolicy === 'standard' ? Math.max(baseNear, drawDistanceM / STANDARD_DEPTH_NEAR_DIVISOR) : baseNear;
    if (cam.fov !== fovDeg || cam.near !== near || cam.far !== drawDistanceM) {
      cam.fov = fovDeg;
      cam.near = near;
      cam.far = drawDistanceM;
      cam.updateProjectionMatrix();
    }
  }

  onModeChange(cb: (m: CameraMode) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // ------------------------------------------------------------------ internals

  /** Eases the shoulder side toward the chosen shoulder: smoothstep over SHOULDER_SWAP_SEC. */
  private advanceBlend(dt: number): void {
    const to = this.shoulder === 'right' ? 1 : -1;
    if (this.swapT >= 1) {
      this.blend = to;
      return;
    }
    this.swapT = Math.min(1, this.swapT + dt / SHOULDER_SWAP_SEC);
    const k = this.swapT * this.swapT * (3 - 2 * this.swapT);
    this.blend = this.blendFrom + (to - this.blendFrom) * k;
  }

  /** Places the camera at its follow point and the current look at once on the next update, with no smoothing (a water respawn, DL-753). */
  snap(): void {
    this.snapNext = true;
  }

  private setMode(m: CameraMode): void {
    if (m === this._mode) return;
    this._mode = m;
    this.snapNext = true;
    for (const cb of this.listeners) cb(m);
  }

  /** The sim's collision result for the shoulder the camera is on. */
  private allowedFor(d: PublishedCamera, follow: FollowParams): number {
    const own = d.allowedDistance ?? Number.POSITIVE_INFINITY;
    if (follow.shoulder === this.shoulder) return own;
    return d.allowedDistanceOpposite ?? own;
  }

  /** Pull in at once; ease back out so that the whole way takes `easeOutSec`, whatever its length. */
  private moveDistance(target: number, dt: number, easeOutSec: number, first: boolean): void {
    if (first || target <= this.distance) {
      this.distance = target;
      this.easeRate = 0;
      return;
    }
    if (this.easeRate === 0) this.easeRate = easeOutSec > 0 ? (target - this.distance) / easeOutSec : Number.POSITIVE_INFINITY;
    this.distance = Math.min(target, this.distance + this.easeRate * dt);
    if (this.distance >= target - REACHED_EPS) {
      this.distance = target;
      this.easeRate = 0;
    }
  }
}

/** Shortest signed difference of two angles, radians in (-pi, pi]. */
function wrapAngle(a: number): number {
  const t = (a + Math.PI) / (Math.PI * 2);
  return (t - Math.floor(t)) * Math.PI * 2 - Math.PI;
}
