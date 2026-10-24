/**
 * Vehicle damage (M03a1, AC-2): a 15 m/s wall hit on `normal` costs `0.23 / durability` of the body, +- 0.03.
 */
import { describe, expect, it } from 'vitest';
import { applyImpact, IMPACT_FLOOR_MPS, newDamage, powerScale, tireGripScale, type Impact } from '../src/vehicle/index.ts';
import { loadPresets } from './vehicle-presets.ts';

const wall = (v: number): Impact => ({ kind: 'static', vNormal: v, vTangent: 0, local: [0, 0, -2], otherMassKg: 0 });

describe('damage', () => {
  it('a 15 m/s wall hit on normal reduces body by 0.23 / durability, +- 0.03, for every preset', () => {
    for (const { p } of loadPresets()) {
      const d = applyImpact(p, newDamage(), wall(15), 'normal');
      const lost = 1 - d.body;
      expect(Math.abs(lost - 0.23 / p.durability), `${p.id}: lost ${lost.toFixed(3)}`).toBeLessThanOrEqual(0.03);
    }
  });

  it('grows with the square of the speed, and slow bumps cost nothing', () => {
    const sedan = loadPresets().find((x) => x.p.id === 'hp.sedan')?.p;
    expect(sedan).toBeDefined();
    if (!sedan) return;
    const at = (v: number): number => 1 - applyImpact(sedan, newDamage(), wall(v), 'normal').body;
    expect(at(7.5)).toBeCloseTo(at(15) / 4, 6);
    expect(at(IMPACT_FLOOR_MPS)).toBe(0);
    expect(at(1)).toBe(0);
    // negative normal speeds count by magnitude
    expect(1 - applyImpact(sedan, newDamage(), wall(-15), 'normal').body).toBeCloseTo(at(15), 10);
  });

  it('difficulty scales the loss: easy 0.6, hard 1.4', () => {
    const p = loadPresets()[0]?.p;
    expect(p).toBeDefined();
    if (!p) return;
    const lost = (d: 'easy' | 'normal' | 'hard'): number => 1 - applyImpact(p, newDamage(), wall(15), d).body;
    expect(lost('easy')).toBeCloseTo(lost('normal') * 0.6, 10);
    expect(lost('hard')).toBeCloseTo(lost('normal') * 1.4, 10);
  });

  it('a front hit hurts the engine; a rear hit does not; a spike takes half a tyre; nothing goes below zero', () => {
    const p = loadPresets()[0]?.p;
    expect(p).toBeDefined();
    if (!p) return;
    const front = applyImpact(p, newDamage(), wall(15), 'normal');
    expect(front.engine).toBeLessThan(1);
    const rear = applyImpact(p, newDamage(), { ...wall(15), local: [0, 0, 2] }, 'normal');
    expect(rear.engine).toBe(1);
    const spike = applyImpact(p, newDamage(), { kind: 'spike', vNormal: 0, vTangent: 0, local: [0, 0, 0], otherMassKg: 0, tire: 2 }, 'normal');
    expect(spike.tires).toEqual([1, 1, 0.5, 1]);
    let d = newDamage();
    for (let i = 0; i < 20; i++) d = applyImpact(p, d, wall(30), 'hard');
    expect(d.body).toBe(0);
    expect(d.engine).toBeGreaterThanOrEqual(0);
  });

  it('powerScale is 1 - 0.4 (1 - engine) and tireGripScale falls to 0.4 when a tyre is gone', () => {
    expect(powerScale({ engine: 1 })).toBe(1);
    expect(powerScale({ engine: 0 })).toBeCloseTo(0.6, 12);
    expect(powerScale({ engine: 0.5 })).toBeCloseTo(0.8, 12);
    expect(tireGripScale({ tires: [1, 1, 1, 1] }, 0)).toBe(1);
    expect(tireGripScale({ tires: [0, 1, 1, 1] }, 0)).toBeCloseTo(0.4, 12);
    expect(tireGripScale({ tires: [1, 1, 0.5, 1] }, 2)).toBeCloseTo(0.7, 12);
  });

  it('a heavy vehicle in a collision hurts more, a light one less', () => {
    const p = loadPresets()[0]?.p;
    expect(p).toBeDefined();
    if (!p) return;
    const hit = (m: number): number => 1 - applyImpact(p, newDamage(), { kind: 'vehicle', vNormal: 15, vTangent: 0, local: [0, 0, -2], otherMassKg: m }, 'normal').body;
    expect(hit(p.massKg * 3)).toBeGreaterThan(hit(p.massKg));
    expect(hit(p.massKg / 4)).toBeLessThan(hit(p.massKg));
  });
});
