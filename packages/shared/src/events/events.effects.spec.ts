/** AC-3 (part 1): stocks apply once and clamp; modifiers decay none / linear / geometric and expire; multipliers clamp to 0.2 to 5. */
import { describe, expect, it } from 'vitest';
import { def, fixtureHost, newFixtureState } from './__fixtures__/host.ts';
import { applyEffects, strengthAt, tickEffects } from './effects.ts';
import { roll } from './engine.ts';
import { MUL_MAX, MUL_MIN, type EffectSpec } from './types.ts';

const mod = (metric: 'cacMul' | 'burnMul' | 'devPowerMul', v: number, weeks: number, decay: 'none' | 'linear' | 'geometric', op: 'mul' | 'add' = 'mul'): EffectSpec => ({
  k: 'metric', metric, op, dist: { k: 'fixed', v }, durationWeeks: weeks, decay,
});
const stock = (metric: 'cash' | 'hype' | 'users' | 'climate', v: number, op: 'mul' | 'add' = 'add'): EffectSpec => ({
  k: 'metric', metric, op, dist: { k: 'fixed', v }, durationWeeks: 0, decay: 'none',
});

describe('events effects', () => {
  it('a stock effect applies once when the event fires, never again', () => {
    const d = def('biz.shock', { mtthWeeks: 0.0001, cooldownWeeks: 1000, onFire: [stock('hype', -10)] });
    const s = newFixtureState(3);
    for (let w = 0; w < 30; w++) {
      s.week = w;
      roll(s, s.ev, [d], fixtureHost);
      tickEffects(s, s.ev, fixtureHost);
    }
    expect(s.stockLog.filter((x) => x.id === 'hype')).toHaveLength(1);
    expect(s.metrics['hype']).toBe(20);
  });

  it('stocks clamp to their legal ranges', () => {
    const s = newFixtureState(1);
    applyEffects(s, s.ev, fixtureHost, 1, [stock('hype', 500), stock('climate', -9), stock('users', -1e12)], 0, false);
    expect(s.metrics['hype']).toBe(100);
    expect(s.metrics['climate']).toBe(-1);
    expect(s.metrics['users']).toBe(0);
  });

  it('modifier strength: none stays 1, linear is 1 - t/D, geometric multiplies (1 - 2/D) each week', () => {
    const e = (decay: 'none' | 'linear' | 'geometric') => ({ spec: mod('cacMul', 2, 10, decay), startWeek: 4, endWeek: 14 });
    expect(strengthAt(e('none'), 9)).toBe(1);
    expect(strengthAt(e('linear'), 4)).toBe(1);
    expect(strengthAt(e('linear'), 9)).toBeCloseTo(0.5, 12);
    expect(strengthAt(e('geometric'), 4)).toBe(1);
    expect(strengthAt(e('geometric'), 7)).toBeCloseTo(0.8 * 0.8 * 0.8, 12);
  });

  it('a mul effect of value v contributes 1 + (v - 1) s and expires at endWeek; an add contributes v s', () => {
    const s = newFixtureState(1);
    s.week = 10;
    applyEffects(s, s.ev, fixtureHost, 1, [mod('cacMul', 2, 10, 'linear'), mod('devPowerMul', 0.5, 4, 'none'), mod('burnMul', 0.25, 5, 'none', 'add')], 0, false);
    let t = tickEffects(s, s.ev, fixtureHost);
    expect(t.mul['cacMul']).toBeCloseTo(2, 12);
    s.week = 15;
    t = tickEffects(s, s.ev, fixtureHost);
    expect(t.mul['cacMul']).toBeCloseTo(1.5, 12); // linear, t = 5 of 10
    expect(t.mul['devPowerMul']).toBeUndefined(); // ended at week 14
    expect(t.add['burnMul']).toBeUndefined(); // ended at week 15
    s.week = 19;
    t = tickEffects(s, s.ev, fixtureHost);
    expect(t.mul['cacMul']).toBeCloseTo(1.1, 12);
    s.week = 20;
    t = tickEffects(s, s.ev, fixtureHost);
    expect(t.mul['cacMul']).toBeUndefined();
    expect(s.ev.active).toHaveLength(0);
  });

  it('adds sum over effects', () => {
    const s = newFixtureState(1);
    applyEffects(s, s.ev, fixtureHost, 1, [mod('burnMul', 0.25, 5, 'none', 'add'), mod('burnMul', 0.5, 5, 'none', 'add')], 0, false);
    expect(tickEffects(s, s.ev, fixtureHost).add['burnMul']).toBeCloseTo(0.75, 12);
  });

  it('multiplier totals clamp to [0.2, 5]', () => {
    const s = newFixtureState(1);
    applyEffects(s, s.ev, fixtureHost, 1, [mod('cacMul', 3, 10, 'none'), mod('cacMul', 3, 10, 'none'), mod('devPowerMul', 0.1, 10, 'none'), mod('devPowerMul', 0.1, 10, 'none')], 0, false);
    const t = tickEffects(s, s.ev, fixtureHost);
    expect(t.mul['cacMul']).toBe(MUL_MAX);
    expect(t.mul['devPowerMul']).toBe(MUL_MIN);
  });

  it('tickEffects is idempotent within a week', () => {
    const s = newFixtureState(1);
    applyEffects(s, s.ev, fixtureHost, 1, [mod('cacMul', 2, 20, 'geometric')], 0, false);
    s.week = 6;
    const a = JSON.stringify(tickEffects(s, s.ev, fixtureHost));
    expect(JSON.stringify(tickEffects(s, s.ev, fixtureHost))).toBe(a);
  });

  it('flag effects set a flag until the week and the host expires it', () => {
    const s = newFixtureState(1);
    s.week = 3;
    applyEffects(s, s.ev, fixtureHost, 1, [{ k: 'flag', key: 'officeClosed', value: true, durationWeeks: 2 }], 0, false);
    expect(s.flags['officeClosed']).toBe(true);
    s.week = 4;
    tickEffects(s, s.ev, fixtureHost);
    expect(s.flags['officeClosed']).toBe(true);
    s.week = 5;
    tickEffects(s, s.ev, fixtureHost);
    expect(s.flags['officeClosed']).toBeUndefined();
  });

  it('staff and round effects reach the host with a sampled count', () => {
    const s = newFixtureState(2);
    applyEffects(s, s.ev, fixtureHost, 4, [{ k: 'staff', op: 'poach', role: 'eng', count: { k: 'fixed', v: 2 } }, { k: 'round', op: 'cutTerms', frac: 0.15 }], 0, false);
    expect(s.staff).toEqual([{ op: 'poach', role: 'eng', n: 2 }]);
    expect(s.rounds).toEqual(['cutTerms']);
  });

  it('an onFire cash loss is bounded by 40 % of cash or 12 weeks of burn, whichever is larger', () => {
    const s = newFixtureState(1, { cash: 100_000_000, burnWeek: 100_000 });
    applyEffects(s, s.ev, fixtureHost, 1, [stock('cash', -900_000_000)], 0, true);
    expect(s.metrics['cash']).toBe(60_000_000); // lost 40 %
    const poor = newFixtureState(1, { cash: 1_000_000, burnWeek: 500_000 });
    applyEffects(poor, poor.ev, fixtureHost, 1, [stock('cash', -900_000_000)], 0, true);
    expect(poor.metrics['cash']).toBe(1_000_000 - 6_000_000); // 12 weeks of burn beats 40 % of a small bank
    const choice = newFixtureState(1, { cash: 100_000_000 });
    applyEffects(choice, choice.ev, fixtureHost, 1, [stock('cash', -90_000_000)], 100, false);
    expect(choice.metrics['cash']).toBe(10_000_000); // a player's own cost is not capped
  });
});
