/**
 * AC-2 (rubber-band half): the band never moves the target speed or the power by more than 8 %, is constant over the last 15 % of
 * the route and is 1.0 in time trials. The rival field around it: seeded mistakes, overtakes, determinism, place order.
 */
import { describe, expect, it } from 'vitest';
import { straightRaceDef, type Difficulty, type RaceDef } from '@dv/shared';
import { Fnv64 } from '@dv/shared';
import { RACING_CONFIG } from '../src/config.ts';
import { raceCar } from '../src/cars.ts';
import { RivalField, type RivalSpec } from '../src/sim/ai-driver.ts';
import { bandStrength, newBand, newCatchUp, rubberMult, stepCatchUp } from '../src/sim/rubber-band.ts';
import { decideTier } from '../src/sim/lod.ts';
import { classTopMps, profileAt } from '../src/sim/speed-profile.ts';
import { rivalSpecs } from '../src/sim/rivals.ts';

const band = RACING_CONFIG.rubberBand;
const quill = raceCar('vehicle.kestrel-quill')!;

describe('rubber band', () => {
  it('moves the multiplier by at most 8 % for any gap, strength and difficulty', () => {
    for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
      for (const eventRb of [0, 0.25, 0.6, 1, 3]) {
        const rb = bandStrength(band, eventRb, diff, 'sprint', false);
        expect(rb).toBeGreaterThanOrEqual(0);
        expect(rb).toBeLessThanOrEqual(1);
        for (let gap = -2000; gap <= 2000; gap += 37) {
          const m = rubberMult(band, newBand(), gap, rb, 0.3);
          expect(m).toBeGreaterThanOrEqual(1 - band.maxPct - 1e-12);
          expect(m).toBeLessThanOrEqual(1 + band.maxPct + 1e-12);
        }
      }
    }
  });

  it('gives a rival behind the player a boost and one far ahead an easier time, by the gap over 150 m', () => {
    const rb = bandStrength(band, 1, 'easy', 'sprint', false);
    expect(rb).toBe(1);
    expect(rubberMult(band, newBand(), 150, rb, 0.1)).toBeCloseTo(1.08, 9);
    expect(rubberMult(band, newBand(), -150, rb, 0.1)).toBeCloseTo(0.92, 9);
    expect(rubberMult(band, newBand(), 75, rb, 0.1)).toBeCloseTo(1.04, 9);
    expect(rubberMult(band, newBand(), 0, rb, 0.1)).toBe(1);
    // the difficulty scales the strength: easy 1.0, normal 0.6, hard 0.25
    expect(bandStrength(band, 1, 'normal', 'sprint', false)).toBeCloseTo(0.6, 9);
    expect(bandStrength(band, 1, 'hard', 'sprint', false)).toBeCloseTo(0.25, 9);
  });

  it('is constant over the last 15 % of the route', () => {
    const st = newBand();
    const rb = 0.6;
    let held = 0;
    for (let p = 0; p < 0.85; p += 0.01) held = rubberMult(band, st, 100, rb, p);
    expect(st.frozen).toBe(false);
    const at = rubberMult(band, st, 100, rb, 0.85);
    expect(at).toBe(held);
    expect(st.frozen).toBe(true);
    for (let p = 0.85; p <= 1; p += 0.01) for (const gap of [-500, 0, 500]) expect(rubberMult(band, st, gap, rb, p)).toBe(held);
  });

  it('is 1.0 in a time trial and in the kinds without a band', () => {
    expect(bandStrength(band, 1, 'easy', 'sprint', true)).toBe(0);
    for (const kind of ['speedtrap', 'drift', 'sideshow'] as const) expect(bandStrength(band, 1, 'easy', kind, false)).toBe(0);
    expect(rubberMult(band, newBand(), 900, 0, 0.2)).toBe(1);
  });

  it('player catch-up: 200 m behind for 15 s grants the x1.25 refill once, easy and normal only', () => {
    const st = newCatchUp();
    let granted = 0;
    for (let t = 0; t < 60 * 20; t++) if (stepCatchUp(band, st, 250, 'normal', 60) > 1) granted++;
    expect(granted).toBe(1);
    const hard = newCatchUp();
    for (let t = 0; t < 60 * 20; t++) expect(stepCatchUp(band, hard, 250, 'hard', 60)).toBe(1);
    const back = newCatchUp();
    for (let t = 0; t < 60 * 14; t++) stepCatchUp(band, back, 250, 'easy', 60);
    stepCatchUp(band, back, 100, 'easy', 60);
    expect(back.behindTicks).toBe(0);
  });
});

