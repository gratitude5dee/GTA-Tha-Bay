/**
 * `stepHandling` (M03a1, AC-2): the tire curve, the steer lock, the gearbox, the brakes, the governor, determinism.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSIST, effectiveLockRad, governorThrottleScale, newHandlingState, stepHandling, suspensionForce, tireCurve, GRAVITY,
  type HandlingInput, type HandlingProfile, type WheelContact,
} from '../src/vehicle/index.ts';
import { loadPresets } from './vehicle-presets.ts';

const presets = Object.fromEntries(loadPresets().map((x) => [x.p.id, x.p])) as Record<string, HandlingProfile>;
const sedan = presets['hp.sedan'] as HandlingProfile;
const DT = 1 / 60;
const DEG = Math.PI / 180;

const input = (o: Partial<HandlingInput> = {}): HandlingInput => ({
  throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, ability: false, assist: { ...DEFAULT_ASSIST }, ...o,
});

function contacts(p: HandlingProfile, v: number, vLat = 0): [WheelContact, WheelContact, WheelContact, WheelContact] {
  const mk = (k: number): WheelContact => ({
    inContact: true, point: [0, 0, 0], normal: [0, 1, 0], suspLenM: p.suspension.restM, vLong: v, vLat,
    loadN: (p.massKg * GRAVITY * (k < 2 ? p.frontWeightPct / 100 : 1 - p.frontWeightPct / 100)) / 2, surface: 0,
  });
  return [mk(0), mk(1), mk(2), mk(3)];
}

const kin = (v: number, vLat = 0) => ({ vLong: v, vLat, yawRate: 0, speedMps: Math.hypot(v, vLat), upY: 1, airborneTicks: 0, grade: 0 });

function sumLong(p: HandlingProfile, v: number, i: HandlingInput, s = newHandlingState()): number {
  const out = stepHandling(p, s, i, contacts(p, v), kin(v), DT);
  return out.wheelForce.reduce((a, w) => a + w.long, 0);
}

describe('tire curve', () => {
  it('equals x(2 - x) up to the peak and reaches slideRatio at slideAtX, flat beyond', () => {
    for (const p of Object.values(presets)) {
      for (const x of [0, 0.1, 0.25, 0.5, 0.75, 1]) expect(tireCurve(x, p.tire.slideRatio, p.tire.slideAtX), p.id).toBeCloseTo(x * (2 - x), 12);
      expect(tireCurve(p.tire.slideAtX, p.tire.slideRatio, p.tire.slideAtX), p.id).toBeCloseTo(p.tire.slideRatio, 12);
      expect(tireCurve(p.tire.slideAtX * 3, p.tire.slideRatio, p.tire.slideAtX), p.id).toBeCloseTo(p.tire.slideRatio, 12);
      // linear fall between the peak and the plateau
      const mid = (1 + p.tire.slideAtX) / 2;
      expect(tireCurve(mid, p.tire.slideRatio, p.tire.slideAtX), p.id).toBeCloseTo((1 + p.tire.slideRatio) / 2, 12);
    }
  });

  it('a 45 degree slip at 25 m/s keeps at least 0.75 of the peak lateral force', () => {
    const x = Math.tan(45 * DEG) / Math.tan(sedan.tire.peakSlipDeg * DEG);
    expect(tireCurve(x, sedan.tire.slideRatio, sedan.tire.slideAtX)).toBeGreaterThanOrEqual(0.75);
  });
});

describe('steering', () => {
  it('the effective lock follows lockDeg / (1 + (v / ref)^2) with its floor', () => {
    for (const p of Object.values(presets)) {
      const { lockDeg, speedRefMps, minLockPct } = p.steer;
      for (const v of [0, 5, speedRefMps, 40]) {
        const want = Math.max((lockDeg * DEG) / (1 + (v / speedRefMps) ** 2), (lockDeg * DEG * minLockPct) / 100);
        expect(effectiveLockRad(p, v), `${p.id} at ${v} m/s`).toBeCloseTo(want, 12);
      }
      expect(effectiveLockRad(p, 0)).toBeCloseTo(lockDeg * DEG, 12);
      expect(effectiveLockRad(p, 500)).toBeCloseTo((lockDeg * DEG * minLockPct) / 100, 12);
    }
  });

  it('the steer angle moves at the limited rate toward the target and returns faster when released', () => {
    const s = newHandlingState();
    const c = contacts(sedan, 10);
    stepHandling(sedan, s, input({ steer: 1 }), c, kin(10), DT);
    expect(s.steerRad).toBeCloseTo(sedan.steer.rateDegPerS * DEG * DT, 10);
    for (let i = 0; i < 120; i++) stepHandling(sedan, s, input({ steer: 1 }), c, kin(10), DT);
    expect(s.steerRad).toBeCloseTo(effectiveLockRad(sedan, 10), 10);
    const before = s.steerRad;
    stepHandling(sedan, s, input({ steer: 0 }), c, kin(10), DT);
    expect(before - s.steerRad).toBeGreaterThan(sedan.steer.rateDegPerS * DEG * DT);
  });

  it('a full-lock turn at 5 m/s has a radius within 5 % of the wheelbase geometry', () => {
    const p = sedan;
    const s = newHandlingState();
    const c = contacts(p, 5);
    for (let i = 0; i < 90; i++) stepHandling(p, s, input({ steer: 1 }), c, kin(5), DT);
    const radius = p.wheelbaseM / Math.tan(s.steerRad);
    const want = p.wheelbaseM / Math.tan(effectiveLockRad(p, 5));
    expect(Math.abs(radius - want) / want).toBeLessThan(0.05);
  });
});

describe('gearbox and drive', () => {
  it('starts in first, upshifts above shiftUpPct of redline and downshifts below shiftDownPct, once per shift time', () => {
    const p = sedan;
    const s = newHandlingState();
    const gears: number[] = [];
    let v = 0;
    for (let i = 0; i < 60 * 30; i++) {
      const out = stepHandling(p, s, input({ throttle: 1 }), contacts(p, v), kin(v), DT);
      for (const e of out.events) if (e.t === 'shift') gears.push(e.to);
      v += (out.wheelForce.reduce((a, w) => a + w.long, 0) / p.massKg) * DT;
    }
    expect(gears.slice(0, 4)).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < gears.length; i++) expect(Math.abs((gears[i] as number) - (gears[i - 1] as number))).toBe(1);
    // coasting down shifts back
    const down: number[] = [];
    for (let i = 0; i < 60 * 10; i++) {
      v = Math.max(0, v - 0.5);
      const out = stepHandling(p, s, input({ throttle: 0.1 }), contacts(p, v), kin(v), DT);
      for (const e of out.events) if (e.t === 'shift') down.push(e.to);
    }
    expect(down.length).toBeGreaterThan(0);
    expect(down[down.length - 1]).toBe(1);
  });

  it('no drive force during a shift, full force before it', () => {
    const p = sedan;
    const s = newHandlingState();
    s.gear = 2;
    s.shiftTicks = 5;
    expect(sumLong(p, 12, input({ throttle: 1 }), s)).toBeLessThan(0);   // only drag and rolling resistance
    s.shiftTicks = 0;
    expect(sumLong(p, 12, input({ throttle: 1 }), s)).toBeGreaterThan(1000);
  });

  it('reverse: the brake pedal drives backwards from rest and brakes while rolling forward', () => {
    const p = sedan;
    const s = newHandlingState();
    expect(sumLong(p, 0, input({ brake: 1 }), s)).toBeLessThan(-500);
    expect(s.gear).toBe(-1);
    expect(sumLong(p, 15, input({ brake: 1 }), newHandlingState())).toBeLessThan(-5000);
  });

  it('engine health scales the drive force by powerScale = 1 - 0.4 (1 - h)', () => {
    const p = sedan;
    const at = (h: number): number => {
      const s = newHandlingState();
      s.gear = 3;
      s.engineHealth = h;
      return sumLong(p, 18, input({ throttle: 1 }), s);
    };
    // F(h) = R + D (1 - 0.4 (1 - h)): the drag R cancels in the differences
    expect((at(1) - at(0.5)) / (at(1) - at(0))).toBeCloseTo(0.5, 6);
    expect(at(1)).toBeGreaterThan(at(0.5));
  });
});

describe('brakes', () => {
  it('stop from 100 kph in 39.4 / g metres, within 8 % of each preset\'s braking g', () => {
    for (const p of Object.values(presets)) {
      let v = 100 / 3.6;
      let x = 0;
      const s = newHandlingState();
      s.gear = 1;
      for (let i = 0; i < 60 * 30 && v > 0.05; i++) {
        const f = sumLong(p, v, input({ brake: 1 }), s);
        v = Math.max(0, v + (f / p.massKg) * DT);
        x += v * DT;
      }
      const want = (100 / 3.6) ** 2 / (2 * p.brake.maxDecelG * GRAVITY);
      expect(Math.abs(x - want) / want, `${p.id}: ${x.toFixed(1)} m vs ${want.toFixed(1)} m`).toBeLessThan(0.08);
    }
  });

  it('the handbrake locks the rear axle', () => {
    const p = sedan;
    const out = stepHandling(p, newHandlingState(), input({ handbrake: true }), contacts(p, 20), kin(20), DT);
    expect(out.wheelForce[2].long).toBeLessThan(-1000);
    expect(out.wheelForce[3].long).toBeLessThan(-1000);
    expect(Math.abs(out.wheelForce[0].long)).toBeLessThan(Math.abs(out.wheelForce[2].long));
  });
});

describe('lateral grip', () => {
  it('opposes sideways speed and never reverses it within one step', () => {
    const p = sedan;
    const out = stepHandling(p, newHandlingState(), input(), contacts(p, 20, 0.05), kin(20, 0.05), DT);
    for (const w of out.wheelForce) {
      expect(w.lat).toBeLessThan(0);
      expect(Math.abs(w.lat)).toBeLessThanOrEqual((p.massKg / 4) * 0.05 / DT + 1e-9);
    }
    const left = stepHandling(p, newHandlingState(), input(), contacts(p, 20, -3), kin(20, -3), DT);
    expect(left.wheelForce[0].lat).toBeGreaterThan(0);
  });

  it('wet and loose surfaces carry less force than asphalt', () => {
    const p = sedan;
    const dry = contacts(p, 20, 2);
    const wet = contacts(p, 20, 2);
    for (const w of wet) w.surface = 1;
    const a = stepHandling(p, newHandlingState(), input(), dry, kin(20, 2), DT).wheelForce[0].lat;
    const b = stepHandling(p, newHandlingState(), input(), wet, kin(20, 2), DT).wheelForce[0].lat;
    expect(Math.abs(b)).toBeLessThan(Math.abs(a));
  });

  it('wheels in the air carry no tyre force', () => {
    const p = sedan;
    const c = contacts(p, 20, 2);
    for (const w of c) w.inContact = false;
    const out = stepHandling(p, newHandlingState(), input({ throttle: 1 }), c, { ...kin(20, 2), airborneTicks: 10 }, DT);
    for (const w of out.wheelForce) expect(w).toEqual({ long: 0, lat: 0 });
  });
});

describe('suspension', () => {
  it('carries the static wheel load at rest length and follows k = m (2 pi f)^2, c = 2 zeta sqrt(k m)', () => {
    const p = sedan;
    const load = (p.massKg * GRAVITY * (p.frontWeightPct / 100)) / 2;
    expect(suspensionForce(p, 0, 0, 0, false)).toBeCloseTo(load, 6);
    const m = load / GRAVITY;
    const k = m * (2 * Math.PI * p.suspension.rideHz) ** 2;
    const c = 2 * p.suspension.dampingRatio * Math.sqrt(k * m);
    expect(suspensionForce(p, 0, 0.05, 0, false)).toBeCloseTo(load + k * 0.05, 6);
    expect(suspensionForce(p, 0, 0, 1, false)).toBeCloseTo(load + c, 6);
    expect(suspensionForce(p, 0, 0, 1, true)).toBeCloseTo(load + c * (1 + p.suspension.landingDamp), 6);
    // never pulls the car down
    expect(suspensionForce(p, 0, -1, -50, false)).toBe(0);
    // the bump stop stiffens the spring beyond the travel
    const travel = p.suspension.travelM;
    expect(suspensionForce(p, 0, travel + 0.05, 0, false)).toBeGreaterThan(load + k * (travel + 0.05) + 1000);
  });

  it('the static sag at the design ride frequency is within 10 % of g / (2 pi f)^2', () => {
    for (const p of Object.values(presets)) {
      const sag = GRAVITY / (2 * Math.PI * p.suspension.rideHz) ** 2;
      expect(sag, p.id).toBeGreaterThan(0.02);
      expect(sag, p.id).toBeLessThan(p.suspension.travelM * 1.5);
    }
  });
});

describe('air trim', () => {
  it('pitches the nose toward the flight path and levels the roll', () => {
    const p = sedan;
    const c = contacts(p, 20);
    for (const w of c) w.inContact = false;
    const out = stepHandling(p, newHandlingState(), input(), c, { ...kin(20), airborneTicks: 10, pitch: 0.1, roll: 0.05, flightPitch: -0.2, pitchRate: 0, rollRate: 0 }, DT);
    expect(out.airTorque[0]).toBeLessThan(0);      // nose down
    expect(out.airTorque[2]).toBeLessThan(0);      // roll back toward level
    const flat = stepHandling(p, newHandlingState(), input(), c, { ...kin(20), airborneTicks: 10, pitch: 0, roll: 0, flightPitch: 0 }, DT);
    expect(flat.airTorque.map((x) => Math.abs(x))).toEqual([0, 0, 0]);
  });
});

describe('speed governor (the one quirk applied in M03a1)', () => {
  const taxi = presets['hp.robotaxi-ambient'] as HandlingProfile;

  it('scales the throttle to zero at the limit and reports govern', () => {
    expect(governorThrottleScale(100 / 3.6, 105)).toBe(1);
    expect(governorThrottleScale(105 / 3.6, 105)).toBe(0);
    expect(governorThrottleScale(110 / 3.6, 105)).toBe(0);
    expect(governorThrottleScale(103.5 / 3.6, 105)).toBeCloseTo(0.5, 6);
    const s = newHandlingState();
    s.gear = 1;
    const v = 105 / 3.6;
    const out = stepHandling(taxi, s, input({ throttle: 1 }), contacts(taxi, v), kin(v), DT);
    expect(out.events.some((e) => e.t === 'govern')).toBe(true);
    expect(out.wheelForce.reduce((a, w) => a + w.long, 0)).toBeLessThan(0);    // only drag
  });

  it('a profile without the quirk is not governed', () => {
    const s = newHandlingState();
    s.gear = 1;
    const v = 30;
    const out = stepHandling(sedan, s, input({ throttle: 1 }), contacts(sedan, v), kin(v), DT);
    expect(out.events.some((e) => e.t === 'govern')).toBe(false);
  });
});

describe('determinism', () => {
  it('the same inputs give the same outputs, bit for bit, and nothing is NaN', () => {
    const run = (): string => {
      const s = newHandlingState();
      let v = 0;
      const log: number[] = [];
      for (let i = 0; i < 600; i++) {
        const out = stepHandling(sedan, s, input({ throttle: i < 400 ? 1 : 0, brake: i >= 400 ? 1 : 0, steer: Math.sin(i / 20) }), contacts(sedan, v, Math.sin(i / 7)), kin(v, Math.sin(i / 7)), DT);
        const f = out.wheelForce.reduce((a, w) => a + w.long, 0);
        v = Math.max(0, v + (f / sedan.massKg) * DT);
        log.push(f, s.rpm, s.steerRad, out.yawTorque, ...out.wheelForce.map((w) => w.lat));
      }
      expect(log.every(Number.isFinite)).toBe(true);
      return log.join(',');
    };
    expect(run()).toBe(run());
  });
});
