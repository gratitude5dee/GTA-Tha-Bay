/** AC-2: adding a def never shifts another def's roll, and ctrU32 equals the M01a1 golden vectors. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ctrU32 } from '../rng.ts';
import { def, fixtureHost, newFixtureState } from './__fixtures__/host.ts';
import { roll } from './engine.ts';
import { ctrFloat, ctrU32 as ctrU32FromEvents } from './rng.ts';
import type { EventDef } from './types.ts';

interface Golden {
  cases: { seed: number; stream: string; counter: number; out: number }[];
}
const golden = JSON.parse(readFileSync(new URL('../../test/golden/ctr.v1.json', import.meta.url), 'utf8')) as Golden;

function history(defs: EventDef[], seed: number, weeks: number): Record<string, number[]> {
  const s = newFixtureState(seed);
  const out: Record<string, number[]> = {};
  for (let w = 0; w < weeks; w++) {
    s.week = w;
    for (const i of roll(s, s.ev, defs, fixtureHost)) (out[i.defId] ??= []).push(w);
  }
  return out;
}

describe('events counter rng', () => {
  it('ctrU32 of the events module equals the M01a1 golden file', () => {
    expect(golden.cases.length).toBeGreaterThan(50);
    for (const c of golden.cases) {
      expect(ctrU32FromEvents(c.seed, c.stream, c.counter)).toBe(c.out);
      expect(ctrU32(c.seed, c.stream, c.counter)).toBe(c.out);
    }
  });

  it('ctrFloat is ctrU32 / 2^32 and lies in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const u = ctrFloat(9, 'ev:x', i);
      expect(u).toBe(ctrU32(9, 'ev:x', i) / 4294967296);
      expect(u >= 0 && u < 1).toBe(true);
    }
  });

  it('inserting one extra def at any position leaves every other def firing in the same weeks', () => {
    const base: EventDef[] = ['a.one', 'b.two', 'c.three', 'd.four', 'e.five'].map((id, i) => def(id, { mtthWeeks: 12 + 7 * i }));
    const want = history(base, 4242, 600);
    expect(Object.keys(want).length).toBe(5);
    for (let pos = 0; pos <= base.length; pos++) {
      // the extra def never fires itself (huge MTTH), so the weekly cap cannot couple it to the others
      const extra = def('c.zzz_extra', { mtthWeeks: 1e12 });
      const list = [...base.slice(0, pos), extra, ...base.slice(pos)];
      expect(history(list, 4242, 600), `inserted at ${pos}`).toEqual(want);
    }
  });

  it('the roll of a def depends on (seed, id, week) only: reversing the list changes nothing', () => {
    const base: EventDef[] = ['a.one', 'b.two', 'c.three'].map((id) => def(id, { mtthWeeks: 30 }));
    expect(history([...base].reverse(), 7, 400)).toEqual(history(base, 7, 400));
  });
});
