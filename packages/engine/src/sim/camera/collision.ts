import {
  dcos, dsin, dsqrt, HALF_PI, SimStage,
  type CameraDirective, type EntityHandle, type EntityId, type FollowParams, type SystemDef, type Vec3 as CamVec3,
} from '@dv/shared';
import { CameraAnchor, LocalPlayer, PlayerControlled, Transform } from '../ecs/components.ts';
import type { EcsWorld } from '../ecs/world.ts';
import { NEUTRAL_INPUT, YAW_UNIT } from '../control/onfoot.ts';
import type { PhysicsSystemsBackend, Vec3 } from '../physics/backend.ts';
import { GROUP_BIT } from '../physics/groups.ts';
import type { EngineServices } from '../services.ts';

export const CAMERA_COLLISION_ID = 'engine.camera.collision';

/** Third person on foot (C04): right, up, back from the chest anchor, in view space. */
export const TP_OFFSET: Readonly<CamVec3> = Object.freeze([0.6, 0.35, 2.8] as CamVec3) as CamVec3;
/** The sphere cast radius (C04 `CollisionParams.probeRadius`). */
export const PROBE_RADIUS = 0.25;
/** The camera stops this far short of the first contact. */
export const CAMERA_MARGIN = 0.05;
/** The shortest allowed distance: the camera never goes closer to the anchor than this. */
export const MIN_ALLOWED = 0.2;
/** What the camera collides with: static geometry. */
export const CAMERA_MASK = GROUP_BIT.static;

/** `FollowParams` defaults for the on-foot tp camera (C04, R-PLAT-04). */
export const DEFAULT_TP_FOLLOW: Readonly<Omit<FollowParams, 'target'>> = Object.freeze({
  anchor: 'chest',
  shoulder: 'right',
  offset: [0.6, 0.35, 2.8],
  fovDeg: 65,
  lag: { pos: 9, rot: 12 },
  pitchLimitsDeg: [-70, 70],
  autoRecenterSec: 0,
  collision: { probeRadius: PROBE_RADIUS, pullInSec: 0, easeOutSec: 0.3, fadeOccludersM: 0.6 },
} as const) as Omit<FollowParams, 'target'>;

/**
 * The vehicle chase camera (M03a1): an orbit camera around a point `VEHICLE_ANCHOR_UP` above the vehicle's centre, `VEHICLE_FAR_M`
 * behind it along the view direction (the near and mid views are shorter along the same ray), with a little lift. The sim casts the
 * sphere for the far view; the page shortens it for the nearer ones.
 */
export const VEHICLE_ANCHOR_UP = 0.9;
export const VEHICLE_FAR_M = 11;
export const VEHICLE_OFFSET: Readonly<CamVec3> = Object.freeze([0, 0.6, VEHICLE_FAR_M] as CamVec3) as CamVec3;
export const VEHICLE_FOLLOW: Readonly<Omit<FollowParams, 'target'>> = Object.freeze({
  anchor: 'root',
  shoulder: 'right',
  offset: [0, 0.6, VEHICLE_FAR_M],
  fovDeg: 70,
  lag: { pos: 9, rot: 12 },
  pitchLimitsDeg: [-45, 30],
  autoRecenterSec: 1.5,
  collision: { probeRadius: PROBE_RADIUS, pullInSec: 0, easeOutSec: 0.3, fadeOccludersM: 0.6 },
} as const) as Omit<FollowParams, 'target'>;

/** Decodes the u16 `camYaw` and the i16 `camPitch` of an InputFrame to radians. */
export function lookAngles(camYaw: number, camPitch: number): { yaw: number; pitch: number } {
  return { yaw: camYaw * YAW_UNIT, pitch: (camPitch * HALF_PI) / 16384 };
}

/**
 * The tp offset in world space for a view direction. The view basis: forward = (-sin yaw cos pitch, sin pitch,
 * -cos yaw cos pitch), right = (cos yaw, 0, -sin yaw), up = (sin yaw sin pitch, cos pitch, cos yaw sin pitch).
 * `side` is +1 for the right shoulder and -1 for the left; the page passes values in between while a swap eases. Writes into `out`.
 */
export function tpOffsetWorld(yaw: number, pitch: number, side: number, out: Vec3, offset: Readonly<CamVec3> = TP_OFFSET): Vec3 {
  const sy = dsin(yaw);
  const cy = dcos(yaw);
  const sp = dsin(pitch);
  const cp = dcos(pitch);
  const right = side * offset[0];
  const up = offset[1];
  const back = offset[2];
  // r * right + u * up - f * back
  out[0] = cy * right + sy * sp * up + sy * cp * back;
  out[1] = cp * up - sp * back;
  out[2] = -sy * right + cy * sp * up + cy * cp * back;
  return out;
}

