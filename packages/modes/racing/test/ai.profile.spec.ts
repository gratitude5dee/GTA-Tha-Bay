/**
 * AC-2 (profile half): the AI speed profile of a fixture line with a hairpin keeps to the grip limit sqrt(mu g / |k|), obeys the
 * braking and power passes, and the pure-pursuit and PI control of `driveCommand` follows the line on a bicycle model.
 */
import { describe, expect, it } from 'vitest';
import { centreline, dcos, dsin, GRAVITY, PI, SIM_DT, straightRaceDef, type RaceDef } from '@dv/shared';
import { RACING_CONFIG } from '../src/config.ts';
import { raceCar } from '../src/cars.ts';
import { driveCommand, newDriveMemory, skillFactor, brakeMargin } from '../src/sim/ai-driver.ts';
import { accelAt, brakeDecel, buildSpeedProfile, classTopMps, GRIP_SHARE, gripLimit, MAX_CURVATURE, profileAt } from '../src/sim/speed-profile.ts';

const quill = raceCar('vehicle.kestrel-quill')!.profile;
const sorrel = raceCar('vehicle.aurelian-sorrel')!.profile;

/** A 1.2 km line: straight, a 20 m radius hairpin (about 180 degrees over 63 m), straight again. */
function hairpinDef(): Pick<RaceDef, 'line' | 'routeLenM' | 'elevation'> & { headings: number[] } {
  const stepM = 5;
  const n = 241;
  const curvature: number[] = [];
  const headings: number[] = [];
  let h = 0;
  const x = [0];
  const z = [0];
  for (let i = 0; i < n; i++) {
    const inHairpin = i >= 100 && i < 113;
    const k = inHairpin ? 1 / 20 : 0;
    // curvature in 1e-4 1/m, as the compiler stores it (positive turns left here)
    curvature.push(Math.round(k * 1e4));
    h += k * stepM;
    headings.push(h);
    x.push((x[i] as number) + -dsin(h) * stepM);
    z.push((z[i] as number) + -dcos(h) * stepM);
  }
  const dxz: number[] = [];
  for (let i = 1; i < n; i++) dxz.push(Math.round(((x[i] as number) - (x[i - 1] as number)) * 10), Math.round(((z[i] as number) - (z[i - 1] as number)) * 10));
  const base = straightRaceDef({ lengthM: (n - 1) * stepM });
  return { ...base, line: { ...base.line, curvature, dxz, start: [0, 0] }, headings };
}

