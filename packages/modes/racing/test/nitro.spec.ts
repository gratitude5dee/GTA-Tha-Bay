/**
 * AC-5 (nitro half): a full tank fires at 100 kph and lasts 4.0 s +- 1 tick; it cannot start below 15; sources fill it; the
 * speed ceiling is 110 % of the class top (checked through `stepHandling`'s boost force).
 */
import { describe, expect, it } from 'vitest';
import { nitroBoostForceN, nitroCeilingMps, type HandlingProfile } from '@dv/shared';
import sorrel from '../../../../content/vehicles/handling/hp.aurelian-sorrel.json';
import solenne from '../../../../content/vehicles/handling/hp.solenne-skip.json';
import { addCharge, newNitro, nitro01, NO_SOURCES, perfectStartBonus, stepNitro } from '../src/sim/nitro.ts';

const p = sorrel as unknown as HandlingProfile;

describe('nitro tank', () => {
  it('a full tank lasts 4.0 s +- 1 tick', () => {
    const st = newNitro(100);
    expect(stepNitro(p, st, true, NO_SOURCES)).toContain('fire');
    let ticks = 1;
    while (st.on && ticks < 1000) {
      stepNitro(p, st, true, NO_SOURCES);
      ticks++;
    }
    expect(Math.abs(ticks - 240)).toBeLessThanOrEqual(1);
    expect(st.charge).toBe(0);
  });

  it('cannot start below 15 and starts at 15', () => {
    const low = newNitro(14.9);
    stepNitro(p, low, true, NO_SOURCES);
    expect(low.on).toBe(false);
    const ok = newNitro(15);
    stepNitro(p, ok, true, NO_SOURCES);
    expect(ok.on).toBe(true);
  });

  it('closing the button closes the tank; the rest stays', () => {
    const st = newNitro(100);
    for (let i = 0; i < 60; i++) stepNitro(p, st, true, NO_SOURCES);
    stepNitro(p, st, false, NO_SOURCES);
    expect(st.on).toBe(false);
    expect(st.charge).toBeCloseTo(100 - 25, 0);
  });

  it('fills from drifting (6/s), drafting (8/s), airtime (10/s) and a near miss (+6), never beyond capacity, and not while open', () => {
    const st = newNitro(0);
    for (let i = 0; i < 60; i++) stepNitro(p, st, false, { ...NO_SOURCES, drifting: true });
    expect(st.charge).toBeCloseTo(6, 3);
    for (let i = 0; i < 60; i++) stepNitro(p, st, false, { ...NO_SOURCES, drafting: true });
    expect(st.charge).toBeCloseTo(14, 3);
    for (let i = 0; i < 60; i++) stepNitro(p, st, false, { ...NO_SOURCES, airborne: true });
    expect(st.charge).toBeCloseTo(24, 3);
    stepNitro(p, st, false, { ...NO_SOURCES, nearMiss: true });
    expect(st.charge).toBeCloseTo(30, 3);
    addCharge(p, st, 500);
    expect(st.charge).toBe(100);
    const open = newNitro(50);
    stepNitro(p, open, true, NO_SOURCES);
    const before = open.charge;
    stepNitro(p, open, true, { ...NO_SOURCES, drifting: true });
    expect(open.charge).toBeLessThan(before);
  });

  it('a car without a tank never fires; the EV roadster refills from braking regeneration', () => {
    const none = newNitro(50);
    stepNitro({ nitro: { ...p.nitro, capacity: 0 } }, none, true, NO_SOURCES);
    expect(none.on).toBe(false);
    const ev = solenne as unknown as HandlingProfile;
    const st = newNitro(0);
    for (let i = 0; i < 60; i++) stepNitro(ev, st, false, { ...NO_SOURCES, regen: true });
    expect(st.charge).toBeCloseTo(4, 3);
  });

  it('the perfect-start bonus is 10 % of the tank', () => {
    expect(perfectStartBonus(p, 10)).toBe(10);
    expect(nitro01(p, newNitro(50))).toBe(0.5);
  });
});

describe('the 110 % ceiling', () => {
  it('is 110 % of the class top (335 kph for class A)', () => {
    expect(nitroCeilingMps(p) * 3.6).toBeCloseTo(335 * 1.1, 6);
  });
  it('the boost force fades to zero at the ceiling and is positive below it', () => {
    const ceiling = nitroCeilingMps(p);
    expect(nitroBoostForceN(p, 100 / 3.6)).toBeGreaterThan(0);
    expect(nitroBoostForceN(p, ceiling)).toBe(0);
    expect(nitroBoostForceN(p, ceiling + 5)).toBe(0);
    expect(nitroBoostForceN(p, ceiling * 0.9)).toBeGreaterThan(nitroBoostForceN(p, ceiling * 0.99));
  });
});