/**
 * How far along the anchor-to-camera direction the camera may go: a sphere cast of `probeRadius` from the anchor
 * toward `anchor + offsetWorld`. With a hit the answer is `max(MIN_ALLOWED, toi - CAMERA_MARGIN)`, otherwise the full length.
 */
export function allowedCameraDistance(
  backend: Pick<PhysicsSystemsBackend, 'castSphere'>,
  anchor: Vec3,
  offsetWorld: Readonly<Vec3>,
  probeRadius: number = PROBE_RADIUS,
): number {
  const length = dsqrt(offsetWorld[0] * offsetWorld[0] + offsetWorld[1] * offsetWorld[1] + offsetWorld[2] * offsetWorld[2]);
  if (!(length > 0)) return 0;
  const dir: Vec3 = [offsetWorld[0] / length, offsetWorld[1] / length, offsetWorld[2] / length];
  const hit = backend.castSphere(anchor, dir, probeRadius, length, CAMERA_MASK);
  if (!hit) return length;
  return Math.max(MIN_ALLOWED, Math.min(length, hit.toi - CAMERA_MARGIN));
}

/**
 * Publish stage, before the snapshot is written: for the local player, casts the camera sphere for both shoulders and
 * leaves the results in `services.camera`. The right shoulder is the directive's `follow.shoulder`; the left result
 * travels beside it, so a shoulder swap on the page needs no round trip to the sim.
 */
export function cameraCollisionSystem(backend: PhysicsSystemsBackend, services: Pick<EngineServices, 'camera' | 'input'>): SystemDef {
  const anchor: Vec3 = [0, 0, 0];
  const offset: Vec3 = [0, 0, 0];
  return {
    id: CAMERA_COLLISION_ID, owner: 'S01', stage: SimStage.Publish, order: 500,
    run: ({ ecs }) => {
      const ids = ecs.query([LocalPlayer, Transform, CameraAnchor, PlayerControlled]);
      const cam = services.camera;
      if (ids.length === 0) {
        cam.target = 0;
        return;
      }
      if (cam.reason === 'vehicle' && cam.target !== 0) {
        // The followed entity is the vehicle: cast the chase camera from above its centre along the player's view.
        const vid = (ecs as unknown as EcsWorld).resolve(cam.target as EntityHandle);
        if (vid !== null) {
          const tr = ecs.store(Transform);
          anchor[0] = tr.px[vid] as number;
          anchor[1] = (tr.py[vid] as number) + VEHICLE_ANCHOR_UP;
          anchor[2] = tr.pz[vid] as number;
          const f = services.input ?? NEUTRAL_INPUT;
          const look = lookAngles(f.camYaw, f.camPitch);
          const d = allowedCameraDistance(backend, anchor, tpOffsetWorld(look.yaw, look.pitch, 0, offset, VEHICLE_OFFSET));
          cam.allowedRight = d;
          cam.allowedLeft = d;
          return;
        }
      }
      const id = ids[0] as number;
      const tr = ecs.store(Transform);
      anchor[0] = tr.px[id] as number;
      anchor[1] = (tr.py[id] as number) + (ecs.store(CameraAnchor).chestY[id] as number);
      anchor[2] = tr.pz[id] as number;
      const frame = services.input ?? NEUTRAL_INPUT;
      const { yaw, pitch } = lookAngles(frame.camYaw, frame.camPitch);
      cam.allowedRight = allowedCameraDistance(backend, anchor, tpOffsetWorld(yaw, pitch, 1, offset));
      cam.allowedLeft = allowedCameraDistance(backend, anchor, tpOffsetWorld(yaw, pitch, -1, offset));
      cam.target = ecs.handle(id as EntityId);
    },
  };
}

/** What the sim puts in the snapshot side block under `cam`: the C04 directive plus the left-shoulder result. */
export interface PublishedCamera extends CameraDirective {
  allowedDistanceOpposite?: number;
}

/** The directive for the local player's tp camera, or null when no player is followed. */
export function publishedCamera(services: Pick<EngineServices, 'camera'>): PublishedCamera | null {
  const cam = services.camera;
  if (cam.target === 0) return null;
  if (cam.reason === 'vehicle') {
    return {
      mode: 'tp',
      follow: { ...VEHICLE_FOLLOW, target: cam.target, offset: [...VEHICLE_OFFSET] as CamVec3 },
      allowedDistance: cam.allowedRight,
      allowedDistanceOpposite: cam.allowedLeft,
      lockPlayerToggle: cam.lockPlayerToggle,
      reason: 'vehicle',
    };
  }
  return {
    mode: 'tp',
    follow: { ...DEFAULT_TP_FOLLOW, target: cam.target, offset: [...TP_OFFSET] as CamVec3 },
    allowedDistance: cam.allowedRight,
    allowedDistanceOpposite: cam.allowedLeft,
    lockPlayerToggle: cam.lockPlayerToggle,
    reason: cam.reason,
  };
}

