import { describe, expect, it } from 'vitest';
import { FLICKER_THRESHOLD, flickerLimit, flickerShare } from './flicker.ts';
import type { Rgba } from './image-diff.ts';

const flat = (w: number, h: number, v: number): Rgba => {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([v, v, v, 255], i * 4);
  return { width: w, height: h, data };
};

describe('flicker measure (M02g2)', () => {
  it('is 0 for identical images and 1 when every pixel moves past the threshold', () => {
    expect(flickerShare(flat(8, 4, 100), flat(8, 4, 100))).toBe(0);
    expect(flickerShare(flat(8, 4, 100), flat(8, 4, 100 + FLICKER_THRESHOLD + 1))).toBe(1);
  });

  it('counts a pixel only above the threshold, on its largest colour channel, and ignores alpha', () => {
    const a = flat(4, 4, 50);
    const b = flat(4, 4, 50);
    b.data[0] = 50 + FLICKER_THRESHOLD; // exactly at the threshold: not counted
    b.data[4 + 2] = 50 + FLICKER_THRESHOLD + 1; // blue channel over: counted
    b.data[8 + 3] = 0; // alpha only: not counted
    expect(flickerShare(a, b)).toBeCloseTo(1 / 16, 12);
  });

  it('refuses images of different sizes', () => {
    expect(() => flickerShare(flat(2, 2, 0), flat(4, 2, 0))).toThrow(/sizes differ/);
  });

  it('limits a pair to half its baseline, with a floor for a quiet pair', () => {
    expect(flickerLimit(0.2)).toBeCloseTo(0.1, 12);
    expect(flickerLimit(0)).toBe(0.0005);
    expect(flickerLimit(0.0004)).toBe(0.0005);
  });
});
