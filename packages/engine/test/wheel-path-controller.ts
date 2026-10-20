/**
 * TEST-ONLY since the ADR-0031 decision: `castray` ships and the vehicle system cannot reach this file. It stays so that
 * `wheel-spike.spec.ts` can re-run the comparison.
 *
 * The wheel path over Rapier's `DynamicRayCastVehicleController` (M03a2 spike candidate). The controller casts the rays and
 * carries the suspension; the tyre forces of `stepHandling` reach the body as external impulses at the hubs (the controller's
 * own engine, brake and side friction are off: they would count the grip twice).
 *
 * Per-wheel data comes from `PhysicsBackend.vehicle.read`. Slots the controller cannot give are NaN (wheel-point velocity);
 * this adapter then derives vLong and vLat from the body kinematics, and counts the NaN slots for the spike report.
 */
import { dcos, dsin, dsqrt, GRAVITY, PI, type HandlingOutput, type WheelContact } from '@dv/shared';
import { VEHICLE_READ_STRIDE, type Vec3, type VehiclePhysics, type WheelDesc } from '../src/sim/physics/backend.ts';
import { wheelAnchors, type WheelContacts, type WheelPath, type WheelVehicle } from '../src/sim/vehicle/wheel-path.ts';

interface ControllerState {
  id: number;
  buf: Float32Array;
}

export class ControllerWheelPath implements WheelPath {
  private readonly states = new Map<WheelVehicle, ControllerState>();
  private readonly at: Vec3 = [0, 0, 0];
  private readonly imp: Vec3 = [0, 0, 0];
  private readonly arb = [0, 0, 0, 0];
  /** NaN slots seen in the last `vehicle.read` (of 44). */
  nanSlots = 0;
  /** `vehicle.read` slots per vehicle. */
  readonly slots = 4 * VEHICLE_READ_STRIDE;

  constructor(private readonly backend: VehiclePhysics) {}

  attach(v: WheelVehicle): void {
    const p = v.rt.profile;
    const anchors = wheelAnchors(p);
    const w = 2 * PI * p.suspension.rideHz;
    // Rapier's spring is stiffness * (rest - length) * chassis mass; the handling spring carries the static load at restM.
    // A rest length of restM + g / w^2 puts the equilibrium at restM.
    const sag = GRAVITY / (w * w);
    const wheels: WheelDesc[] = anchors.map((a, k) => ({
      pos: [a[0], a[1], a[2]], radius: p.drive.wheelRadiusM, restM: p.suspension.restM + sag, axle: k < 2 ? 'front' : 'rear',
    }));
    const id = this.backend.vehicle.create(v.body, wheels);
    const front = p.frontWeightPct / 100;
    const corner = [front / 2, front / 2, (1 - front) / 2, (1 - front) / 2];
    this.backend.tuneVehicle(id, {
      stiffness: corner.map((f) => f * w * w),
      compression: corner.map((f) => 2 * p.suspension.dampingRatio * w * f),
      relaxation: corner.map((f) => 2 * p.suspension.dampingRatio * w * f),
      maxTravelM: sag + p.suspension.travelM,
      maxForceN: 1e7,
      sideFriction: 0,
      frictionSlip: 0,
    });
    this.states.set(v, { id, buf: new Float32Array(4 * VEHICLE_READ_STRIDE) });
  }

  detach(v: WheelVehicle): void {
    this.states.delete(v);
  }

  readContacts(v: WheelVehicle, contacts: WheelContacts): void {
    const st = this.states.get(v);
    if (!st) throw new Error('ControllerWheelPath: vehicle not attached');
    const rt = v.rt;
    const p = rt.profile;
    const b = v.pose;
    const dt = v.dt;
    const anchors = wheelAnchors(p);
    const rest = p.suspension.restM;
    const travel = p.suspension.travelM;
    const landing = rt.landTicks > 0;
    const info = v.info;
    info.contacts = 0;
    info.bumpSpeed = 0;

    this.backend.vehicle.drive(st.id, { engineForce: 0, brake: 0, steerRad: rt.hs.steerRad, handbrake: false });
    this.backend.vehicle.read(st.id, st.buf);
    const buf = st.buf;
    let nan = 0;
    for (let i = 0; i < buf.length; i++) if (Number.isNaN(buf[i])) nan++;
    this.nanSlots = nan;

    const steer = rt.hs.steerRad;
    const sinS = dsin(steer);
    const cosS = dcos(steer);
    let nyAvg = 0;
    const comp = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const o = k * VEHICLE_READ_STRIDE;
      const a = anchors[k] as Vec3;
      const c = contacts[k] as WheelContact;
      const ax = b.px + b.rx * a[0] + b.ux * a[1] - b.fx * a[2];
      const ay = b.py + b.ry * a[0] + b.uy * a[1] - b.fy * a[2];
      const az = b.pz + b.rz * a[0] + b.uz * a[1] - b.fz * a[2];
      this.arb[k] = 0;
      if ((buf[o] as number) < 0.5) {
        c.inContact = false;
        c.loadN = 0;
        rt.susp[k] = Number.NaN;
        const hubLen = rest + travel;
        info.hub[k] = [ax - b.ux * hubLen, ay - b.uy * hubLen, az - b.uz * hubLen];
        continue;
      }
      const suspLen = buf[o + 7] as number;
      const prev = rt.susp[k] as number;
      const first = Number.isNaN(prev);
      const compVel = first ? 0 : (prev - suspLen) / dt;
      if (first) rt.landTicks = 12;
      rt.susp[k] = suspLen;
      const compression = rest - suspLen;
      comp[k] = compression;
      if (compression > travel && compVel > info.bumpSpeed) info.bumpSpeed = compVel;
      c.point[0] = buf[o + 1] as number; c.point[1] = buf[o + 2] as number; c.point[2] = buf[o + 3] as number;
      c.normal[0] = buf[o + 4] as number; c.normal[1] = buf[o + 5] as number; c.normal[2] = buf[o + 6] as number;
      c.suspLenM = suspLen;
      c.loadN = buf[o + 10] as number;
      c.inContact = true;
      c.surface = 0;
      info.contacts++;
      nyAvg += c.normal[1];
      info.hub[k] = [ax - b.ux * suspLen, ay - b.uy * suspLen, az - b.uz * suspLen];
    }
    void landing;

