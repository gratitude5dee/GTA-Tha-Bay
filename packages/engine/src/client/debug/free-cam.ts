import type { ControlId, InputContextId } from '@dv/shared';
import { PITCH_LIMIT } from '../input/defaults.ts';
import type { CameraLike } from '../camera/rig.ts';

/** Free cam speeds, metres per second (01-engine.md section 2.11, M01b2). */
export const FREE_CAM_SPEED = 10;
export const FREE_CAM_FAST = 40;

/** The router members the free cam uses. */
export interface FreeCamRouter {
  push(ctx: InputContextId): void;
  pop(ctx: InputContextId): void;
  readonly raw: { readonly controls: ReadonlyMap<ControlId, number> };
}

export interface FreeCamOptions {
  router: FreeCamRouter;
  camera: CameraLike;
  /** Sets the camera's position and quaternion from the pose (the same maths as the rig). */
  onToggle?: (active: boolean) => void;
}

/**
 * A detached camera for QA builds (F4). While it is on, the router's `debug` context is pushed, so the on-foot bindings stop
 * feeding the sim and the player stands still; the sim keeps running. WASD move along the view direction's horizontal
 * plane, Space and Q/E go up and down, Shift multiplies the speed by four. Look comes from the router: `look` is the object
 * the page passes to `applyLook` while the free cam is on.
 */
export class FreeCam {
  active = false;
  readonly look = { yaw: 0, pitch: 0 };
  readonly pos: [number, number, number] = [0, 0, 0];

  constructor(private readonly opts: FreeCamOptions) {}

  /** Switches on from the given pose (the current camera), or off. Returns the new state. */
  toggle(from?: { pos: readonly [number, number, number]; yaw: number; pitch: number }): boolean {
    this.active = !this.active;
    if (this.active) {
      if (from) {
        this.pos[0] = from.pos[0];
        this.pos[1] = from.pos[1];
        this.pos[2] = from.pos[2];
        this.look.yaw = from.yaw;
        this.look.pitch = from.pitch;
      }
      this.opts.router.push('debug');
    } else {
      this.opts.router.pop('debug');
    }
    this.opts.onToggle?.(this.active);
    return this.active;
  }

  private held(code: string): boolean {
    return (this.opts.router.raw.controls.get(`key:${code}` as ControlId) ?? 0) > 0.5;
  }

  /** Moves the camera by the keys held now. Call once per render frame after the router sampled. */
  update(dtSec: number): void {
    if (!this.active) return;
    const speed = this.held('ShiftLeft') || this.held('ShiftRight') ? FREE_CAM_FAST : FREE_CAM_SPEED;
    const f = (this.held('KeyW') ? 1 : 0) - (this.held('KeyS') ? 1 : 0);
    const r = (this.held('KeyD') ? 1 : 0) - (this.held('KeyA') ? 1 : 0);
    const u = (this.held('Space') || this.held('KeyE') ? 1 : 0) - (this.held('KeyQ') ? 1 : 0);
    // View basis (C03): forward = (-sin yaw cos pitch, sin pitch, -cos yaw cos pitch), right = (cos yaw, 0, -sin yaw).
    const { yaw, pitch } = this.look;
    const cp = Math.cos(pitch);
    const fx = -Math.sin(yaw) * cp;
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * cp;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const d = speed * Math.max(0, dtSec);
    this.pos[0] += (fx * f + rx * r) * d;
    this.pos[1] += (fy * f + u) * d;
    this.pos[2] += (fz * f + rz * r) * d;
    this.look.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.look.pitch));
    this.apply();
  }

  /** Writes the pose into the camera. */
  apply(): void {
    const cam = this.opts.camera;
    cam.position.set(this.pos[0], this.pos[1], this.pos[2]);
    const sy = Math.sin(this.look.yaw / 2);
    const cy = Math.cos(this.look.yaw / 2);
    const sp = Math.sin(this.look.pitch / 2);
    const cp = Math.cos(this.look.pitch / 2);
    cam.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
  }
}
