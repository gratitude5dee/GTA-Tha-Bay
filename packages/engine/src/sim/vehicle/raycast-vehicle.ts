/**
 * The own ray-cast vehicle (01-engine.md 2.4, DL-104): four suspension rays per car against the static colliders
 * (`castRay`), contact data into S06's `stepHandling`, its `WheelForce` applied as impulses at the hub with
 * `applyImpulse`. Rapier's `DynamicRayCastVehicleController.drive()` is not used. The U-RAC-1 spike (M03a2) decides whether
 * this force path or a different one ships.
 *
 * Body frame: +X right, +Y up, +Z back; forward is -Z. Wheel order: FL, FR, RL, RR.
 *
 * Sim code under the C02 lint: detmath only.
 */
import {
  datan2, dcos, dsin, dsqrt, PI, stepHandling, suspensionForce,
  type BodyKin, type HandlingInput, type HandlingOutput, type HandlingProfile, type HandlingState, type WheelContact,
} from '@dv/shared';
import type { Vec3, VehiclePhysics } from '../physics/backend.ts';
import { GROUP_BIT } from '../physics/groups.ts';
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

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export class RaycastVehicleSim {
  private readonly buf = new Float64Array(13);
  private readonly pose = newPose();
  private readonly contacts: [WheelContact, WheelContact, WheelContact, WheelContact] = [this.mk(), this.mk(), this.mk(), this.mk()];
  private readonly origin: Vec3 = [0, 0, 0];
  private readonly dir: Vec3 = [0, -1, 0];
  private readonly at: Vec3 = [0, 0, 0];
  private readonly imp: Vec3 = [0, 0, 0];
  private readonly wfx = [0, 0, 0, 0];
  private readonly wfy = [0, 0, 0, 0];
  private readonly wfz = [0, 0, 0, 0];
  private readonly wrx = [0, 0, 0, 0];
  private readonly wry = [0, 0, 0, 0];
  private readonly wrz = [0, 0, 0, 0];
  private readonly comp = [0, 0, 0, 0];
  private readonly spring = [0, 0, 0, 0];
  readonly info: SubstepInfo = { contacts: 0, bumpSpeed: 0, hub: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], out: null };

  constructor(private readonly backend: VehiclePhysics) {}

  private mk(): WheelContact {
    return { inContact: false, point: [0, 0, 0], normal: [0, 1, 0], suspLenM: 0, vLong: 0, vLat: 0, loadN: 0, surface: 0 };
  }

  /** Pose read by the last `step`. */
  get lastPose(): BodyPose {
    return this.pose;
  }

  /**
   * One handling substep of one vehicle: cast the four rays, build the contacts, run `stepHandling`, apply the impulses.
   * `dt` is SIM_DT or SIM_DT / 2.
   */
  step(rt: VehicleRuntime, body: number, input: HandlingInput, dt: number, engineHealth: number, tireHealth: readonly number[]): SubstepInfo {
    const p = rt.profile;
    const hs: HandlingState = rt.hs;
    hs.engineHealth = engineHealth;
    for (let k = 0; k < 4; k++) hs.tireHealth[k] = tireHealth[k] as number;
    const backend = this.backend;
    backend.readBody(body, this.buf);
    const b = this.pose;
    loadPose(b, this.buf);
    const anchors = wheelAnchors(p);
    const r = p.drive.wheelRadiusM;
    const rest = p.suspension.restM;
    const travel = p.suspension.travelM;
    const rayLen = rest + travel + r;
    const landing = rt.landTicks > 0;
    const info = this.info;
    info.contacts = 0;
    info.bumpSpeed = 0;

    const steer = hs.steerRad;
    const sinS = dsin(steer);
    const cosS = dcos(steer);
    let nyAvg = 0;

    for (let k = 0; k < 4; k++) {
      const a = anchors[k] as Vec3;
      const c = this.contacts[k] as WheelContact;
      // world anchor: right * x + up * y + back * z  (back = -forward)
      const ax = b.px + b.rx * a[0] + b.ux * a[1] - b.fx * a[2];
      const ay = b.py + b.ry * a[0] + b.uy * a[1] - b.fy * a[2];
      const az = b.pz + b.rz * a[0] + b.uz * a[1] - b.fz * a[2];
      this.origin[0] = ax; this.origin[1] = ay; this.origin[2] = az;
      this.dir[0] = -b.ux; this.dir[1] = -b.uy; this.dir[2] = -b.uz;
      const hit = backend.castRay(this.origin, this.dir, rayLen, GROUP_BIT.static);
      if (!hit) {
        c.inContact = false;
        c.loadN = 0;
        rt.susp[k] = Number.NaN;
        const hubLen = rest + travel;
        info.hub[k] = [ax - b.ux * hubLen, ay - b.uy * hubLen, az - b.uz * hubLen];
        continue;
      }
      const suspLen = hit.toi - r;
      const prev = rt.susp[k] as number;
      const first = Number.isNaN(prev);
      const compVel = first ? 0 : (prev - suspLen) / dt;
      if (first) rt.landTicks = 12;
      rt.susp[k] = suspLen;
      const compression = rest - suspLen;
      this.comp[k] = compression;
      this.spring[k] = suspensionForce(p, k, compression, compVel, landing || first);
      if (compression > travel && compVel > info.bumpSpeed) info.bumpSpeed = compVel;
      // contact point and normal
      const px = ax - b.ux * hit.toi;
      const py = ay - b.uy * hit.toi;
      const pz = az - b.uz * hit.toi;
      c.point[0] = px; c.point[1] = py; c.point[2] = pz;
      c.normal[0] = hit.normal[0]; c.normal[1] = hit.normal[1]; c.normal[2] = hit.normal[2];
      c.suspLenM = suspLen;
      c.inContact = true;
      c.surface = 0;
      info.contacts++;
      nyAvg += hit.normal[1];
      info.hub[k] = [ax - b.ux * suspLen, ay - b.uy * suspLen, az - b.uz * suspLen];
    }

    // anti-roll bars move load between the wheels of an axle
    for (let axle = 0; axle < 2; axle++) {
      const l = axle * 2;
      const rgt = l + 1;
      if (!(this.contacts[l] as WheelContact).inContact || !(this.contacts[rgt] as WheelContact).inContact) continue;
      const m = (p.massKg * (axle === 0 ? p.frontWeightPct / 100 : 1 - p.frontWeightPct / 100)) / 2;
      const w = 2 * PI * p.suspension.rideHz;
      const arb = p.suspension.antiRoll * m * w * w * ((this.comp[l] as number) - (this.comp[rgt] as number));
      this.spring[l] = Math.max(0, (this.spring[l] as number) + arb);
      this.spring[rgt] = Math.max(0, (this.spring[rgt] as number) - arb);
    }

    // wheel frames and speeds
    for (let k = 0; k < 4; k++) {
      const c = this.contacts[k] as WheelContact;
      if (!c.inContact) continue;
      c.loadN = this.spring[k] as number;
      const front = k < 2;
      // steered heading: forward * cos + right * sin (positive steer turns right)
      let hx = b.fx; let hy = b.fy; let hz = b.fz;
      if (front) {
        hx = b.fx * cosS + b.rx * sinS;
        hy = b.fy * cosS + b.ry * sinS;
        hz = b.fz * cosS + b.rz * sinS;
      }
      const nx = c.normal[0]; const ny = c.normal[1]; const nz = c.normal[2];
      const d = hx * nx + hy * ny + hz * nz;
      hx -= nx * d; hy -= ny * d; hz -= nz * d;
      const len = dsqrt(hx * hx + hy * hy + hz * hz) || 1;
      hx /= len; hy /= len; hz /= len;
      // right = forward x normal
      const rx = hy * nz - hz * ny;
      const ry = hz * nx - hx * nz;
      const rz = hx * ny - hy * nx;
      this.wfx[k] = hx; this.wfy[k] = hy; this.wfz[k] = hz;
      this.wrx[k] = rx; this.wry[k] = ry; this.wrz[k] = rz;
      // velocity at the contact point: v + w x (point - pos)
      const dx = c.point[0] - b.px; const dy = c.point[1] - b.py; const dz = c.point[2] - b.pz;
      const vx = b.vx + (b.wy * dz - b.wz * dy);
      const vy = b.vy + (b.wz * dx - b.wx * dz);
      const vz = b.vz + (b.wx * dy - b.wy * dx);
      c.vLong = vx * hx + vy * hy + vz * hz;
      c.vLat = vx * rx + vy * ry + vz * rz;
    }

    // body kinematics
    const speed = dsqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
    const horiz = dsqrt(b.vx * b.vx + b.vz * b.vz);
    const kin: BodyKin = {
      vLong: b.vx * b.fx + b.vy * b.fy + b.vz * b.fz,
      vLat: b.vx * b.rx + b.vy * b.ry + b.vz * b.rz,
      yawRate: -(b.wx * b.ux + b.wy * b.uy + b.wz * b.uz),
      speedMps: speed,
      upY: b.uy,
      airborneTicks: rt.airTicks,
      grade: info.contacts > 0 ? gradeOf(nyAvg / info.contacts) : 0,
      pitch: datan2(b.fy, dsqrt(b.fx * b.fx + b.fz * b.fz)),
      roll: datan2(-b.ry, b.uy),
      pitchRate: b.wx * b.rx + b.wy * b.ry + b.wz * b.rz,
      rollRate: b.wx * b.fx + b.wy * b.fy + b.wz * b.fz,
      flightPitch: datan2(b.vy, horiz > 0.5 ? horiz : 0.5),
    };

    const out = stepHandling(p, hs, input, this.contacts, kin, dt);
    info.out = out;

    // impulses at the hubs
    for (let k = 0; k < 4; k++) {
      const c = this.contacts[k] as WheelContact;
      if (!c.inContact) continue;
      const wf = out.wheelForce[k] as { long: number; lat: number };
      const n = c.loadN;
      const jx = (b.ux * n + (this.wfx[k] as number) * wf.long + (this.wrx[k] as number) * wf.lat) * dt;
      const jy = (b.uy * n + (this.wfy[k] as number) * wf.long + (this.wry[k] as number) * wf.lat) * dt;
      const jz = (b.uz * n + (this.wfz[k] as number) * wf.long + (this.wrz[k] as number) * wf.lat) * dt;
      this.imp[0] = jx; this.imp[1] = jy; this.imp[2] = jz;
      const hub = info.hub[k] as [number, number, number];
      this.at[0] = hub[0]; this.at[1] = hub[1]; this.at[2] = hub[2];
      backend.applyImpulse(body, this.imp, this.at);
    }
    // yaw torque is positive to the right: clockwise seen from above is -up
    if (out.yawTorque !== 0) {
      const t = -out.yawTorque * dt;
      this.imp[0] = b.ux * t; this.imp[1] = b.uy * t; this.imp[2] = b.uz * t;
      backend.applyTorqueImpulse(body, this.imp);
    }
    const ap = out.airTorque[0];
    const ar = out.airTorque[2];
    if (ap !== 0 || ar !== 0) {
      this.imp[0] = (b.rx * ap + b.fx * ar) * dt;
      this.imp[1] = (b.ry * ap + b.fy * ar) * dt;
      this.imp[2] = (b.rz * ap + b.fz * ar) * dt;
      backend.applyTorqueImpulse(body, this.imp);
    }

    return info;
  }
}

function gradeOf(ny: number): number {
  const n = clamp(ny, 0.05, 1);
  return dsqrt(1 - n * n) / n;
}
