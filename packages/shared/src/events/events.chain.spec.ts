/** AC-3 (part 2): chains stop at depth 4, a follow-up whose requires fail expires silently, the weekly cap is 2, severe events keep 8 weeks apart. */
import { describe, expect, it } from 'vitest';
import { def, fixtureHost, newFixtureState, type FixtureState } from './__fixtures__/host.ts';
import { autoResolve, choose, roll, tickEffects } from './engine.ts';
import { CHOICE_DEADLINE_WEEKS, MAX_NEW_EVENTS_PER_WEEK, SEVERE_GAP_WEEKS, type EventDef, type EventInstance } from './types.ts';

const SURE = 0.0001; // p = 1 - exp(-10000) = 1

function run(defs: EventDef[], weeks: number, s: FixtureState = newFixtureState(9)): EventInstance[] {
  const out: EventInstance[] = [];
  for (let w = 0; w < weeks; w++) {
    s.week = w;
    out.push(...roll(s, s.ev, defs, fixtureHost));
    tickEffects(s, s.ev, fixtureHost);
  }
  return out;
}

describe('events chains', () => {
  it('a chain stops at depth 4', () => {
    const fu = (to: string) => [{ eventId: to, delayWeeks: [1, 1] as [number, number], p: 1 }];
    const defs = [
      def('c.zero', { mtthWeeks: SURE, cooldownWeeks: 1000, followUps: fu('c.one'), onFire: [] }),
      def('c.one', { mtthWeeks: 0, followUps: fu('c.two') }),
      def('c.two', { mtthWeeks: 0, followUps: fu('c.three') }),
      def('c.three', { mtthWeeks: 0, followUps: fu('c.four') }),
      def('c.four', { mtthWeeks: 0, followUps: fu('c.five') }),
      def('c.five', { mtthWeeks: 0 }),
    ];
    const fired = run(defs, 20);
    expect(fired.map((i) => `${i.defId}@${i.chainDepth}`)).toEqual(['c.zero@0', 'c.one@1', 'c.two@2', 'c.three@3', 'c.four@4']);
    expect(fired.map((i) => i.firedWeek)).toEqual([0, 1, 2, 3, 4]);
    expect(Math.max(...fired.map((i) => i.chainDepth))).toBe(4);
    expect(fired.slice(1).every((i) => i.origin === 'chain')).toBe(true);
  });

  it('a follow-up whose requires fail by its due week expires silently', () => {
    const s = newFixtureState(1);
    const defs = [
      def('c.root', { mtthWeeks: SURE, cooldownWeeks: 1000, followUps: [{ eventId: 'c.child', delayWeeks: [3, 3], p: 1 }] }),
      def('c.child', { mtthWeeks: 0, requires: [{ flag: 'open' }] }),
    ];
    s.week = 0;
    expect(roll(s, s.ev, defs, fixtureHost).map((i) => i.defId)).toEqual(['c.root']);
    expect(s.ev.pending).toHaveLength(1);
    for (let w = 1; w <= 6; w++) {
      s.week = w;
      expect(roll(s, s.ev, defs, fixtureHost)).toEqual([]);
    }
    expect(s.ev.pending).toHaveLength(0);
    // the same chain with the flag set fires
    const t = newFixtureState(1);
    t.flags['open'] = true;
    expect(run(defs, 6, t).map((i) => i.defId)).toEqual(['c.root', 'c.child']);
  });

  it('follow-up probability p and the delay range come from counter draws', () => {
    let fired = 0;
    const n = 400;
    for (let seed = 0; seed < n; seed++) {
      const s = newFixtureState(seed);
      const defs = [def('c.root', { mtthWeeks: SURE, cooldownWeeks: 1000, followUps: [{ eventId: 'c.child', delayWeeks: [2, 5], p: 0.3 }] }), def('c.child', { mtthWeeks: 0 })];
      const out = run(defs, 12, s);
      const child = out.find((i) => i.defId === 'c.child');
      if (child) {
        fired++;
        expect(child.firedWeek).toBeGreaterThanOrEqual(2);
        expect(child.firedWeek).toBeLessThanOrEqual(5);
      }
    }
    expect(Math.abs(fired / n - 0.3)).toBeLessThan(0.08);
  });

  it('at most two new events fire in a week; the highest severity wins and the rest are counted as suppressed', () => {
    const defs = [def('e.a', { mtthWeeks: SURE, severity: 1 }), def('e.b', { mtthWeeks: SURE, severity: 3 }), def('e.c', { mtthWeeks: SURE, severity: 2 }), def('e.d', { mtthWeeks: SURE, severity: 3 })];
    const s = newFixtureState(1);
    const fired = roll(s, s.ev, defs, fixtureHost);
    expect(fired).toHaveLength(MAX_NEW_EVENTS_PER_WEEK);
    expect(fired.map((i) => i.defId)).toEqual(['e.b', 'e.d']); // ties by id
    expect(s.ev.counts['suppressed']).toBe(2);
  });

  it('two severity 4+ events never fire within eight weeks', () => {
    const defs = [def('s.big', { mtthWeeks: SURE, severity: 4 }), def('s.huge', { mtthWeeks: SURE, severity: 5 })];
    const fired = run(defs, 40);
    const weeks = fired.filter((i) => i.defId === 's.big' || i.defId === 's.huge').map((i) => i.firedWeek);
    expect(weeks.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < weeks.length; i++) expect((weeks[i] as number) - (weeks[i - 1] as number)).toBeGreaterThanOrEqual(SEVERE_GAP_WEEKS);
    expect(fired[0]?.defId).toBe('s.huge'); // the higher severity went first
  });

  it('an exclusive group admits one event at a time', () => {
    const defs = [def('x.one', { mtthWeeks: SURE, exclusiveGroup: 'rates', cooldownWeeks: 5 }), def('x.two', { mtthWeeks: SURE, exclusiveGroup: 'rates', cooldownWeeks: 5 })];
    const fired = run(defs, 30);
    for (let w = 0; w < 30; w++) expect(fired.filter((i) => i.firedWeek === w).length).toBeLessThanOrEqual(1);
    expect(fired.length).toBeGreaterThanOrEqual(5);
  });

  it('a choice event waits in the inbox with a deadline two weeks out and is auto-resolved with its default', () => {
    const d = def('p.choice', {
      mtthWeeks: SURE,
      cooldownWeeks: 1000,
      onFire: [{ k: 'metric', metric: 'hype', op: 'add', dist: { k: 'fixed', v: -5 }, durationWeeks: 0, decay: 'none' }],
      choices: [
        { id: 'keep', effects: [] },
        { id: 'pay', cost: [{ k: 'metric', metric: 'cash', op: 'add', dist: { k: 'fixed', v: -1000 }, durationWeeks: 0, decay: 'none' }], effects: [{ k: 'metric', metric: 'hype', op: 'add', dist: { k: 'fixed', v: 9 }, durationWeeks: 0, decay: 'none' }] },
      ],
      defaultChoiceId: 'keep',
    });
    const s = newFixtureState(1);
    s.week = 5;
    const [inst] = roll(s, s.ev, [d], fixtureHost);
    expect(inst?.deadlineWeek).toBe(5 + CHOICE_DEADLINE_WEEKS);
    expect(s.ev.inbox).toHaveLength(1);
    expect(s.metrics['hype']).toBe(25); // onFire applied before any choice
    s.week = 6;
    autoResolve(s, s.ev, [d], fixtureHost);
    expect(s.ev.inbox).toHaveLength(1);
    s.week = 7;
    autoResolve(s, s.ev, [d], fixtureHost);
    expect(s.ev.inbox).toHaveLength(0);
    expect(s.metrics['hype']).toBe(25); // the default 'keep' has no effect
    expect(s.ev.counts['p.choice.c.keep']).toBe(1);
  });

  it('choose pays the cost, applies the effects and removes the item; an unknown choice throws', () => {
    const d = def('p.choice2', {
      mtthWeeks: SURE,
      cooldownWeeks: 1000,
      choices: [
        { id: 'keep', effects: [] },
        { id: 'pay', cost: [{ k: 'metric', metric: 'cash', op: 'add', dist: { k: 'fixed', v: -1000 }, durationWeeks: 0, decay: 'none' }], effects: [{ k: 'metric', metric: 'hype', op: 'add', dist: { k: 'fixed', v: 9 }, durationWeeks: 0, decay: 'none' }], followUps: [{ eventId: 'p.after', delayWeeks: [1, 1], p: 1 }] },
      ],
      defaultChoiceId: 'keep',
    });
    const after = def('p.after', { mtthWeeks: 0 });
    const s = newFixtureState(1);
    const [inst] = roll(s, s.ev, [d, after], fixtureHost);
    expect(() => choose(s, s.ev, (inst as EventInstance).iid, 'nope', [d, after], fixtureHost)).toThrow();
    choose(s, s.ev, (inst as EventInstance).iid, 'pay', [d, after], fixtureHost);
    expect(s.metrics['cash']).toBe(100_000_000 - 1000);
    expect(s.metrics['hype']).toBe(39);
    expect(s.ev.inbox).toHaveLength(0);
    expect(s.ev.pending.map((p) => p.defId)).toEqual(['p.after']);
  });
});
