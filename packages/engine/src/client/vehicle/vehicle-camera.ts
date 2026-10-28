/**
 * Vehicle cameras (R-PLAT-04, 01-engine.md 2.6; M03a1): three chase distances, hood and cockpit, switchable outside cutscenes,
 * with auto-recentre after 1.5 s without look input.
 *
 * The chase camera orbits a point at roof height above the vehicle's centre (0.9 m by default; M02g1: `hy + 0.5` of the body). The player's view angles (`look`, the same angles that go to
 * the sim as `camYaw` and `camPitch`) set where the camera is: behind the view direction, `distance` metres away. The sim casts the
 * collision sphere for the far distance along that ray (`cameraCollisionSystem`, reason `vehicle`) and publishes `allowedDistance`;
 * the nearer views are shorter on the same ray, so they are clear too. Hood and cockpit sit on the car and turn with it; the look
 * angle moves the view up to 1.4 rad aside.
 */
import type { VehicleView } from '@dv/shared';
import { VEHICLE_ANCHOR_UP, VEHICLE_FAR_M } from '../../sim/camera/collision.ts';
import type { CameraLike } from '../camera/rig.ts';

export const VEHICLE_VIEW_ORDER: readonly VehicleView[] = ['chase-mid', 'chase-near', 'chase-far', 'hood', 'cockpit'];

/** Chase distances along the view ray, metres. `chase-far` is the distance the sim casts for. */
export const CHASE_DISTANCE_M: Readonly<Record<'chase-near' | 'chase-mid' | 'chase-far', number>> = Object.freeze({
  'chase-near': 5.2,
  'chase-mid': 8,
  'chase-far': VEHICLE_FAR_M,
});

/** The lift of the camera over the anchor per metre of distance (the offset is [0, 0.6, d] in view space at d = 11). */
const LIFT_PER_M = 0.6 / VEHICLE_FAR_M;
/**
 * Look pitch the chase camera settles at, radians (looking a little down at the car). M02g1: -0.17 puts the horizon 37.7 % from the
 * top of the picture at the chase field of view (70 degrees): `0.5 - tan(0.17) / (2 tan(35 degrees))`, inside the 35 to 40 % the
 * look study asks for (-0.2 gave 35.5 %, at the edge).
 */
export const CHASE_REST_PITCH = -0.17;
/** Seconds without look input before the view swings back behind the car (R-PLAT-04). */
export const RECENTRE_AFTER_SEC = 1.5;
/** The follow rate of the recentre, per second. */
const RECENTRE_RATE = 3;
/** Smoothing rates of the anchor, per second (C04 lag defaults). */
const POS_LAG = 9;
const FOV_DEG: Readonly<Record<VehicleView, number>> = { 'chase-near': 70, 'chase-mid': 70, 'chase-far': 70, hood: 78, cockpit: 80 };
/** Hood and cockpit eye points in the body frame (x right, y up, z back): above and ahead of the centre of gravity. */
const EYE: Readonly<Record<'hood' | 'cockpit', readonly [number, number, number]>> = { hood: [0, 0.62, -0.9], cockpit: [-0.4, 0.5, 0.05] };
/** How far aside the look may turn the hood and cockpit views, radians. */
const SIDE_LOOK_MAX = 1.4;

export interface VehiclePose {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
}

export function wrapAngle(a: number): number {
  const t = (a + Math.PI) / (Math.PI * 2);
  return (t - Math.floor(t)) * Math.PI * 2 - Math.PI;
}

/** Heading of a pose, radians about +Y with 0 facing -Z: forward is (-sin h, -cos h). */
export function headingOf(p: Pick<VehiclePose, 'qx' | 'qy' | 'qz' | 'qw'>): number {
  const fx = -2 * (p.qx * p.qz + p.qw * p.qy);
  const fz = -(1 - 2 * (p.qx * p.qx + p.qy * p.qy));
  return Math.atan2(-fx, -fz);
}

export interface VehicleCameraFrame {
  camera: CameraLike;
  pose: VehiclePose;
  /** The player's view angles, radians (updated in place by the recentre). */
  look: { yaw: number; pitch: number };
  /** The sim's allowed distance along the far chase ray; null when it has not answered yet. */
  allowed: number | null;
  dtSec: number;
  /** Seconds since the player last moved the view. */
  idleSec: number;
  drawDistanceM: number;
  /**
   * M02g1: the far chase distance and the anchor height of the followed vehicle, from the sim's follow offset (`offset[2]`) and its
   * published anchor; absent: the M03a1 constants (11 m, 0.9 m).
   */
  farM?: number;
  anchorUpM?: number;
}

