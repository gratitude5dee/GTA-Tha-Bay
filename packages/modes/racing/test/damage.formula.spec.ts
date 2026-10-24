/**
 * AC-4: a class-A car at normal difficulty: 15 m/s costs 0.23 +- 0.03 of the body, 30 m/s totals it and emits `race.dnf
 * {reason:'totaled'}`, a front hit gives the engine 0.5 x d, a spike strip zeroes the crossed tyre, a 7 m/s landing damages, and
 * `powerScale` never drops below 0.6.
 */
import { describe, expect, it } from 'vitest';
import { newDamage, powerScale, tireGripScale, type HandlingProfile, type Impact } from '@dv/shared';
import sorrel from '../../../../content/vehicles/handling/hp.aurelian-sorrel.json';
import { RACING_CONFIG } from '../src/config.ts';
import { applyRaceImpact, contactLoss } from '../src/sim/damage-system.ts';

const p = sorrel as unknown as HandlingProfile;
const cfg = RACING_CONFIG.damage;
const hit = (v: number, front = false, kind: Impact['kind'] = 'static'): Impact => ({ kind, vNormal: v, vTangent: 0, local: [0, 0, front ? -2 : 2], otherMassKg: 0 });

describe('race damage formula', () => {
  it('15 m/s costs the class-A body 0.23 +- 0.03', () => {
    const r = applyRaceImpact(cfg, p, newDamage(), hit(15), 'normal');
    expect(1 - r.state.body).toBeGreaterThan(0.2);
    expect(1 - r.state.body).toBeLessThan(0.26);
    expect(r.totaled).toBe(false);
  });

  it('30 m/s totals the car and emits race.dnf totaled', () => {
    const r = applyRaceImpact(cfg, p, newDamage(), hit(30), 'normal');
    expect(r.state.body).toBe(0);
    expect(r.totaled).toBe(true);
    expect(r.events).toEqual([{ t: 'race.dnf', reason: 'totaled' }]);
  });

  it('a front hit gives the engine half of the body loss', () => {
    const d = contactLoss(cfg, p, 15, 'normal');
    const front = applyRaceImpact(cfg, p, newDamage(), hit(15, true), 'normal');
    expect(1 - front.state.engine).toBeCloseTo(0.5 * d, 6);
    const rear = applyRaceImpact(cfg, p, newDamage(), hit(15, false), 'normal');
    expect(rear.state.engine).toBe(1);
  });

  it('a spike strip sets the crossed tyres to 0 and leaves the rest', () => {
    let s = newDamage();
    s = applyRaceImpact(cfg, p, s, { kind: 'spike', vNormal: 0, vTangent: 0, local: [0, 0, 0], otherMassKg: 0, tire: 0 }, 'normal').state;
    s = applyRaceImpact(cfg, p, s, { kind: 'spike', vNormal: 0, vTangent: 0, local: [0, 0, 0], otherMassKg: 0, tire: 3 }, 'normal').state;
    expect(s.tires).toEqual([0, 1, 1, 0]);
    expect(tireGripScale(s, 0)).toBeCloseTo(0.4, 6);
    expect(tireGripScale(s, 1)).toBe(1);
  });

  it('a 7 m/s landing damages; 5 m/s does not', () => {
    const land = (v: number) => applyRaceImpact(cfg, p, newDamage(), { kind: 'landing', vNormal: v, vTangent: 0, local: [0, 0, 0], otherMassKg: 0 }, 'normal');
    expect(land(7).state.body).toBeLessThan(1);
    expect(land(5).state.body).toBe(1);
  });

  it('difficulty scales the loss (easy 0.6, hard 1.2) and durability divides it', () => {
    const n = contactLoss(cfg, p, 15, 'normal');
    expect(contactLoss(cfg, p, 15, 'easy')).toBeCloseTo(n * 0.6, 9);
    expect(contactLoss(cfg, p, 15, 'hard')).toBeCloseTo(n * 1.2, 9);
    expect(contactLoss(cfg, { durability: 2 }, 15, 'normal')).toBeCloseTo(n / 2, 9);
    expect(contactLoss(cfg, p, 3, 'normal')).toBe(0);
  });

  it('powerScale never drops below 0.6, even for a destroyed engine', () => {
    let s = newDamage();
    for (let i = 0; i < 6; i++) s = applyRaceImpact(cfg, p, s, hit(30, true), 'hard').state;
    expect(s.engine).toBe(0);
    expect(powerScale(s)).toBeCloseTo(0.6, 9);
  });
});
