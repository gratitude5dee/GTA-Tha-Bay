/** TV-1 .. TV-11 and WF-1 .. WF-7 of 08-tycoon-finance.md section 7, exactly (cents; the reference values win over any derivation). */
import { describe, expect, it } from 'vitest';
import {
  addSafe,
  assertConserved,
  convertSafes,
  initialCapTable,
  poolAvailable,
  priceRound,
  waterfall,
  type CapTable,
  type Conversion,
  type PricedResult,
  type Safe,
} from './index.ts';

const usd = (d: number): number => d * 100;
const ctx = { id: 'r1', kind: 'a' as const, week: 10, leadInvestorId: 'vc:a', liq: { multiple: 1 as const, participating: false }, boardSeats: 1 };
const cap1: Safe = { id: '1', investorId: 'vc:s1', amount: usd(500_000), signedWeek: 1, type: 'cap', postMoneyCap: usd(6_700_000) };

const ok = <T>(r: T | { ok: false; code: string }): T => {
  if (typeof r === 'object' && r !== null && 'ok' in r && (r as { ok: unknown }).ok === false) throw new Error(`unexpected error ${(r as { code: string }).code}`);
  return r as T;
};
const withSafes = (...s: Safe[]): CapTable => {
  let t = initialCapTable();
  for (const x of s) t = ok(addSafe(t, x) as { ok: true; table: CapTable }).table;
  return t;
};
const pct = (n: number, d: number): number => (n / d) * 100;

describe('finance vectors (section 7)', () => {
  it('TV-1 one post-money cap SAFE, no round', () => {
    const c = ok(convertSafes(withSafes(cap1), null)) as Conversion;
    expect(c.sharesBySafe['1']).toBe(806_451);
    expect(Math.abs(pct(806_451, 10_806_451) - 7.4627)).toBeLessThan(1e-4);
  });

  it('TV-2 two caps', () => {
    const a: Safe = { id: 'a', investorId: 'vc:a', amount: usd(500_000), signedWeek: 1, type: 'cap', postMoneyCap: usd(5_500_000) };
    const b: Safe = { id: 'b', investorId: 'vc:b', amount: usd(500_000), signedWeek: 2, type: 'cap', postMoneyCap: usd(8_300_000) };
    const c = ok(convertSafes(withSafes(a, b), null)) as Conversion;
    expect(c.sharesBySafe['a']).toBe(1_070_967);
    expect(c.sharesBySafe['b']).toBe(709_677);
    expect(c.N).toBe(1_780_644);
    expect(Math.abs(pct(1_780_644, 11_780_644) - 15.115)).toBeLessThan(1e-3);
  });

  it('TV-3 SAFE then priced round pre $12 M, $3 M, q 1,000 bp', () => {
    const r = ok(priceRound(withSafes(cap1), { preMoney: usd(12_000_000), amount: usd(3_000_000), poolTargetBp: 1000 }, ctx)) as PricedResult;
    expect(r.X).toBe(11_207_373);
    expect(r.T).toBe(400_922);
    expect(r.newShares).toBe(2_801_843);
    expect(r.postFd).toBe(14_009_216);
    expect(r.priceMicros).toBe(1_070_723);
    const t = r.table;
    expect(t.holders.find((h) => h.id === 'f1')?.shares.common).toBe(9_000_000);
    expect(Math.abs(pct(9_000_000, 14_009_216) - 64.2434)).toBeLessThan(1e-4);
    expect(t.holders.find((h) => h.id === 'vc:s1')?.shares['pref-safe-1']).toBe(806_451);
    expect(pct(r.newShares, r.postFd)).toBeGreaterThanOrEqual(19.9999);
    expect(poolAvailable(t)).toBe(1_400_922);
    expect(Math.abs(pct(poolAvailable(t), r.postFd) - 10)).toBeLessThan(1e-4);
    expect(assertConserved(t, true)).toBeNull();
  });

  it('TV-4 no SAFE, pre $8 M, $2 M, q 1,000', () => {
    const r = ok(priceRound(initialCapTable(), { preMoney: usd(8_000_000), amount: usd(2_000_000), poolTargetBp: 1000 }, ctx)) as PricedResult;
    expect([r.X, r.T, r.newShares, r.postFd, r.priceMicros, poolAvailable(r.table)]).toEqual([10_285_715, 285_715, 2_571_428, 12_857_143, 777_777, 1_285_715]);
  });

  it('TV-5 pool already above target: no top-up', () => {
    const t = initialCapTable();
    t.holders[0]!.shares.common = 9_000_000;
    t.pool = { authorized: 3_000_000, granted: 0 };
    t.totalFd = 12_000_000;
    const r = ok(priceRound(t, { preMoney: usd(8_000_000), amount: usd(2_000_000), poolTargetBp: 1000 }, ctx)) as PricedResult;
    expect([r.T, r.X, r.newShares, r.postFd]).toEqual([0, 12_000_000, 3_000_000, 15_000_000]);
    expect(pct(poolAvailable(r.table), r.postFd)).toBe(20);
  });

  const capDisc: Safe = { id: '1', investorId: 'vc:s1', amount: usd(500_000), signedWeek: 1, type: 'capDiscount', postMoneyCap: usd(6_700_000), discountBp: 8000 };

  it('TV-6 the discount binds (capDiscount)', () => {
    const r = ok(priceRound(withSafes(capDisc), { preMoney: usd(8_000_000), amount: usd(2_000_000), poolTargetBp: 1000 }, ctx)) as PricedResult;
    expect(r.conversion.sharesBySafe['1']).toBe(882_352);
    expect([r.X, r.T, r.newShares, r.postFd, r.priceMicros]).toEqual([11_294_117, 411_765, 2_823_529, 14_117_646, 708_333]);
    expect(r.conversion.iterations).toBe(5);
  });

  it('TV-7 the cap binds in the larger round', () => {
    const r = ok(priceRound(withSafes(capDisc), { preMoney: usd(12_000_000), amount: usd(3_000_000), poolTargetBp: 1000 }, ctx)) as PricedResult;
    expect(r.conversion.sharesBySafe['1']).toBe(806_451);
    expect(r.conversion.iterations).toBe(0);
  });

  it('TV-8 a discount-only SAFE converts to the same 882,352 shares', () => {
    const d: Safe = { id: '1', investorId: 'vc:s1', amount: usd(500_000), signedWeek: 1, type: 'discount', discountBp: 8000 };
    const r = ok(priceRound(withSafes(d), { preMoney: usd(8_000_000), amount: usd(2_000_000), poolTargetBp: 1000 }, ctx)) as PricedResult;
    expect(r.conversion.sharesBySafe['1']).toBe(882_352);
    expect(r.conversion.iterations).toBeLessThanOrEqual(16);
  });

  it('TV-9 an MFN SAFE inherits the later cap', () => {
    const mfn: Safe = { id: 'm', investorId: 'vc:m', amount: usd(1_000_000), signedWeek: 1, type: 'mfn' };
    const cap: Safe = { id: 'c', investorId: 'vc:c', amount: usd(500_000), signedWeek: 2, type: 'cap', postMoneyCap: usd(6_700_000) };
    const r = ok(priceRound(withSafes(mfn, cap), { preMoney: usd(12_000_000), amount: usd(3_000_000), poolTargetBp: 1000 }, ctx)) as PricedResult;
    expect(r.conversion.sharesBySafe['m']).toBe(1_923_076);
    expect(r.conversion.sharesBySafe['c']).toBe(961_538);
    expect([r.X, r.T, r.newShares, r.postFd]).toEqual([13_582_416, 697_802, 3_395_604, 16_978_020]);
  });

  it('TV-10 a SAFE stack with F >= 0.5 is refused and changes nothing', () => {
    let t = initialCapTable();
    let refused: unknown = null;
    for (let i = 0; i < 5; i++) {
      const r = addSafe(t, { id: `s${i}`, investorId: `vc:${i}`, amount: usd(1_000_000), signedWeek: i, type: 'cap', postMoneyCap: usd(2_000_000) });
      if ('ok' in r && r.ok === false) {
        refused = r;
        break;
      }
      t = (r as { table: CapTable }).table;
    }
    expect(refused).toEqual({ ok: false, code: 'SAFE_STACK_LIMIT' });
    expect(t.safes.length).toBeLessThan(5);
    const before = JSON.stringify(t);
    addSafe(t, { id: 'x', investorId: 'vc:x', amount: usd(1_000_000), signedWeek: 9, type: 'cap', postMoneyCap: usd(2_000_000) });
    expect(JSON.stringify(t)).toBe(before);
  });

  it('TV-11 infeasible terms', () => {
    const r = priceRound(initialCapTable(), { preMoney: usd(8_000_000), amount: usd(1_000_000), poolTargetBp: 9000 }, ctx);
    expect(r).toMatchObject({ ok: false, code: 'TERMS_INFEASIBLE' });
  });
});

