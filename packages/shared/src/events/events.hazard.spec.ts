/** AC-1: the hazard function equals 1 - exp(-factor / MTTH) and the draw frequency over 100,000 counter draws lies within 3 sigma. */
import { describe, expect, it } from 'vitest';
import { detmath } from '../detmath.ts';
import { def, fixtureHost, newFixtureState } from './__fixtures__/host.ts';
import { hazardFactor, hazardP, roll } from './engine.ts';
import { ctrFloat } from './rng.ts';

const PAIRS: [factor: number, mtth: number][] = [
  [1, 40], [1, 1226], [2.5, 45], [0.5, 60], [3, 90], [8, 100], [0.1, 40], [1.5, 20], [1, 4], [4, 300],
];

describe('events hazard', () => {
  it('p equals 1 - detmath.exp(-factor / MTTH) to 1e-12 for ten (factor, MTTH) pairs', () => {
    for (const [f, m] of PAIRS) {
      expect(Math.abs(hazardP(f, m) - (1 - detmath.exp(-f / m)))).toBeLessThan(1e-12);
      expect(Math.abs(hazardP(f, m) - (1 - Math.exp(-f / m)))).toBeLessThan(1e-12);
    }
  });

  it('MTTH 40 at factor 1 gives 0.0247 within 1e-4, and 150 weeks give 97.6 %', () => {
    expect(Math.abs(hazardP(1, 40) - 0.0247)).toBeLessThan(1e-4);
    expect(Math.abs(1 - detmath.exp(-150 / 40) - 0.976)).toBeLessThan(1e-3);
  });

  it('the frequency over 100,000 counter draws is within 3 sigma of p for every pair', () => {
    const n = 100_000;
    PAIRS.forEach(([f, m], pi) => {
      const p = hazardP(f, m);
      let hits = 0;
      for (let w = 0; w < n; w++) if (ctrFloat(0x1000 + pi, `ev:pair${pi}`, w) < p) hits++;
      const sigma = Math.sqrt(n * p * (1 - p));
      expect(Math.abs(hits - n * p), `pair ${f}/${m}: ${hits} hits, expected ${(n * p).toFixed(1)} +- ${(3 * sigma).toFixed(1)}`).toBeLessThanOrEqual(3 * sigma);
    });
  });

  it('the engine fires a def about p of the weeks (rolls on a fixture host)', () => {
    const d = def('biz.fixture', { mtthWeeks: 40 });
    const s = newFixtureState(77);
    let fired = 0;
    const n = 20_000;
    for (let w = 0; w < n; w++) {
      s.week = w;
      fired += roll(s, s.ev, [d], fixtureHost).length;
    }
    const p = hazardP(1, 40);
    expect(Math.abs(fired - n * p)).toBeLessThanOrEqual(3 * Math.sqrt(n * p * (1 - p)));
  });

  it('modifiers multiply the rate, clamped to 0.1 and 8', () => {
    const s = newFixtureState(1, { hype: 80, techDebt: 90 });
    const d = def('biz.mods', {
      modifiers: [
        { when: { m: 'hype', op: '>', v: 50 }, factor: 3 },
        { when: { m: 'techDebt', op: '>', v: 60 }, factor: 3 },
        { when: { m: 'hype', op: '<', v: 10 }, factor: 100 },
      ],
    });
    expect(hazardFactor(d, s, fixtureHost)).toBe(8);
    const low = def('biz.low', { modifiers: [{ when: { m: 'hype', op: '>', v: 0 }, factor: 0.001 }] });
    expect(hazardFactor(low, s, fixtureHost)).toBe(0.1);
  });

  it('a def whose requires fail, whose minWeek has not come or whose cooldown runs never rolls', () => {
    const s = newFixtureState(5);
    const gated = def('biz.gated', { mtthWeeks: 1, requires: [{ m: 'users', op: '>', v: 1e9 }] });
    const late = def('biz.late', { mtthWeeks: 1, minWeek: 10_000 });
    for (let w = 0; w < 200; w++) {
      s.week = w;
      expect(roll(s, s.ev, [gated, late], fixtureHost)).toEqual([]);
    }
    const cool = def('biz.cool', { mtthWeeks: 1, cooldownWeeks: 10 });
    const weeks: number[] = [];
    for (let w = 0; w < 100; w++) {
      s.week = w;
      for (const i of roll(s, s.ev, [cool], fixtureHost)) weeks.push(i.firedWeek);
    }
    for (let i = 1; i < weeks.length; i++) expect((weeks[i] as number) - (weeks[i - 1] as number)).toBeGreaterThanOrEqual(10);
  });
});
