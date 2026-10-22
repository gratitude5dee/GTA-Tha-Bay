/**
 * The shared vehicle handling model v1 (S06; 06-racing-data.md 4.1 and 06-racing-content.md C.3.0). Story driving
 * (M03a1) and racing (M07) call the same `stepHandling`.
 *
 * Pure per-step model, sim code under the C02 lint: `detmath` only, no `Math.sqrt`/`sin`/`pow`, no clock, no random.
 *
 * Frames. Body frame: +X right, +Y up, +Z back (forward is -Z, the engine's prefab convention). Wheel frame: `vLong`
 * is speed along the wheel's heading (forward positive), `vLat` across it (to the right positive). Steer angle and
 * `yawRate` are positive to the right (clockwise seen from above), so a right turn has positive steer and positive yaw
 * rate. `WheelForce` is in the same wheel frame, newtons.
 *
 * Division of work with the engine wrapper (`packages/engine/src/sim/vehicle`): the wrapper casts the suspension rays,
 * evaluates `suspensionForce` for the vertical load, fills `WheelContact`, calls `stepHandling` and applies the result as
 * impulses at the contact points. Nitro, drift assist, thrusterHop, the other quirks and the assists beyond steer assist
 * are typed and return neutral output (06-racing.md section 8, row M03a); M07a1 fills them.
 */
import { datan2, dcos, dsin, dsqrt, PI } from '../detmath.ts';
import { powerScale, tireGripScale } from './damage.ts';
import { nitroCeilingMps } from './envelope.ts';
import { findQuirk, governorThrottleScale } from './quirks.ts';

export const VEHICLE_SCHEMA = 1 as const;
export type VehicleClass = 'D' | 'C' | 'B' | 'A' | 'S' | 'R';
export type Drivetrain = 'FWD' | 'RWD' | 'AWD';
export type Difficulty = 'easy' | 'normal' | 'hard';

export type Quirk =
  | { k: 'speedGovernor'; kph: number; jailbreakItem?: string }
  | { k: 'autoYield'; radiusM: number }
  | { k: 'stallOnDarkSignal'; holdSec: [number, number] }
  | { k: 'thrusterHop'; deltaVy: number; charges: number; rechargeSec: number; coyoteSec: number }
  | { k: 'regenBraking'; nitroPerSec: number; minKph: number };

export interface HandlingProfile {
  schema: typeof VEHICLE_SCHEMA;
  /** 'hp.sedan' */
  id: string;
  /** +1 per tuning change; stored in replays. */
  rev: number;
  class: VehicleClass;
  /** Checked by ip:strings and names:lint. */
  fictionalMake: string;
  massKg: number;
  cgHeightM: number;
  wheelbaseM: number;
  trackM: number;
  frontWeightPct: number;
  engine: {
    idleRpm: number;
    redlineRpm: number;
    /** Ascending rpm, linear interpolation. */
    torque: readonly (readonly [rpm: number, nm: number])[];
    /** Declared; CI asserts within 3 % of max(T*omega). */
    powerKw: number;
  };
  drive: {
    type: Drivetrain;
    gears: readonly number[];
    reverse: number;
    finalDrive: number;
    efficiency: number;
    wheelRadiusM: number;
    /** Of redline; auto gearbox only (arcade). */
    shiftUpPct: number;
    shiftDownPct: number;
    shiftTimeSec: number;
    /** 0..1, AWD only. */
    awdRearBias: number;
  };
  tire: {
    muLong: number;
    muLat: number;
    /** Peak of the lateral curve. */
    peakSlipDeg: number;
    /** Plateau (0.78) reached at x = slip/peak = slideAtX (2.5). */
    slideRatio: number;
    slideAtX: number;
    /** 0..0.3: mu falls as load rises. */
    loadSens: number;
    frontGrip: number;
    rearGrip: number;
    rollResistN: number;
  };
  aero: { cdA: number; downforceNPerMps2: number };
  steer: { lockDeg: number; speedRefMps: number; minLockPct: number; rateDegPerS: number; assist: number; selfAlign: number };
  brake: { maxDecelG: number; bias: number; abs: boolean };
  drift: { assist: number; handbrakeRearGrip: number; yawDamp: number };
  suspension: {
    restM: number;
    travelM: number;
    rideHz: number;
    dampingRatio: number;
    antiRoll: number;
    landingDamp: number;
    airPitchTrim: number;
    airRollTrim: number;
  };
  nitro: {
    capacity: number;
    boostKw: number;
    drainPerSec: number;
    minToFire: number;
    maxOverTopPct: number;
    refill: { driftPerSec: number; nearMiss: number; draftPerSec: number; airPerSec: number };
  };
  /** Divisor in damage formulas, class-scaled. */
  durability: number;
  quirks?: readonly Quirk[];
}