    // anti-roll bars: extra load moved between the wheels of an axle, applied as an external vertical impulse
    for (let axle = 0; axle < 2; axle++) {
      const l = axle * 2;
      const r = l + 1;
      const cl = contacts[l] as WheelContact;
      const cr = contacts[r] as WheelContact;
      if (!cl.inContact || !cr.inContact) continue;
      const m = (p.massKg * (axle === 0 ? p.frontWeightPct / 100 : 1 - p.frontWeightPct / 100)) / 2;
      const w = 2 * PI * p.suspension.rideHz;
      const arb = p.suspension.antiRoll * m * w * w * ((comp[l] as number) - (comp[r] as number));
      const dl = Math.max(-cl.loadN, arb);
      const dr = Math.max(-cr.loadN, -arb);
      this.arb[l] = dl; this.arb[r] = dr;
      cl.loadN += dl; cr.loadN += dr;
    }

    for (let k = 0; k < 4; k++) {
      const c = contacts[k] as WheelContact;
      if (!c.inContact) continue;
      const front = k < 2;
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
      const rx = hy * nz - hz * ny;
      const ry = hz * nx - hx * nz;
      const rz = hx * ny - hy * nx;
      v.fx[k] = hx; v.fy[k] = hy; v.fz[k] = hz;
      v.rx[k] = rx; v.ry[k] = ry; v.rz[k] = rz;
      const dx = c.point[0] - b.px; const dy = c.point[1] - b.py; const dz = c.point[2] - b.pz;
      const vx = b.vx + (b.wy * dz - b.wz * dy);
      const vy = b.vy + (b.wz * dx - b.wx * dz);
      const vz = b.vz + (b.wx * dy - b.wy * dx);
      c.vLong = vx * hx + vy * hy + vz * hz;
      c.vLat = vx * rx + vy * ry + vz * rz;
    }
    v.nyAvg = nyAvg;
  }

  apply(v: WheelVehicle, out: HandlingOutput): void {
    const b = v.pose;
    const dt = v.dt;
    const backend = this.backend;
    const info = v.info;
    for (let k = 0; k < 4; k++) {
      const c = v.contacts[k] as WheelContact;
      if (!c.inContact) continue;
      const wf = out.wheelForce[k] as { long: number; lat: number };
      const n = this.arb[k] as number;
      this.imp[0] = (b.ux * n + (v.fx[k] as number) * wf.long + (v.rx[k] as number) * wf.lat) * dt;
      this.imp[1] = (b.uy * n + (v.fy[k] as number) * wf.long + (v.ry[k] as number) * wf.lat) * dt;
      this.imp[2] = (b.uz * n + (v.fz[k] as number) * wf.long + (v.rz[k] as number) * wf.lat) * dt;
      const hub = info.hub[k] as [number, number, number];
      this.at[0] = hub[0]; this.at[1] = hub[1]; this.at[2] = hub[2];
      backend.applyImpulse(v.body, this.imp, this.at);
    }
    if (out.yawTorque !== 0) {
      const t = -out.yawTorque * dt;
      this.imp[0] = b.ux * t; this.imp[1] = b.uy * t; this.imp[2] = b.uz * t;
      backend.applyTorqueImpulse(v.body, this.imp);
    }
    const ap = out.airTorque[0];
    const ar = out.airTorque[2];
    if (ap !== 0 || ar !== 0) {
      this.imp[0] = (b.rx * ap + b.fx * ar) * dt;
      this.imp[1] = (b.ry * ap + b.fy * ar) * dt;
      this.imp[2] = (b.rz * ap + b.fz * ar) * dt;
      backend.applyTorqueImpulse(v.body, this.imp);
    }
  }
}