/** A 3 km straight with a hairpin every 400 m (the curvature array only: the geometry stays straight). */
function cornersDef(opts: { rubberBand?: number; kind?: RaceDef['kind'] } = {}): RaceDef {
  const d = straightRaceDef({ lengthM: 3000, gates: 6, ...(opts.kind ? { kind: opts.kind } : {}) });
  const kv = d.line.curvature.slice();
  for (let i = 60; i < kv.length; i += 80) for (let j = 0; j < 6; j++) kv[i + j] = 450;
  return { ...d, line: { ...d.line, curvature: kv }, rubberBand: opts.rubberBand ?? 1, grid: [{ s: 40, lane: 0, offsetM: 0 }, { s: 34, lane: 1, offsetM: 0 }, { s: 28, lane: 0, offsetM: 0 }, { s: 22, lane: 1, offsetM: 0 }] };
}

const specs = (skills: number[]): RivalSpec[] => skills.map((skill, i) => ({ driverId: `rival.t${i}`, vehicleDef: quill.vehicleDef, skill, profile: quill.profile }));

function drive(field: RivalField, def: RaceDef, player: { v: number }, seconds: number, probe?: (tick: number) => void): void {
  let totalM = 40;
  for (let t = 0; t < seconds * 60; t++) {
    totalM += player.v / 60;
    field.step(t + 1, 0, { totalM, lat: 0, speedMps: player.v });
    probe?.(t);
  }
  void def;
}

