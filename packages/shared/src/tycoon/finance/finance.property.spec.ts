/** Property suite (finance section 7): 200 seeded random cap tables and exit values. */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../rng.ts';
import { addSafe, assertConserved, cloneTable, initialCapTable, priceRound, waterfall, type CapTable, type PricedResult, type Safe } from './index.ts';

const KINDS = ['seed', 'a', 'b', 'c'] as const;

function randomTable(seed: number): CapTable {
  const r = new Rng(seed);
  const int = (lo: number, hi: number): number => lo + Math.floor(r.nextFloat() * (hi - lo + 1));
  let t = initialCapTable(r.nextFloat() < 0.3);
  const nSafes = int(0, 2);
  for (let i = 0; i < nSafes; i++) {
    const type = (['cap', 'discount', 'capDiscount', 'mfn'] as const)[int(0, 3)] as Safe['type'];
    const s: Safe = { id: `s${i}`, investorId: `vc:s${i}`, amount: int(5, 150) * 1_000_000, signedWeek: i, type };
    if (type === 'cap' || type === 'capDiscount') s.postMoneyCap = int(40, 300) * 100_000_000;
    if (type === 'discount' || type === 'capDiscount') s.discountBp = int(6, 9) * 1000 - (type === 'discount' ? 0 : 500);
    const res = addSafe(t, s);
    if ('table' in res) t = res.table;
  }
  const nRounds = int(0, 2);
  for (let i = 0; i < nRounds; i++) {
    const kind = KINDS[i] as (typeof KINDS)[number];
    const mult = ([1, 1.5, 2] as const)[int(0, 2)] as 1 | 1.5 | 2;
    const pre = int(40, 400) * 100_000_000;
    const amount = Math.floor((pre * int(8, 25)) / 100);
    const res = priceRound(t, { preMoney: pre, amount, poolTargetBp: int(300, 1200) }, { id: `r${i}`, kind, week: 10 + i, leadInvestorId: `vc:r${i}`, liq: { multiple: mult, participating: r.nextFloat() < 0.3 }, boardSeats: 0 });
    if ('table' in res) {
      t = res.table;
      expect(assertConserved(t)).toBeNull();
    }
  }
  return t;
}

describe('finance properties', () => {
  it('200 tables: shares conserved, sum of payouts is E, no payout above E, class payouts monotone in E', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const t = randomTable(seed);
      expect(assertConserved(t)).toBeNull();
      const r = new Rng(seed * 7919);
      const es = Array.from({ length: 14 }, () => Math.floor(r.nextFloat() * 4_000_000_000)).sort((a, b) => a - b);
      let prev: Record<string, number> = {};
      // BD-M09a1-04: the cents that the floors leave over go to common, so a class may dip by at most one cent per class between two E.
      const slack = Object.keys(waterfall(1, t).byClass).length;
      for (const E of es) {
        const p = waterfall(E, t);
        let sum = 0;
        for (const [k, v] of Object.entries(p.byClass)) {
          sum += v;
          expect(v, `seed ${seed} E ${E} class ${k}`).toBeGreaterThanOrEqual(0);
          expect(v, `seed ${seed} E ${E} class ${k} above E`).toBeLessThanOrEqual(E);
          expect(v, `seed ${seed} class ${k} not monotone at E ${E}`).toBeGreaterThanOrEqual((prev[k] ?? 0) - slack);
        }
        expect(sum, `seed ${seed} E ${E}`).toBe(E);
        expect(Object.values(p.byHolder).reduce((a, b) => a + b, 0)).toBe(E);
        prev = p.byClass;
      }
    }
  });

  it('200 tables: the waterfall does not depend on holder or SAFE insertion order', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const t = randomTable(seed);
      const u = cloneTable(t);
      u.holders.reverse();
      u.safes.reverse();
      u.rounds.reverse();
      const E = 100_000_000 + seed * 13_000_000;
      expect(waterfall(E, u).byClass, `seed ${seed}`).toEqual(waterfall(E, t).byClass);
    }
  });

  it('conservation holds after every operation of a long chain of rounds', () => {
    let t = initialCapTable();
    for (let i = 0; i < 4; i++) {
      const res = priceRound(t, { preMoney: (20 + i * 40) * 100_000_000, amount: (5 + i * 10) * 100_000_000, poolTargetBp: 800 }, { id: `r${i}`, kind: (['seed', 'a', 'b', 'c'] as const)[i] as 'seed', week: i, leadInvestorId: `vc:${i}`, liq: { multiple: 1, participating: false }, boardSeats: 0 }) as PricedResult;
      t = res.table;
      expect(assertConserved(t, true)).toBeNull();
    }
    expect(t.totalFd).toBeGreaterThan(10_000_000);
  });
});
