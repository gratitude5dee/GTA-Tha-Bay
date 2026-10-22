import { describe, expect, it } from 'vitest';
import { clampTerms, termSheetEnvelope, type EnvelopeCompany, type TermSheetEnvelope, type VcProfile } from './index.ts';

const usd = (d: number): number => d * 100;
const company = (o: Partial<EnvelopeCompany> = {}): EnvelopeCompany => ({
  week: 30, round: 'a', targetCents: usd(5_000_000), valuationRef: usd(25_000_000), reputation: 60, techDebt: 20, hype: 50, runwayWeeks: 40, founderControl: true, ...o,
});
const vc = (o: Partial<VcProfile> = {}): VcProfile => ({ id: 'vc-test', style: 'standard', valuationBias: 0, checkMin: usd(1_000_000), checkMax: usd(20_000_000), predatoryAllowed: false, redFlags: [], ...o });
const env = (r: TermSheetEnvelope | { pass: true }): TermSheetEnvelope => {
  if ('pass' in r) throw new Error('unexpected pass');
  return r;
};

describe('termSheetEnvelope', () => {
  it('FOMO never exceeds 1,500 bp however many rival sheets there are', () => {
    for (const n of [0, 1, 2, 3, 5, 40]) {
      const e = env(termSheetEnvelope(company(), vc(), 0, n, 50));
      expect(e.fomoBonusBp).toBeLessThanOrEqual(1500);
      expect(e.fomoBonusBp).toBe(Math.min(1500, Math.round(600 * n)));
    }
  });

  it('an empty amount band returns Pass', () => {
    expect(termSheetEnvelope(company({ targetCents: usd(100_000_000) }), vc(), 0, 0, 50)).toEqual({ pass: true, reason: 'ask_too_high' });
    expect(termSheetEnvelope(company({ targetCents: usd(100_000) }), vc(), 0, 0, 50)).toEqual({ pass: true, reason: 'ask_too_low' });
  });

  it('an empty dilution band returns Pass', () => {
    // A valuation far above what the 15 % to 27 % dilution band allows for this amount
    const r = termSheetEnvelope(company({ valuationRef: usd(2_000_000_000) }), vc(), 0, 0, 50);
    expect(r).toMatchObject({ pass: true });
    const low = termSheetEnvelope(company({ valuationRef: usd(100_000) }), vc(), 0, 0, 50);
    expect(low).toMatchObject({ pass: true });
  });

  it('participating or a multiple above 1 appears only for a predatory VC under stress', () => {
    const tourist = vc({ predatoryAllowed: true });
    const calm = env(termSheetEnvelope(company(), tourist, 0, 0, 50));
    expect(calm.liq).toEqual({ multiple: 1, participating: false });
    const bust = env(termSheetEnvelope(company(), tourist, -0.5, 0, 50));
    expect(bust.liq.participating).toBe(true);
    const short = env(termSheetEnvelope(company({ runwayWeeks: 8 }), tourist, 0, 0, 50));
    expect(short.liq.multiple).toBeGreaterThan(1);
    const honest = env(termSheetEnvelope(company({ runwayWeeks: 8 }), vc(), -0.9, 0, 50));
    expect(honest.liq).toEqual({ multiple: 1, participating: false });
    // the lure: the pre-money band is 10 % higher under stress
    const plain = env(termSheetEnvelope(company({ runwayWeeks: 40 }), tourist, -0.31, 0, 50));
    expect(plain.liq.participating).toBe(true);
  });

  it('walk-away at reputation < 20, tech debt > 80 or mood < 10', () => {
    expect(env(termSheetEnvelope(company({ reputation: 19 }), vc(), 0, 0, 50)).walkAway).toMatchObject({ ok: false, reason: 'red_flag' });
    expect(env(termSheetEnvelope(company({ techDebt: 81 }), vc(), 0, 0, 50)).walkAway).toMatchObject({ ok: false });
    expect(env(termSheetEnvelope(company(), vc(), 0, 0, 9)).walkAway).toMatchObject({ ok: false, reason: 'mood_floor' });
    expect(env(termSheetEnvelope(company({ reputation: 20, techDebt: 80 }), vc(), 0, 0, 10)).walkAway).toBeNull();
    expect(env(termSheetEnvelope(company({ founderControl: false }), vc({ style: 'founder_friendly', redFlags: ['noFounderControl'] }), 0, 0, 50)).walkAway).toMatchObject({ reason: 'red_flag' });
  });

  it('the midpoint at mood 50 with a neutral style is the band centre', () => {
    const e = env(termSheetEnvelope(company(), vc(), 0, 0, 50));
    expect(e.midpoint.amount).toBe(Math.round((e.amount[0] + e.amount[1]) / 2));
    expect(e.midpoint.preMoney).toBe(Math.round((e.preMoney[0] + e.preMoney[1]) / 2));
    expect(e.midpoint.poolTargetBp).toBe(Math.round((e.poolTargetBp[0] + e.poolTargetBp[1]) / 2));
    const hi = env(termSheetEnvelope(company(), vc(), 0, 0, 90));
    expect(hi.midpoint.preMoney).toBeGreaterThan(e.midpoint.preMoney - 1);
    const hard = env(termSheetEnvelope(company(), vc({ style: 'hardball' }), 0, 0, 50));
    expect(hard.midpoint.preMoney).toBeLessThan(e.midpoint.preMoney + 1);
  });

  it('is a pure function and validUntilWeek is two weeks out', () => {
    const a = termSheetEnvelope(company(), vc(), 0.1, 1, 55);
    const b = termSheetEnvelope(company(), vc(), 0.1, 1, 55);
    expect(a).toEqual(b);
    expect(env(a).validUntilWeek).toBe(32);
  });

  it('a SAFE has a cap band and no pool or board', () => {
    const e = env(termSheetEnvelope(company({ round: 'safe', targetCents: usd(500_000), valuationRef: usd(6_000_000) }), vc({ checkMin: usd(50_000), checkMax: usd(1_000_000) }), 0, 0, 50));
    expect(e.safeCap).toBeDefined();
    expect(e.poolTargetBp).toEqual([0, 0]);
    expect(e.boardSeat).toBe(false);
  });

  it('clampTerms clamps every field and names it', () => {
    const e = env(termSheetEnvelope(company(), vc(), 0, 0, 50));
    const { terms, clamped } = clampTerms({ amount: e.amount[1] * 3, preMoney: 1, poolTargetBp: 9000, boardSeat: true, liq: { multiple: 2, participating: true } }, { ...e, boardSeat: false });
    expect(terms.amount).toBe(e.amount[1]);
    expect(terms.preMoney).toBe(e.preMoney[0]);
    expect(terms.poolTargetBp).toBe(e.poolTargetBp[1]);
    expect(terms.boardSeat).toBe(false);
    expect(terms.liq).toEqual(e.liq);
    expect(clamped).toEqual(['amount', 'preMoney', 'poolTargetBp', 'boardSeat', 'liq']);
  });
});
