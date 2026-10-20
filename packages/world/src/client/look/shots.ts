/**
 * Look shots (M02e): fixed camera, hour and weather for the goldens and the before/after capture. The list is
 * `config/world/look-shots.json`; `__dvBridge.world.shot(id)` applies one. Pure data here: the camera pose maths and the lookup.
 */
import shotsJson from '../../../../../config/world/look-shots.json';
import type { WeatherPreset } from '@dv/shared';

export interface LookShot {
  id: string;
  /** ENU metres; `y` is the camera height above the ground under it (the bridge adds the terrain height once the chunk is resident). */
  x: number;
  y: number;
  z: number;
  yawDeg: number;
  pitchDeg: number;
  fovDeg: number;
  hour: number;
  weather: WeatherPreset;
}

export const LOOK_SHOTS: readonly LookShot[] = (shotsJson as unknown as { shots: LookShot[] }).shots;

export function lookShot(id: string): LookShot {
  const s = LOOK_SHOTS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown look shot ${id}: ${LOOK_SHOTS.map((x) => x.id).join(', ')}`);
  return s;
}

const DEG = Math.PI / 180;

/** The camera quaternion of a yaw and pitch in the C03 convention (forward = -sin yaw cos pitch, sin pitch, -cos yaw cos pitch). */
export function shotQuaternion(yawDeg: number, pitchDeg: number): [number, number, number, number] {
  const sy = Math.sin((yawDeg * DEG) / 2), cy = Math.cos((yawDeg * DEG) / 2);
  const sp = Math.sin((pitchDeg * DEG) / 2), cp = Math.cos((pitchDeg * DEG) / 2);
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

/** The unit view direction of a shot. */
export function shotDirection(yawDeg: number, pitchDeg: number): [number, number, number] {
  const cp = Math.cos(pitchDeg * DEG);
  return [-Math.sin(yawDeg * DEG) * cp, Math.sin(pitchDeg * DEG), -Math.cos(yawDeg * DEG) * cp];
}
