import type { InputFrame } from '@dv/shared';
import type { ControlShared } from '../services.ts';

/**
 * The water-respawn movement latch and the inland facing (DL-753; 02-world-maps.md 4.1 a). Sim code under the C02 lint.
 *
 * When the water puts the local player back on the shore (on foot: the swim respawn; in a vehicle with the player aboard: the 1.5 s
 * stall), the movement input is latched: the owner that reads the stick treats every movement axis as centred until a tick whose
 * InputFrame has all of them at zero (the stick back in its dead zone, every movement key and touch button released). So a press held
 * through the fade never walks or drives the player straight back into the water. The latch lives in `ControlShared`, which is hashed
 * and checkpointed with the `control` resource, and is cleared only by the input the sim reads: no wall clock.
 *
 * `respawnSeq` counts the water respawns of the session and `respawnYaw` is the inland yaw of the last one (forward is
 * (-sin yaw, -cos yaw), along the shore node's normal away from the water). The page turns its camera to that yaw when it sees a new
 * `respawnSeq` in the player side block; the sim itself never reads them.
 */

/** True when the frame moves nothing: no walk stick, no throttle, brake or steer (every context's movement axes). */
export function movementCentred(f: Readonly<InputFrame>): boolean {
  return f.moveX === 0 && f.moveY === 0 && f.throttle === 0 && f.brake === 0 && f.steer === 0;
}

/** Arms the latch: the water took the player and a respawn has begun (the fade out). */
export function armMoveLatch(c: ControlShared): void {
  c.moveLatch = true;
}

/**
 * Called by the owner that reads the local player's movement input, once the player is back under its control. A centred frame
 * releases the latch. Returns true while the frame's movement must be ignored.
 */
export function moveLatched(c: ControlShared, f: Readonly<InputFrame>): boolean {
  if (!c.moveLatch) return false;
  if (movementCentred(f)) {
    c.moveLatch = false;
    return false;
  }
  return true;
}

/** Records a finished water respawn facing `yaw` (inland), for the page's camera. */
export function noteWaterRespawn(c: ControlShared, yaw: number): void {
  c.respawnSeq = (c.respawnSeq + 1) >>> 0;
  c.respawnYaw = yaw;
}