/** Per-class envelope. Content CI and the vehicle-mod validator reject any profile outside it (D-S06-08). Numbers: `envelope.ts`. */
export interface ClassEnvelope {
  class: VehicleClass;
  massKg: [number, number];
  powerKw: [number, number];
  muLat: [number, number];
  topKph: [number, number];
  zeroTo100Sec: [number, number];
  piBand: [number, number];
}

// ---- pure per-step model (sim code: detmath only, no Math.sqrt/sin/pow) -------------------------------------------
export interface WheelContact {
  inContact: boolean;
  point: [number, number, number];
  normal: [number, number, number];
  suspLenM: number;
  vLong: number;
  vLat: number;
  loadN: number;
  /** 0 asphalt, 1 wet (rain preset), 2 loose (grating, tram rail). */
  surface: 0 | 1 | 2;
}

/**
 * Body kinematics. `pitch`, `roll`, `pitchRate`, `rollRate` and `flightPitch` are optional additions to the S06 shape
 * (BD-M03a1-03): the air trim needs the body's attitude, which the shape listed no field for. Pitch is nose-up positive,
 * roll is right-side-down positive, `flightPitch` is the climb angle of the velocity vector.
 */
export interface BodyKin {
  vLong: number;
  vLat: number;
  /** Positive to the right (clockwise seen from above). */
  yawRate: number;
  speedMps: number;
  upY: number;
  airborneTicks: number;
  /** Rise over run under the car. */
  grade: number;
  pitch?: number;
  roll?: number;
  pitchRate?: number;
  rollRate?: number;
  flightPitch?: number;
}

/** Component `Vehicle` (engine) plus Drift/Nitro/Quirk (racing). */
export interface HandlingState {
  /** 1..n forward, -1 reverse, 0 not yet engaged. */
  gear: number;
  rpm: number;
  shiftTicks: number;
  steerRad: number;
  nitro: number;
  nitroOn: boolean;
  driftTicks: number;
  driftScore: number;
  hopCharges: number;
  hopRechargeTicks: number;
  stallTicks: number;
  engineHealth: number;
  tireHealth: [number, number, number, number];
}

export interface AssistSettings {
  steerAssist: 0 | 1 | 2 | 3;
  brakeAssist: boolean;
  autoThrottle: boolean;
  autoBrake: boolean;
  driftAssist: 0 | 1 | 2;
  stabilityControl: boolean;
  racingLine: 'off' | 'brake' | 'full';
  resetPenalty: boolean;
}

/** Quantized C03 InputFrame fields, normalised: throttle and brake 0..1, steer -1..1 (positive right). */
export interface HandlingInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  nitro: boolean;
  ability: boolean;
  assist: AssistSettings;
}

export interface WheelForce { long: number; lat: number }
export type HandlingEvent =
  | { t: 'shift'; to: number }
  | { t: 'nitro'; on: boolean }
  | { t: 'hop' }
  | { t: 'drift'; angleDeg: number }
  | { t: 'stall' }
  | { t: 'govern' };

export interface HandlingOutput {
  /** Front wheels, radians, positive right. */
  steerRad: [number, number];
  /** FL, FR, RL, RR. Applied as impulses at the contact points. */
  wheelForce: [WheelForce, WheelForce, WheelForce, WheelForce];
  /** About +Y, positive to the right, N*m. */
  yawTorque: number;
  /** Body-frame torques [pitch about the right axis (nose-up positive), 0, roll about the forward axis (right-down positive)], N*m. */
  airTorque: [number, number, number];
  abilityImpulseY: number;
  events: HandlingEvent[];
}

export const DEFAULT_ASSIST: Readonly<AssistSettings> = Object.freeze({
  steerAssist: 1, brakeAssist: false, autoThrottle: false, autoBrake: false, driftAssist: 0,
  stabilityControl: false, racingLine: 'off', resetPenalty: false,
});