describe('waterfall vectors (TV-3 table after the round)', () => {
  const after = (liq = { multiple: 1 as 1 | 1.5 | 2, participating: false }): CapTable =>
    (ok(priceRound(withSafes(cap1), { preMoney: usd(12_000_000), amount: usd(3_000_000), poolTargetBp: 1000 }, { ...ctx, liq })) as PricedResult).table;
  const row = (E: number, t = after()): [number, number, number] => {
    const p = waterfall(usd(E), t);
    expect(Object.values(p.byClass).reduce((a, b) => a + b, 0)).toBe(usd(E));
    return [p.byClass['pref-safe-1'] as number, p.byClass['pref-a'] as number, p.byClass['common'] as number];
  };
  it('WF-1 below the preferences', () => expect(row(2_000_000)).toEqual([28_571_428, 171_428_571, 1]));
  it('WF-2 exactly the stack', () => expect(row(3_500_000)).toEqual([50_000_000, 300_000_000, 0]));
  it('WF-3 the SAFE converts, A holds its preference', () => expect(row(10_000_000)).toEqual([57_565_749, 300_000_000, 642_434_251]));
  it('WF-4', () => expect(row(13_000_000)).toEqual([82_236_784, 300_000_000, 917_763_216]));
  it('WF-5 both convert', () => expect(row(14_000_000)).toEqual([89_546_722, 311_111_098, 999_342_180]));
  it('WF-6', () => expect(row(20_000_000)).toEqual([127_923_888, 444_444_426, 1_427_631_686]));
  it('WF-7 Series A at 2x participating', () => expect(row(10_000_000, after({ multiple: 2, participating: true }))).toEqual([50_000_000, 683_092_534, 266_907_466]));
});
