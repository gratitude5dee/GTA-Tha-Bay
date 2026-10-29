/**
 * M02g1 AC-2: the lit share of the windows by the hour (`look.json` `windows.litFrac`, `look/windows.ts`). Few windows are lit at dawn,
 * the old 55 to 85 % at 22:00, and the share never jumps: at most 0.05 per game minute, across midnight too.
 */
import { describe, expect, it } from 'vitest';
import { LOOK, lookErrors, type LookFile } from '../src/client/look/config.ts';
import { LIT_RANGE_FIXED, litRange, windowLitFraction } from '../src/client/look/windows.ts';
import { TIERS } from '@dv/engine/platform/tier-config';

describe('windowLitFraction', () => {
  it('is at most 0.3 at 06:30 (a few lit windows at dawn)', () => {
    expect(windowLitFraction(6.5)).toBeLessThanOrEqual(0.3);
    expect(litRange(6.5).max).toBeLessThanOrEqual(0.3);
  });

  it('is 0.55 to 0.85 at 22:00 (the range of the fixed share before M02g1)', () => {
    expect(windowLitFraction(22)).toBeGreaterThanOrEqual(0.55);
    expect(windowLitFraction(22)).toBeLessThanOrEqual(0.85);
    expect(litRange(22).min).toBeCloseTo(LIT_RANGE_FIXED.min, 9);
    expect(litRange(22).max).toBeCloseTo(LIT_RANGE_FIXED.max, 9);
  });

  it('never changes by more than 0.05 per game minute over the whole day, wrapping at midnight', () => {
    let worst = 0;
    for (let m = 0; m < 24 * 60; m++) {
      const a = litRange(m / 60);
      const b = litRange((m + 1) / 60);
      worst = Math.max(worst, Math.abs(b.min - a.min), Math.abs(b.max - a.max), Math.abs(windowLitFraction((m + 1) / 60) - windowLitFraction(m / 60)));
    }
    expect(worst).toBeLessThanOrEqual(0.05);
    // across midnight in both directions, and 24 h is 0 h
    expect(litRange(23.999).max).toBeCloseTo(litRange(0).max, 2);
    expect(litRange(24)).toEqual(litRange(0));
    expect(litRange(-1)).toEqual(litRange(23));
    expect(litRange(48 + 6.5)).toEqual(litRange(6.5));
  });

  it('always has min <= max and both in 0..1', () => {
    for (let m = 0; m < 24 * 60; m += 7) {
      const r = litRange(m / 60);
      expect(r.min).toBeGreaterThanOrEqual(0);
      expect(r.max).toBeLessThanOrEqual(1);
      expect(r.min).toBeLessThanOrEqual(r.max);
    }
  });

  it('is darkest around noon and highest in the evening', () => {
    expect(windowLitFraction(12)).toBeLessThan(windowLitFraction(6.5));
    expect(windowLitFraction(22)).toBeGreaterThan(windowLitFraction(18));
    expect(windowLitFraction(20)).toBeGreaterThan(windowLitFraction(16));
  });

  it('hits the rows of the table exactly at their hours', () => {
    for (const [hour, min, max] of LOOK.windows.litFrac) {
      const r = litRange(hour);
      expect(r.min).toBeCloseTo(min, 9);
      expect(r.max).toBeCloseTo(max, 9);
    }
  });

  it('falls back to the old fixed range for an empty table', () => {
    const empty = { ...LOOK, windows: { litFrac: [] } } as unknown as LookFile;
    expect(litRange(3, empty)).toEqual({ min: 0.55, max: 0.85 });
  });
});

describe('the windows table in look.json', () => {
  it('passes the structural check (rows increase in hour, min <= max)', () => {
    const shadowDistances = Object.fromEntries(Object.entries(TIERS).map(([t, v]) => [t, v.features.shadows.distanceM]));
    expect(lookErrors(LOOK, shadowDistances)).toEqual([]);
    const broken = JSON.parse(JSON.stringify(LOOK)) as LookFile;
    (broken.windows.litFrac as unknown as number[][])[2] = [1, 0.9, 0.1];
    expect(lookErrors(broken, shadowDistances).join('\n')).toMatch(/min 0.9 exceeds max 0.1|hours must increase/);
  });
});