export const GRAVITY = 9.81;
const DEG = PI / 180;
const TWO_PI = 2 * PI;
/** Air density times one half. */
const HALF_RHO = 0.6;
/** Throttle torque cut at redline spreads over this fraction of the redline rpm. */
const REV_LIMIT_BAND = 0.04;
/** Torque is read at no less than this fraction of the idle-to-redline range: the clutch slips on a launch (arcade). */
const LAUNCH_RPM_FRAC = 0.3;

export function newHandlingState(): HandlingState {
  return {
    gear: 0, rpm: 0, shiftTicks: 0, steerRad: 0, nitro: 0, nitroOn: false, driftTicks: 0, driftScore: 0,
    hopCharges: 0, hopRechargeTicks: 0, stallTicks: 0, engineHealth: 1, tireHealth: [1, 1, 1, 1],
  };
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const abs = (x: number): number => (x < 0 ? -x : x);
const sign = (x: number): number => (x < 0 ? -1 : 1);

/** Torque in N*m at `rpm`: linear interpolation of the table, clamped at both ends. */
export function torqueAt(table: HandlingProfile['engine']['torque'], rpm: number): number {
  const n = table.length;
  const first = table[0] as readonly [number, number];
  if (rpm <= first[0]) return first[1];
  const last = table[n - 1] as readonly [number, number];
  if (rpm >= last[0]) return last[1];
  for (let i = 1; i < n; i++) {
    const b = table[i] as readonly [number, number];
    if (rpm <= b[0]) {
      const a = table[i - 1] as readonly [number, number];
      const t = (rpm - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return last[1];
}

/** max(T * omega) over the torque curve in kW, scanned every 10 rpm from idle to redline. CI compares it with `powerKw`. */
export function peakPowerKw(p: Pick<HandlingProfile, 'engine'>): number {
  let best = 0;
  for (let rpm = p.engine.idleRpm; rpm <= p.engine.redlineRpm; rpm += 10) {
    const kw = (torqueAt(p.engine.torque, rpm) * rpm * TWO_PI) / 60 / 1000;
    if (kw > best) best = kw;
  }
  return best;
}

/**
 * Normalised lateral curve g(x): x(2 - x) up to the peak at x = 1, then a linear fall to `slideRatio` at x = `slideAtX`
 * and flat beyond.
 */
export function tireCurve(x: number, slideRatio: number, slideAtX: number): number {
  if (x <= 0) return 0;
  if (x <= 1) return x * (2 - x);
  const f = (x - 1) / (slideAtX - 1);
  return 1 - (1 - slideRatio) * (f > 1 ? 1 : f);
}

/** Effective front lock in radians at `speedMps`: lockDeg / (1 + (v/ref)^2), floored at minLockPct of the lock. */
export function effectiveLockRad(p: Pick<HandlingProfile, 'steer'>, speedMps: number): number {
  const lock = p.steer.lockDeg * DEG;
  const r = speedMps / p.steer.speedRefMps;
  const eff = lock / (1 + r * r);
  const floor = (lock * p.steer.minLockPct) / 100;
  return eff < floor ? floor : eff;
}

/** The static load on one wheel of the front (0, 1) or rear (2, 3) axle, newtons. */
export function staticWheelLoadN(p: Pick<HandlingProfile, 'massKg' | 'frontWeightPct'>, wheel: number): number {
  const frac = wheel < 2 ? p.frontWeightPct / 100 : 1 - p.frontWeightPct / 100;
  return (p.massKg * GRAVITY * frac) / 2;
}

/**
 * Vertical load of one wheel's spring-damper, newtons along the contact normal, never negative. The spring carries the
 * static wheel load at `compressionM` = 0 (the rest length `suspension.restM`), so the car sits at its designed height;
 * k = m_corner (2 pi f)^2 and c = 2 zeta sqrt(k m_corner) (zeta is a ratio, not a coefficient). `compressionM` is positive
 * when the wheel is pushed up from rest and `compressVelMps` positive while it compresses. `landing` adds the extra
 * damping of the first ticks after air. A bump stop stiffens the spring beyond the travel.
 */
export function suspensionForce(
  p: Pick<HandlingProfile, 'suspension' | 'massKg' | 'frontWeightPct'>,
  wheel: number,
  compressionM: number,
  compressVelMps: number,
  landing: boolean,
): number {
  const load = staticWheelLoadN(p, wheel);
  const m = load / GRAVITY;
  const w = TWO_PI * p.suspension.rideHz;
  const k = m * w * w;
  let c = 2 * p.suspension.dampingRatio * dsqrt(k * m);
  if (landing) c *= 1 + p.suspension.landingDamp;
  let f = load + k * compressionM + c * compressVelMps;
  const over = compressionM - p.suspension.travelM;
  if (over > 0) f += 12 * k * over;
  return f < 0 ? 0 : f;
}

function driveShare(type: Drivetrain, awdRearBias: number, wheel: number): number {
  const front = wheel < 2;
  if (type === 'FWD') return front ? 0.5 : 0;
  if (type === 'RWD') return front ? 0 : 0.5;
  return front ? (1 - awdRearBias) / 2 : awdRearBias / 2;
}

export function stepHandling(
  p: HandlingProfile,
  s: HandlingState,
  i: HandlingInput,
  w: readonly [WheelContact, WheelContact, WheelContact, WheelContact],
  b: BodyKin,
  dt: number,
): HandlingOutput {
  const events: HandlingEvent[] = [];
  const wheelForce: HandlingOutput['wheelForce'] = [
    { long: 0, lat: 0 }, { long: 0, lat: 0 }, { long: 0, lat: 0 }, { long: 0, lat: 0 },
  ];
  const out: HandlingOutput = { steerRad: [0, 0], wheelForce, yawTorque: 0, airTorque: [0, 0, 0], abilityImpulseY: 0, events };

  const speed = b.speedMps;
  const fwd = b.vLong;
  const fwdAbs = abs(fwd);
  const d = p.drive;
  const m = p.massKg;
  const m4 = m / 4;

  // --- steering: lock falls with speed, the rate is limited, self-alignment speeds the return to centre
  const steerIn = clamp(i.steer, -1, 1);
  const target = steerIn * effectiveLockRad(p, speed);
  let rate = p.steer.rateDegPerS * DEG * dt;
  if (abs(steerIn) < 0.02) rate *= 1 + p.steer.selfAlign * 3;
  s.steerRad += clamp(target - s.steerRad, -rate, rate);
  out.steerRad[0] = s.steerRad;
  out.steerRad[1] = s.steerRad;

  // --- pedals: brake while rolling forward, reverse from rest, throttle brakes a backward roll
  let throttle = clamp(i.throttle, 0, 1);
  let brakeCmd = 0;
  let reverse = false;
  const brakeIn = clamp(i.brake, 0, 1);
  if (brakeIn > 0 && throttle === 0) {
    if (fwd > 1.5) brakeCmd = brakeIn;
    else {
      reverse = true;
      throttle = brakeIn;
    }
  } else if (brakeIn > 0) {
    brakeCmd = brakeIn;
    throttle = 0;
  } else if (throttle > 0 && fwd < -1.5) {
    brakeCmd = throttle;
    throttle = 0;
  }
  if (reverse) {
    if (s.gear !== -1) s.gear = -1;
  } else if (s.gear <= 0) {
    s.gear = 1;
    if (s.shiftTicks === 0) events.push({ t: 'shift', to: 1 });
  }

  // --- speed governor (the only quirk acted on in M03a1)
  const gov = findQuirk(p, 'speedGovernor');
  if (gov && throttle > 0) {
    const scale = governorThrottleScale(speed, gov.kph);
    if (scale < 1) {
      throttle *= scale;
      events.push({ t: 'govern' });
    }
  }

  // --- engine speed from the driven wheels
  let inContact = 0;
  for (let k = 0; k < 4; k++) if ((w[k] as WheelContact).inContact) inContact++;
  let vDriven = 0;
  let nDriven = 0;
  for (let k = 0; k < 4; k++) {
    const c = w[k] as WheelContact;
    if (c.inContact && driveShare(d.type, d.awdRearBias, k) > 0) {
      vDriven += abs(c.vLong);
      nDriven++;
    }
  }
  vDriven = nDriven > 0 ? vDriven / nDriven : fwdAbs;
  const radius = d.wheelRadiusM;
  const gearOf = (g: number): number => (g > 0 ? (d.gears[g - 1] as number) : d.reverse);
  let ratioTotal = gearOf(s.gear) * d.finalDrive;
  const rpmPerMps = (60 / (TWO_PI * radius));
  let rpmRaw = vDriven * ratioTotal * rpmPerMps;

  // --- automatic gearbox
  if (s.shiftTicks > 0) s.shiftTicks--;
  else if (s.gear > 0 && inContact > 0) {
    const nGears = d.gears.length;
    if (s.gear < nGears && rpmRaw > d.shiftUpPct * p.engine.redlineRpm) {
      s.gear++;
      s.shiftTicks = Math.round(d.shiftTimeSec / dt);
      events.push({ t: 'shift', to: s.gear });
    } else if (s.gear > 1 && rpmRaw < d.shiftDownPct * p.engine.redlineRpm) {
      s.gear--;
      s.shiftTicks = Math.round(d.shiftTimeSec / dt);
      events.push({ t: 'shift', to: s.gear });
    }
    ratioTotal = gearOf(s.gear) * d.finalDrive;
    rpmRaw = vDriven * ratioTotal * rpmPerMps;
  }
  if (inContact === 0) {
    // Wheels in the air: the engine revs freely toward the throttle's rpm.
    const free = p.engine.idleRpm + throttle * (p.engine.redlineRpm - p.engine.idleRpm) * 0.6;
    s.rpm += (free - s.rpm) * 0.1;
  } else {
    s.rpm = rpmRaw < p.engine.idleRpm ? p.engine.idleRpm : rpmRaw;
  }

  // --- drive force at the wheels (total, before the split)
  let driveForce = 0;
  if (throttle > 0 && s.shiftTicks === 0 && inContact > 0) {
    const launch = p.engine.idleRpm + LAUNCH_RPM_FRAC * (p.engine.redlineRpm - p.engine.idleRpm);
    let torque = torqueAt(p.engine.torque, s.rpm > launch ? s.rpm : launch) * throttle * powerScale({ engine: s.engineHealth });
    if (rpmRaw > p.engine.redlineRpm) torque *= Math.max(0, 1 - (rpmRaw - p.engine.redlineRpm) / (REV_LIMIT_BAND * p.engine.redlineRpm));
    driveForce = (torque * ratioTotal * d.efficiency) / radius;
    if (reverse) driveForce = -driveForce;
  }

  // --- nitro (M07a1): extra drive force while the racing director holds `nitroOn`; it fades out toward the over-speed ceiling
  if (s.nitroOn && inContact > 0 && !reverse && p.nitro.capacity > 0) driveForce += nitroBoostForceN(p, speed);

  // --- brake demand
  const decel = p.brake.maxDecelG * GRAVITY;
  const brakeTotal = brakeCmd * decel * m;
  const holding = throttle === 0 && brakeCmd === 0 && !reverse && fwdAbs < 0.4;
  const t = tanPeak(p);
  const downforce = p.aero.downforceNPerMps2 * speed * speed;
  const resist = HALF_RHO * p.aero.cdA * speed * speed + p.tire.rollResistN * (fwdAbs > 1 ? 1 : fwdAbs);
  const coast = throttle === 0 && brakeCmd === 0 && !holding ? 0.03 * m * GRAVITY * (fwdAbs > 5 ? 1 : fwdAbs / 5) : 0;
  const resistPerWheel = (resist + coast) * sign(fwd) / 4;

  for (let k = 0; k < 4; k++) {
    const c = w[k] as WheelContact;
    const wf = wheelForce[k] as WheelForce;
    if (!c.inContact) continue;
    const front = k < 2;
    const surf = c.surface === 1 ? 0.72 : c.surface === 2 ? 0.55 : 1;
    const dmg = tireGripScale({ tires: s.tireHealth }, k as 0 | 1 | 2 | 3);
    const axle = front ? p.tire.frontGrip : p.tire.rearGrip;
    const n0 = staticWheelLoadN(p, k);
    const load = c.loadN + downforce / 4;
    const loadFactor = clamp(1 - p.tire.loadSens * (load / n0 - 1), 0.6, 1.3);
    const rearLoose = !front && i.handbrake ? p.drift.handbrakeRearGrip : 1;
    const muLat = p.tire.muLat * axle * surf * dmg * loadFactor * rearLoose;
    const muLong = p.tire.muLong * axle * surf * dmg * loadFactor;

    // lateral: normalised slip, the curve, and no overshoot of the sideways speed in one step
    const slipRef = (abs(c.vLong) > 2 ? abs(c.vLong) : 2) * t;
    const x = abs(c.vLat) / slipRef;
    const fyMax = muLat * load;
    let fy = fyMax * tireCurve(x, p.tire.slideRatio, p.tire.slideAtX);
    const fyStop = (m4 * abs(c.vLat)) / dt;
    if (fy > fyStop) fy = fyStop;
    const fyFrac = fyMax > 0 ? fy / fyMax : 0;

    // drive force: friction limit shrinks with the lateral use of the tyre
    let fx = 0;
    const share = driveShare(d.type, d.awdRearBias, k);
    if (share > 0 && driveForce !== 0) {
      const lim = muLong * load * (1 - 0.6 * fyFrac * fyFrac);
      const want = driveForce * share;
      fx = clamp(want, -lim, lim);
    }

    // brakes: bias between axles, ABS keeps each wheel just under the lock-up limit, the wheel never reverses within a step
    let fb = 0;
    if (brakeTotal > 0) fb += front ? (brakeTotal * p.brake.bias) / 2 : (brakeTotal * (1 - p.brake.bias)) / 2;
    if (i.handbrake && !front) fb += 0.9 * muLong * load;
    if (holding) fb += 0.5 * muLong * load;
    const brakeLim = p.brake.maxDecelG * 1.25 * load * surf * dmg;
    if (fb > brakeLim) fb = p.brake.abs ? brakeLim : brakeLim * 0.8;
    const fbStop = (m4 * abs(c.vLong)) / dt;
    if (fb > fbStop) fb = fbStop;
    if (fb > 0) fx -= sign(c.vLong) * fb;
    if (fb > 0 && brakeLim > 0) {
      const frac = fb / brakeLim;
      fy *= dsqrt(Math.max(0.2, 1 - 0.7 * frac * frac));
    }

    // drag, rolling resistance and engine braking
    fx -= resistPerWheel;
    wf.long = fx;
    wf.lat = c.vLat > 0 ? -fy : fy;
  }

  // --- steer assist: yaw-rate error correction toward the rate the steering implies
  const level = i.assist.steerAssist;
  if (level > 0 && p.steer.assist > 0 && fwdAbs > 2 && inContact > 1 && !i.handbrake) {
    const rt = (fwd * dsin(s.steerRad)) / (dcos(s.steerRad) * p.wheelbaseM);
    const iz = (m * p.wheelbaseM * p.wheelbaseM) / 4;
    const gain = 6 * p.steer.assist * (level / 3);
    out.yawTorque = clamp(iz * gain * (rt - b.yawRate), -iz * 8, iz * 8);
  }

  // --- air: attitude trim toward the flight path
  if (inContact === 0 && b.airborneTicks > 3) {
    const ip = m * p.wheelbaseM * p.wheelbaseM * 0.1;
    const pitchErr = (b.flightPitch ?? 0) - (b.pitch ?? 0);
    out.airTorque[0] = ip * p.suspension.airPitchTrim * (10 * pitchErr - 4.5 * (b.pitchRate ?? 0));
    out.airTorque[2] = ip * p.suspension.airRollTrim * (10 * -(b.roll ?? 0) - 4.5 * (b.rollRate ?? 0));
  }
  return out;
}

/** Newtons of extra drive force at the wheels from nitro at `speedMps`: `boostKw` over the speed (floored at 8 m/s), faded to zero over the last 5 % below the ceiling. */
export function nitroBoostForceN(p: Pick<HandlingProfile, 'class' | 'nitro'>, speedMps: number): number {
  const ceiling = nitroCeilingMps(p);
  const room = (ceiling - speedMps) / (0.05 * ceiling);
  const fade = room <= 0 ? 0 : room >= 1 ? 1 : room;
  return ((p.nitro.boostKw * 1000) / (speedMps < 8 ? 8 : speedMps)) * fade;
}

function tanPeak(p: Pick<HandlingProfile, 'tire'>): number {
  const a = p.tire.peakSlipDeg * DEG;
  return dsin(a) / dcos(a);
}

/** Heading of a velocity vector in the wheel frame, radians (used by the wrapper to place the slip angle in events). */
export function slipAngle(vLong: number, vLat: number): number {
  return datan2(vLat, vLong < 0 ? -vLong : vLong);
}