describe('rival field', () => {
  it('a rival never targets more than 8 % above its profile, and never exceeds the class top by more than 8 %', () => {
    const def = cornersDef();
    const field = new RivalField({ def, cfg: RACING_CONFIG, specs: specs([0.3, 0.7, 1]), difficulty: 'easy', seed: 5 });
    let maxRatio = 0;
    let maxTop = 0;
    drive(field, def, { v: 5 }, 120, () => {
      for (const r of field.rivals) {
        const base = profileAt(r.plan, r.s + 6 + 0.25 * r.v) * (0.82 + 0.16 * r.skill);
        if (base > 0) maxRatio = Math.max(maxRatio, r.targetV / base);
        maxTop = Math.max(maxTop, r.v / classTopMps(r.profile));
      }
    });
    expect(maxRatio).toBeLessThanOrEqual(1.08 + 1e-6);
    expect(maxRatio).toBeGreaterThan(1.0);
    expect(maxTop).toBeLessThanOrEqual(1.08);
    for (const r of field.rivals) expect(r.totalM).toBeGreaterThan(300);
  });

  it('the band is off in a time trial: every multiplier is 1', () => {
    const def = cornersDef();
    const field = new RivalField({ def, cfg: RACING_CONFIG, specs: specs([0.5, 0.9]), difficulty: 'easy', seed: 9, timeTrial: true });
    let max = 1;
    let min = 1;
    drive(field, def, { v: 40 }, 60, () => {
      for (const r of field.rivals) {
        max = Math.max(max, r.powerMult);
        min = Math.min(min, r.powerMult);
      }
    });
    expect(max).toBe(1);
    expect(min).toBe(1);
  });

  it('the multiplier is frozen once a rival is in the last 15 % of the race', () => {
    const def = cornersDef();
    const field = new RivalField({ def, cfg: RACING_CONFIG, specs: specs([0.9]), difficulty: 'easy', seed: 2 });
    const after: number[] = [];
    drive(field, def, { v: 10 }, 400, () => {
      const r = field.rivals[0]!;
      if (r.totalM / def.routeLenM >= 0.86 && r.finishTick < 0) after.push(r.powerMult);
    });
    expect(after.length).toBeGreaterThan(20);
    expect(new Set(after).size).toBe(1);
  });

  it('is a function of the seed and the player: equal runs hash equal, another seed changes a low-skill rival', () => {
    const def = cornersDef();
    const run = (seed: number): string => {
      const f = new RivalField({ def, cfg: RACING_CONFIG, specs: specs([0, 0, 0]), difficulty: 'normal', seed });
      drive(f, def, { v: 30 }, 90);
      const h = new Fnv64();
      f.hashInto(h);
      return h.hex();
    };
    expect(run(11)).toBe(run(11));
    expect(run(11)).not.toBe(run(12));
  });

  it('a rival behind another in its lane takes the freer side for 1.5 s, and goes back to the line', () => {
    const def = straightRaceDef({ lengthM: 2000, gates: 4 });
    const field = new RivalField({ def, cfg: { ...RACING_CONFIG, rubberBand: { ...RACING_CONFIG.rubberBand, maxPct: 0 } }, specs: specs([1, 0]), difficulty: 'normal', seed: 3 });
    const [fast, slow] = field.rivals as [(typeof field.rivals)[0], (typeof field.rivals)[0]];
    fast.s = 100; fast.totalM = 100; fast.lat = 0; fast.latTarget = 0;
    slow.s = 118; slow.totalM = 118; slow.lat = 0; slow.latTarget = 0; slow.v = 10;
    fast.v = 30;
    let moved = false;
    let back = false;
    for (let t = 0; t < 60 * 12; t++) {
      field.step(t + 1, 0, { totalM: -500, lat: 0, speedMps: 0 });
      slow.v = 10;
      if (Math.abs(fast.lat) > 1.5) moved = true;
      if (moved && Math.abs(fast.lat) < 0.2) back = true;
    }
    expect(moved).toBe(true);
    expect(back).toBe(true);
  });

  it('place order: the player is 1 + the rivals further along, or finished before it', () => {
    const def = cornersDef();
    const field = new RivalField({ def, cfg: RACING_CONFIG, specs: specs([0.5, 0.5, 0.5]), difficulty: 'normal', seed: 1 });
    field.rivals[0]!.totalM = 900;
    field.rivals[1]!.totalM = 400;
    field.rivals[2]!.totalM = 100;
    expect(field.placeOf(500, -1)).toBe(2);
    expect(field.placeOf(950, -1)).toBe(1);
    expect(field.placeOf(50, -1)).toBe(4);
    field.rivals[0]!.finishTick = 1000;
    field.rivals[1]!.finishTick = 2000;
    expect(field.placeOf(3000, 1500)).toBe(2);
    expect(field.placeOf(3000, 2500)).toBe(3);
  });

  it('rivalSpecs moves the skill with the difficulty and falls back to the loaner for an unknown car', () => {
    const def = { opponents: [{ driverId: 'rival.a', vehicleDef: 'vehicle.kestrel-quill', skill: 0.5 }, { driverId: 'rival.b', vehicleDef: 'vehicle.nope', skill: 0.95 }] };
    expect(rivalSpecs(def, 'easy').map((s) => Math.round(s.skill * 100) / 100)).toEqual([0.35, 0.8]);
    expect(rivalSpecs(def, 'hard').map((s) => Math.round(s.skill * 100) / 100)).toEqual([0.6, 1]);
    expect(rivalSpecs(def, 'normal')[1]?.vehicleDef).toBe('vehicle.ondine-pico');
  });
});

describe('vehicle tiers', () => {
  it('promotes within 70 m while the M1 budget has room, demotes beyond 100 m, and keeps M2 when the host has no M1', () => {
    const m = RACING_CONFIG.models;
    expect(decideTier(m, 'desktop', 'M2', 60, 3, true)).toEqual({ tier: 'M1', changed: true });
    expect(decideTier(m, 'desktop', 'M2', 60, 8, true)).toEqual({ tier: 'M2', changed: false });
    expect(decideTier(m, 'desktop', 'M2', 85, 0, true)).toEqual({ tier: 'M2', changed: false });
    expect(decideTier(m, 'desktop', 'M1', 85, 0, true)).toEqual({ tier: 'M1', changed: false });
    expect(decideTier(m, 'desktop', 'M1', 101, 0, true)).toEqual({ tier: 'M2', changed: true });
    expect(decideTier(m, 'mobile-low', 'M2', 10, 4, true).tier).toBe('M2');
    expect(decideTier(m, 'desktop', 'M2', 10, 0, false).tier).toBe('M2');
  });
});