describe('AI speed profile', () => {
  const def = hairpinDef();
  for (const [name, p] of [['quill (C)', quill], ['sorrel (A)', sorrel]] as const) {
    describe(name, () => {
      const sp = buildSpeedProfile(def, p);
      const top = classTopMps(p);

      it('no sample exceeds the grip limit sqrt(mu g / |k|), the baked curvature and the tyres\' mu', () => {
        const kv = def.line.curvature;
        for (let i = 0; i < sp.v.length; i++) {
          const k = Math.abs(kv[i] as number) * 1e-4;
          const lim = k < 1e-5 ? Infinity : Math.sqrt((p.tire.muLat * GRAVITY) / Math.min(k, MAX_CURVATURE));
          expect(sp.v[i] as number, `sample ${i}`).toBeLessThanOrEqual(lim + 1e-6);
          expect(sp.v[i] as number).toBeLessThanOrEqual(top + 1e-9);
          expect(sp.grip[i] as number).toBeLessThanOrEqual(gripLimit(kv[i] as number, p.tire.muLat * GRIP_SHARE, top) + 1e-9);
        }
      });

      it('braking satisfies v_i^2 <= v_{i+1}^2 + 2 a ds, and the power pass v_{i+1}^2 <= v_i^2 + 2 a(v_i) ds', () => {
        const b = brakeDecel(p);
        for (let i = 0; i + 1 < sp.v.length; i++) {
          const a = sp.v[i] as number;
          const c = sp.v[i + 1] as number;
          expect(a * a, `brake ${i}`).toBeLessThanOrEqual(c * c + 2 * b * sp.stepM + 1e-6);
          expect(c * c, `accel ${i}`).toBeLessThanOrEqual(a * a + 2 * accelAt(p, a) * sp.stepM + 1e-6);
        }
      });

      it('slows for the hairpin and is near the top speed far from it', () => {
        const min = Math.min(...Array.from(sp.v.slice(100, 113)));
        expect(min).toBeLessThan(top * 0.5);
        expect(sp.v[40] as number).toBeGreaterThan(top * 0.6);
        // it starts braking before the hairpin: the sample 60 m before is above the hairpin speed but below the top
        expect(profileAt(sp, 100 * 5 - 5)).toBeLessThan(profileAt(sp, 100 * 5 - 200));
      });
    });
  }

  it('a more skilled driver brakes later and goes faster (skill factor 0.82 to 0.98, brake margin 1.25 to 1.0)', () => {
    const ai = RACING_CONFIG.ai;
    expect(skillFactor(ai, 0)).toBeCloseTo(0.82, 6);
    expect(skillFactor(ai, 1)).toBeCloseTo(0.98, 6);
    expect(brakeMargin(ai, 0)).toBeCloseTo(1.25, 6);
    expect(brakeMargin(ai, 1)).toBeCloseTo(1.0, 6);
    const slow = buildSpeedProfile(def, quill, { brakeMargin: brakeMargin(ai, 0) });
    const fast = buildSpeedProfile(def, quill, { brakeMargin: brakeMargin(ai, 1) });
    expect(slow.v[90] as number).toBeLessThanOrEqual(fast.v[90] as number);
    expect(slow.v.reduce((a, b) => a + b, 0)).toBeLessThan(fast.v.reduce((a, b) => a + b, 0));
  });

  it('pure pursuit with the PI controller follows the hairpin line on a bicycle model', () => {
    const d = def as unknown as RaceDef;
    const sp = buildSpeedProfile(d, quill);
    const ai = RACING_CONFIG.ai;
    const cl = centreline(d);
    const mem = newDriveMemory();
    let x = cl[0] as number;
    let z = cl[1] as number;
    let yaw = 0;
    let v = 0;
    let s = 0;
    let worst = 0;
    let overshoot = 0;
    const plan = (at: number): number => profileAt(sp, at) * skillFactor(ai, 0.8);
    for (let t = 0; t < 60 * 70; t++) {
      // the projection of the car on the line: the nearest 5 m sample within a window ahead
      let best = Infinity;
      for (let k = Math.max(0, Math.floor(s / 5) - 6); k <= Math.min(cl.length / 2 - 1, Math.floor(s / 5) + 30); k++) {
        const dd = Math.hypot((cl[2 * k] as number) - x, (cl[2 * k + 1] as number) - z);
        if (dd < best) {
          best = dd;
          s = k * 5;
        }
      }
      worst = Math.max(worst, best);
      const out = driveCommand(d, quill, sp, ai, 0.8, mem, { x, z, yaw, speedMps: v, s });
      // the model: engine and brake along the heading, a front wheel angle from the steer byte as `driveCommand` assumed
      const a = out.throttle > 0 ? (out.throttle / 127) * accelAt(quill, v) : -(out.brake / 127) * brakeDecel(quill);
      v = Math.max(0, v + a * SIM_DT);
      const lockRad = (quill.steer.lockDeg * PI) / 180 / (1 + (v / quill.steer.speedRefMps) * (v / quill.steer.speedRefMps));
      const delta = (out.steer / 127) * Math.max(lockRad, 0.05);
      yaw += (v / quill.wheelbaseM) * Math.tan(-delta) * SIM_DT;
      x += -dsin(yaw) * v * SIM_DT;
      z += -dcos(yaw) * v * SIM_DT;
      overshoot = Math.max(overshoot, v - plan(s) * 1.25);
      if (s >= (cl.length / 2 - 3) * 5) break;
    }
    expect(s).toBeGreaterThan(1100);
    expect(worst).toBeLessThan(5);
    expect(overshoot).toBeLessThan(3);
  });

  it('the stuck recovery and the off-route placement fire at the configured limits', () => {
    const d = def as unknown as RaceDef;
    const sp = buildSpeedProfile(d, quill);
    const ai = RACING_CONFIG.ai;
    const mem = newDriveMemory();
    let reversed = false;
    for (let t = 0; t < Math.round(ai.recoverStuckSec / SIM_DT) + 5; t++) {
      const out = driveCommand(d, quill, sp, ai, 0.5, mem, { x: 0, z: 0, yaw: 0, speedMps: 0, s: 0 });
      if (out.reverse) reversed = true;
    }
    expect(reversed).toBe(true);
    const far = driveCommand(d, quill, sp, ai, 0.5, newDriveMemory(), { x: 60, z: -100, yaw: 0, speedMps: 10, s: 100 });
    expect(far.teleport).toBe(true);
    expect(driveCommand(d, quill, sp, ai, 0.5, newDriveMemory(), { x: 0, z: -100, yaw: 0, speedMps: 10, s: 100 }).teleport).toBe(false);
  });
});