/** Height of the horizon below the top of the picture as a share of its height, for a camera pitch and vertical field of view (degrees). */
export function horizonFromTop(pitchRad: number, fovDeg: number): number {
  return 0.5 - Math.tan(-pitchRad) / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

/**
 * The vehicle camera. `cycle()` steps through the five views; `update` places the draw camera. The result of the last update is
 * kept in `last` for the QA bridge (which checks that no view sits inside a collider).
 */
export class VehicleCamera {
  private _view: VehicleView = 'chase-mid';
  private sx = 0;
  private sy = 0;
  private sz = 0;
  private ready = false;
  /** Where the draw camera was put by the last `update`, and its distance from the anchor. */
  last = { x: 0, y: 0, z: 0, distance: 0, view: 'chase-mid' as VehicleView };
  private readonly listeners = new Set<(v: VehicleView) => void>();

  get view(): VehicleView {
    return this._view;
  }

  setView(v: VehicleView): void {
    if (v === this._view) return;
    this._view = v;
    for (const cb of this.listeners) cb(v);
  }

  /** The next view in `VEHICLE_VIEW_ORDER`. */
  cycle(): VehicleView {
    const i = VEHICLE_VIEW_ORDER.indexOf(this._view);
    this.setView(VEHICLE_VIEW_ORDER[(i + 1) % VEHICLE_VIEW_ORDER.length] as VehicleView);
    return this._view;
  }

  onViewChange(cb: (v: VehicleView) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Forget the smoothed anchor: the next update snaps (entering a vehicle, a teleport). */
  reset(): void {
    this.ready = false;
  }

  /**
   * After `RECENTRE_AFTER_SEC` without look input the view eases back behind the car (chase views) or straight ahead (hood and
   * cockpit). Mutates `look`.
   */
  recentre(look: { yaw: number; pitch: number }, heading: number, idleSec: number, dtSec: number): void {
    if (idleSec < RECENTRE_AFTER_SEC) return;
    const k = 1 - Math.exp(-dtSec * RECENTRE_RATE);
    look.yaw += wrapAngle(heading - look.yaw) * k;
    const rest = this._view === 'hood' || this._view === 'cockpit' ? 0 : CHASE_REST_PITCH;
    look.pitch += (rest - look.pitch) * k;
  }

  /** Puts the view behind the car at once (entering a vehicle). */
  snapBehind(look: { yaw: number; pitch: number }, heading: number): void {
    look.yaw = heading;
    look.pitch = this._view === 'hood' || this._view === 'cockpit' ? 0 : CHASE_REST_PITCH;
  }

  update(f: VehicleCameraFrame): void {
    const { pose, look, camera } = f;
    const heading = headingOf(pose);
    const view = this._view;
    let px: number;
    let py: number;
    let pz: number;
    let yaw = look.yaw;
    let pitch = look.pitch;
    let distance = 0;

    if (view === 'hood' || view === 'cockpit') {
      const e = EYE[view];
      // body axes from the quaternion: right, up, back
      const { qx: x, qy: y, qz: z, qw: w } = pose;
      const rx = 1 - 2 * (y * y + z * z);
      const ry = 2 * (x * y + w * z);
      const rz = 2 * (x * z - w * y);
      const ux = 2 * (x * y - w * z);
      const uy = 1 - 2 * (x * x + z * z);
      const uz = 2 * (y * z + w * x);
      const bx = 2 * (x * z + w * y);
      const by = 2 * (y * z - w * x);
      const bz = 1 - 2 * (x * x + y * y);
      px = pose.x + rx * e[0] + ux * e[1] + bx * e[2];
      py = pose.y + ry * e[0] + uy * e[1] + by * e[2];
      pz = pose.z + rz * e[0] + uz * e[1] + bz * e[2];
      const aside = Math.max(-SIDE_LOOK_MAX, Math.min(SIDE_LOOK_MAX, wrapAngle(look.yaw - heading)));
      yaw = heading + aside;
      pitch = Math.max(-0.6, Math.min(0.6, look.pitch));
      this.ready = false;
    } else {
      const ax = pose.x;
      const ay = pose.y + (f.anchorUpM ?? VEHICLE_ANCHOR_UP);
      const az = pose.z;
      if (!this.ready || Math.hypot(ax - this.sx, ay - this.sy, az - this.sz) > 8) {
        this.sx = ax; this.sy = ay; this.sz = az;
        this.ready = true;
      } else {
        const k = 1 - Math.exp(-Math.max(0, f.dtSec) * POS_LAG);
        this.sx += (ax - this.sx) * k;
        this.sy += (ay - this.sy) * k;
        this.sz += (az - this.sz) * k;
      }
      const want = (CHASE_DISTANCE_M[view] * (f.farM ?? VEHICLE_FAR_M)) / VEHICLE_FAR_M;
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const sy = Math.sin(yaw);
      const cy = Math.cos(yaw);
      const lift = LIFT_PER_M * want;
      // the view-space offset [0, lift, want] in world space: back = (sin yaw cos pitch, -sin pitch, cos yaw cos pitch), up = (sin yaw sin pitch, cos pitch, cos yaw sin pitch)
      const ox = sy * sp * lift + sy * cp * want;
      const oy = cp * lift - sp * want;
      const oz = cy * sp * lift + cy * cp * want;
      const len = Math.hypot(ox, oy, oz);
      const own = f.allowed === null ? Number.POSITIVE_INFINITY : f.allowed;
      distance = Math.min(len, own);
      const k2 = len > 0 ? distance / len : 0;
      px = this.sx + ox * k2;
      py = this.sy + oy * k2;
      pz = this.sz + oz * k2;
    }

    const sy2 = Math.sin(yaw / 2);
    const cy2 = Math.cos(yaw / 2);
    const sp2 = Math.sin(pitch / 2);
    const cp2 = Math.cos(pitch / 2);
    camera.position.set(px, py, pz);
    camera.quaternion.set(cy2 * sp2, sy2 * cp2, -sy2 * sp2, cy2 * cp2);
    const fov = FOV_DEG[view];
    const near = view === 'cockpit' || view === 'hood' ? 0.05 : 0.1;
    if (camera.fov !== fov || camera.near !== near || camera.far !== f.drawDistanceM) {
      camera.fov = fov;
      camera.near = near;
      camera.far = f.drawDistanceM;
      camera.updateProjectionMatrix();
    }
    this.last = { x: px, y: py, z: pz, distance, view };
  }
}
