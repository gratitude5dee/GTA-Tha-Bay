/**
 * One handling substep of one vehicle (01-engine.md 2.4, DL-104): read the body, let the wheel path fill the four
 * `WheelContact`s, run S06's `stepHandling`, hand its output back to the wheel path. The wheel path is the U-RAC-1 seam
 * (`wheel-path.ts`); the shipped one is named by `SELECTED_WHEEL_PATH` (ADR-0031).
 *
 * Body frame: +X right, +Y up, +Z back; forward is -Z. Wheel order: FL, FR, RL, RR.
 *
 * Sim code under the C02 lint: detmath only.
 */
import {
  datan2, dsqrt, SELECTED_WHEEL_PATH, stepHandling,
  type BodyKin, type WheelPathName, type HandlingInput, type HandlingState, type WheelContact,
} from '@dv/shared';
import type { VehiclePhysics } from '../physics/backend.ts';
import type { VehicleRuntime } from './components.ts';
import { CastrayWheelPath } from './wheel-path-castray.ts';
import { loadPose, newWheelVehicle, type BodyPose, type SubstepInfo, type WheelPath, type WheelVehicle } from './wheel-path.ts';

export { loadPose, newPose, wheelAnchors, type BodyPose, type SubstepInfo } from './wheel-path.ts';

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** The wheel path that ships. A test or the spike harness may pass its own to `RaycastVehicleSim`. */
export function selectedWheelPath(backend: VehiclePhysics): WheelPath {
  // Only the selected implementation has code in src (ADR-0031); the type check below fails if the constant moves.
  const selected: WheelPathName = SELECTED_WHEEL_PATH;
  if (selected !== 'castray') throw new Error(`wheel path ${selected} has no implementation in src`);
  return new CastrayWheelPath(backend);
}

export class RaycastVehicleSim {
  private readonly buf = new Float64Array(13);
  private readonly vehicles = new Map<number, WheelVehicle>();
  private lastVehicle: WheelVehicle | null = null;
  readonly path: WheelPath;

  constructor(private readonly backend: VehiclePhysics, path?: WheelPath) {
    this.path = path ?? selectedWheelPath(backend);
  }

  /** Pose read by the last `step`. */
  get lastPose(): BodyPose {
    const v = this.lastVehicle;
    if (!v) throw new Error('RaycastVehicleSim.lastPose read before the first step');
    return v.pose;
  }

  /** Drops the wheel path's state for the vehicle on `body`. */
  release(body: number): void {
    const v = this.vehicles.get(body);
    if (!v) return;
    this.path.detach(v);
    this.vehicles.delete(body);
  }

  /**
   * One handling substep of one vehicle: read the contacts, run `stepHandling`, apply the output. `dt` is SIM_DT or
   * SIM_DT / 2.
   */
  step(rt: VehicleRuntime, body: number, input: HandlingInput, dt: number, engineHealth: number, tireHealth: readonly number[]): SubstepInfo {
    let v = this.vehicles.get(body);
    if (!v || v.rt !== rt) {
      if (v) this.path.detach(v);
      v = newWheelVehicle(rt, body);
      this.vehicles.set(body, v);
      this.path.attach(v);
    }
    this.lastVehicle = v;
    const p = rt.profile;
    const hs: HandlingState = rt.hs;
    hs.engineHealth = engineHealth;
    for (let k = 0; k < 4; k++) hs.tireHealth[k] = tireHealth[k] as number;
    this.backend.readBody(body, this.buf);
    const b = v.pose;
    loadPose(b, this.buf);
    v.dt = dt;

    this.path.readContacts(v, v.contacts);
    const info = v.info;

    const speed = dsqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
    const horiz = dsqrt(b.vx * b.vx + b.vz * b.vz);
    const kin: BodyKin = {
      vLong: b.vx * b.fx + b.vy * b.fy + b.vz * b.fz,
      vLat: b.vx * b.rx + b.vy * b.ry + b.vz * b.rz,
      yawRate: -(b.wx * b.ux + b.wy * b.uy + b.wz * b.uz),
      speedMps: speed,
      upY: b.uy,
      airborneTicks: rt.airTicks,
      grade: info.contacts > 0 ? gradeOf(v.nyAvg / info.contacts) : 0,
      pitch: datan2(b.fy, dsqrt(b.fx * b.fx + b.fz * b.fz)),
      roll: datan2(-b.ry, b.uy),
      pitchRate: b.wx * b.rx + b.wy * b.ry + b.wz * b.rz,
      rollRate: b.wx * b.fx + b.wy * b.fy + b.wz * b.fz,
      flightPitch: datan2(b.vy, horiz > 0.5 ? horiz : 0.5),
    };

    const out = stepHandling(p, hs, input, v.contacts as [WheelContact, WheelContact, WheelContact, WheelContact], kin, dt);
    info.out = out;
    this.path.apply(v, out);
    return info;
  }
}

function gradeOf(ny: number): number {
  const n = clamp(ny, 0.05, 1);
  return dsqrt(1 - n * n) / n;
}
