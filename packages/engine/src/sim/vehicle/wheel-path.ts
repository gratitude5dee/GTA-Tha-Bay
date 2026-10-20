/**
 * The wheel-force seam (M03a2, U-RAC-1): how per-wheel contact data reaches S06's `stepHandling` and how its `WheelForce`
 * reaches the body. Two implementations were built and measured; `SELECTED_WHEEL_PATH` (shared) names the one that ships
 * (docs/decisions/ADR-0031-vehicle-wheel-force-path.md). The vehicle system talks to the seam only.
 *
 * Body frame: +X right, +Y up, +Z back; forward is -Z. Wheel order: FL, FR, RL, RR.
 * Sim code under the C02 lint.
 */
import type { HandlingOutput, HandlingProfile, WheelContact } from '@dv/shared';
import type { Vec3 } from '../physics/backend.ts';
import type { VehicleRuntime } from './components.ts';

export interface BodyPose {
  px: number; py: number; pz: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
  wx: number; wy: number; wz: number;
  /** Unit axes in world space. */
  rx: number; ry: number; rz: number;
  ux: number; uy: number; uz: number;
  /** Forward (-Z local). */
  fx: number; fy: number; fz: number;
}

export function newPose(): BodyPose {
  return {
    px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
    rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: -1,
  };
}

/** Fills `p` from a `readBody` buffer: position, orientation, velocities and the three world-space axes. */
export function loadPose(p: BodyPose, b: Float64Array): void {
  p.px = b[0] as number; p.py = b[1] as number; p.pz = b[2] as number;
  const x = (p.qx = b[3] as number);
  const y = (p.qy = b[4] as number);
  const z = (p.qz = b[5] as number);
  const w = (p.qw = b[6] as number);
  p.vx = b[7] as number; p.vy = b[8] as number; p.vz = b[9] as number;
  p.wx = b[10] as number; p.wy = b[11] as number; p.wz = b[12] as number;
  p.rx = 1 - 2 * (y * y + z * z);
  p.ry = 2 * (x * y + w * z);
  p.rz = 2 * (x * z - w * y);
  p.ux = 2 * (x * y - w * z);
  p.uy = 1 - 2 * (x * x + z * z);
  p.uz = 2 * (y * z + w * x);
  p.fx = -2 * (x * z + w * y);
  p.fy = -2 * (y * z - w * x);
  p.fz = -(1 - 2 * (x * x + y * y));
}

/** Local wheel anchors (top of the suspension, body frame) in FL, FR, RL, RR order. */
export function wheelAnchors(p: HandlingProfile): [Vec3, Vec3, Vec3, Vec3] {
  const front = p.wheelbaseM * (1 - p.frontWeightPct / 100);
  const rear = p.wheelbaseM * (p.frontWeightPct / 100);
  const half = p.trackM / 2;
  const y = p.drive.wheelRadiusM + p.suspension.restM - p.cgHeightM;
  return [[-half, y, -front], [half, y, -front], [-half, y, rear], [half, y, rear]];
}

/** What one substep learned that the vehicle system needs. */
export interface SubstepInfo {
  contacts: number;
  /** Largest suspension compression speed that hit the bump stop, m/s (0 when none did). */
  bumpSpeed: number;
  /** World position of each wheel hub. */
  hub: [number, number, number][];
  out: HandlingOutput | null;
}

export type WheelContacts = [WheelContact, WheelContact, WheelContact, WheelContact];

export function newContact(): WheelContact {
  return { inContact: false, point: [0, 0, 0], normal: [0, 1, 0], suspLenM: 0, vLong: 0, vLat: 0, loadN: 0, surface: 0 };
}

/** One vehicle as a wheel path sees it. The orchestrator owns it; `pose` is loaded before `readContacts`. */
export interface WheelVehicle {
  readonly rt: VehicleRuntime;
  readonly body: number;
  readonly pose: BodyPose;
  /** Substep length, s. */
  dt: number;
  readonly info: SubstepInfo;
  /** The four contacts of the substep: filled by `readContacts`, read by `apply`. */
  readonly contacts: WheelContacts;
  /** Mean ground normal y over the wheels in contact (for the grade). */
  nyAvg: number;
  /** Per wheel: steered heading (f*) and lateral axis (r*) in world space, set by `readContacts`. */
  readonly fx: number[]; readonly fy: number[]; readonly fz: number[];
  readonly rx: number[]; readonly ry: number[]; readonly rz: number[];
}

export function newWheelVehicle(rt: VehicleRuntime, body: number): WheelVehicle {
  return {
    rt, body, pose: newPose(), dt: 0, nyAvg: 0,
    info: { contacts: 0, bumpSpeed: 0, hub: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], out: null },
    contacts: [newContact(), newContact(), newContact(), newContact()],
    fx: [0, 0, 0, 0], fy: [0, 0, 0, 0], fz: [0, 0, 0, 0], rx: [0, 0, 0, 0], ry: [0, 0, 0, 0], rz: [0, 0, 0, 0],
  };
}

export interface WheelPath {
  /** Called once per vehicle before its first substep. */
  attach(v: WheelVehicle): void;
  /** Fills `out` (the vehicle's four contacts) for this substep; sets `v.info.contacts`, `bumpSpeed`, `hub`, `nyAvg` and the wheel frames. */
  readContacts(v: WheelVehicle, out: WheelContacts): void;
  /** Gets the handling output into the body (impulses, torques or controller inputs). */
  apply(v: WheelVehicle, o: HandlingOutput): void;
  /** Called when the vehicle goes away. */
  detach(v: WheelVehicle): void;
}
