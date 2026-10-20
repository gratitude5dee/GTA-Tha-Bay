/**
 * The own ray-cast wheel path (01-engine.md 2.4, DL-104): four suspension rays per car against the static colliders
 * (`castRay`), contact data into S06's `stepHandling`, its `WheelForce` applied as impulses at the hub with `applyImpulse`.
 * Rapier's `DynamicRayCastVehicleController.drive()` is not used (ADR-0031).
 *
 * Sim code under the C02 lint: detmath only.
 */
import { dcos, dsin, dsqrt, PI, suspensionForce, type HandlingOutput, type WheelContact } from '@dv/shared';
import type { Vec3, VehiclePhysics } from '../physics/backend.ts';
import { GROUP_BIT } from '../physics/groups.ts';
import { wheelAnchors, type WheelContacts, type WheelPath, type WheelVehicle } from './wheel-path.ts';

export class CastrayWheelPath implements WheelPath {
  private readonly origin: Vec3 = [0, 0, 0];
  private readonly dir: Vec3 = [0, -1, 0];
  private readonly at: Vec3 = [0, 0, 0];
  private readonly imp: Vec3 = [0, 0, 0];
  private readonly comp = [0, 0, 0, 0];
  private readonly spring = [0, 0, 0, 0];

  constructor(private readonly backend: VehiclePhysics) {}

  attach(): void {}
  detach(): void {}

  readContacts(v: WheelVehicle, contacts: WheelContacts): void {
    const rt = v.rt;
    const p = rt.profile;
    const b = v.pose;
    const dt = v.dt;
    const backend = this.backend;
    const anchors = wheelAnchors(p);
    const r = p.drive.wheelRadiusM;
    const rest = p.suspension.restM;
    const travel = p.suspension.travelM;
    const rayLen = rest + travel + r;
    const landing = rt.landTicks > 0;
    const info = v.info;
    info.contacts = 0;
    info.bumpSpeed = 0;

    const steer = rt.hs.steerRad;
    const sinS = dsin(steer);
    const cosS = dcos(steer);
    let nyAvg = 0;

    for (let k = 0; k < 4; k++) {
      const a = anchors[k] as Vec3;
      const c = contacts[k] as WheelContact;
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
      if (!(contacts[l] as WheelContact).inContact || !(contacts[rgt] as WheelContact).inContact) continue;
      const m = (p.massKg * (axle === 0 ? p.frontWeightPct / 100 : 1 - p.frontWeightPct / 100)) / 2;
      const w = 2 * PI * p.suspension.rideHz;
      const arb = p.suspension.antiRoll * m * w * w * ((this.comp[l] as number) - (this.comp[rgt] as number));
      this.spring[l] = Math.max(0, (this.spring[l] as number) + arb);
      this.spring[rgt] = Math.max(0, (this.spring[rgt] as number) - arb);
    }

    // wheel frames and speeds
    for (let k = 0; k < 4; k++) {
      const c = contacts[k] as WheelContact;
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
      v.fx[k] = hx; v.fy[k] = hy; v.fz[k] = hz;
      v.rx[k] = rx; v.ry[k] = ry; v.rz[k] = rz;
      // velocity at the contact point: v + w x (point - pos)
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
    // impulses at the hubs
    for (let k = 0; k < 4; k++) {
      const c = v.contacts[k] as WheelContact;
      if (!c.inContact) continue;
      const wf = out.wheelForce[k] as { long: number; lat: number };
      const n = c.loadN;
      const jx = (b.ux * n + (v.fx[k] as number) * wf.long + (v.rx[k] as number) * wf.lat) * dt;
      const jy = (b.uy * n + (v.fy[k] as number) * wf.long + (v.ry[k] as number) * wf.lat) * dt;
      const jz = (b.uz * n + (v.fz[k] as number) * wf.long + (v.rz[k] as number) * wf.lat) * dt;
      this.imp[0] = jx; this.imp[1] = jy; this.imp[2] = jz;
      const hub = info.hub[k] as [number, number, number];
      this.at[0] = hub[0]; this.at[1] = hub[1]; this.at[2] = hub[2];
      backend.applyImpulse(v.body, this.imp, this.at);
    }
    // yaw torque is positive to the right: clockwise seen from above is -up
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
